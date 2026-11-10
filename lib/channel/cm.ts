// 📣 LE CM AUTOMATIQUE DU CANAL PUBLIC (15/10/2026, décision Mathieu : « Go pour le CM et les CTA »).
//
// 🔁 REFONTE DU 10/11/2026 (Mathieu : le canal sonne répétitif et robotique, il veut que ça sonne comme s'il postait
// lui-même). Ce qui suit dans ce commentaire décrit la version du 15/10 ; ce qui a changé :
//   · plus de séquence fixe : un plan de 4 à 5 posts par jour, heures tirées au hasard dans des fenêtres larges, formats
//     pondérés jamais deux fois de suite (lib/channel/plan.ts), pour laisser la place aux 3 à 4 bulles vidéo de Mathieu ;
//   · plus d'en-tête « 🔵💙 HOW IT WORKS », plus de 👇 obligatoire, 1 ou 2 CTA par jour (les seuls boutons, 2 au plus) ;
//   · la carte de gain fixe (« ✅ +$X at 0.10 lot … Closed by Algoria AI ») devient un trade commenté à la 1re personne ;
//   · le guide de ton est contrôlé par le code (lib/channel/tone.ts) : un texte refusé est réécrit une fois, puis le
//     post saute (plus de texte de banque en secours, sauf les annonces du webinaire) ;
//   · la phrase de risque : une ligne en italique, seulement sur un post qui montre un chiffre de résultat ;
//   · plus de bannière automatique : une image seulement quand c'est une vraie photo (les coulisses du matin) ;
//   · la photo vient du dossier Drive de Mathieu (lib/channel/photos.ts), marquée utilisée à la publication.
// Les webinaires gardent leur logique (webinarPost, plus bas) : un CTA prévu devient l'annonce.
//
// Le constat (analyse du canal du 02/10) : des textes de motivation et des bonjour / bonne nuit jamais lus, rien le
// soir, et rien sur ce que l'audience demande (26 votes sur 34 : « automation explanations »). Les trois quarts de ce
// qui marche, c'est Mathieu : ses bulles vidéo, ses CTA envoyés depuis l'admin, ses transferts des gains du VIP.
// Le bot reprend tout ça, sauf les bulles vidéo (il propose seulement la question du jour) :
//   · 9h00   le bonjour qui lance la journée, écrit avec ce qui se passe vraiment ce jour-là ;
//   · 11h00  un post « How it works » (une banque de fiches, en rotation, faits de l'Academy uniquement) ;
//   · 17h30, 20h30  deux CTA (13h00 et 20h30 le week-end), en rotation, vers l'app ou vers Mathieu : les SEULS
//     posts avec un bouton (22/10/2026) ;
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
// RIEN NE PART SANS UN CLIC. LA VEILLE À 18h (Paris), les admins reçoivent les posts du lendemain dans un seul message
// (Mathieu, 15/10 : « je me lève pas aussi tôt » ; 23/10 : 23h15 lui arrivait à 1 h du matin à Dubaï) :
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
import { publishPollToChannels, publishToChannels, sourceChannel } from './publish';
import { adminTgIds, notifyOwner } from '@/lib/member/notifyOwner';
import { buildDayPlan, type PlanFormat } from './plan';
import { driveWanted, listDrivePhotos, LOW_STOCK, pickFresh, readDriveEnv, sendDrivePhoto, type PhotoCandidate, type PhotoUse } from './photos';
import { firstLine, normLine, rationedIn, similarity, SIMILAR } from './tone';
import { HISTORY_MAINTENANCE } from '@/lib/member/historyMaintenance';
import { appendAgentMemory } from '@/lib/member/agentDocs';
import { amountsLine, check, dayContext, writePoll, writePost, type Brief, type DayContext, type TradeFacts } from './writer';
import { safeSlice, wellFormed } from './text';
import { atOneLot, atRef } from '@/lib/display/scale';
import { tradingDayOf, tradingDayStartMs, tradingTimeMs } from '@/lib/display/tradingDay';
import { APP_URL, SUPPORT_TG_URL } from '@/lib/member/i18n';
import { LIVE_DM_LINE, saHour, seatLink, ukDay, ukHour, upcomingSessions, WEBINAR_PAGE, type WebinarSession } from '@/lib/member/webinar';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const RISK = "Trading involves risk. Past results don't guarantee future results.";
const L = {
  app: `${APP_URL}/member`,
  start: `${APP_URL}/member/onboarding`,
  academy: `${APP_URL}/academy`,
  install: `${APP_URL}/download`,
  history: `${APP_URL}/member/history`,
  track: 'https://getalgoria.com/track-record',
  me: SUPPORT_TG_URL,
};

export type CmPost = { id: string; text: string; btn: string; url: string };
const post = (id: string, lines: string[], btn: string, url: string): CmPost => ({ id, text: lines.join('\n'), btn, url });
const card = (id: string, lines: string[]) => ({ id, text: lines.join('\n') });
const HOW = '🔵💙 HOW IT WORKS';

/** Les posts « How it works », dans l'ordre de passage. Chaque affirmation vient de l'Academy (lib/member/academy.ts).
 *  Sans bouton (22/10/2026, voir « deux boutons par jour » plus bas). */
