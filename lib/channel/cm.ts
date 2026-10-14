// 📣 LE CM AUTOMATIQUE DU CANAL PUBLIC (15/10/2026, décision Mathieu : « Go pour le CM et les CTA »).
//
// Le constat (analyse du canal du 02/10) : des textes de motivation et des bonjour / bonne nuit jamais lus, rien le
// soir, et rien sur ce que l'audience demande (26 votes sur 34 : « automation explanations »). Les trois quarts de ce
// qui marche, c'est Mathieu : ses bulles vidéo, ses CTA envoyés depuis l'admin, ses transferts des gains du VIP.
// Le bot reprend tout ça, sauf les bulles vidéo (il propose seulement la question du jour) :
//   · 9h00   le bonjour qui lance la journée, écrit avec ce qui se passe vraiment ce jour-là ;
//   · 11h00  un post « How it works » (une banque de fiches, en rotation, faits de l'Academy uniquement) ;
//   · 12h30, 17h30, 20h30  trois CTA (deux le week-end), en rotation, vers l'app ou vers Mathieu ;
//   · 14h00 et 19h00 (semaine)  la carte du meilleur gain depuis le créneau précédent, comme dans le VIP ;
//   · 23h05  le récap du jour, qui garde son propre brouillon (lib/channel/recap.ts).
// Les heures bougent de quelques minutes d'un jour à l'autre : un canal qui poste à 12:30:00 pile tous les jours
// sent l'automate.
//
// ÉCRIT PAR CLAUDE, PAS COPIÉ-COLLÉ (15/10/2026, Mathieu : « un CM intelligent, qui comprend et qui s'adapte »).
// Le bonjour, les How it works et les CTA sont rédigés chaque matin par lib/channel/writer.ts à partir du contexte
// du jour ; la banque ci-dessous sert de fiches de faits et de texte de secours si le modèle échoue. Mathieu corrige
// en RÉPONDANT au message du matin (« 2 plus court », « # jamais d'emoji fusée ») : le post est réécrit et la leçon
// entre dans la mémoire du CM (agent_docs « cm_memory »), relue à chaque rédaction.
//
// RIEN NE PART SANS UN CLIC. LA VEILLE À 23h15 (Paris), juste après le brouillon du récap, les admins reçoivent les
// posts du lendemain dans un seul message (Mathieu, 15/10 : « je me lève pas aussi tôt ») :
// « ✅ Tout valider », ou ❌ sur un post précis. Un post non validé à son heure expire. Les cartes de gain sont
// validées comme créneau : leur contenu est choisi à l'heure dite, selon une règle fixe (un vrai trade copié, gagnant,
// au moins +150 $ à 1 lot comme les cartes du VIP), et le créneau saute s'il n'y en a pas.
//
// Règles de contenu (Mathieu) : anglais, pas de tiret long, une espace avant ? et !, aucune négativité dans le canal
// public, montants à 0.10 lot (et 0.01), jamais de taille de compte, résultats passés avec la phrase de risque,
// aucune projection, pas la règle des 30 jours. Les témoignages ne sont pas concernés.
// JAMAIS D'ARGENT À METTRE EN PUBLIC (Mathieu, 15/10 : « je veux pas faire peur aux gens avec un 500 $ ») : ni dépôt,
// ni minimum, ni montant conseillé, ni « fund your account ». On dit « create your trading account » et « connect
// your trading account to Algoria ». Les fiches ci-dessous n'en parlent plus, et le rédacteur refuse ces mots.
import { liveTrades, type Trade } from './recap';
import { publishToChannels, sourceChannel } from './publish';
import { adminTgIds } from '@/lib/member/notifyOwner';
import { appendAgentMemory } from '@/lib/member/agentDocs';
import { dayContext, writePost, type Brief, type DayContext } from './writer';
import { atOneLot, atRef } from '@/lib/display/scale';
import { tradingDayOf, tradingDayStartMs, tradingTimeMs } from '@/lib/display/tradingDay';
import { APP_URL, SUPPORT_TG_URL } from '@/lib/member/i18n';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const RISK = "Trading involves risk. Past results don't guarantee future results.";
const L = {
  app: `${APP_URL}/member`,
  start: `${APP_URL}/member/onboarding`,
  academy: `${APP_URL}/academy`,
  install: `${APP_URL}/download`,
  history: `${APP_URL}/member/history`,
  track: 'https://algoria.tech/track-record',
  me: SUPPORT_TG_URL,
  call: `${SUPPORT_TG_URL}?text=${encodeURIComponent("Hey Mathieu ! I'd like a quick call to set up my Algoria access 📞")}`,
};

export type CmPost = { id: string; text: string; btn: string; url: string };
const post = (id: string, lines: string[], btn: string, url: string): CmPost => ({ id, text: lines.join('\n'), btn, url });
const HOW = '🔵💙 HOW IT WORKS';

