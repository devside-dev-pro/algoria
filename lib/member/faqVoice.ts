// 🎙 LA BANQUE DE VOCAUX FAQ (10/11/2026, validé par Mathieu, spec Support Algoria « banque_vocaux.md »).
//
// Mathieu enregistre lui-même un vocal (EN) pour chaque question qui revient le plus, parce que les vocaux closent
// mieux que les textes (depuis le 19/10 : 6,6 % de dépôts avec un vocal pays contre 0,9 % sans, biais d'engagement).
// Il les envoie au bot en privé et les tague avec les boutons (lib/member/supportAuto.ts). Quand un prospect pose une
// de ces questions et que le thème est reconnu avec une confiance haute, le vocal part depuis son compte, suivi d'une
// ligne de texte FIXE par thème (les liens, le rappel du risque). Sinon : rien ne change, la réponse écrite habituelle.
//
// Ce fichier est PUR (pas de base, pas de Telegram) : thèmes, lignes fixes, classement, garde-fous, anti-spam. Il est
// testé par lib/member/faqVoice.test.ts (npm test).
import { APP_URL } from './i18n';
import { MYFXBOOK_URL } from './myfxbook';

export const FAQ_KIND = 'faq_voice';

/** Les thèmes, dans l'ordre des boutons (les 10 premiers de la spec, puis la suite). */
export const FAQ_TOPICS = [
  'faq_how_it_works', 'faq_broker', 'faq_deposit', 'faq_cost_free', 'faq_connect',
  'faq_results_myfxbook', 'faq_gold_only', 'faq_withdraw_30d', 'faq_risk_lots', 'faq_kyc_raisefx',
  'faq_app_login', 'faq_not_copying_yet', 'faq_incident',
] as const;
export type FaqTopic = (typeof FAQ_TOPICS)[number];
export const isFaqTopic = (t: unknown): t is FaqTopic => typeof t === 'string' && (FAQ_TOPICS as readonly string[]).includes(t);

/** Le libellé des boutons chez Mathieu (court : 2 boutons par ligne). */
export const FAQ_LABELS: Record<FaqTopic, string> = {
  faq_how_it_works: '⚙️ Comment ça marche',
  faq_broker: '🏦 Quel broker',
  faq_deposit: '💵 Dépôt / minimum',
  faq_cost_free: '🆓 Gratuit / 400 $',
  faq_connect: '🔌 Connecter MT5',
  faq_results_myfxbook: '📊 Résultats / Myfxbook',
  faq_gold_only: '🥇 Or uniquement',
  faq_withdraw_30d: '💸 Retraits / 30 j',
  faq_risk_lots: '⚖️ Risque / lots',
  faq_kyc_raisefx: '🪪 KYC / vérif broker',
  faq_app_login: '📲 App / connexion',
  faq_not_copying_yet: '⏳ Pas encore de trades',
  faq_incident: '🚨 Incident (si demandé)',
};

/** LA LIGNE FIXE sous le vocal (spec section 4, « Texte »). Liens : app.getalgoria.com (domaine actuel) et le
 *  Myfxbook officiel, seul lien de résultats. Jamais de mot de passe demandé, or uniquement, aucune promesse. */
export const FAQ_LINES: Record<FaqTopic, string> = {
  faq_how_it_works: `Here’s the short version + the app link when you’re ready: ${APP_URL}/member`,
  faq_broker: 'Open the app and tap the partner broker step — it’ll give you the right link for your country.',
  faq_deposit: 'Recommended start is about $500 on your own broker account. Absolute minimum is $200.',
  faq_cost_free: 'Partner broker = free access. Own broker or prop = $400 lifetime in the app.',
  faq_connect: `Connect only in the app: ${APP_URL}/member/onboarding — never send your trader password in chat.`,
  faq_results_myfxbook: `Verified record: ${MYFXBOOK_URL} — past results don’t guarantee future results.`,
  faq_gold_only: 'Algoria trades gold (XAUUSD) only — not crypto.',
  faq_withdraw_30d: 'Withdrawals are on your broker. First 30 days: don’t withdraw or it disconnects Algoria.',
  faq_risk_lots: 'Default sizing is about 0.01 lot per ~$500 balance — change it anytime in the app.',
  faq_kyc_raisefx: 'Finish broker KYC first — especially RaiseFX level 2 — then come back to connect in the app.',
  faq_app_login: `App: ${APP_URL} — if an old icon is broken, delete it and reinstall from ${APP_URL}/download.`,
  faq_not_copying_yet: 'If you’re connected, the AI only trades when there’s a clean gold setup — quiet days are normal.',
  faq_incident: `Verified record of the new engine: ${MYFXBOOK_URL} — past results don’t guarantee future results.`,
};