export const HOWTO: Array<{ id: string; text: string }> = [
  card('who', [HOW, "<b>Who's really trading ?</b>", '', 'Algoria is 100% driven by AI. 🤖', 'Mathieu built it. He never places a trade by hand.', '', "Every trade you see here is the AI's decision. Zero manual trades."]),
  card('copy', [HOW, '<b>Do I have to copy the trades myself ?</b>', '', 'No. ❌', '', 'You connect your own MetaTrader 5 account once.', 'After that, every Algoria trade is copied to it automatically, at the size you chose.', '', 'No signals to follow. No charts to watch. You see everything live in the app. 📲']),
  card('money', [HOW, '<b>Whose account is it ?</b>', '', 'Yours. In YOUR name, at the broker. 🔐', '', '🤖 Algoria takes the trade', '🔁 The copier sends it to your trading account', '💼 Your account: your size, your broker, your name', '', 'Nothing goes through us.']),
  card('password', [HOW, '<b>What can the trader password do ?</b>', '', 'It connects your account to the copier. That\'s it.', '', '✅ Copy the trades', '❌ Take anything out of your account', '❌ Open your client area', '', 'Your account stays 100% in your hands. 🙌']),
  card('start', [HOW, '<b>What do I need to start ?</b>', '', '1️⃣ Create your trading account with our partner broker', '2️⃣ Connect your trading account to Algoria in the app: encrypted, 2 minutes', '3️⃣ The team switches the copy on ✅', '', 'Trading involves risk.']),
  // 'stoploss' RETIRÉ (22/10/2026) : « Every trade has a stop loss… never averaged down » était faux — la nuit du
  // 21 au 22/10, 124 positions sur 145 n'avaient pas de stop et le copieur rachetait à chaque baisse. Il ne revient
  // que quand le stop obligatoire est imposé par le runner (garde-fous de l'après-incident).
  card('pause', [HOW, '<b>Can I stop the copy ?</b>', '', 'Yes, anytime, by yourself. ⏸', '', 'Open the app, Profile, PAUSE.', 'The copy stops. Tap RESUME when you want it back.', '', 'No message to send, no one to ask. You stay in control.']),
  card('quiet', [HOW, '<b>No trade today ?</b>', '', "That's the plan. ✅", '', 'Algoria never forces a trade. It only enters when a clean setup shows up.', '', 'Quiet days are normal. They are part of the strategy, not a bug. 🧘']),
  card('free', [HOW, '<b>Why is Algoria free ?</b>', '', '💸 No subscription, no fee, never a cut of your profits.', '', 'The partner broker pays Algoria when you create your trading account through our link.', "That's why the link matters: an account created without it isn't linked to Algoria. 🔗"]),
  card('martingale', [HOW, '<b>Is it a martingale ?</b>', '', 'No. 🙅', '', 'A martingale doubles its size after every loss to win it back.', 'Algoria does the opposite:', '📏 you choose your copy size once', '📏 it stays the same, win or lose', '', 'Your lot never grows after a loss.']),
  card('track', [HOW, '<b>Do they only show the wins ?</b>', '', 'No. 📊', '', 'The track record is the real account: month by month since July 2026, trade by trade since October. Red months included.', '', 'No simulation. No backtest. No screenshots.', '', RISK]),
  card('broker', [HOW, '<b>Which broker should I pick ?</b>', '', '🥇 RaiseFX first: your account runs with the same spreads as the account Algoria trades.', '', 'Already have an account there ? Pick another partner: VT Markets, PU Prime, TradingSphere or Xlence.', '', 'The app gives you the right link for each one. 📲']),
  card('biglot', [HOW, '<b>Bigger lot, faster results ?</b>', '', 'No. ⚠️', '', 'Your copy size is set once, in your profile, and it never grows after a loss.', "A bigger lot doesn't make the strategy better. It just makes every move bigger, up and down.", '', 'Algoria is built to run calm, not fast. 🧘']),
  card('existing', [HOW, '<b>Already have an account at the broker ?</b>', '', "You can't open a second one at the same broker: KYC blocks it. 🚫", '', 'Two easy ways in:', 'A️⃣ Attach your account to Algoria: ask their support, the app gives you the exact message to send', 'B️⃣ Open at another partner broker, through the link in the app']),
  card('lot', [HOW, "<b>What's a lot ?</b>", '', 'The size of a trade. 📏', '', '1.00 is a standard lot. 0.01 is a micro lot, 100 times smaller.', 'The bigger the lot, the more each price move is worth, up AND down.', '', 'At Algoria: your lot is set once in your profile, and it never grows after a loss.']),
  card('theapp', [HOW, "<b>What's in the app ?</b>", '', '📲 The live AI feed: what Algoria is watching, right now', '✅ Every trade, wins and losses, at your own size', '🔔 A notification when a trade closes in profit', '', 'No App Store. Installs in seconds. Free.']),
  card('setup', [HOW, '<b>How long does the setup take ?</b>', '', 'About 10 minutes on your side. ⏱', '', '1️⃣ Create your trading account through the app', '2️⃣ Connect your trading account to Algoria', '', 'Stuck at any step ? Write to Mathieu, he answers himself. 💬']),
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
];

/** 🛠 TANT QUE L'HISTORIQUE EST EN MAINTENANCE pour les prospects (lib/member/historyMaintenance.ts), aucun post ne les
 *  envoie vers un track record ou un historique qu'ils ne peuvent pas voir (26/10/2026 : « Are you only showing me the
 *  good days ? … nothing hidden » est parti alors que la page du track record affichait « maintenance »). Ces fiches
 *  reviennent d'elles-mêmes quand HISTORY_MAINTENANCE repasse à false. */
const NEEDS_HISTORY = new Set(['track', 'theapp', 'results', 'trackcta']);
const shown = (id: string) => !HISTORY_MAINTENANCE || !NEEDS_HISTORY.has(id);

// LA SÉQUENCE FIXE WEEKDAY / WEEKEND (15/10 → 09/11/2026) est remplacée par le plan de lib/channel/plan.ts.
// DEUX BOUTONS PAR JOUR, PAS PLUS (22/10/2026, Mathieu : « à la limite un ou deux boutons par jour pour les CTA ») :
// seuls les CTA ont un bouton, et le plan en prévoit 1 ou 2.
/** Heure (Paris) à laquelle le plan du LENDEMAIN part aux admins. Mathieu valide le soir, la journée tourne seule. Avant
 *  cette heure, c'est le plan du jour qui manque éventuellement (panne, premier jour) qui est préparé, tout de suite.
 *  23h15 jusqu'au 23/10/2026 (après la fermeture de l'or) ; 18h depuis, à la demande de Mathieu qui vit à Dubaï
 *  (20 h ou 21 h chez lui). La séance du jour n'est pas finie à 18h : le bonjour ne cite le résultat de la veille que
 *  si la séance est close au moment de l'écrire (lib/channel/writer.ts, dayContext). */
export const PLAN_AT = '18:00';
/** MASTER À L'ARRÊT (23/10/2026, Mathieu) : support_settings 'cm_win_cards' = 'off' → pas de gain à montrer, la carte de
 *  14 h devient un How it works et celle de 19 h « la question de la semaine », sans bouton. Remettre 'on' quand le
 *  nouveau master trade. */
async function winCardsOn(db: Db): Promise<boolean> {
  const { data } = await db.from('support_settings').select('value').eq('key', 'cm_win_cards').limit(1);
  return String((data?.[0] as { value?: string } | undefined)?.value ?? 'on').trim().toLowerCase() !== 'off';
}
/** Le jour dont le plan doit exister à l'instant `now`. */
export const planTarget = (now = Date.now()) => {
  const today = tradingDayOf(now);
  return now >= tradingTimeMs(today, PLAN_AT) ? new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : today;
};
const TP_MIN_AT_ONE_LOT = 150; // le seuil des cartes de gain du VIP (runner/metaapi/trades.ts, VIP_WIN_MIN_USD)
const STALE_MS = 90 * 60_000; // un post validé mais raté de plus de 1 h 30 (panne) ne part plus : il serait hors sujet
const GRACE_MS = 60 * 60_000; // un brouillon validé jusqu'à 1 h après son heure part tout de suite ; au-delà il expire
// L'ANCIEN « JITTER » (hash(jour:créneau) % 21 − 10 min) est retiré : il glissait de −2 min par jour sur cta2 et cta3.
// Les heures sont tirées au hasard au moment du plan (lib/channel/plan.ts) puis figées dans scheduled_at.
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
};
const VIDEO_AT = '19:30';

