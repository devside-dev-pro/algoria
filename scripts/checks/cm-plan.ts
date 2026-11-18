// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/cm-plan.ts
//
// La refonte du CM (10/11/2026) : le plan du jour (4 à 5 posts, jamais deux formats identiques de suite, espacement),
// le filtre des tournures interdites et du guide de ton, l'anti-répétition sur les premières lignes, la phrase de risque,
// le sondage, le trade commenté de secours et le choix des photos. Aucun appel réseau, aucune base.
import { buildDayPlan, hasConsecutiveRepeat, MIN_GAP_MIN, WINDOWS } from '../../lib/channel/plan';
import { emojisOf, firstLine, similarity, toneIssue } from '../../lib/channel/tone';
import { check as guard, checkPoll, stripRisk, withRisk } from '../../lib/channel/writer';
import { guardTrade, tradeFallback } from '../../lib/channel/cm';
import { pickFresh } from '../../lib/channel/photos';
import { tradingTimeMs } from '../../lib/display/tradingDay';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}
/** un tirage reproductible (mulberry32) */
const seeded = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const RISK = "Trading involves risk. Past results don't guarantee future results.";

// ── LE PLAN ──────────────────────────────────────────────────────────────────────────────────────────
{
  const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
  let bad = { count: 0, repeat: 0, gap: 0, window: 0, cta: 0, ctaAdj: 0, first: 0, tradeWeekend: 0, early: 0, dup: 0 };
  const minutes = new Map<string, Set<number>>();
  let prevKind: string | null = null;
  for (let n = 0; n < 2000; n++) {
    const day = days[n % days.length];
    const weekend = ['2026-11-14', '2026-11-15'].includes(day);
    const rand = seeded(n + 1);
    const plan = buildDayPlan({ day, weekend, timeMs: (h) => tradingTimeMs(day, h), rand, prevKind, trades: !weekend, ...(n % 9 === 0 ? { ctas: 2 as const } : {}) });
    const kinds = plan.map((p) => p.kind);
    if (plan.length < 4 || plan.length > 5) bad.count++;
    if (hasConsecutiveRepeat(kinds, prevKind)) bad.repeat++;
    for (let i = 1; i < plan.length; i++) if (plan[i].at - plan[i - 1].at < MIN_GAP_MIN * 60_000) bad.gap++;
    const wins = WINDOWS[weekend ? 'weekend' : 'weekday'];
    if (plan.some((p) => p.at < tradingTimeMs(day, wins[0][0]) || p.at > tradingTimeMs(day, wins[wins.length - 1][1]))) bad.window++;
    const ctas = kinds.filter((k) => k === 'cta').length;
    if (ctas < 1 || ctas > 2) bad.cta++;
    if (kinds.some((k, i) => k === 'cta' && kinds[i + 1] === 'cta')) bad.ctaAdj++;
    if (kinds[0] !== 'backstage') bad.first++;
    if (weekend && kinds.includes('trade')) bad.tradeWeekend++;
    if (kinds.indexOf('trade') >= 0 && plan[kinds.indexOf('trade')].at < tradingTimeMs(day, '13:30')) bad.early++;
    if (new Set(kinds.filter((k) => k !== 'cta')).size !== kinds.filter((k) => k !== 'cta').length) bad.dup++;
    plan.forEach((p) => { const k = `${day.slice(8)}:${p.slot}`; if (!minutes.has(k)) minutes.set(k, new Set()); minutes.get(k)!.add(p.at); });
    prevKind = kinds[kinds.length - 1];
  }
  check('plan : toujours 4 ou 5 posts', bad.count === 0, String(bad.count));
  check('plan : jamais deux formats identiques de suite (veille comprise)', bad.repeat === 0, String(bad.repeat));
  check(`plan : au moins ${MIN_GAP_MIN} min entre deux posts (place aux bulles de Mathieu)`, bad.gap === 0, String(bad.gap));
  check('plan : toutes les heures dans les fenêtres', bad.window === 0, String(bad.window));
  check('plan : 1 ou 2 CTA (2 boutons par jour au plus)', bad.cta === 0, String(bad.cta));
  check('plan : jamais deux CTA collés', bad.ctaAdj === 0, String(bad.ctaAdj));
  check('plan : les coulisses ouvrent la journée', bad.first === 0, String(bad.first));
  check('plan : pas de trade commenté le week-end', bad.tradeWeekend === 0, String(bad.tradeWeekend));
  check('plan : pas de trade commenté avant 13h30', bad.early === 0, String(bad.early));
  check('plan : au plus un post de chaque format (hors CTA)', bad.dup === 0, String(bad.dup));
  // le vrai hasard : pour un même jour et un même créneau, les heures changent d'un tirage à l'autre (l'ancien jitter
  // donnait toujours la même, et glissait de −2 min par jour)
  check('plan : heures vraiment tirées (≥ 20 heures différentes par créneau)', [...minutes.values()].every((v) => v.size >= 20), [...minutes.entries()].map(([k, v]) => `${k}=${v.size}`).slice(0, 5).join(' '));
  const all = buildDayPlan({ day: '2026-11-10', weekend: false, timeMs: (h) => tradingTimeMs('2026-11-10', h), rand: seeded(7), trades: true, count: 5 });
  check('plan : 5 posts si demandé', all.length === 5);
  check('plan : heures à la minute ronde', all.every((p) => p.at % 60_000 === 0));
  const noTrade = buildDayPlan({ day: '2026-11-10', weekend: false, timeMs: (h) => tradingTimeMs('2026-11-10', h), rand: seeded(3), trades: false });
  check('plan : cartes de gain coupées → pas de trade commenté', !noTrade.some((p) => p.kind === 'trade'));
  const formats = new Set<string>();
  for (let n = 0; n < 300; n++) buildDayPlan({ day: '2026-11-10', weekend: false, timeMs: (h) => tradingTimeMs('2026-11-10', h), rand: seeded(n), trades: true }).forEach((p) => formats.add(p.kind));
  check('plan : les 8 formats sortent tous', ['backstage', 'gold', 'qa', 'story', 'trade', 'poll', 'lesson', 'cta'].every((f) => formats.has(f)), [...formats].join(','));
}

