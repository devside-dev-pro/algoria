// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/webinar-timezones.ts
//
// Les 6 fuseaux du webinaire (10/11/2026) : UK/Irlande, Italie/Europe centrale, Afrique du Sud/Israël, Dubaï, Sydney et
// Nouvelle-Zélande (avec le jour). Heures calculées par Intl (fuseaux IANA), heure d'été comprise. Le webinaire unique du
// mercredi (le dimanche est supprimé). Aucune base, aucun appel réseau.
import { webinarPost } from '../../lib/channel/cm';
import { check as guard, withTimes } from '../../lib/channel/writer';
import { isWeeklySlot, saHour, ukHour, WEEKLY, webinarTimes, webinarTimesBlock, webinarTimesInline } from '../../lib/member/webinar';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}
const eq = (name: string, got: string, want: string) => check(name, got === want, `obtenu :\n${got}\nattendu :\n${want}`);

// ── mercredi 11/11/2026, 19:00 UK (l'heure réelle de WEEKLY) : l'hiver partout en Europe, l'été austral ──────────
const NOV11 = '2026-11-11T19:00:00.000Z';
check('WEEKLY : un seul webinaire, le mercredi à 19:00 UK', WEEKLY.length === 1 && WEEKLY[0].weekday === 3 && WEEKLY[0].at === '19:00');
eq('11/11 : le bloc des 6 fuseaux', webinarTimesBlock(NOV11), [
  '🇬🇧 UK & Ireland: 19:00',
  '🇮🇹 Italy & Central Europe: 20:00',
  '🇿🇦🇮🇱 South Africa & Israel: 21:00',
  '',
  '🇦🇪 Dubai: 23:00',
  '🇦🇺 Sydney: Thu 06:00',
  '🇳🇿 New Zealand: Thu 08:00',
].join('\n'));
eq('11/11 : la ligne du rédacteur', webinarTimesInline(NOV11),
  '19:00 UK & Ireland, 20:00 Italy & Central Europe, 21:00 South Africa & Israel, 23:00 Dubai, Thu 06:00 Sydney, Thu 08:00 New Zealand');
check('ukHour / saHour inchangés', ukHour(NOV11) === '19:00' && saHour(NOV11) === '21:00');

// ── l'été (mi-juin) : Londres BST, Israël IDT (≠ Afrique du Sud), Sydney et Auckland en heure d'hiver ─────────────
const JUN = '2026-06-17T18:00:00.000Z'; // mercredi 19:00 à Londres (BST)
eq('été : Afrique du Sud et Israël sur deux lignes', webinarTimesBlock(JUN), [
  '🇬🇧 UK & Ireland: 19:00',
  '🇮🇹 Italy & Central Europe: 20:00',
  '🇿🇦 South Africa: 20:00',
  '🇮🇱 Israel: 21:00',
  '',
  '🇦🇪 Dubai: 22:00',
  '🇦🇺 Sydney: Thu 04:00',
  '🇳🇿 New Zealand: Thu 06:00',
].join('\n'));

// ── la bascule de printemps : Israël passe à l'heure d'été le vendredi 27/03/2026, l'Europe le dimanche 29/03. Le
//    samedi 28/03 (pas un jour de webinaire, juste un instant de test), Israël a déjà une heure d'avance, Rome pas encore
const MAR = '2026-03-28T19:00:00.000Z';
const m = webinarTimes(MAR).flat();
const by = (l: string) => m.find((t) => t.label === l);
check('fin mars : Israël en avance d’une heure sur l’Afrique du Sud', by('South Africa')?.time === '21:00' && by('Israel')?.time === '22:00', JSON.stringify(m));
check('fin mars : Rome encore en CET (20:00)', by('Italy & Central Europe')?.time === '20:00');
check('fin mars : Sydney en AEDT (Sun 06:00)', by('Sydney')?.day === 'Sun' && by('Sydney')?.time === '06:00');