// 🎤 LES WEBINAIRES DANS LE CANAL (24/10/2026, Mathieu : « forme bien le CM sur tout ça »). La veille d'une session, le
// CTA « app » devient l'annonce du webinaire ; le jour J, les deux CTA aussi : « ce soir » au premier créneau, et le
// second avancé à 15 min du début (« on commence dans 15 minutes », bouton droit sur le bot, qui envoie le lien Zoom
// tout de suite). Toujours deux boutons par jour au plus, et la rotation des CTA reprend le lendemain là où elle était.
// Le bonjour de la veille et du jour J peut en dire un mot, sans bouton.
// 'soon' = J-2 (26/10/2026, Mathieu : « il faut commencer à teaser le webinaire… prévenir tout le monde que y'a un webinaire
// dans 2 jours ») : le mercredi s'annonce le lundi, le dimanche le vendredi
export type WbPhase = 'soon' | 'tomorrow' | 'today' | 'last';
const WB_LAST_CALL_MS = 15 * 60_000;
export function webinarPost(s: WebinarSession, phase: WbPhase): CmPost & { goal: string } {
  const at = `${ukHour(s.starts_at)} UK time (${saHour(s.starts_at)} in South Africa)`;
  if (phase === 'last') {
    return {
      ...post('webinar-last', ['🔴 <b>We go live in 15 minutes.</b>', '', 'Zoom, 45 minutes, in English, with me.', 'Tap below, press START, and the Zoom link comes straight away 👇'], '🎥 JOIN THE LIVE', seatLink(s.id, 'channel')),
      goal: `last call: Mathieu's free live webinar on Zoom starts in 15 minutes (${at}). The button opens Telegram: they press START and the Zoom link comes straight away. Short and urgent`,
    };
  }
  const when = phase === 'soon' ? ukDay(s.starts_at) : phase === 'tomorrow' ? `Tomorrow, ${ukDay(s.starts_at)}` : 'Tonight';
  return {
    ...post(`webinar-${phase}`, [
      `🎤 <b>${when}, I’m going live.</b>`,
      '',
      `${phase === 'soon' ? 'In 2 days, ' : ''}${at}, on Zoom, in English.`,
      '45 minutes: how the AI trades gold, the real app on screen, real past results, and your questions.',
      '',
      '🎁 At the end, something reserved for the 10 people who are there live.',
      '',
      'Free. Save your seat 👇',
      '',
      LIVE_DM_LINE,
    ], '🎤 SAVE MY SEAT', `${WEBINAR_PAGE}?src=channel`),
    goal: `announce Mathieu's free live webinar on Zoom ${phase === 'soon' ? `IN 2 DAYS, on ${ukDay(s.starts_at)}` : phase === 'tomorrow' ? `TOMORROW, ${ukDay(s.starts_at)}` : 'TONIGHT'}, at ${at}: 45 minutes in English, his story, how the AI trades gold, the real app on screen, real past results, live questions. At the end something is reserved for the 10 people who are there live (never say what it is). Make them save their seat now. Keep one line, in substance: or just DM @mathieu_algoria the single word LIVE (write LIVE in <b>bold</b>) and their seat is saved. One button only, the system adds it. No Zoom link in the text, no second button, no figure you were not given, nothing negative, no promise of gains`,
  };
}

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

/** Les formats publiables (les anciens noms restent lisibles pour les plans d'avant le 10/11/2026). */
const POST_KINDS = ['backstage', 'gold', 'qa', 'story', 'trade', 'poll', 'lesson', 'cta', 'morning', 'howto', 'tp'];
/** Une fiche « How it works » sans son en-tête : les faits seulement (la pédagogie reformulée). */
const cardFacts = (t: string) => t.split('\n').filter((l) => !l.includes(HOW)).join('\n').trim();
/** Écart minimal entre le dernier appel du webinaire et un autre post du CM. */
const WB_GAP_MS = 60 * 60_000;