/** Les posts « How it works », dans l'ordre de passage. Chaque affirmation vient de l'Academy (lib/member/academy.ts). */
export const HOWTO: CmPost[] = [
  post('who', [HOW, "<b>Who's really trading ?</b>", '', 'Algoria is 100% driven by AI. 🤖', 'Mathieu built it. He never places a trade by hand.', '', "Every trade you see here is the AI's decision. Zero manual trades."], '🎓 HOW IT WORKS, IN 5 MIN', L.academy),
  post('copy', [HOW, '<b>Do I have to copy the trades myself ?</b>', '', 'No. ❌', '', 'You connect your own MetaTrader 5 account once.', 'After that, every Algoria trade is copied to it automatically, at the size you chose.', '', 'No signals to follow. No charts to watch. You see everything live in the app. 📲'], '🚀 OPEN ALGORIA', L.app),
  post('money', [HOW, '<b>Whose account is it ?</b>', '', 'Yours. In YOUR name, at the broker. 🔐', '', '🤖 Algoria takes the trade', '🔁 The copier sends it to your trading account', '💼 Your account: your size, your broker, your name', '', 'Nothing goes through us.'], '🎓 LEARN MORE', L.academy),
  post('password', [HOW, '<b>What can the trader password do ?</b>', '', 'It connects your account to the copier. That\'s it.', '', '✅ Copy the trades', '❌ Take anything out of your account', '❌ Open your client area', '', 'Your account stays 100% in your hands. 🙌'], '🎓 LEARN MORE', L.academy),
  post('start', [HOW, '<b>What do I need to start ?</b>', '', '1️⃣ Create your trading account with our partner broker', '2️⃣ Connect your trading account to Algoria in the app: encrypted, 2 minutes', '3️⃣ The team switches the copy on ✅', '', 'Trading involves risk.'], '⚡ START HERE', L.start),
  post('stoploss', [HOW, '<b>What happens when a trade goes wrong ?</b>', '', '🛑 Every trade has a stop loss.', 'The loss is cut and accepted. Never averaged down, never "held until it comes back".', '', "That's how a bad trade stays a small one. 🧠", '', RISK], '🎓 LEARN MORE', L.academy),
  post('pause', [HOW, '<b>Can I stop the copy ?</b>', '', 'Yes, anytime, by yourself. ⏸', '', 'Open the app, Profile, PAUSE.', 'The copy stops. Tap RESUME when you want it back.', '', 'No message to send, no one to ask. You stay in control.'], '🚀 OPEN ALGORIA', L.app),
  post('quiet', [HOW, '<b>No trade today ?</b>', '', "That's the plan. ✅", '', 'Algoria never forces a trade. It only enters when a clean setup shows up.', '', 'Quiet days are normal. They are part of the strategy, not a bug. 🧘'], '🎓 LEARN MORE', L.academy),
  post('free', [HOW, '<b>Why is Algoria free ?</b>', '', '💸 No subscription, no fee, never a cut of your profits.', '', 'The partner broker pays Algoria when you create your trading account through our link.', "That's why the link matters: an account created without it isn't linked to Algoria. 🔗"], '⚡ START HERE', L.start),
  post('martingale', [HOW, '<b>Is it a martingale ?</b>', '', 'No. 🙅', '', 'A martingale doubles its size after every loss to win it back.', 'Algoria does the opposite:', '📏 you choose your copy size once', '📏 it stays the same, win or lose', '', 'Your lot never grows after a loss.'], '🎓 LEARN MORE', L.academy),
  post('track', [HOW, '<b>Do they only show the wins ?</b>', '', 'No. 📊', '', 'The track record is the real account: month by month since July 2026, trade by trade since October. Red months included.', '', 'No simulation. No backtest. No screenshots.', '', RISK], '📊 SEE THE TRACK RECORD', L.track),
  post('broker', [HOW, '<b>Which broker should I pick ?</b>', '', '🥇 RaiseFX first: your account runs with the same spreads as the account Algoria trades.', '', 'Already have an account there ? Pick another partner: VT Markets, PU Prime, TradingSphere or Xlence.', '', 'The app gives you the right link for each one. 📲'], '⚡ START HERE', L.start),
  post('biglot', [HOW, '<b>Bigger lot, faster results ?</b>', '', 'No. ⚠️', '', 'Your copy size is set once, in your profile, and it never grows after a loss.', "A bigger lot doesn't make the strategy better. It just makes every move bigger, up and down.", '', 'Algoria is built to run calm, not fast. 🧘'], '🎓 LEARN MORE', L.academy),
  post('existing', [HOW, '<b>Already have an account at the broker ?</b>', '', "You can't open a second one at the same broker: KYC blocks it. 🚫", '', 'Two easy ways in:', 'A️⃣ Attach your account to Algoria: ask their support, the app gives you the exact message to send', 'B️⃣ Open at another partner broker, through the link in the app'], '⚡ START HERE', L.start),
  post('lot', [HOW, "<b>What's a lot ?</b>", '', 'The size of a trade. 📏', '', '1.00 is a standard lot. 0.01 is a micro lot, 100 times smaller.', 'The bigger the lot, the more each price move is worth, up AND down.', '', 'At Algoria: your lot is set once in your profile, and it never grows after a loss.'], '🎓 THE FULL GLOSSARY', L.academy),
  post('theapp', [HOW, "<b>What's in the app ?</b>", '', '📲 The live AI feed: what Algoria is watching, right now', '✅ Every trade, wins and losses, at your own size', '🔔 A notification when a trade closes in profit', '', 'No App Store. Installs in seconds. Free.'], '📲 INSTALL THE APP', L.install),
  post('setup', [HOW, '<b>How long does the setup take ?</b>', '', 'About 10 minutes on your side. ⏱', '', '1️⃣ Create your trading account through the app', '2️⃣ Connect your trading account to Algoria', '', 'Stuck at any step ? Write to Mathieu, he answers himself. 💬'], '💬 MESSAGE MATHIEU', L.me),
];