// ── LE FILTRE DES INTERDITS ET DU TON ─────────────────────────────────────────────────────────────────
{
  const ok = 'I spent the morning answering your messages.\n\nMost of you ask the same thing : do I need to know trading ?\n\nNo. The AI does it, your account copies it.';
  check('ton : un texte simple passe', toneIssue(ok) === null, String(toneIssue(ok)));
  for (const [bad, why] of [
    ['Tuesday morning from me ☕\n\nThe AI is working.', 'ouvre sur le jour'],
    ['Happy Friday everyone\n\nSee you Monday.', 'Happy Friday'],
    ['<b>Wednesday</b>, hi from me\n\nok', 'jour en gras'],
    ['🔵💙 HOW IT WORKS\n<b>Who trades ?</b>', 'en-tête'],
    ['Quick one for you\n\nok', 'quick one'],
    ['Ask me anything.\n\nNo pitch, promise.', 'no pitch'],
    ['Write to me.\n\nI reply myself.', 'I reply myself'],
    ['The AI is already on gold.\n\nok', 'already on gold'],
    ['It works for you while you live your day.', 'while you live your day'],
    ['Stuck halfway through the setup ?\n\nWrite to me.', 'stuck halfway'],
    ['The guide is ready.\n\nTap below to open it.', 'tap below'],
    ['Every trade is there.\n\nNothing hidden.', 'nothing hidden'],
    ['A <b>first</b> and a <b>second</b> bold.', 'deux gras'],
    ['Three emojis 🚀 here 💙 now ✅', '3 emojis'],
    ['Thanks for being here 🙏🏼 really 🙏🏼', '🙏🏼 deux fois'],
  ] as Array<[string, string]>) check(`ton : refusé (${why})`, toneIssue(bad, { hasButton: true }) !== null);
  check('ton : 🙏🏼 refusé si déjà passé cette semaine', toneIssue('Thanks for being here 🙏🏼', { rationedUsed: new Set(['pray']) }) !== null);
  check('ton : 🙏🏼 accepté une fois sinon', toneIssue('Thanks for being here 🙏🏼', { rationedUsed: new Set() }) === null);
  check('ton : 🙌🏻 refusé si déjà passé cette semaine', toneIssue('Big day 🙌🏻', { rationedUsed: new Set(['raise']) }) !== null);
  check('ton : un CTA ne finit pas par 👇', toneIssue('The guide is under this post 👇', { hasButton: true }) !== null);
  check('ton : un CTA peut parler de son bouton', toneIssue('The guide is just under this post, have a look.', { hasButton: true }) === null);
  check('ton : sans bouton, pas de 👇 du tout', toneIssue('Look 👇 here', { hasButton: false }) !== null);
  check('ton : 2 emojis acceptés', toneIssue('Good one ✅\n\nSee you tonight 💙') === null);
  check('ton : un emoji à teint compte pour un', emojisOf('👋🏽').length === 1);
  check('ton : le récap garde son en-tête', toneIssue('🔵💙 DAY RECAP\n\nok', { allowHeader: true }) === null);
  // le garde-fou complet (writer.ts) refuse aussi, et les anciennes règles tiennent toujours
  const base = { tokens: {}, noButton: true, allowedUsd: [] as number[], tone: { openings: [] as string[] } };
  check('garde-fou : « quick one » refusé', !guard('Quick one : the app is free.', base).ok);
  check('garde-fou : promesse toujours refusée', !guard('You will earn every day.', base).ok);
  check('garde-fou : argent à mettre toujours refusé', !guard('Deposit and start.', base).ok);
  check('garde-fou : négatif toujours refusé', !guard('A small loss today.', base).ok);
  check('garde-fou : montant écrit par le modèle toujours refusé', !guard('We made $120 today.', base).ok);
}