/** Crée les posts du jour (une seule fois : (day, slot) est unique). Renvoie le nombre de lignes créées. */
export async function planDay(db: Db, day: string): Promise<number> {
  const { data: existing } = await db.from('channel_posts').select('id').eq('day', day).limit(1);
  if (existing?.length) return 0;
  const weekend = isWeekend(day);
  // ROTATION : les fiches et les CTA repartent après leur dernier post PUBLIÉ (ou validé), anciens noms compris.
  const { data: hist } = await db.from('channel_posts').select('ref,kind').in('kind', ['howto', 'lesson', 'cta']).in('status', ['published', 'publishing', 'approved'])
    .order('scheduled_at', { ascending: false }).limit(100);
  const last = (pred: (r: { ref: string | null; kind: string }) => number) => { for (const r of (hist ?? []) as Array<{ ref: string | null; kind: string }>) { const i = pred(r); if (i >= 0) return i; } return -1; };
  let hi = last((r) => (r.kind === 'howto' || r.kind === 'lesson' ? HOWTO.findIndex((p) => p.id === r.ref) : -1));
  const ci: Record<string, number> = {
    app: last((r) => (r.kind === 'cta' ? CTAS.findIndex((c) => c.id === r.ref && c.fam === 'app') : -1)),
    mathieu: last((r) => (r.kind === 'cta' ? CTAS.findIndex((c) => c.id === r.ref && c.fam === 'mathieu') : -1)),
  };
  const lastFam = ((hist ?? []) as Array<{ ref: string | null; kind: string }>).filter((r) => r.kind === 'cta').map((r) => CTAS.find((c) => c.id === r.ref)?.fam).find(Boolean) ?? 'app';
  // le format du dernier post de la veille : jamais deux fois de suite, même d'un jour à l'autre
  const { data: prevRows } = await db.from('channel_posts').select('kind').eq('day', addDaysCm(day, -1)).in('kind', POST_KINDS).order('scheduled_at', { ascending: false }).limit(1);
  const prevKind = (prevRows?.[0] as { kind?: string } | undefined)?.kind ?? null;
  const now = Date.now();
  const winCards = await winCardsOn(db).catch(() => true);
  // 🎤 le webinaire dans 2 jours, du lendemain ou du jour (voir webinarPost) — logique inchangée, rien n'est planifié ici
  const wb = (await upcomingSessions(db, 1).catch(() => []))[0] as WebinarSession | undefined;
  const wbStart = wb ? Date.parse(wb.starts_at) : 0;
  const wbDay = wb && wbStart > now ? tradingDayOf(wbStart) : null;
  const wbPhase: WbPhase | null = wbDay === day ? 'today' : wbDay && wbDay === addDaysCm(day, 1) ? 'tomorrow' : wbDay && wbDay === addDaysCm(day, 2) ? 'soon' : null;

  const planned = buildDayPlan({ day, weekend, timeMs: (hhmm) => tradingTimeMs(day, hhmm), rand: Math.random, prevKind, trades: winCards && !weekend, ...(wbPhase === 'today' ? { ctas: 2 as const } : {}) });
  // CTA : deux le même jour = un « Mathieu » et un « app », comme avant ; un seul = l'autre famille que la dernière fois
  const ctaSlots = planned.filter((p) => p.kind === 'cta');
  const fams: Array<'app' | 'mathieu'> = ctaSlots.length > 1 ? ['mathieu', 'app'] : [lastFam === 'app' ? 'mathieu' : 'app'];
  if (ctaSlots.length === 1 && (wbPhase === 'soon' || wbPhase === 'tomorrow')) fams[0] = 'app'; // l'annonce prend le CTA « app »

  const rows: Array<Record<string, unknown>> = [];
  const briefs: Array<Brief | 'poll' | null> = [];
  let wbFirst = 0, wbLast = false, ctaN = 0;
  for (const s of planned) {
    let at = s.at;
    if (at <= now) continue; // créneau déjà passé (plan préparé en retard)
    const base = { day, slot: s.slot, kind: s.kind as PlanFormat, scheduled_at: new Date(at).toISOString(), status: 'draft' };
    if (s.kind === 'cta') {
      const fam = fams[Math.min(ctaN++, fams.length - 1)];
      // 🎤 ce CTA devient-il une annonce du webinaire ? (même règle qu'avant le 10/11 : J-2 et J-1 le CTA « app » ; le jour J
      // « ce soir » au premier CTA plus d'1 h avant le début, puis le dernier appel 15 min avant)
      const wbPick: WbPhase | null = !wb ? null
        : wbPhase === 'tomorrow' || wbPhase === 'soon' ? (fam === 'app' ? wbPhase : null)
        : wbPhase !== 'today' ? null
        : !wbFirst && at < wbStart - 60 * 60_000 ? 'today'
        : !wbLast && wbStart - WB_LAST_CALL_MS > Math.max(now, wbFirst + 60 * 60_000) ? 'last' : null;
      if (wbPick && wb) {
        if (wbPick === 'today') wbFirst = at;
        if (wbPick === 'last') { wbLast = true; at = wbStart - WB_LAST_CALL_MS; }
        const w = webinarPost(wb, wbPick);
        rows.push({ ...base, kind: 'cta', scheduled_at: new Date(at).toISOString(), ref: w.id, text: w.text, button_text: w.btn, button_url: w.url, report: { webinar: wb.id, goal: w.goal } });
        briefs.push({ kind: 'cta', goal: w.goal, reference: w.text, button: w.btn });
        continue;
      }
      const i = nextIn(CTAS, ci[fam], (c) => c.fam === fam && shown(c.id));
      if (i < 0) continue;
      ci[fam] = i;
      const c = CTAS[i];
      rows.push({ ...base, ref: c.id, text: null, button_text: c.btn, button_url: c.url });
      briefs.push({ kind: 'cta', goal: CTA_GOAL[c.id] ?? 'bring them to the app', reference: c.text, button: c.btn });
    } else if (s.kind === 'lesson') {
      hi = nextIn(HOWTO, hi, (p) => shown(p.id));
      const p = HOWTO[hi];
      rows.push({ ...base, ref: p.id, text: null });
      briefs.push({ kind: 'lesson', card: cardFacts(p.text) });
    } else if (s.kind === 'trade') {
      rows.push({ ...base, ref: null, text: null }); briefs.push(null); // le trade est choisi et commenté à son heure
    } else if (s.kind === 'poll') {
      rows.push({ ...base, ref: 'poll', text: null }); briefs.push('poll');
    } else if (s.kind === 'backstage') {
      rows.push({ ...base, ref: 'backstage', text: null }); briefs.push({ kind: 'backstage', photo: true }); // photo : voir plus bas
    } else {
      rows.push({ ...base, ref: s.kind, text: null }); briefs.push({ kind: s.kind } as Brief);
    }
  }
  // le dernier appel du webinaire est à heure fixe : un autre post du CM trop près de lui saute (place à la bulle)
  const lastCall = rows.find((r) => r.ref === 'webinar-last');
  if (lastCall) {
    const t = Date.parse(String(lastCall.scheduled_at));
    for (let k = rows.length - 1; k >= 0; k--) if (rows[k] !== lastCall && rows[k].kind !== 'cta' && Math.abs(Date.parse(String(rows[k].scheduled_at)) - t) < WB_GAP_MS) { rows.splice(k, 1); briefs.splice(k, 1); }
  }
  if (!rows.length) return 0;

  // LA PHOTO DES COULISSES : choisie maintenant, marquée utilisée seulement à la publication (runDue)
  let photoAlert: string | null = null;
  const bk = rows.findIndex((r) => r.kind === 'backstage');
  if (bk >= 0) {
    const ph = await choosePhoto(db, day).catch(() => null);
    photoAlert = ph?.alert ?? null;
    if (ph?.key) { rows[bk].photo_url = ph.fileId ?? null; rows[bk].report = { photo_key: ph.key, ...(ph.driveId ? { drive_file_id: ph.driveId } : {}) }; }
    else briefs[bk] = { kind: 'backstage', photo: false };
  }

  // LA RÉDACTION : tous les posts du jour en parallèle (un appel chacun, comme avant : la cron a 60 s). Échec ou texte
  // refusé deux fois par les garde-fous → le post SAUTE (10/11/2026 : la banque sonnait robot), sauf les annonces du
  // webinaire, qui gardent leur texte.
  const ctx = await dayContext(db, day).catch(() => null);
  if (ctx && wb && wbPhase) ctx.webinar = `Mathieu's free live webinar on Zoom is ${wbPhase === 'today' ? 'TONIGHT' : wbPhase === 'tomorrow' ? `TOMORROW, ${ukDay(wb.starts_at)}` : `IN 2 DAYS, on ${ukDay(wb.starts_at)}`}, at ${ukHour(wb.starts_at)} UK time (${saHour(wb.starts_at)} in South Africa), 45 minutes in English. The announcement posts carry one button to save a seat, and one line: or just DM @mathieu_algoria the single word LIVE and the seat is saved. The final reminder (we go live in a few minutes) does not add that line. The morning post may mention the webinar in one warm line (no link, no button, no pointing below); other posts do not mention it. Never a Zoom link in the channel, never a second button, nothing negative, no promise of gains.`;
  const write = (b: Brief | 'poll' | null, openings: string[] = []) => (!ctx || !b ? Promise.resolve(null)
    : b === 'poll' ? writePoll(ctx, openings).then((p) => (p ? JSON.stringify(p) : null)).catch(() => null)
    : writePost(ctx, b, { openings }).catch(() => null));
  const written: Array<string | null> = await Promise.all(briefs.map((b) => write(b)));
  // dans la journée aussi : deux posts écrits en parallèle ne s'ouvrent pas pareil (le second est réécrit une fois,
  // en connaissant les ouvertures des autres), et 🙏 / 🙌 ne passent qu'une fois
  const opening = (k: number) => (briefs[k] === 'poll' ? String((JSON.parse(String(written[k])) as { question?: string }).question ?? '') : firstLine(String(written[k] ?? '')));
  for (let k = 1; k < rows.length; k++) {
    if (!written[k] || !briefs[k]) continue;
    const mine = opening(k);
    const clash = rows.slice(0, k).some((_, j) => written[j] && (normLine(opening(j)) === normLine(mine) || similarity(opening(j), mine) >= SIMILAR));
    if (clash) written[k] = await write(briefs[k], rows.slice(0, k).map((_, j) => (written[j] ? opening(j) : '')).filter(Boolean));
  }
  const rationed = new Set<string>();
  for (let k = 0; k < rows.length; k++) {
    if (!written[k] || briefs[k] === 'poll') continue;
    let t = String(written[k]);
    for (const key of rationedIn(t)) {
      if (rationed.has(key)) t = t.replace(key === 'pray' ? /\s?🙏[\u{1F3FB}-\u{1F3FF}]?/gu : /\s?🙌[\u{1F3FB}-\u{1F3FF}]?/gu, '');
      rationed.add(key);
    }
    written[k] = t;
  }
  for (let k = rows.length - 1; k >= 0; k--) {
    const rep = (rows[k].report as object | undefined) ?? {}; // garde le brief d'un CTA webinaire (briefOf) et la photo
    if (rows[k].kind === 'trade') continue;
    if (written[k] && briefs[k] === 'poll') { const p = JSON.parse(String(written[k])) as { question: string; options: string[] }; rows[k].text = p.question; rows[k].report = { ...rep, poll: p, writer: 'ai' }; }
    else if (written[k]) { rows[k].text = written[k]; rows[k].report = { ...rep, writer: 'ai' }; }
    else if (String(rows[k].ref ?? '').startsWith('webinar-')) rows[k].report = { ...rep, writer: 'bank' };
    else { rows.splice(k, 1); briefs.splice(k, 1); } // pas de version en conserve
  }
  if (!rows.some((r) => r.kind !== 'trade')) return 0;
  // une seule requête : si un autre passage a créé le plan entre-temps, l'unicité fait tout échouer, et un seul
  // message part aux admins
  const { error } = await db.from('channel_posts').insert(rows);
  if (error) return 0;
  // 📸 stock de photos bas ou nul : une alerte par plan (donc une par jour), par le canal d'alerte admin habituel
  if (photoAlert) await notifyOwner({ title: '📸 Photos du CM', lines: [photoAlert], tag: 'cm-photos' }).catch(() => null);
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
    .map((r) => (r.detail?.from === 'client' ? String(r.detail?.text ?? '') : '')).filter((t) => t.length > 8 && !t.startsWith('[')).map((t) => safeSlice(t, 300));
  if (msgs.length < 5) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const res = await new Anthropic().messages.create({
    model: process.env.ALGORIA_CM_MODEL ?? 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: 'You read messages that prospects sent to the founder of Algoria, an AI that trades gold and is copied on members\' own broker accounts. Find the ONE concrete question that comes up most often and that a 30-second video answer would settle. Reply with that question only, in English, under 15 words. No names, no account numbers, no amounts. If nothing stands out, reply NONE.',
    messages: [{ role: 'user', content: wellFormed(safeSlice(msgs.join('\n---\n'), 30000)) }],
  });
  const out = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim().replace(/^["«]|["»]$/g, '');
  return !out || /^none\b/i.test(out) || out.length > 160 ? null : out;
}