/** Les CTA, en rotation par famille : « app » (ils avancent seuls) et « mathieu » (ils ont besoin d'un humain). */
export const CTAS: Array<CmPost & { fam: 'app' | 'mathieu' }> = [
  { ...post('results', ['📈 <b>Every Algoria trade is live in the app.</b>', '', 'Every win, every stop, at your own copy size. Nothing hidden, nothing rounded up.', '', 'See what your account would have done this week 👇'], '🚀 OPEN ALGORIA', L.app), fam: 'app' },
  { ...post('steps', ['🧭 <b>3 steps and the AI trades for you.</b>', '', '1️⃣ Create your trading account with our partner broker', '2️⃣ Connect it to Algoria in the app', '3️⃣ The AI trades for you, on your own account', '', 'The app walks you through each one 👇'], '⚡ START NOW', L.start), fam: 'app' },
  { ...post('academy', ['🎓 <b>New here ? Start with this.</b>', '', '5 minutes to understand exactly what Algoria is, how it trades gold, and why your money never leaves your own account.'], '🎓 OPEN THE ACADEMY', L.academy), fam: 'app' },
  { ...post('copying', ["⚡ <b>The AI trades, your account copies. That's the whole thing.</b>", '', 'Everything stays on <i>your own</i> trading account, in your name. We never touch it.', '', 'About 10 minutes to create your trading account and connect it to Algoria 👇'], '⚡ START COPYING', L.start), fam: 'app' },
  { ...post('trackcta', ["📊 <b>Don't trust screenshots. Check the account.</b>", '', 'The real track record: month by month since July 2026, trade by trade since October. Red months included.', '', RISK], '📊 SEE THE TRACK RECORD', L.track), fam: 'app' },
  { ...post('install', ['📲 <b>Algoria on your home screen.</b>', '', 'The live AI feed, every trade at your own size, and a notification when a trade closes in profit.', '', 'No App Store. Installs in seconds. Free.'], '📲 INSTALL THE APP', L.install), fam: 'app' },
  { ...post('stuck', ['💬 <b>Stuck somewhere in your setup ?</b>', '', 'The broker, creating your trading account, connecting it to Algoria: whatever it is, it takes me two minutes to unblock. Write to me directly, I answer myself.', '', "No sales pitch. Just tell me where you're stuck 🙏🏼"], '💬 MESSAGE MATHIEU', L.me), fam: 'mathieu' },
  { ...post('brokerq', ['🌍 <b>Not sure which broker to pick ?</b>', '', "Tell me which country you're in and I'll tell you which one to choose. It takes me 30 seconds 🙏🏼"], '💬 ASK MATHIEU', L.me), fam: 'mathieu' },
  { ...post('question', ['💬 <b>Any question about Algoria ?</b>', '', 'How the copy works, which broker to pick, how to connect your trading account: ask me. A real human answers, I reply myself 🙏🏼'], '💬 ASK MATHIEU', L.me), fam: 'mathieu' },
  { ...post('call', ['📞 <b>Want to go through it together ?</b>', '', 'A quick call and I walk you through it: creating your trading account and connecting it to Algoria, step by step 🙏🏼'], '📞 BOOK A CALL', L.call), fam: 'mathieu' },
];

type Slot = { slot: string; at: string; kind: 'morning' | 'howto' | 'cta' | 'tp'; fam?: 'app' | 'mathieu' };
// heures de Paris. Le soir compte : l'audience (Afrique du Sud, Royaume-Uni) a fini sa journée.
const WEEKDAY: Slot[] = [
  { slot: 'morning', at: '09:00', kind: 'morning' },
  { slot: 'howto', at: '11:00', kind: 'howto' },
  { slot: 'cta1', at: '12:30', kind: 'cta', fam: 'app' },
  { slot: 'tp1', at: '14:00', kind: 'tp' },
  { slot: 'cta2', at: '17:30', kind: 'cta', fam: 'mathieu' },
  { slot: 'tp2', at: '19:00', kind: 'tp' },
  { slot: 'cta3', at: '20:30', kind: 'cta', fam: 'app' },
];
const WEEKEND: Slot[] = [
  { slot: 'morning', at: '10:00', kind: 'morning' },
  { slot: 'howto', at: '11:30', kind: 'howto' },
  { slot: 'cta1', at: '13:00', kind: 'cta', fam: 'app' },
  { slot: 'cta2', at: '20:30', kind: 'cta', fam: 'mathieu' },
];
/** Heure (Paris) à laquelle le plan du LENDEMAIN part aux admins : après la fermeture de l'or (23h) et le brouillon du
 *  récap (23h05). Mathieu valide le soir, la journée tourne seule. Avant cette heure, c'est le plan du jour qui manque
 *  éventuellement (panne, premier jour) qui est préparé, tout de suite. */