// ── L'ANTI-RÉPÉTITION (14 jours, premières lignes entières) ────────────────────────────────────────────
{
  const openings = [
    'Tuesday morning from me ☕',
    'Algoria AI is already on gold, working for you while you live your day, and every trade is copied on your account automatically',
    'Not sure which broker to pick for your trading account ?',
  ];
  check('répétition : même ouverture refusée', toneIssue('Not sure which broker to pick for your trading account ?\n\nTell me your country.', { openings }) !== null);
  check('répétition : ouverture presque identique refusée', toneIssue('Not sure which broker to pick for your account ?\n\nTell me.', { openings }) !== null);
  // au-delà de 300 caractères : la comparaison porte sur la ligne entière, pas sur un préfixe
  const long = `${'word '.repeat(70)}end one`;
  check('répétition : longue première ligne comparée en entier', toneIssue(`${long}\n\nok`, { openings: [long] }) !== null);
  check('répétition : une autre ouverture passe', toneIssue('I get this question a lot : which broker ?\n\nTell me your country.', { openings }) === null);
  check('répétition : similarity symétrique', Math.abs(similarity('a b c dog cat', 'dog cat bird') - similarity('dog cat bird', 'a b c dog cat')) < 1e-9);
  check('répétition : firstLine sans balises', firstLine('\n<b>Hello there</b>\nmore') === 'Hello there');
}

// ── LA PHRASE DE RISQUE ─────────────────────────────────────────────────────────────────────────────
{
  const o = { tokens: { YESTERDAY: '+$2.10 at 0.01 lot · +$21 at 0.10 lot' }, noButton: true, allowedUsd: [] as number[], autoRisk: true };
  const withFig = guard('Yesterday went well.\n\n{{YESTERDAY}}', o);
  check('risque : ajouté en une ligne en italique sur un post avec chiffre', withFig.ok && withFig.text.endsWith(`<i>${RISK}</i>`) && (withFig.text.match(/Trading involves risk/g) ?? []).length === 1, withFig.ok ? withFig.text : withFig.why);
  const noFig = guard(`The app is free.\n\n<i>${RISK}</i>`, o);
  check('risque : retiré d\'un post sans chiffre', noFig.ok && !noFig.text.includes('Trading involves risk'), noFig.ok ? noFig.text : noFig.why);
  check('risque : withRisk ne double jamais', (withRisk(`x\n\n${RISK}`, true).match(/Trading involves risk/g) ?? []).length === 1);
  check('risque : stripRisk retire la version courte', !stripRisk('a\n\nTrading involves risk.').includes('risk'));
}