// ── un jour qui change seulement pour Dubaï (session tardive) : le jour s'affiche aussi pour Dubaï ─────────────────
const LATE = '2026-11-11T21:30:00.000Z';
const late = webinarTimes(LATE).flat();
check('session tardive : Dubaï affiche le lendemain', late.find((t) => t.label === 'Dubai')?.day === 'Thu' && late.find((t) => t.label === 'Dubai')?.time === '01:30');
check('session tardive : le Royaume-Uni sans jour', late.find((t) => t.label === 'UK & Ireland')?.day === null);
check('jamais plus de 5 lignes par bloc', [NOV11, JUN, MAR, LATE].every((at) => webinarTimesBlock(at).split('\n\n').every((b) => b.split('\n').length <= 5)));

// ── le mercredi seulement : un dimanche resté en base est écarté ─────────────────────────────────────────────────
check('mercredi 11/11 gardé', isWeeklySlot(NOV11));
check('dimanche 15/11 écarté', !isWeeklySlot('2026-11-15T19:00:00.000Z'));
check('mercredi d’été gardé (BST)', isWeeklySlot(JUN));

// ── les annonces du canal : 6 fuseaux, gabarits qui varient, garde-fous intacts ──────────────────────────────────
const S = { id: '2026-11-11', starts_at: NOV11, zoom_url: null };
const cta = { tokens: {}, maxChars: 700 };
const texts: string[] = [];
for (const phase of ['soon', 'tomorrow', 'today'] as const) {
  const p = webinarPost(S, phase);
  texts.push(p.text);
  check(`${phase} : le bloc des 6 fuseaux dans le texte de secours`, !!p.times && p.text.includes(webinarTimesBlock(NOV11)));
  check(`${phase} : la consigne impose {{TIMES}} et la variété`, /\{\{TIMES\}\}/.test(p.goal) && /do not reuse the first line/i.test(p.goal));
  check(`${phase} : pas d'ancienne mention « in South Africa » seule`, !/in South Africa\)/.test(p.goal));
  const g = guard(p.text, cta);
  check(`${phase} : le texte de secours passe le garde-fou`, g.ok === true, g.ok ? '' : g.why);
}
check('les annonces de la semaine ne s’ouvrent pas toutes pareil', new Set(texts.map((t) => t.split('\n')[0])).size >= 2, texts.map((t) => t.split('\n')[0]).join(' | '));
const firstLines = new Set<string>();
for (let d = 0; d < 8; d++) firstLines.add(webinarPost({ id: `2026-11-${String(11 + d * 7).padStart(2, '0')}`, starts_at: NOV11, zoom_url: null }, 'tomorrow').text.split('\n')[0]);
check('d’une semaine à l’autre, plusieurs gabarits', firstLines.size >= 2, [...firstLines].join(' | '));

// ── le jeton {{TIMES}} : remplacé après le garde-fou, en bloc à part ──────────────────────────────────────────────
const times = webinarTimesBlock(NOV11);
const draft = '🎤 <b>Wednesday night I’m live, come say hi.</b>\n\n{{TIMES}}\n\n45 minutes on Zoom, the real app and your questions 👇';
const r = guard(draft, { tokens: { TIMES: '{{TIMES}}' }, required: ['TIMES'], maxChars: 700 });
check('brouillon avec {{TIMES}} accepté', r.ok === true, r.ok ? '' : r.why);
const out = r.ok ? withTimes(r.text, times) : '';
check('{{TIMES}} remplacé par le bloc, en bloc à part', out.includes(`\n\n${times}\n\n`) && !out.includes('{{TIMES}}'), out);
const miss = guard('🎤 <b>Live tonight at 19:00 UK.</b>\n\nSave your seat 👇', { tokens: { TIMES: '{{TIMES}}' }, required: ['TIMES'], maxChars: 700 });
check('brouillon sans {{TIMES}} refusé', miss.ok === false);
const promise = guard('🎤 Live tonight.\n\n{{TIMES}}\n\nYou will earn money with me.', { tokens: { TIMES: '{{TIMES}}' }, required: ['TIMES'], maxChars: 700 });
check('promesse de gain toujours refusée', promise.ok === false);
const neg = guard('🎤 Live tonight.\n\n{{TIMES}}\n\nEven after a loss.', { tokens: { TIMES: '{{TIMES}}' }, required: ['TIMES'], maxChars: 700 });
check('mot négatif toujours refusé', neg.ok === false);

console.log(`\nexemple (11/11/2026) :\n${times}\n`);
if (failed) {
  console.error(`\n${failed} contrôle(s) en échec`);
  process.exit(1);
}
console.log('tous les contrôles passent');