export const PLAN_AT = '23:15';
/** Le jour dont le plan doit exister à l'instant `now`. */
export const planTarget = (now = Date.now()) => {
  const today = tradingDayOf(now);
  return now >= tradingTimeMs(today, PLAN_AT) ? new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : today;
};
const TP_FROM: Record<string, string | null> = { tp1: null, tp2: '14:00' }; // une carte couvre depuis le créneau précédent
const TP_MIN_AT_ONE_LOT = 150; // le seuil des cartes de gain du VIP (runner/metaapi/trades.ts, VIP_WIN_MIN_USD)
const STALE_MS = 90 * 60_000; // un post validé mais raté de plus de 1 h 30 (panne) ne part plus : il serait hors sujet
const GRACE_MS = 60 * 60_000; // un brouillon validé jusqu'à 1 h après son heure part tout de suite ; au-delà il expire
/** Décalage de -10 à +10 minutes, fixe pour un jour et un créneau donnés. */
const jitter = (day: string, slot: string) => {
  let h = 0;
  for (const ch of `${day}:${slot}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ((h % 21) - 10) * 60_000;
};
const CTA_GOAL: Record<string, string> = {
  results: 'make them open the app and look at every real trade at their own size',
  steps: 'show that starting is 3 simple steps and send them to the guided setup',
  academy: 'send newcomers to the 5-minute Academy that explains everything',
  copying: 'explain the idea in one breath (the AI trades, your trading account copies, everything stays in your name) and send them to start',
  trackcta: 'invite them to check the real track record instead of trusting screenshots',
  install: 'get them to install the app on their home screen',
  stuck: 'invite anyone stuck in their setup to message Mathieu directly',
  brokerq: 'offer to tell them which broker to pick if they say their country',
  question: 'invite questions to Mathieu, a real human who answers himself',
  call: 'offer a quick call with Mathieu to set up their access together',
};
const VIDEO_AT = '19:30';

const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const usd = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(2)}`;
const px = (n: number | null | undefined) => (n == null ? null : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

type Row = { id: number; day: string; slot: string; kind: string; ref: string | null; text: string | null; button_text: string | null; button_url: string | null; photo_url: string | null; scheduled_at: string; status: string; report: unknown };

// ── LE PLAN DU JOUR ───────────────────────────────────────────────────────────────────────────────────

/** Prochain élément d'une liste après `from`, en sautant ceux que `ok` refuse. */
function nextIn<T>(list: T[], from: number, ok: (x: T) => boolean): number {
  for (let k = 1; k <= list.length; k++) { const i = (from + k + list.length) % list.length; if (ok(list[i])) return i; }
  return -1;
}

/** Crée les posts du jour (une seule fois : (day, slot) est unique). Renvoie le nombre de lignes créées. */
export async function planDay(db: Db, day: string): Promise<number> {
  const { data: existing } = await db.from('channel_posts').select('id').eq('day', day).limit(1);
  if (existing?.length) return 0;
  const weekend = isWeekend(day);
  const slots = weekend ? WEEKEND : WEEKDAY;
  // ROTATION : chaque liste repart après son dernier post PUBLIÉ (ou validé). Un How it works refusé revient donc le
  // lendemain ; un CTA refusé repassera au tour suivant de sa famille.
  const { data: hist } = await db.from('channel_posts').select('ref,kind').in('kind', ['howto', 'cta']).in('status', ['published', 'publishing', 'approved'])
    .order('scheduled_at', { ascending: false }).limit(100);
  const last = (pred: (r: { ref: string | null; kind: string }) => number) => { for (const r of (hist ?? []) as Array<{ ref: string | null; kind: string }>) { const i = pred(r); if (i >= 0) return i; } return -1; };
  let hi = last((r) => (r.kind === 'howto' ? HOWTO.findIndex((p) => p.id === r.ref) : -1));
  const ci: Record<string, number> = {
    app: last((r) => (r.kind === 'cta' ? CTAS.findIndex((c) => c.id === r.ref && c.fam === 'app') : -1)),
    mathieu: last((r) => (r.kind === 'cta' ? CTAS.findIndex((c) => c.id === r.ref && c.fam === 'mathieu') : -1)),
  };
  const now = Date.now();
  const rows: Array<Record<string, unknown>> = [];
  const briefs: Array<Brief | null> = [];
  for (const s of slots) {
    const at = tradingTimeMs(day, s.at) + jitter(day, s.slot);
    if (at <= now) continue; // créneau déjà passé (plan préparé en retard)
    const base = { day, slot: s.slot, kind: s.kind, scheduled_at: new Date(at).toISOString(), status: 'draft' };
    if (s.kind === 'morning') {
      rows.push({ ...base, ref: 'morning', text: null, button_text: '🚀 OPEN ALGORIA', button_url: L.app });
      briefs.push({ kind: 'morning' });
      continue;
    }
    if (s.kind === 'howto') {
      hi = nextIn(HOWTO, hi, () => true);
      const p = HOWTO[hi];
      rows.push({ ...base, ref: p.id, text: p.text, button_text: p.btn, button_url: p.url });
      briefs.push({ kind: 'howto', card: p.text, button: p.btn });
    } else if (s.kind === 'cta') {
      const fam = s.fam ?? 'app';
      const i = nextIn(CTAS, ci[fam], (c) => c.fam === fam);
      if (i < 0) continue;
      ci[fam] = i;
      const c = CTAS[i];
      rows.push({ ...base, ref: c.id, text: c.text, button_text: c.btn, button_url: c.url });
      briefs.push({ kind: 'cta', goal: CTA_GOAL[c.id] ?? 'bring them to the app', reference: c.text, button: c.btn });
    } else { rows.push(base); briefs.push(null); } // carte de gain : choisie à l'heure dite
  }
  if (!rows.length) return 0;
  // LA RÉDACTION : tous les posts du jour en parallèle (un appel chacun). Échec ou texte refusé par les garde-fous →
  // le texte de la banque ; pour le bonjour, pas de post (un bonjour en conserve, c'est ce qu'on veut éviter).
  const ctx = await dayContext(db, day).catch(() => null);
  const written = ctx ? await Promise.all(briefs.map((b) => (b ? writePost(ctx, b).catch(() => null) : Promise.resolve(null)))) : briefs.map(() => null);
  for (let k = rows.length - 1; k >= 0; k--) {
    if (written[k]) { rows[k].text = written[k]; rows[k].report = { writer: 'ai' }; }
    else if (rows[k].kind === 'morning') rows.splice(k, 1);
    else if (rows[k].kind !== 'tp') rows[k].report = { writer: 'bank' };
  }
  if (!rows.length) return 0;
  // une seule requête : si un autre passage a créé le plan entre-temps, l'unicité fait tout échouer, et un seul
  // message part aux admins
  const { error } = await db.from('channel_posts').insert(rows);
  if (error) return 0;
  const idea = await videoIdea(db).catch(() => null);
  if (idea) await db.from('channel_posts').insert({ day, slot: 'video', kind: 'video', text: idea, scheduled_at: new Date(tradingTimeMs(day, VIDEO_AT)).toISOString(), status: 'info' });
  return rows.length;
}

/** LA QUESTION DU JOUR POUR LA BULLE VIDÉO : la question concrète qui revient le plus dans les messages reçus
 *  par Mathieu ces 7 derniers jours (support Telegram Business). Une proposition, jamais publiée. */
async function videoIdea(db: Db): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { data } = await db.from('member_actions').select('detail').eq('kind', 'biz_msg').gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order('created_at', { ascending: false }).limit(300);
  const msgs = ((data ?? []) as Array<{ detail: { from?: string; text?: string } | null }>)
    .map((r) => (r.detail?.from === 'client' ? String(r.detail?.text ?? '') : '')).filter((t) => t.length > 8 && !t.startsWith('[')).map((t) => t.slice(0, 300));
  if (msgs.length < 5) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const res = await new Anthropic().messages.create({
    model: process.env.ALGORIA_CM_MODEL ?? 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: 'You read messages that prospects sent to the founder of Algoria, an AI that trades gold and is copied on members\' own broker accounts. Find the ONE concrete question that comes up most often and that a 30-second video answer would settle. Reply with that question only, in English, under 15 words. No names, no account numbers, no amounts. If nothing stands out, reply NONE.',
    messages: [{ role: 'user', content: msgs.join('\n---\n').slice(0, 30000) }],
  });
  const out = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim().replace(/^["«]|["»]$/g, '');
  return !out || /^none\b/i.test(out) || out.length > 160 ? null : out;
}

// ── LE MESSAGE AUX ADMINS ─────────────────────────────────────────────────────────────────────────────

const POST_KINDS = ['morning', 'howto', 'cta', 'tp'];
const STATUS: Record<string, string> = { draft: '⏳ à valider', approved: '✅ validé', publishing: '📤 en cours', published: '📣 publié', skipped: '❌ pas publié', expired: '⌛ expiré' };
const NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const parisHHMM = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

async function rowsOf(db: Db, day: string): Promise<Row[]> {
  const { data } = await db.from('channel_posts').select('*').eq('day', day).order('scheduled_at', { ascending: true });
  return (data ?? []) as Row[];
}

/** Le message du matin, régénéré depuis la base à chaque clic : il dit toujours l'état réel. */
export function renderPlan(day: string, rows: Row[]): { text: string; keyboard: Array<Array<Record<string, string>>> } {
  const posts = rows.filter((r) => POST_KINDS.includes(r.kind));
  const idea = rows.find((r) => r.kind === 'video')?.text;
  const tomorrow = day > tradingDayOf(Date.now());
  const parts: string[] = [`📣 <b>Canal public · ${tomorrow ? 'demain, ' : ''}${esc(dayLabel(day))}</b>`, tomorrow ? '<i>Valide ce soir : les posts partiront demain à leur heure, même si tu dors. Rien ne part sans ton clic. Source + miroir UK + canal IT (traduit).</i>' : '<i>Rien ne part sans ton clic. Source + miroir UK + canal IT (traduit).</i>'];
  posts.forEach((r, i) => {
    const head = r.kind === 'morning' ? 'BONJOUR' : r.kind === 'howto' ? 'HOW IT WORKS' : r.kind === 'cta' ? 'CTA' : 'CARTE DE GAIN';
    const by = (r.report as { writer?: string } | null)?.writer;
    const tag = by === 'ai' ? ' · ✍️ IA' : by === 'fixed' ? ' · ✏️ corrigé' : by === 'bank' ? ' · 📄 banque' : '';
    parts.push('', `<b>${NUM[i] ?? i + 1}  ${parisHHMM(r.scheduled_at)} · ${head}</b>${tag} · ${STATUS[r.status] ?? r.status}`);
    if (r.kind === 'tp') {
      const rep = r.report as { reason?: string } | null;
      parts.push(r.text ? `<blockquote>${esc(plain(r.text).slice(0, 300))}</blockquote>` : `<i>Le meilleur gain copié ${TP_FROM[r.slot] ? `depuis ${TP_FROM[r.slot]}` : 'depuis minuit'} (au moins +$15 à 0.10 lot), avec sa carte, comme dans le VIP. Rien s'il n'y en a pas.${rep?.reason ? ` · ${esc(rep.reason)}` : ''}</i>`);
    } else {
      parts.push(`<blockquote>${esc(plain(r.text ?? '').slice(0, 420))}</blockquote>`);
      if (r.button_text) parts.push(`🔘 ${esc(r.button_text)}`);
    }
  });
  if (!isWeekend(day)) parts.push('', '<i>23:05 · le récap du jour garde son brouillon à part, comme d\'habitude.</i>');
  if (idea) parts.push('', `🎥 <b>Idée de bulle vidéo</b> (la question qui revient le plus en support cette semaine) :`, `« ${esc(idea)} »`);
  parts.push('', '<i>Pour corriger un post : réponds à ce message avec son numéro et ce qu\'il faut changer (« 2 plus court »). Pour une règle durable : # + la règle. Un post non validé part quand même si tu valides jusqu\'à 1 h après son heure.</i>');
  const text = parts.join('\n').slice(0, 4090);
  const keyboard: Array<Array<Record<string, string>>> = [];
  if (posts.some((r) => r.status === 'draft')) keyboard.push([{ text: '✅ Tout valider', callback_data: `cma:${day}` }]);
  const toggles = posts.map((r, i) => ({ r, i })).filter(({ r }) => ['draft', 'approved', 'skipped'].includes(r.status) && Date.parse(r.scheduled_at) + (r.status === 'approved' ? 0 : GRACE_MS) > Date.now())
    .map(({ r, i }) => ({ text: `${r.status === 'skipped' ? '↩️' : '❌'} ${NUM[i] ?? i + 1}`, callback_data: `cmt:${r.id}` }));
  if (toggles.length) keyboard.push(toggles);
  if (posts.some((r) => ['draft', 'approved'].includes(r.status))) keyboard.push([{ text: tomorrow ? '🚫 Rien demain' : '🚫 Rien aujourd\'hui', callback_data: `cmn:${day}` }]);
  return { text, keyboard };
}

const tg = async (method: string, payload: Record<string, unknown>) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000), body: JSON.stringify(payload) });
    return (await r.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  } catch { return null; }
};