// ── LE SONDAGE ──────────────────────────────────────────────────────────────────────────────────────
{
  check('sondage : correct', checkPoll({ question: 'Where are you in your setup ?', options: ['Just watching', 'App installed', 'Account connected'] }).ok);
  check('sondage : une seule option refusée', !checkPoll({ question: 'Ready ?', options: ['Yes'] }).ok);
  check('sondage : gains refusés', !checkPoll({ question: 'How much do you want to make ?', options: ['$100', '$1000'] }).ok);
  check('sondage : ouverture sur le jour refusée', !checkPoll({ question: 'Tuesday question : app or Telegram ?', options: ['App', 'Telegram'] }).ok);
  check('sondage : options identiques refusées', !checkPoll({ question: 'Which one ?', options: ['App', 'app'] }).ok);
}

// ── LE TRADE COMMENTÉ DE SECOURS ──────────────────────────────────────────────────────────────────────
{
  const facts = { direction: 'SELL' as const, entry: '4,119.62', exit: '4,117.26', how: 'it closed in profit', closedAt: '18:53' };
  const result = '+$2.36 at 0.01 lot · +$23.60 at 0.10 lot';
  let allOk = true, texts = new Set<string>();
  for (let n = 0; n < 200; n++) {
    const t = guardTrade(tradeFallback(facts, seeded(n)), result, null);
    if (!t || !t.includes(result) || !t.endsWith(`<i>${RISK}</i>`) || /Closed by Algoria AI/.test(t)) { allOk = false; console.error(t); break; }
    texts.add(t);
  }
  check('trade : le secours passe les garde-fous, avec les vrais chiffres et le risque', allOk);
  check('trade : le texte varie (≥ 8 versions)', texts.size >= 8, String(texts.size));
  check('trade : plus de modèle fixe « ✅ +$X at 0.10 lot »', ![...texts].some((t) => t.startsWith('✅')));
}

// ── LES PHOTOS ──────────────────────────────────────────────────────────────────────────────────────
{
  const now = Date.parse('2026-11-10T08:00:00Z');
  const D = 86_400_000;
  const photos = Array.from({ length: 40 }, (_, i) => ({ key: `drive:${i}` }));
  const uses = Array.from({ length: 20 }, (_, i) => ({ key: `drive:${i}`, at: now - (i + 1) * D }));
  let r = pickFresh(photos, uses, now, seeded(1));
  check('photos : jamais une photo passée depuis moins de 30 jours', !!r.pick && Number(r.pick.key.slice(6)) >= 20);
  check('photos : stock frais compté', r.freshLeft === 19, String(r.freshLeft));
  r = pickFresh(photos.slice(0, 24), uses, now, seeded(1));
  check('photos : alerte sous 5 fraîches', r.freshLeft < 5, String(r.freshLeft));
  const small = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  r = pickFresh(small, [{ key: 'a', at: now - D }, { key: 'b', at: now - 2 * D }, { key: 'c', at: now - 3 * D }], now);
  check('photos : petit dossier → la plus ancienne (n − 1 passages entre deux)', r.pick?.key === 'c', r.pick?.key);
  r = pickFresh([{ key: 'a' }], [{ key: 'a', at: now - D }], now);
  check('photos : une seule photo déjà passée → texte seul', r.pick === null);
  r = pickFresh([], [], now);
  check('photos : dossier vide → texte seul', r.pick === null && r.freshLeft === 0);
  r = pickFresh(small, [], now, seeded(2), 'a');
  check('photos : « change la photo » exclut l\'actuelle', !!r.pick && r.pick.key !== 'a');
  r = pickFresh(small, [{ key: 'a', at: now - 40 * D }], now, () => 0);
  check('photos : une photo passée il y a 40 jours redevient fraîche', !!r.pick);
}

if (failed) { console.error(`\n${failed} échec(s)`); process.exit(1); }
console.log('\nTout est bon.');