// ── LE MESSAGE AUX ADMINS ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<string, string> = { draft: '⏳ à valider', approved: '✅ validé', publishing: '📤 en cours', published: '📣 publié', skipped: '❌ pas publié', expired: '⌛ expiré' };
const NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const parisHHMM = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

async function rowsOf(db: Db, day: string): Promise<Row[]> {
  const { data } = await db.from('channel_posts').select('*').eq('day', day).order('scheduled_at', { ascending: true });
  return (data ?? []) as Row[];
}

const HEADS: Record<string, string> = {
  backstage: 'COULISSES', gold: "AVIS SUR L'OR", qa: 'QUESTION DE MEMBRE', story: 'HISTOIRE PERSO', trade: 'TRADE COMMENTÉ',
  poll: 'SONDAGE', lesson: 'PÉDAGOGIE', morning: 'BONJOUR', howto: 'HOW IT WORKS', tp: 'CARTE DE GAIN',
};
const headOf = (r: { kind: string; ref: string | null }) => (r.kind === 'cta' ? (r.ref?.startsWith('webinar-') ? 'CTA 🎤 WEBINAIRE' : 'CTA 🔘') : HEADS[r.kind] ?? r.kind.toUpperCase());

/** Le message du matin, régénéré depuis la base à chaque clic : il dit toujours l'état réel. */
export function renderPlan(day: string, rows: Row[]): { text: string; keyboard: Array<Array<Record<string, string>>> } {
  const posts = rows.filter((r) => POST_KINDS.includes(r.kind));
  const idea = rows.find((r) => r.kind === 'video')?.text;
  const tomorrow = day > tradingDayOf(Date.now());
  const parts: string[] = [`📣 <b>Canal public · ${tomorrow ? 'demain, ' : ''}${esc(dayLabel(day))}</b>`, tomorrow ? '<i>Valide ce soir : les posts partiront demain à leur heure, même si tu dors. Rien ne part sans ton clic. Source + miroir UK + canal IT (traduit).</i>' : '<i>Rien ne part sans ton clic. Source + miroir UK + canal IT (traduit).</i>'];
  posts.forEach((r, i) => {
    const head = headOf(r);
    const by = (r.report as { writer?: string } | null)?.writer;
    const tag = by === 'ai' ? ' · ✍️ IA' : by === 'fixed' ? ' · ✏️ corrigé' : by === 'bank' ? ' · 📄 banque' : '';
    const rep0 = (r.report as { photo_key?: string } | null) ?? {};
    // plus de bannière (10/11/2026) : une image seulement quand c'est une vraie photo
    const img = r.photo_url || rep0.photo_key ? ' · 📸 photo' : r.kind === 'backstage' ? ' · texte seul (pas de photo fraîche)' : '';
    parts.push('', `<b>${NUM[i] ?? i + 1}  ${parisHHMM(r.scheduled_at)} · ${head}</b>${tag}${img} · ${STATUS[r.status] ?? r.status}`);
    if (r.kind === 'tp' || r.kind === 'trade') {
      const rep = r.report as { reason?: string } | null;
      parts.push(r.text ? `<blockquote>${esc(safeSlice(plain(r.text), 300))}</blockquote>` : `<i>Le meilleur gain copié depuis le début de la séance (au moins +$15 à 0.10 lot), pas encore montré, commenté à la première personne à son heure (chiffres réels). Rien s'il n'y en a pas.${rep?.reason ? ` · ${esc(rep.reason)}` : ''}</i>`);
    } else if (r.kind === 'poll') {
      const poll = (r.report as { poll?: { question: string; options: string[] } } | null)?.poll;
      parts.push(`<blockquote>📊 ${esc(poll?.question ?? r.text ?? '')}${(poll?.options ?? []).map((o) => `\n▫️ ${esc(o)}`).join('')}</blockquote>`);
    } else {
      parts.push(`<blockquote>${esc(safeSlice(plain(r.text ?? ''), 420))}</blockquote>`);
      if (r.button_text) parts.push(`🔘 ${esc(r.button_text)}`);
    }
  });
  if (!isWeekend(day)) parts.push('', '<i>23:05 · le récap du jour garde son brouillon à part, comme d\'habitude.</i>');
  if (idea) parts.push('', `🎥 <b>Idée de bulle vidéo</b> (la question qui revient le plus en support cette semaine) :`, `« ${esc(idea)} »`);
  parts.push('', '<i>Pour corriger un post : réponds à ce message avec son numéro et ce qu\'il faut changer (« 2 plus court », « 1 change la photo »). Pour une règle durable : # + la règle. Un post non validé part quand même si tu valides jusqu\'à 1 h après son heure.</i>');
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
  const rows = await rowsOf(db, day);
  const { text, keyboard } = renderPlan(day, rows);
  const msgs: Array<{ chat: number; id: number }> = [];
  const admins = await adminTgIds();
  // LA PHOTO DRIVE : téléchargée une fois et envoyée au premier admin ; le file_id Telegram rendu sert ensuite partout
  // (les autres admins, puis la publication), sans retélécharger
  const env = readDriveEnv();
  for (const r of rows) {
    const rep = (r.report as { drive_file_id?: string } | null) ?? {};
    if (!rep.drive_file_id || r.photo_url || !env || !admins.length) continue;
    const fid = await sendDrivePhoto(env, rep.drive_file_id, admins[0], photoCaption(rows, r)).catch((e) => { console.error('[cm] photo Drive:', (e as Error).message); return null; });
    if (fid) { r.photo_url = fid; await db.from('channel_posts').update({ photo_url: fid }).eq('id', r.id); (r as Row & { _sentTo?: number })._sentTo = admins[0]; }
  }
  const album = albumOf(rows);
  for (const chat_id of admins) {
    // la vraie photo d'abord, numérotée comme dans le plan : ce qui part, on le voit (plus de bannières)
    for (const m of album) if (m.sentTo !== chat_id) await tg('sendPhoto', { chat_id, photo: m.media, caption: m.caption });
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

/** Le trade d'un post « trade commenté » : le meilleur trade copié gagnant de la séance, pas encore montré. */
async function pickWin(db: Db, r: Row): Promise<{ trade: Trade; net10: number; facts: TradeFacts } | { reason: string }> {
  const day = String(r.day).slice(0, 10);
  const trades = await liveTrades(db, new Date(tradingDayStartMs(day)).toISOString());
  const { data: used } = await db.from('channel_posts').select('ref').in('kind', ['tp', 'trade']).in('status', ['published', 'publishing']).gte('day', day);
  const done = new Set(((used ?? []) as Array<{ ref: string | null }>).map((u) => String(u.ref)));
  const best = trades
    .filter((t) => tradingDayOf(t.closed_at) === day && Date.parse(t.closed_at) <= Date.now() && atOneLot(t.pnl, t.lot) >= TP_MIN_AT_ONE_LOT && !done.has(String(t.ticket)))
    .sort((a, b) => atOneLot(b.pnl, b.lot) - atOneLot(a.pnl, a.lot))[0] as Trade | undefined;
  if (!best) return { reason: 'aucun gain assez net sur la séance' };
  return {
    trade: best,
    net10: atRef(best.pnl, best.lot),
    facts: {
      direction: best.direction === 'long' ? 'BUY' : best.direction === 'short' ? 'SELL' : null,
      entry: px(best.entry), exit: px(best.exit),
      how: best.reason === 'tp' ? 'it hit its target' : best.reason === 'trail' ? 'the trailing stop locked the profit' : 'it closed in profit',
      closedAt: parisHHMM(best.closed_at),
    },
  };
}

/** LE SECOURS DU TRADE COMMENTÉ (modèle absent ou texte refusé deux fois) : quelques tournures à la première personne,
 *  tirées au hasard, avec les vrais chiffres ({{RESULT}}, remplacé par le code). Elles passent par les mêmes garde-fous. */
export function tradeFallback(f: TradeFacts, rand: () => number = Math.random): string {
  const dir = f.direction ? `${f.direction} ` : '';
  const move = f.entry && f.exit ? `, ${f.entry} to ${f.exit}` : '';
  const open = [
    `The AI just closed a ${dir}on gold${move}.`,
    `That one went the right way : a gold ${dir}trade${move}.`,
    `I was watching this one : gold ${dir}${move ? move.slice(2) : 'trade'}, and ${f.how}.`,
    `Gold ${dir}from the AI this afternoon, ${f.how}.`,
    `One more for the AI on gold, a ${dir}trade${move}.`,
  ];
  const close = [
    'Copied automatically on every connected account.',
    'Nobody had to do anything, the copy handled it.',
    "Members didn't touch a thing, their accounts copied it.",
    'Same trade on every account that copies Algoria, at its own size.',
  ];
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  return [pick(open).replace(/\s+/g, ' ').replace(' ,', ','), '{{RESULT}}', pick(close)].join('\n\n');
}

/** support_settings 'cm_trade_card' = 'on' : le trade commenté garde l'image de la carte (/api/card/win). Par défaut non :
 *  une image seulement quand c'est une vraie photo (10/11/2026). */
async function tradeCardOn(db: Db): Promise<boolean> {
  const { data } = await db.from('support_settings').select('value').eq('key', 'cm_trade_card').limit(1);
  return String((data?.[0] as { value?: string } | undefined)?.value ?? 'off').trim().toLowerCase() === 'on';
}

const asObj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

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
    // un brouillon validé dans le délai de grâce part tout de suite ; au-delà de STALE_MS (cron en panne), plus rien.
    // Un post expiré ne « consomme » pas sa photo : elle n'est marquée qu'à la publication.
    if (now - Date.parse(r.scheduled_at) > STALE_MS) {
      const { data: x } = await db.from('channel_posts').update({ status: 'expired', report: { ...asObj(r.report), reason: 'cron en retard' } }).eq('id', r.id).eq('status', 'approved').select('id');
      expired += (x ?? []).length;
      continue;
    }
    if (!src) break;
    // verrou : un seul passage publie une ligne donnée
    const { data: locked } = await db.from('channel_posts').update({ status: 'publishing' }).eq('id', r.id).eq('status', 'approved').select('id');
    if (!locked?.length) continue;
    const rep = asObj(r.report);
    let text = r.text ?? '', photo = r.photo_url ?? '', ref = r.ref;
    let btnText = r.button_text ?? '', btnUrl = r.button_url ?? '';
    if (r.kind === 'tp' || r.kind === 'trade') {
      const w = await pickWin(db, r).catch((e) => ({ reason: String((e as Error).message).slice(0, 120) }));
      if ('reason' in w) { await db.from('channel_posts').update({ status: 'skipped', report: { ...rep, reason: w.reason } }).eq('id', r.id); skipped++; continue; }
      // LE TRADE COMMENTÉ (10/11/2026) : écrit maintenant, à la première personne, sur ce trade-là ; chiffres du code
      const result = amountsLine(w.net10);
      const ctx = await dayContext(db, String(r.day).slice(0, 10)).catch(() => null);
      let written = ctx ? await writePost(ctx, { kind: 'trade', facts: w.facts }, { result }).catch(() => null) : null;
      if (!written) written = guardTrade(tradeFallback(w.facts), result, ctx);
      if (!written) { await db.from('channel_posts').update({ status: 'skipped', report: { ...rep, reason: 'commentaire refusé par les garde-fous' } }).eq('id', r.id); skipped++; continue; }
      text = written; ref = w.trade.ticket; btnText = ''; btnUrl = '';
      photo = (await tradeCardOn(db).catch(() => false)) ? `${APP_URL}/api/card/win?ticket=${encodeURIComponent(String(w.trade.ticket))}&strategy=${Number(w.trade.strategy ?? 2)}` : '';
    }
    // plus de bannière automatique (10/11/2026) : une image seulement quand c'est une vraie photo
    let out;
    const poll = (rep.poll as { question?: string; options?: string[] } | undefined);
    if (r.kind === 'poll' && poll?.question && poll.options?.length) out = await publishPollToChannels(db, { chatId: src, question: poll.question, options: poll.options });
    else {
      out = await publishToChannels(db, { chatId: src, text, buttonText: btnText, buttonUrl: btnUrl, ...(photo ? { photoUrl: photo } : {}) });
      // l'image n'a pas pu être récupérée par Telegram : le post part en texte, il ne se perd pas (et la photo reste fraîche)
      if (!out.ok && photo) { photo = ''; out = await publishToChannels(db, { chatId: src, text, buttonText: btnText, buttonUrl: btnUrl }); }
    }
    // la photo est « utilisée » maintenant seulement ; sans photo partie, la clé est retirée
    const { photo_key: pk, ...restRep } = rep as { photo_key?: string };
    const keep = out.ok && photo && pk ? { photo_key: pk } : {};
    if (out.ok && photo && typeof pk === 'string' && pk.startsWith('bank:')) await db.from('cm_photos').update({ last_used_at: new Date().toISOString() }).eq('id', Number(pk.slice(5)));
    // échec : la ligne repasse en « validé » et le passage suivant réessaie (jusqu'à STALE_MS)
    await db.from('channel_posts').update({ status: out.ok ? 'published' : 'approved', ref, text, photo_url: photo || null, button_text: btnText || null, button_url: btnUrl || null, message_id: out.ok ? out.messageId : null,
      report: out.ok ? { ...restRep, ...keep, channels: out.report } : { ...rep, error: out.error, channels: out.report } }).eq('id', r.id);
    if (out.ok) published++;
  }
  return { published, skipped, expired };
}