/** Envoie le plan du jour à chaque admin. */
export async function sendPlan(db: Db, day: string): Promise<number> {
  const { text, keyboard } = renderPlan(day, await rowsOf(db, day));
  const msgs: Array<{ chat: number; id: number }> = [];
  for (const chat_id of await adminTgIds()) {
    const r = await tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard } }) as { ok?: boolean; description?: string; result?: { message_id?: number } } | null;
    if (r?.ok && r.result?.message_id) msgs.push({ chat: chat_id, id: r.result.message_id });
    else console.error('[cm] plan non envoyé:', r?.description ?? 'unknown');
  }
  // la ligne « plan » garde les messages envoyés : une réponse de Mathieu à l'un d'eux est une correction (handleCmReply)
  if (msgs.length) await db.from('channel_posts').insert({ day, slot: 'plan', kind: 'plan', status: 'info', scheduled_at: new Date().toISOString(), report: { msgs } });
  return msgs.length;
}

/** Boutons du message du matin (webhook Telegram). Renvoie false si le bouton n'est pas le nôtre. */
export async function handleCmCallback(db: Db, cq: { id: string; data?: string; from?: { id?: number; username?: string }; message?: { chat?: { id?: number }; message_id?: number } }): Promise<boolean> {
  const m = /^cm([atn]):(.+)$/.exec(String(cq?.data ?? ''));
  if (!m) return false;
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190) });
  if (!(await adminTgIds()).includes(Number(cq.from?.id))) { await answer('Réservé aux admins.'); return true; }
  const by = cq.from?.username ? `@${cq.from.username}` : String(cq.from?.id ?? 'admin');
  const decided = { decided_by: by, decided_at: new Date().toISOString() };
  let day = m[2];
  let note = 'OK';
  if (m[1] === 'a') {
    // seuls les brouillons : un post déjà publié, refusé ou expiré ne bouge pas
    await db.from('channel_posts').update({ status: 'approved', ...decided }).eq('day', day).eq('status', 'draft');
    note = 'Validé ✓ Les posts partiront à leur heure.';
  } else if (m[1] === 'n') {
    await db.from('channel_posts').update({ status: 'skipped', ...decided }).eq('day', day).in('status', ['draft', 'approved']);
    note = 'OK, rien ne part ce jour-là.';
  } else {
    const { data } = await db.from('channel_posts').select('id,day,status,scheduled_at').eq('id', Number(day)).limit(1);
    const r = (data ?? [])[0] as { id: number; day: string; status: string; scheduled_at: string } | undefined;
    if (!r) { await answer('Introuvable.'); return true; }
    day = String(r.day).slice(0, 10);
    if (Date.parse(r.scheduled_at) <= Date.now()) note = 'Trop tard pour celui-là.';
    else if (r.status === 'skipped') { await db.from('channel_posts').update({ status: 'draft', ...decided }).eq('id', r.id).eq('status', 'skipped'); note = 'Remis en brouillon : valide-le avec ✅.'; }
    else if (['draft', 'approved'].includes(r.status)) { await db.from('channel_posts').update({ status: 'skipped', ...decided }).eq('id', r.id).in('status', ['draft', 'approved']); note = 'Retiré ✓'; }
    else note = 'Déjà parti.';
  }
  if (cq.message?.chat?.id && cq.message?.message_id) {
    const { text, keyboard } = renderPlan(day, await rowsOf(db, day));
    await tg('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard } });
  }
  await answer(note);
  return true;
}