/** Les thèmes qui ne partent JAMAIS seuls : un bouton sous la carte « À toi », Mathieu décide d'un tap.
 *  L'incident (jamais proactif, jamais sans lui) ; les retraits sont déjà « sensibles » pour le pilote automatique. */
export const FAQ_CARD_ONLY: ReadonlySet<FaqTopic> = new Set<FaqTopic>(['faq_incident', 'faq_withdraw_30d']);

// ── LE CLASSEMENT ──────────────────────────────────────────────────────────────────────────────────────
// Un classifieur léger et déterministe (règles), doublé par le modèle du support : le vocal ne part seul que si le
// thème est reconnu avec une confiance ≥ FAQ_MIN_CONFIDENCE ET que le modèle a classé la réponse « auto » (question de
// routine, il est sûr). Confiance : 0,9 pour une formulation forte, 0,55 pour un simple mot-clé ; moins 0,4 si un
// AUTRE thème est aussi clairement là (deux questions : un vocal ne répondrait qu'à une), moins 0,15 pour un mot-clé
// d'un autre thème ; moins 0,15 au-delà de 280 caractères, 0,3 au-delà de 500 (message long = plus qu'une FAQ).
export const FAQ_MIN_CONFIDENCE = 0.8;

type Rule = { strong: RegExp[]; weak?: RegExp[] };
const RULES: Record<FaqTopic, Rule> = {
  faq_how_it_works: {
    strong: [/\bhow (?:does|do|will) (?:this|it|algoria|that|the (?:bot|ai|app|system)) works?\b/i, /\bhow (?:it|this) works?\b/i, /\bwhat (?:is|'s) algoria\b/i, /\bwhat (?:exactly )?(?:do|does) (?:you|algoria|the (?:bot|ai)) do\b/i, /\bexplain (?:how|me how|to me how|the process)\b/i],
  },
  faq_broker: {
    strong: [/\b(?:which|what) brokers?\b/i, /\b(?:partner|recommended) brokers?\b/i, /\b(?:can|could) i use (?:my own|another|a different|any) broker\b/i, /\bbroker (?:do|should|can) i use\b/i],
    weak: [/\bbrokers?\b/i, /\braise ?fx\b/i],
  },
  faq_deposit: {
    strong: [/\b(?:minimum|min)\.? (?:deposit|amount|to start|investment|capital)\b/i, /\bhow much (?:do i|should i|must i|i need to|do i need to|to|can i) (?:deposit|invest|start|put|fund)\b/i, /\bwhat(?:'s| is) the (?:minimum|min)\b/i, /\bhow much (?:money )?(?:to|do i need to) start\b/i],
    weak: [/\bdeposit\b/i, /\bfund (?:my|the) account\b/i],
  },
  faq_cost_free: {
    strong: [/\b(?:is it|it'?s|is this|is algoria|is the (?:bot|app|access)) (?:really |totally |completely )?free\b/i, /\bhow much (?:does it|is it|is algoria|does algoria|is the (?:bot|app|access)) cost\b/i, /\bwhat(?:'s| is) the (?:price|cost|fee)\b/i, /\bdo i (?:have to |need to )?pay\b/i, /\bmonthly (?:fee|subscription|payment)\b/i, /\b(?:lifetime|licen[cs]e) (?:access|fee|price|cost)\b/i],
    weak: [/\b\$?400\s?\$?\b/i, /\bfree\b/i, /\bsubscription\b/i],
  },
  faq_connect: {
    strong: [/\bhow (?:do|can|should) i (?:get )?connect(?:ed)?\b/i, /\bhow to connect\b/i, /\bconnect (?:my )?(?:mt5|mt 5|metatrader|trading account|broker account|account)\b/i, /\blink (?:my )?(?:mt5|metatrader|account)\b/i],
    weak: [/\bmt5\b|\bmetatrader\b/i, /\bconnect\w*\b/i],
  },
  faq_results_myfxbook: {
    strong: [/\bmy ?fx ?book\b/i, /\btrack ?record\b/i, /\b(?:proof|proofs|records?) of (?:results?|profits?|performance|trading)\b/i, /\b(?:show|see|send) (?:me )?(?:the |your )?(?:results|performance|proofs?)\b/i, /\bverified (?:record|results|account)\b/i, /\bprofit history\b/i],
    weak: [/\bresults?\b/i, /\bperformance\b/i, /\bproofs?\b/i],
  },
  faq_gold_only: {
    strong: [/\b(?:only|just) gold\b/i, /\bgold only\b/i, /\bwhat (?:do you|does it|does algoria|does the (?:bot|ai)) trade\b/i, /\bwhich (?:pairs?|assets?|markets?|currenc(?:y|ies)|instruments?)\b/i, /\b(?:trade|trades|trading) (?:crypto|bitcoin|btc|forex|us30|indices|nasdaq)\b/i, /\bcrypto bot\b/i],
    weak: [/\bxau(?:usd)?\b/i, /\bgold\b/i, /\bcrypto\b/i],
  },
  faq_withdraw_30d: {
    strong: [/\bwithdraw(?:al|als|ing|n)?\b/i, /\bcash ?out\b/i, /\btake (?:my |the )?(?:money|profits?) out\b/i],
    weak: [/\b30 days?\b/i],
  },
  faq_risk_lots: {
    strong: [/\blot ?sizes?\b/i, /\bwhat lots?\b/i, /\b0[.,]0\d lots?\b/i, /\brisk (?:per trade|management|level|settings?)\b/i, /\bhow (?:much|big) (?:is the )?risk\b/i, /\bwhich lots?\b/i],
    weak: [/\brisk\b/i, /\bdrawdown\b/i, /\bstop ?loss\b/i, /\blots?\b/i],
  },
  faq_kyc_raisefx: {
    strong: [/\bkyc\b/i, /\b(?:verify|verification of) (?:my )?(?:account|identity|documents?)\b/i, /\b(?:upload|submit|send|put) (?:my )?(?:documents?|id|passport|proof of address)\b/i, /\bproof of (?:address|identity|residence)\b/i, /\baccount (?:is )?(?:not|still not) verified\b/i],
    weak: [/\bdocuments?\b/i, /\bverif\w*\b/i],
  },
  faq_app_login: {
    strong: [/\b(?:can'?t|cannot|unable to|not able to) (?:open|log ?in|login|sign ?in|access|find|download|install) (?:to |into |on )?(?:the |your )?app\b/i, /\bapp (?:is )?(?:not working|doesn'?t (?:work|open)|won'?t open|broken|not opening)\b/i, /\b(?:log ?in|login|sign ?in) (?:to|into|on) (?:the )?app\b/i, /\bgetalgoria\b/i, /\bhow (?:do|can) i (?:download|install|get) the app\b/i, /\bwhere (?:is|can i find) the app\b/i],
    weak: [/\bapp\b/i, /\blog ?in\b|\blogin\b/i],
  },
  faq_not_copying_yet: {
    strong: [/\b(?:no|not any|zero) trades? (?:yet|so far|today|on (?:my|the) (?:account|app|mt5))\b/i, /\bnot copying\b/i, /\b(?:still )?waiting (?:to be|for (?:it|the account|my account) to be) connected\b/i, /\bwhen (?:does|will) it (?:start|begin) (?:trading|copying)\b/i, /\bhasn'?t (?:started|taken|placed|opened) (?:any )?trades?\b/i, /\bno trades?\b/i],
    weak: [/\bstill waiting\b/i],
  },
  faq_incident: {
    // EXPLICITE uniquement : jamais déduit d'un « results » ou d'un « loss » vague
    strong: [/\bincident\b/i, /\bwhat happened\b.{0,40}\b(?:october|account|accounts|engine|last (?:week|month)|21|22)\b/i, /\b(?:account|accounts) (?:was |got |were |has been )?(?:blown|wiped|liquidated)\b/i, /\b(?:blew|blown|wiped) (?:my |the |out )?(?:account|accounts)\b/i, /\b(?:october|21(?:st)?|22(?:nd)?) (?:loss|losses|crash|incident)\b/i],
  },
};

// une conversation sur la nuit du 21-22/10 (mots de lib/member/incident.ts, INCIDENT_TALK) : seul faq_incident, et
// seulement explicite ; jamais un vocal joyeux sur un autre sujet sous un message qui parle de pertes
const INCIDENT_WORDS = /\b(incident|blown|wiped|liquidat\w*|margin call|stop ?out|stopped out|what happened|crash\w*|bug|glitch|malfunction\w*|compensat\w*|refund\w*|money back|lost (?:my|all|everything|it|money)|(?<!stop[ -]?)losses?|scam\w*|fraud\w*)\b/i;
// les messages tout faits des boutons de l'app (« hi, I want to start », pas une vraie question : supportAuto.ts)
const APP_BUTTON = /book a quick call to activate|quick call to set up my algoria|skip the waiting list|already have the app, how do i get connected/i;
// il colle un identifiant, un mot de passe, un token : jamais de vocal, la carte va à Mathieu (garde du modèle)
const CREDENTIALS = /\b(?:password|passcode|pwd|pass|token|seed(?: phrase)?|otp|investor|trader)\s*(?:is|:|=|-)\s*\S+/i;

export type FaqClass = { topic: FaqTopic | null; confidence: number; reason?: string; scores: Partial<Record<FaqTopic, number>> };

export function classifyFaq(text: string): FaqClass {
  const t = String(text ?? '').replace(/[’]/g, "'").trim();
  if (!t) return { topic: null, confidence: 0, reason: 'vide', scores: {} };
  if (APP_BUTTON.test(t)) return { topic: null, confidence: 0, reason: 'message tout fait de l’app', scores: {} };
  if (CREDENTIALS.test(t)) return { topic: null, confidence: 0, reason: 'identifiant ou mot de passe dans le message', scores: {} };
  const scores: Partial<Record<FaqTopic, number>> = {};
  const strongOf: Partial<Record<FaqTopic, boolean>> = {};
  for (const topic of FAQ_TOPICS) {
    const r = RULES[topic];
    const strong = r.strong.filter((re) => re.test(t)).length;
    const weak = (r.weak ?? []).filter((re) => re.test(t)).length;
    if (!strong && !weak) continue;
    scores[topic] = strong ? Math.min(1, 0.9 + 0.05 * (strong - 1)) : 0.55;
    strongOf[topic] = strong > 0;
  }
  const ranked = (Object.keys(scores) as FaqTopic[]).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || FAQ_TOPICS.indexOf(a) - FAQ_TOPICS.indexOf(b));
  const top = ranked[0];
  if (!top) return { topic: null, confidence: 0, reason: 'aucun thème', scores };
  // l'incident : explicite et rien d'autre ; sinon des mots de la nuit bloquent tout vocal
  if (INCIDENT_WORDS.test(t) && !strongOf.faq_incident) return { topic: null, confidence: 0, reason: 'parle de pertes / de la nuit sans question explicite', scores };
  const pick: FaqTopic = strongOf.faq_incident ? 'faq_incident' : top;
  let confidence = scores[pick] ?? 0;
  for (const other of ranked) {
    if (other === pick) continue;
    // un mot-clé faible d'un thème voisin dans une formulation forte (« which broker » contient « broker ») ne compte pas
    if (strongOf[other]) confidence -= 0.4;
    else if (!sameFamily(pick, other)) confidence -= 0.15;
  }
  if (t.length > 500) confidence -= 0.3;
  else if (t.length > 280) confidence -= 0.15;
  confidence = Math.max(0, Math.round(confidence * 100) / 100);
  return { topic: pick, confidence, scores };
}

// des thèmes qui partagent naturellement leurs mots-clés faibles (« minimum deposit … broker account »)
const FAMILIES: FaqTopic[][] = [
  ['faq_deposit', 'faq_broker', 'faq_cost_free'],
  ['faq_connect', 'faq_app_login', 'faq_not_copying_yet'],
  ['faq_kyc_raisefx', 'faq_broker'],
  ['faq_results_myfxbook', 'faq_risk_lots'],
  ['faq_withdraw_30d', 'faq_broker'],
];
const sameFamily = (a: FaqTopic, b: FaqTopic) => FAMILIES.some((f) => f.includes(a) && f.includes(b));

// ── LA DÉCISION ────────────────────────────────────────────────────────────────────────────────────────

export type FaqContext = {
  /** le modèle du support a classé sa réponse « auto » (question de routine, il est sûr) */
  modelSure: boolean;
  /** un garde-fou existant du pilote automatique envoie la réponse en carte (pilote coupé, sensible, incident…) */
  reviewReason: string | null;
  /** il a envoyé WEBINAR il y a moins de 3 jours : la conversation est à Mathieu, rien ne part */
  webinarLead: boolean;
  /** entre l'accueil (bulle) et son intro : ni lien broker, ni dépôt, ni étapes (20/10/2026, Riyaz) */
  beforeIntro: boolean;
  /** le vocal pays et l'intro viennent de partir dans ce passage : on ne répète rien */
  introJustSent: boolean;
  /** il demande le lien exact d'un broker : la réponse écrite le lui donne */
  brokerLinkAsk: boolean;
  /** captures ou médias dans le lot : la réponse doit les lire */
  hasMedia: boolean;
  /** un vocal actif existe pour ce thème */
  assetExists: boolean;
  /** un faq_voice de ce thème lui a déjà été envoyé dans la fenêtre anti-spam (ou trop de vocaux FAQ en 24 h) */
  recentlySent: boolean;
};

export type FaqDecision = { mode: 'auto' | 'card' | 'none'; topic: FaqTopic | null; reason: string };

/** auto = le vocal part seul à la place du texte · card = bouton « 🎙 Envoyer le vocal » sous la carte de Mathieu ·
 *  none = comportement actuel inchangé. Ne relâche AUCUN garde-fou : une réponse qui irait en carte reste une carte. */
export function faqVoiceDecision(c: FaqClass, ctx: FaqContext): FaqDecision {
  const topic = c.topic;
  const none = (reason: string): FaqDecision => ({ mode: 'none', topic, reason });
  if (!topic) return none(c.reason ?? 'aucun thème');
  if (c.confidence < FAQ_MIN_CONFIDENCE) return none(`confiance ${c.confidence} < ${FAQ_MIN_CONFIDENCE}`);
  if (ctx.webinarLead) return none('lead webinaire : à Mathieu');
  if (ctx.beforeIntro || ctx.introJustSent) return none('accueil / intro en cours');
  if (ctx.brokerLinkAsk) return none('il demande un lien de broker précis');
  if (ctx.hasMedia) return none('captures ou médias à lire');
  if (!ctx.assetExists) return none('pas de vocal actif pour ce thème');
  if (ctx.recentlySent) return none('déjà envoyé récemment (anti-spam)');
  if (ctx.reviewReason || FAQ_CARD_ONLY.has(topic)) return { mode: 'card', topic, reason: ctx.reviewReason ?? 'thème à valider par Mathieu' };
  if (!ctx.modelSure) return { mode: 'card', topic, reason: 'le modèle n’est pas sûr' };
  return { mode: 'auto', topic, reason: 'ok' };
}

// ── L'ANTI-SPAM ────────────────────────────────────────────────────────────────────────────────────────
/** Pas deux fois le même vocal FAQ à la même personne en 30 jours, et pas plus de 2 vocaux FAQ en 24 h. */
export const FAQ_TOPIC_COOLDOWN_MS = 30 * 86_400_000;
export const FAQ_DAILY_MAX = 2;

export function faqRecentlySent(sent: Array<{ created_at: string; topic: string | null }>, topic: FaqTopic, now = Date.now()): boolean {
  const sameTopic = sent.some((s) => s.topic === topic && now - Date.parse(s.created_at) < FAQ_TOPIC_COOLDOWN_MS);
  const today = sent.filter((s) => now - Date.parse(s.created_at) < 86_400_000).length;
  return sameTopic || today >= FAQ_DAILY_MAX;
}

// ── LES BOUTONS CHEZ MATHIEU ───────────────────────────────────────────────────────────────────────────
type Btn = { text: string; callback_data: string };

/** Sous un vocal FAQ : ses thèmes (✓ = le sien), revenir en vocal pays, retirer. */
export function faqKeyboard(a: { id: number; situation?: string | null; active?: boolean | null }) {
  if (a.active === false) return { inline_keyboard: [[{ text: '↩️ Remettre dans la bibliothèque', callback_data: `sa:${a.id}:on` }]] };
  const btns: Btn[] = FAQ_TOPICS.map((t) => ({ text: `${a.situation === t ? '✓ ' : ''}${FAQ_LABELS[t]}`, callback_data: `sa:${a.id}:t:${t}` }));
  const rows: Btn[][] = [];
  for (let k = 0; k < btns.length; k += 2) rows.push(btns.slice(k, k + 2));
  rows.push([{ text: '🌍 C’est un vocal pays', callback_data: `sa:${a.id}:cv` }, { text: '🗑 Retirer', callback_data: `sa:${a.id}:x` }]);
  return { inline_keyboard: rows };
}

/** Le bouton sous la carte « À toi » : envoyer le vocal FAQ (et sa ligne) dans la conversation. */
export const faqCardButton = (assetId: number, rowId: string, topic: FaqTopic) => ({
  inline_keyboard: [[{ text: `🎙 Envoyer le vocal « ${FAQ_LABELS[topic]} »`, callback_data: `sa:${assetId}:v:${rowId}` }]],
});

/** Les callbacks de la bibliothèque (sa:<id>:…), y compris ceux des vocaux FAQ. null = pas un bouton de la bibliothèque. */
export type AssetCallback =
  | { id: number; op: 'situation'; value: 'new' | 'app' | 'all' }
  | { id: number; op: 'lang'; value: 'en' | 'it' }
  | { id: number; op: 'country'; value: string }
  | { id: number; op: 'active'; value: boolean }
  | { id: number; op: 'faq' }
  | { id: number; op: 'country_voice' }
  | { id: number; op: 'topic'; value: FaqTopic }
  | { id: number; op: 'send'; rowId: string };

export function parseAssetCallback(data: unknown): AssetCallback | null {
  const m = /^sa:(\d+):(s:(new|app|all)|l:(en|it)|c:([A-Z]{2})|x|on|faq|cv|t:(faq_[a-z0-9_]+)|v:([0-9a-f-]{36}))$/i.exec(String(data ?? ''));
  if (!m) return null;
  const id = Number(m[1]);
  if (m[3]) return { id, op: 'situation', value: m[3] as 'new' | 'app' | 'all' };
  if (m[4]) return { id, op: 'lang', value: m[4] as 'en' | 'it' };
  if (m[5]) return { id, op: 'country', value: m[5].toUpperCase() };
  if (m[6]) return isFaqTopic(m[6]) ? { id, op: 'topic', value: m[6] } : null;
  if (m[7]) return { id, op: 'send', rowId: m[7].toLowerCase() };
  if (m[2] === 'faq') return { id, op: 'faq' };
  if (m[2] === 'cv') return { id, op: 'country_voice' };
  return { id, op: 'active', value: m[2] === 'on' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Tague un vocal sur un thème. REMPLACEMENT : l'ancien vocal actif de ce thème est désactivé (jamais supprimé), AVANT
 *  d'activer le nouveau (l'index unique partiel de la migration 0042 l'exige). Renvoie le nombre de vocaux désactivés. */
export async function tagFaqVoice(db: Db, id: number, topic: FaqTopic): Promise<{ replaced: number; error?: string }> {
  const { data: old } = await db.from('support_assets').update({ active: false }).eq('kind', FAQ_KIND).eq('situation', topic).eq('active', true).neq('id', id).select('id');
  const { error } = await db.from('support_assets').update({ kind: FAQ_KIND, situation: topic, lang: 'en', active: true }).eq('id', id);
  return { replaced: (old ?? []).length, ...(error ? { error: String(error.message ?? error) } : {}) };
}

/** Le vocal actif d'un thème (le plus récent s'il en reste plusieurs, avant migration). */
export async function pickFaqVoice(db: Db, topic: FaqTopic): Promise<{ id: number; file_id: string; uses: number | null } | null> {
  const { data } = await db.from('support_assets').select('id,file_id,uses').eq('kind', FAQ_KIND).eq('situation', topic).eq('active', true).order('id', { ascending: false }).limit(1);
  return (data?.[0] ?? null) as { id: number; file_id: string; uses: number | null } | null;
}

/** Les vocaux FAQ déjà envoyés à cette personne (30 jours), pour l'anti-spam. */
export async function faqSentTo(db: Db, tgId: number, now = Date.now()): Promise<Array<{ created_at: string; topic: string | null }>> {
  const { data } = await db.from('member_actions').select('created_at,detail').eq('tg_id', tgId).eq('kind', 'biz_msg').eq('detail->>via', FAQ_KIND)
    .gte('created_at', new Date(now - FAQ_TOPIC_COOLDOWN_MS).toISOString()).limit(50);
  return ((data ?? []) as Array<{ created_at: string; detail: Record<string, unknown> | null }>).map((r) => ({ created_at: r.created_at, topic: r.detail?.topic ? String(r.detail.topic) : null }));
}