/** Le secours du trade commenté, contrôlé comme un texte du modèle (ton, chiffres, risque). */
export function guardTrade(raw: string, result: string, ctx: DayContext | null): string | null {
  const r = check(raw, { tokens: { RESULT: result }, required: ['RESULT'], noButton: true, allowedUsd: [], autoRisk: true, maxChars: 760,
    tone: { openings: ctx?.openings ?? [], rationedUsed: ctx?.rationedUsed, hasButton: false } });
  return r.ok ? r.text : null;
}

// ── LES CORRECTIONS DE MATHIEU ────────────────────────────────────────────────────────────────────────

const addDaysCm = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayFr = () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });

function briefOf(r: Row): Brief | null {
  const rep = (r.report as { goal?: string; photo_key?: string } | null) ?? {};
  if (r.kind === 'morning') return { kind: 'morning' };
  if (r.kind === 'backstage') return { kind: 'backstage', photo: !!(r.photo_url || rep.photo_key) };
  if (r.kind === 'howto' || r.kind === 'lesson') { const p = HOWTO.find((x) => x.id === r.ref); return p ? { kind: 'lesson', card: cardFacts(p.text) } : null; }
  if (r.kind === 'qa' || r.kind === 'gold' || r.kind === 'story') return { kind: r.kind };
  if (r.kind === 'cta' && r.ref?.startsWith('webinar-') && rep.goal) return { kind: 'cta', goal: rep.goal, reference: r.text ?? '', button: r.button_text ?? '' };
  if (r.kind === 'cta') { const c = CTAS.find((x) => x.id === r.ref); return c ? { kind: 'cta', goal: CTA_GOAL[c.id] ?? 'bring them to the app', reference: c.text, button: c.btn } : null; }
  return null; // trade (écrit à son heure) et sondage (pas de réécriture par réponse, ❌ pour le retirer)
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
  const swaps: Array<{ n: number; r: Row }> = [];
  for (const a of asks) {
    const r = posts[a.n - 1];
    if (!r) { notes.push(`${a.n} : pas de post ${a.n} ce jour-là`); continue; }
    // « 1 change la photo », « 3 autre image » : on change l'image, pas le texte (et ce n'est pas une leçon d'écriture)
    if (IMAGE_ASK.test(a.text) && r.kind !== 'tp' && r.kind !== 'trade') {
      if (!['draft', 'approved', 'skipped'].includes(r.status) || Date.parse(r.scheduled_at) + GRACE_MS <= Date.now()) { notes.push(`${a.n} : déjà parti ou expiré`); continue; }
      swaps.push({ n: a.n, r });
      continue;
    }
    const label = headOf(r).toLowerCase();
    // la remarque est une leçon pour la suite, que le post puisse encore être réécrit ou non
    await appendAgentMemory(db, `${todayFr()} · ${label} : « ${a.text.slice(0, 300)} »`, by, 'cm_memory');
    const brief = briefOf(r);
    if (!brief) { notes.push(`${a.n} : ${r.kind === 'poll' ? 'le sondage ne se réécrit pas, ❌ pour le retirer' : 'le trade commenté est écrit à son heure'}, je retiens juste la remarque`); continue; }
    if (!['draft', 'approved', 'skipped'].includes(r.status) || Date.parse(r.scheduled_at) + GRACE_MS <= Date.now()) { notes.push(`${a.n} : déjà parti ou expiré, je retiens juste la remarque`); continue; }
    todo.push({ n: a.n, r, brief, instruction: a.text });
  }
  for (const sw of swaps) {
    const why = await swapImage(db, sw.r, chat, msg.message_id, `${NUM[sw.n - 1] ?? sw.n} nouvelle photo, à revalider avec ✅ Tout valider`);
    if (why) notes.push(`${sw.n} : ${why}`);
  }
  if (swaps.length) {
    const view = renderPlan(day, await rowsOf(db, day));
    await tg('editMessageText', { chat_id: chat, message_id: replyTo, text: view.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: view.keyboard } });
  }
  if (!todo.length) { if (!swaps.length || notes.length) await reply(`${swaps.length ? '📸 Image changée.' : '🧠 Noté.'}${notes.length ? `\n${notes.join('\n')}` : ''}`); return true; }
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
      await db.from('channel_posts').update({ text: fresh[k], status: 'draft', report: { ...((todo[k].r.report as object) ?? {}), writer: 'fixed' }, decided_by: by, decided_at: new Date().toISOString() }).eq('id', todo[k].r.id);
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