// ── LA PUBLICATION ────────────────────────────────────────────────────────────────────────────────────

/** La carte de gain d'un créneau : le meilleur trade copié gagnant depuis le créneau précédent, pas encore posté. */
async function pickWin(db: Db, r: Row): Promise<{ text: string; photo: string; ticket: string } | { reason: string }> {
  const day = String(r.day).slice(0, 10);
  const fromAt = TP_FROM[r.slot];
  const since = fromAt ? tradingTimeMs(day, fromAt) : tradingDayStartMs(day);
  const trades = await liveTrades(db, new Date(since).toISOString());
  const { data: used } = await db.from('channel_posts').select('ref').eq('kind', 'tp').in('status', ['published', 'publishing']).gte('day', day);
  const done = new Set(((used ?? []) as Array<{ ref: string | null }>).map((u) => String(u.ref)));
  const best = trades
    .filter((t) => tradingDayOf(t.closed_at) === day && Date.parse(t.closed_at) <= Date.now() && atOneLot(t.pnl, t.lot) >= TP_MIN_AT_ONE_LOT && !done.has(String(t.ticket)))
    .sort((a, b) => atOneLot(b.pnl, b.lot) - atOneLot(a.pnl, a.lot))[0] as Trade | undefined;
  if (!best) return { reason: 'aucun gain assez net sur le créneau' };
  const net10 = atRef(best.pnl, best.lot);
  const dir = best.direction === 'long' ? ' BUY' : best.direction === 'short' ? ' SELL' : '';
  const how = best.reason === 'tp' ? 'target hit' : best.reason === 'trail' ? 'profit locked by the trailing stop' : 'closed in profit';
  const prices = px(best.entry) && px(best.exit) ? `${px(best.entry)} → ${px(best.exit)} · ` : '';
  const text = [
    `✅ <b>${usd(net10)} at 0.10 lot</b> · gold${dir}`,
    `<i>${prices}${how}</i>`,
    '',
    `🤖 Closed by Algoria AI and copied automatically on members' accounts. At 0.01 lot: ${usd(net10 / 10)}.`,
    '',
    RISK,
  ].join('\n');
  return { text, photo: `${APP_URL}/api/card/win?ticket=${encodeURIComponent(String(best.ticket))}&strategy=${Number(best.strategy ?? 2)}`, ticket: String(best.ticket) };
}

/** Le passage de la cron : expire ce qui n'a pas été validé à temps, publie ce qui est validé et dont l'heure est venue. */
export async function runDue(db: Db): Promise<{ published: number; skipped: number; expired: number }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let published = 0, skipped = 0, expired = 0;
  const { data: late } = await db.from('channel_posts').update({ status: 'expired' }).eq('status', 'draft').lte('scheduled_at', new Date(now - GRACE_MS).toISOString()).select('id');
  expired += (late ?? []).length;
  const { data: due } = await db.from('channel_posts').select('*').eq('status', 'approved').lte('scheduled_at', nowIso).order('scheduled_at', { ascending: true }).limit(5);
  const src = sourceChannel();
  for (const r of (due ?? []) as Row[]) {
    // un brouillon validé dans le délai de grâce part tout de suite ; au-delà de STALE_MS (cron en panne), plus rien
    if (now - Date.parse(r.scheduled_at) > STALE_MS) {
      const { data: x } = await db.from('channel_posts').update({ status: 'expired', report: { reason: 'cron en retard' } }).eq('id', r.id).eq('status', 'approved').select('id');
      expired += (x ?? []).length;
      continue;
    }
    if (!src) break;
    // verrou : un seul passage publie une ligne donnée
    const { data: locked } = await db.from('channel_posts').update({ status: 'publishing' }).eq('id', r.id).eq('status', 'approved').select('id');
    if (!locked?.length) continue;
    let text = r.text ?? '', photo = r.photo_url ?? '', ref = r.ref;
    let btnText = r.button_text ?? '', btnUrl = r.button_url ?? '';
    if (r.kind === 'tp') {
      const w = await pickWin(db, r).catch((e) => ({ reason: String((e as Error).message).slice(0, 120) }));
      if ('reason' in w) { await db.from('channel_posts').update({ status: 'skipped', report: { reason: w.reason } }).eq('id', r.id); skipped++; continue; }
      text = w.text; photo = w.photo; ref = w.ticket; btnText = '📲 SEE EVERY TRADE'; btnUrl = L.history;
    }
    let out = await publishToChannels(db, { chatId: src, text, buttonText: btnText, buttonUrl: btnUrl, ...(photo ? { photoUrl: photo } : {}) });
    // la carte n'a pas pu être rendue ou récupérée par Telegram : le gain part en texte, il ne se perd pas
    if (!out.ok && photo) { photo = ''; out = await publishToChannels(db, { chatId: src, text, buttonText: btnText, buttonUrl: btnUrl }); }
    // échec : la ligne repasse en « validé » et le passage suivant réessaie (jusqu'à STALE_MS)
    await db.from('channel_posts').update({ status: out.ok ? 'published' : 'approved', ref, text, photo_url: photo || null, button_text: btnText || null, button_url: btnUrl || null, message_id: out.ok ? out.messageId : null, report: out.ok ? out.report : { error: out.error, report: out.report } }).eq('id', r.id);
    if (out.ok) published++;
  }
  return { published, skipped, expired };
}

// ── LES CORRECTIONS DE MATHIEU ────────────────────────────────────────────────────────────────────────

const addDaysCm = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayFr = () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });

function briefOf(r: Row): Brief | null {
  if (r.kind === 'morning') return { kind: 'morning' };
  if (r.kind === 'howto') { const p = HOWTO.find((x) => x.id === r.ref); return p ? { kind: 'howto', card: p.text, button: p.btn } : null; }
  if (r.kind === 'cta') { const c = CTAS.find((x) => x.id === r.ref); return c ? { kind: 'cta', goal: CTA_GOAL[c.id] ?? 'bring them to the app', reference: c.text, button: c.btn } : null; }
  return null;
}