// ── LES IMAGES ─────────────────────────────────────────────────────────────────────────────────────────
// 15/10/2026 (Mathieu : « ça manque de couleurs, de bannières ») : une bannière générée sur chaque post sans photo.
// 10/11/2026 (refonte) : c'est fini, une bannière sur chaque post faisait partie de l'effet « robot ». Une image
// seulement quand c'est une VRAIE photo : celle des coulisses du matin (dossier Drive de Mathieu, sinon la banque
// cm_photos). La route /api/card/banner et bannerParts restent pour les anciens posts déjà publiés ; la carte de gain
// (/api/card/win) ne revient que si support_settings 'cm_trade_card' = 'on'.

const IMAGE_ASK = /\b(photo|image|visuel|banni[eè]re|picture)\b/i;
const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[^\p{L}\p{N}\s,.'’?!:&$+%()\/-]/gu, '').replace(/\s+/g, ' ').trim();

/** L'étiquette et le titre de la bannière d'un post (lus par /api/card/banner). */
export function bannerParts(r: { kind: string; text: string | null; button_text: string | null; day?: string }): { kicker: string; title: string } {
  const text = r.text ?? '';
  const bold = /<b>([\s\S]+?)<\/b>/.exec(text)?.[1];
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l && !/HOW IT WORKS|YOU ASKED/i.test(l)) ?? '';
  let title = strip(bold ?? firstLine);
  if (title.length > 90) title = `${title.slice(0, 87).replace(/\s+\S*$/, '')}…`;
  if (r.kind === 'howto') return { kicker: 'HOW IT WORKS', title: title || 'How Algoria works' };
  if (r.kind === 'qa') return { kicker: 'YOU ASKED', title: title || 'Your questions, answered' };
  if (r.kind === 'morning') {
    const d = r.day ? new Date(`${String(r.day).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).toUpperCase() : '';
    return { kicker: 'GOOD MORNING, ALGORIA FAMILY', title: d || title };
  }
  const kicker = strip(r.button_text ?? '').toUpperCase() || 'ALGORIA AI';
  return { kicker, title: title || 'Algoria AI trades gold for you' };
}

const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
/** L'URL de la bannière d'un post ; `v` change avec le texte et la variante, pour que Telegram ne garde pas l'ancienne. */
export const bannerUrl = (r: { id: number; text: string | null; report: unknown }) =>
  `${APP_URL}/api/card/banner?post=${r.id}&v=${hash(`${r.text ?? ''}#${Number((r.report as { variant?: number } | null)?.variant ?? 0)}`)}`;

/** Les vraies photos du plan (plus de bannières, 10/11/2026), dans l'ordre et avec les numéros du message. */
function albumOf(rows: Row[]): Array<{ media: string; caption: string; sentTo?: number }> {
  return rows.filter((r) => POST_KINDS.includes(r.kind) && r.photo_url && r.kind !== 'tp' && r.kind !== 'trade' && ['draft', 'approved', 'skipped'].includes(r.status))
    .map((r) => ({ media: String(r.photo_url), caption: photoCaption(rows, r), sentTo: (r as Row & { _sentTo?: number })._sentTo }));
}
const photoCaption = (rows: Row[], r: Row) => {
  const i = rows.filter((x) => POST_KINDS.includes(x.kind)).findIndex((x) => x.id === r.id);
  return `${NUM[i] ?? i + 1} ${parisHHMM(r.scheduled_at)} · ${headOf(r)}`;
};

type Chosen = { key: string | null; fileId?: string | null; driveId?: string; alert?: string | null };

/** Les passages déjà publiés (la photo est « utilisée » à la PUBLICATION, 10/11/2026) : report.photo_key des posts publiés,
 *  plus, pour la banque, son last_used_at (posé à la publication depuis le 10/11, au plan avant). */
async function photoUses(db: Db): Promise<PhotoUse[]> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data } = await db.from('channel_posts').select('report,scheduled_at').eq('status', 'published').gte('scheduled_at', since).not('report->>photo_key', 'is', null).limit(500);
  return ((data ?? []) as Array<{ report: { photo_key?: string } | null; scheduled_at: string }>)
    .filter((r) => r.report?.photo_key).map((r) => ({ key: String(r.report?.photo_key), at: Date.parse(r.scheduled_at) }));
}

/** LA PHOTO DES COULISSES (lib/channel/photos.ts) : le dossier Drive de Mathieu s'il est configuré, sinon la banque
 *  cm_photos. Rien n'est marqué ici. null (clé) = texte seul, jamais une photo répétée. `alert` = à envoyer aux admins. */
async function choosePhoto(db: Db, _day: string, excludeKey?: string | null): Promise<Chosen> {
  const share = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim();
  let all: Array<PhotoCandidate & { fileId?: string }> = [];
  if (driveWanted()) {
    const env = readDriveEnv();
    if (!env) return { key: null, alert: 'Le dossier Drive des photos est configuré (CM_PHOTOS_DRIVE_FOLDER_ID), mais pas le compte de service (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY). Le post du matin part en texte seul.' };
    try { all = await listDrivePhotos(env); } catch (e) {
      return { key: null, alert: `Le dossier Drive des photos est illisible (${String((e as Error).message).slice(0, 80)}). Partage-le en Lecteur avec ${share || 'le compte de service'}. Le post du matin part en texte seul.` };
    }
  } else {
    const { data } = await db.from('cm_photos').select('id,file_id,last_used_at').eq('active', true).limit(500);
    all = ((data ?? []) as Array<{ id: number; file_id: string }>).map((p) => ({ key: `bank:${p.id}`, fileId: p.file_id }));
  }
  const bankUses = driveWanted() ? [] : (((await db.from('cm_photos').select('id,last_used_at').not('last_used_at', 'is', null).limit(500)).data ?? []) as Array<{ id: number; last_used_at: string }>)
    .map((p) => ({ key: `bank:${p.id}`, at: Date.parse(p.last_used_at) }));
  const { pick, freshLeft } = pickFresh(all, [...(await photoUses(db)), ...bankUses], Date.now(), Math.random, excludeKey);
  const where = driveWanted() ? 'dans le dossier Drive « Photos Mathieu - CM canal »' : 'dans la banque du bot';
  const alert = !all.length ? `Aucune photo ${where} : le post du matin part en texte seul. Ajoute des photos${driveWanted() && share ? ` (dossier partagé en Lecteur avec ${share})` : ''}.`
    : !pick ? `Plus aucune photo fraîche ${where} (toutes passées récemment) : le post du matin part en texte seul plutôt que de répéter une photo. Ajoute des photos.`
    : freshLeft < LOW_STOCK ? `Plus que ${Math.max(0, freshLeft)} photo${freshLeft > 1 ? 's' : ''} fraîche${freshLeft > 1 ? 's' : ''} ${where} (pas passées depuis 30 jours). Pense à en ajouter.` : null;
  if (!pick) return { key: null, alert };
  const c = all.find((p) => p.key === pick.key);
  return { key: pick.key, fileId: c?.fileId ?? null, ...(pick.key.startsWith('drive:') ? { driveId: pick.key.slice(6) } : {}), alert };
}

/** « 1 change la photo » : une autre photo pour les coulisses (Drive ou banque), montrée tout de suite à l'admin.
 *  Le post redevient un brouillon. Les autres posts n'ont plus d'image (10/11/2026). */
async function swapImage(db: Db, r: Row, chat: number, replyTo: number, caption: string): Promise<string> {
  const rep = (r.report as { photo_key?: string; drive_file_id?: string } | null) ?? {};
  if (r.kind !== 'backstage' && r.kind !== 'morning') return 'pas d’image sur ce post (une image seulement pour une vraie photo, le matin)';
  const ph = await choosePhoto(db, String(r.day).slice(0, 10), rep.photo_key).catch(() => null);
  if (!ph?.key) return 'pas d’autre photo fraîche : le post partira en texte seul si tu retires la photo';
  let fid = ph.fileId ?? null;
  const env = readDriveEnv();
  if (ph.driveId && env) fid = await sendDrivePhoto(env, ph.driveId, chat, caption, replyTo).catch(() => null);
  else if (fid) await tg('sendPhoto', { chat_id: chat, photo: fid, caption, reply_to_message_id: replyTo });
  if (!fid) return 'la photo n’a pas pu être chargée, réessaie';
  const { drive_file_id: _d, ...rest } = rep;
  await db.from('channel_posts').update({ photo_url: fid, status: 'draft', report: { ...rest, photo_key: ph.key, ...(ph.driveId ? { drive_file_id: ph.driveId } : {}) } }).eq('id', r.id);
  return '';
}

/** UNE PHOTO ENVOYÉE AU BOT PAR UN ADMIN, en privé et pas en réponse à un message : elle entre dans la banque du
 *  bonjour. Un album entier fonctionne (une confirmation par album). Renvoie false si ce n'est pas pour nous. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleCmPhoto(db: Db, msg: any, defer?: (fn: () => Promise<void>) => void): Promise<boolean> {
  if (msg?.chat?.type !== 'private' || !Array.isArray(msg.photo) || !msg.photo.length || msg.reply_to_message || msg.business_connection_id) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const best = msg.photo[msg.photo.length - 1] as { file_id: string; file_unique_id: string };
  const by = msg.from?.username ? `@${msg.from.username}` : String(msg.from?.id ?? 'admin');
  const group = msg.media_group_id ? String(msg.media_group_id) : null;
  const { error } = await db.from('cm_photos').insert({ file_id: best.file_id, file_unique_id: best.file_unique_id, chat_id: Number(msg.chat.id), message_id: Number(msg.message_id), media_group_id: group, added_by: by });
  const dup = error && /duplicate|unique/i.test(error.message);
  if (error && !dup) { await tg('sendMessage', { chat_id: msg.chat.id, text: `⨯ Photo pas enregistrée (${error.message.slice(0, 80)}), renvoie-la.`, reply_to_message_id: msg.message_id }); return true; }
  const confirm = async () => {
    const { data: all } = await db.from('cm_photos').select('id').eq('active', true).limit(1000);
    const total = (all ?? []).length;
    let head = dup ? '📸 Déjà dans la banque.' : '📸 Ajoutée à la banque du bonjour du matin.';
    if (group) {
      const { data: g } = await db.from('cm_photos').select('id').eq('media_group_id', group).limit(20);
      const n = (g ?? []).length;
      head = `📸 ${n} photo${n > 1 ? 's' : ''} de cet album ajoutée${n > 1 ? 's' : ''} à la banque du bonjour du matin (une photo déjà présente n'est pas comptée deux fois).`;
    }
    await tg('sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: `${head} ${total} photo${total > 1 ? 's' : ''} au total.\nPour en retirer une : réponds « retire » sur la photo.` });
  };
  if (!group) { await confirm(); return true; }
  // UN ALBUM arrive en autant de messages que de photos, une par une (~0,7 s chacune, jusqu'à 10). Une seule
  // confirmation, sur la première photo du groupe, et APRÈS l'arrivée des autres : compter tout de suite affichait
  // « 11 au total » alors que 19 étaient en cours d'enregistrement (vécu le 15/10).
  const { data: same } = await db.from('cm_photos').select('message_id').eq('media_group_id', group).order('message_id', { ascending: true }).limit(1);
  if (Number(same?.[0]?.message_id) !== Number(msg.message_id)) return true;
  const later = async () => { await new Promise((r) => setTimeout(r, 12_000)); await confirm(); };
  if (defer) defer(later); else await later();
  return true;
}

/** « retire » en réponse à une photo de la banque : elle n'est plus proposée. Renvoie false si ce n'est pas pour nous. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleCmPhotoRemove(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (msg?.chat?.type !== 'private' || !msg?.reply_to_message?.photo || !/^(retire|supprime|enl[eè]ve|remove|delete)\b/i.test(text)) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const { data } = await db.from('cm_photos').update({ active: false }).eq('chat_id', Number(msg.chat.id)).eq('message_id', Number(msg.reply_to_message.message_id)).select('id');
  await tg('sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: (data ?? []).length ? '🗑 Retirée de la banque.' : 'Cette photo n’est pas dans la banque.' });
  return true;
}