/** RÉPONSE DE MATHIEU AU MESSAGE DU MATIN. « 2 plus court » : le post 2 est réécrit par le rédacteur (puis à revalider)
 *  et la remarque entre dans la mémoire du CM. « # règle » : la règle entre dans la mémoire, rien n'est réécrit.
 *  `defer` repousse la réécriture après la réponse au webhook (Telegram n'attend pas un modèle).
 *  Renvoie false si le message ne répond pas à un message du matin : le webhook poursuit alors son traitement. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleCmReply(db: Db, msg: any, defer: (fn: () => Promise<void>) => void): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const replyTo = Number(msg?.reply_to_message?.message_id) || 0;
  if (!text || !replyTo || msg?.chat?.type !== 'private' || msg?.business_connection_id) return false;
  const chat = Number(msg.chat.id);
  const { data: plans } = await db.from('channel_posts').select('day,report').eq('kind', 'plan').gte('day', addDaysCm(tradingDayOf(new Date()), -3)).limit(10);
  const plan = ((plans ?? []) as Array<{ day: string; report: { msgs?: Array<{ chat: number; id: number }> } | null }>)
    .find((p) => (p.report?.msgs ?? []).some((m) => Number(m.chat) === chat && Number(m.id) === replyTo));
  if (!plan) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return true;
  const by = msg.from?.username ? `@${msg.from.username}` : String(msg.from?.id ?? 'admin');
  const reply = (t: string) => tg('sendMessage', { chat_id: chat, text: t, reply_to_message_id: msg.message_id });
  const day = String(plan.day).slice(0, 10);

  if (text.startsWith('#')) {
    const rule = text.replace(/^#+\s*/, '');
    if (!rule) return true;
    const ok = await appendAgentMemory(db, `${todayFr()} · ${rule.slice(0, 400)}`, by, 'cm_memory');
    await reply(ok ? '🧠 Noté pour tous les prochains posts du canal.' : '⨯ Pas pu l’enregistrer, réessaie.');
    return true;
  }
  // PLUSIEURS CORRECTIONS DANS UN MESSAGE (Mathieu, 15/10) : une ligne par numéro (« 2 plus court » ⏎ « 5 enlève
  // l'emoji »). Une ligne sans numéro prolonge la correction d'au-dessus.
  const asks: Array<{ n: number; text: string }> = [];
  for (const line of text.split(/\n+/)) {
    const m = /^\s*([1-9])\s*[:.)-]?\s+(.+)$/.exec(line) ?? /^\s*([1-9])\s*[:.)-]\s*(.+)$/.exec(line);
    if (m) asks.push({ n: Number(m[1]), text: m[2].trim() });
    else if (asks.length && line.trim()) asks[asks.length - 1].text += ` ${line.trim()}`;
  }
  if (!asks.length) { await reply('Pour corriger un post : son numéro puis ce qu’il faut changer, par exemple « 2 plus court » (une ligne par post). Pour une règle durable : # + la règle.'); return true; }
  const posts = (await rowsOf(db, day)).filter((r) => POST_KINDS.includes(r.kind));
  const todo: Array<{ n: number; r: Row; brief: Brief; instruction: string }> = [];
  const notes: string[] = [];
  for (const a of asks) {
    const r = posts[a.n - 1];
    if (!r) { notes.push(`${a.n} : pas de post ${a.n} ce jour-là`); continue; }
    const label = r.kind === 'morning' ? 'bonjour du matin' : r.kind === 'howto' ? 'How it works' : r.kind === 'cta' ? 'CTA' : 'carte de gain';
    // la remarque est une leçon pour la suite, que le post puisse encore être réécrit ou non
    await appendAgentMemory(db, `${todayFr()} · ${label} : « ${a.text.slice(0, 300)} »`, by, 'cm_memory');
    const brief = briefOf(r);
    if (!brief) { notes.push(`${a.n} : la carte de gain est choisie à son heure, je retiens juste la remarque`); continue; }
    if (!['draft', 'approved', 'skipped'].includes(r.status) || Date.parse(r.scheduled_at) + GRACE_MS <= Date.now()) { notes.push(`${a.n} : déjà parti ou expiré, je retiens juste la remarque`); continue; }
    todo.push({ n: a.n, r, brief, instruction: a.text });
  }
  if (!todo.length) { await reply(`🧠 Noté.${notes.length ? `\n${notes.join('\n')}` : ''}`); return true; }
  const nums = todo.map((t) => t.n).join(', ');
  await reply(`✍️ Je réécris ${todo.length > 1 ? `les posts ${nums}` : `le post ${nums}`}…${notes.length ? `\n${notes.join('\n')}` : ''}`);
  defer(async () => {
    const ctx: DayContext | null = await dayContext(db, day).catch(() => null);
    const fresh = await Promise.all(todo.map((t) => (ctx ? writePost(ctx, t.brief, { instruction: t.instruction, previous: t.r.text ?? '' }).catch(() => null) : Promise.resolve(null))));
    const done: number[] = [], failed: number[] = [], same: number[] = [];
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    for (let k = 0; k < todo.length; k++) {
      if (!fresh[k]) { failed.push(todo[k].n); continue; }
      // version identique (vécu 15/10 : « on dit 106 $ mais la notif a dit 141 $ ») : le rédacteur n'a rien pu changer,
      // le plus souvent parce que la demande porte sur un chiffre, qui vient du code. On le dit au lieu d'annoncer « réécrit ».
      if (norm(String(fresh[k])) === norm(todo[k].r.text ?? '')) { same.push(todo[k].n); continue; }
      // le post corrigé redevient un brouillon : il repart seulement après un nouveau ✅
      await db.from('channel_posts').update({ text: fresh[k], status: 'draft', report: { writer: 'fixed' }, decided_by: by, decided_at: new Date().toISOString() }).eq('id', todo[k].r.id);
      done.push(todo[k].n);
    }
    if (done.length) {
      const view = renderPlan(day, await rowsOf(db, day));
      await tg('editMessageText', { chat_id: chat, message_id: replyTo, text: view.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: view.keyboard } });
    }
    await reply([
      done.length ? `✅ ${done.length > 1 ? `Posts ${done.join(', ')} réécrits` : `Post ${done[0]} réécrit`}, mis à jour dans le message : revalide avec ✅ Tout valider.` : '',
      failed.length ? `⨯ Pas réussi à réécrire proprement ${failed.join(', ')} (ou la version ne respectait pas les règles du canal) : le texte reste tel quel, ❌ pour le retirer.` : '',
      same.length ? `⚠️ ${same.join(', ')} : rien changé, la nouvelle version était identique. Si ta demande porte sur un chiffre : les chiffres viennent du code (journée de Paris, mêmes trades que le récap et l’app) et ne se modifient pas, mais je peux les retirer du post, dis-le-moi (« 1 enlève les chiffres »).` : '',
      '🧠 Remarques notées.',
    ].filter(Boolean).join('\n'));
  });
  return true;
}
