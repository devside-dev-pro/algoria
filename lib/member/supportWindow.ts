// 🌙 FENÊTRE AUTO 05:00–09:00 Asia/Dubai (spec Support « perimetre_auto_5h9h.md »).
//
// Hors de cette fenêtre, ou si l'interrupteur est coupé, RIEN ne change (lib/member/supportAuto.ts suit son chemin
// habituel). L'interrupteur est la variable d'environnement SUPPORT_AUTO_WINDOW, lue à chaque passage : absente,
// vide, « off », « 0 » ou « false » = coupé. « on » ou « true » = fenêtre par défaut 05:00–09:00 Asia/Dubai.
// Une plage « HH:MM-HH:MM » change les heures (même fuseau). La fusion de la PR ne pose pas la variable en prod :
// Mathieu la passe à « on » lui-même, quand il le décide.
//
// Liste blanche FERMÉE de sujets : tout ce qui est hors liste, incertain, ou sensible, reste en relecture.
// Aucun texte de fiche n'est dans ce fichier. Pour brancher une fiche après validation de Mathieu :
//   1. poser le texte dans support_settings, clé `faq_sheet_<topic>` (ex. faq_sheet_faq_how_it_works) ;
//   2. passer le drapeau auto_ok : support_settings `faq_auto_ok` = JSON {"faq_how_it_works":true} (ou liste
//      séparée par des virgules). Sans ce drapeau, le sujet reste en relecture même si le vocal existe ;
//   3. et/ou enregistrer le vocal FAQ du thème (kind faq_voice, situation = le topic, déjà prévu par la #583).
// En auto, on envoie le VOCAL s'il est tagué, SINON le texte de la fiche, jamais les deux. Le vocal d'attente
// n°19 se tague kind=faq_voice, situation=faq_attente_5h9h (voir FAQ_WAIT_TOPIC) : il part seul, sans ligne fixe.
//
// Ce fichier est PUR (pas de base, pas de Telegram). Testé par lib/member/supportWindow.test.ts.
import { FAQ_CARD_ONLY, FAQ_MIN_CONFIDENCE, FAQ_WAIT_KIND, FAQ_WAIT_LABEL, FAQ_WAIT_TOPIC, classifyFaq, isFaqWaitTopic, type FaqClass, type FaqTopic } from './faqVoice';

export const SUPPORT_AUTO_WINDOW_TZ = 'Asia/Dubai';
export const SUPPORT_AUTO_WINDOW_DEFAULT = { start: '05:00', end: '09:00' } as const;

export { FAQ_WAIT_KIND, FAQ_WAIT_LABEL, FAQ_WAIT_TOPIC, isFaqWaitTopic } from './faqVoice';

export const WINDOW_WAIT_VIA = 'window_wait';
export const WINDOW_AUTO_VIA = 'window_auto';

/** Sujets que la fenêtre PEUT traiter en auto (liste fermée). Les identifiants sans classifieur #583
 *  (compte déjà ouvert / IB, trades d'activation) sont prévus pour un branchement ultérieur. */
export const WINDOW_TOPIC_ALLOWLIST = [
  'faq_how_it_works',
  'faq_broker',
  'faq_cost_free',
  'faq_existing_account',
  'faq_deposit',
  'faq_connect',
  'faq_kyc_raisefx',
  'faq_activation',
  'faq_results_myfxbook',
  'faq_risk_lots',
  'faq_gold_only',
] as const;
export type WindowTopic = (typeof WINDOW_TOPIC_ALLOWLIST)[number];
export const isWindowTopic = (t: unknown): t is WindowTopic =>
  typeof t === 'string' && (WINDOW_TOPIC_ALLOWLIST as readonly string[]).includes(t);

export const WINDOW_WAIT_TEXT = 'Hey, I got your message — I’ll get back to you shortly. In the meantime you can keep going in the app at https://app.getalgoria.com (log in with Telegram). Please don’t send any passwords here.';

export type WindowConfig = { enabled: boolean; start: string; end: string };

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseHm(hhmm: string): { h: number; m: number } | null {
  const m = HHMM.exec(String(hhmm ?? '').trim());
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

const hmToMin = (t: { h: number; m: number }) => t.h * 60 + t.m;

/** Interrupteur + plage. Jamais activé par défaut. */
export function parseSupportAutoWindow(raw: string | undefined | null = undefined): WindowConfig {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v || v === 'off' || v === '0' || v === 'false' || v === 'no') {
    return { enabled: false, start: SUPPORT_AUTO_WINDOW_DEFAULT.start, end: SUPPORT_AUTO_WINDOW_DEFAULT.end };
  }
  if (v === 'on' || v === 'true' || v === '1' || v === 'yes') {
    return { enabled: true, start: SUPPORT_AUTO_WINDOW_DEFAULT.start, end: SUPPORT_AUTO_WINDOW_DEFAULT.end };
  }
  const range = /^([0-2]?\d:[0-5]\d)\s*[-–]\s*([0-2]?\d:[0-5]\d)$/.exec(v);
  if (range && parseHm(range[1]) && parseHm(range[2])) return { enabled: true, start: range[1], end: range[2] };
  return { enabled: false, start: SUPPORT_AUTO_WINDOW_DEFAULT.start, end: SUPPORT_AUTO_WINDOW_DEFAULT.end };
}

const dubaiParts = (ms: number) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: SUPPORT_AUTO_WINDOW_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { year: g('year'), month: g('month'), day: g('day'), hour: g('hour'), minute: g('minute'), second: g('second') };
};

/** Instant (ms) de minuit Asia/Dubai du jour civil de `ms` (UTC+4 toute l'année, pas d'heure d'été). */
export const dubaiDayStartMs = (ms: number) => {
  const d = dubaiParts(ms);
  return Date.UTC(d.year, d.month - 1, d.day, 0, 0, 0) - 4 * 3_600_000;
};

export const supportAutoWindowBounds = (now: number, cfg: WindowConfig) => {
  const start = parseHm(cfg.start) ?? { h: 5, m: 0 };
  const end = parseHm(cfg.end) ?? { h: 9, m: 0 };
  const mid = dubaiDayStartMs(now);
  return { startMs: mid + hmToMin(start) * 60_000, endMs: mid + hmToMin(end) * 60_000 };
};

/** Vrai si `now` est dans [start, end[ du jour civil à Dubaï, et que l'interrupteur est allumé. */
export function isInSupportAutoWindow(now: number | Date, cfg: WindowConfig): boolean {
  if (!cfg.enabled) return false;
  const ms = typeof now === 'number' ? now : now.getTime();
  const { startMs, endMs } = supportAutoWindowBounds(ms, cfg);
  return ms >= startMs && ms < endMs;
}

/** Sous-ensemble configurable, toujours filtré par la liste blanche. Vide ou absent = toute la liste. */
export function parseWindowTopics(raw: string | undefined | null = undefined): ReadonlySet<WindowTopic> {
  const v = String(raw ?? '').trim();
  if (!v) return new Set(WINDOW_TOPIC_ALLOWLIST);
  const out = new Set<WindowTopic>();
  for (const part of v.split(/[,\s]+/)) {
    const t = part.trim();
    if (isWindowTopic(t)) out.add(t);
  }
  return out;
}

export type SheetFlag = { autoOk: boolean; body: string | null };
export type SheetMap = Record<string, SheetFlag>;

/** Lit les drapeaux auto_ok et les textes de fiches depuis un dictionnaire support_settings (clé → valeur).
 *  `faq_auto_ok` : JSON objet ou liste « topic,topic ». `faq_sheet_<topic>` : le texte, quand Mathieu l'a validé. */
export function parseSheetFlags(settings: Record<string, string | null | undefined>): SheetMap {
  const out: SheetMap = {};
  for (const t of WINDOW_TOPIC_ALLOWLIST) out[t] = { autoOk: false, body: null };
  const raw = String(settings.faq_auto_ok ?? '').trim();
  if (raw) {
    if (raw.startsWith('{')) {
      try {
        const j = JSON.parse(raw) as Record<string, unknown>;
        for (const [k, v] of Object.entries(j)) if (isWindowTopic(k) && v === true) out[k].autoOk = true;
      } catch { /* JSON invalide : aucun drapeau, tout reste en relecture */ }
    } else {
      for (const t of parseWindowTopics(raw)) out[t].autoOk = true;
    }
  }
  for (const t of WINDOW_TOPIC_ALLOWLIST) {
    const body = String(settings[`faq_sheet_${t}`] ?? '').trim();
    if (body) out[t].body = body;
  }
  return out;
}

// ── CE QUI RESTE EN RELECTURE, même dans la fenêtre ────────────────────────────────────────────────────
const CREDENTIALS = /\b(?:password|passcode|pwd|pass|token|seed(?: phrase)?|otp|investor|trader)\s*(?:is|:|=|-)\s*\S+/i;
const ALREADY_DEPOSITED = /\b(?:i(?:'ve| have| just)?|we(?:'ve| have)?)\s+(?:already\s+)?(?:deposited|funded|paid|sent(?:\s+the)?\s+money|made\s+(?:a\s+|the\s+)?deposit)\b/i;
const DEPOSIT_REFUSED = /\bdeposit\b.{0,60}\b(?:refus\w*|reject\w*|declin\w*|fail\w*|not (?:showing|appearing|reflecting)|hasn'?t (?:shown|arrived|gone through)|doesn'?t show)\b/i;
const AMOUNT_DISPUTE = /\b(?:wrong amount|missing (?:money|funds|deposit)|not the (?:right |correct )?amount|charged(?: me)? twice|i (?:was )?charged|contest\w* (?:the )?amount)\b/i;
const WITHDRAW = /\bwithdraw(?:al|als|ing|n)?\b|\bcash ?out\b|\btake (?:my |the )?(?:money|profits?) out\b/i;
const INCIDENT = /\b(?:incident|blown|wiped|liquidat\w*|compensat\w*|refund\w*|money back|complaint|complain\w*|chargeback|scam\w*|fraud\w*|lost (?:my|all|everything|it|money))\b/i;
const MANUAL_ACCESS = /\b(?:connect me|log\s?me\s?in|give me access|access to my (?:account|mt5|broker)|can you (?:please )?connect (?:my|the|it)|connect (?:it|my account) for me)\b/i;
const KYC_REFUSED = /\bkyc\b.{0,50}\b(?:refus\w*|reject\w*|declin\w*|fail\w*)\b|\b(?:refus\w*|reject\w*|declin\w*)\b.{0,50}\bkyc\b/i;
const ID_DOCS = /\b(?:passport|id card|identity (?:card|document)|driver'?s licen[cs]e|proof of (?:address|identity|residence)|national id)\b/i;
const ID_SENT = /\b(?:here(?:'| i)?s|attached|i(?:'ve| have)? (?:sent|send|shared|uploaded)|see (?:my|the) (?:photo|picture|screenshot|document))\b/i;

/** Motif de relecture, ou null si le texte n'est pas à lui seul un cas sensible. */
export function windowReviewReason(text: string, faq: FaqClass): string | null {
  const t = String(text ?? '').trim();
  if (!t) return 'message vide';
  if (CREDENTIALS.test(t)) return 'identifiants envoyés dans le chat';
  if (ID_DOCS.test(t) && (ID_SENT.test(t) || /https?:\/\//i.test(t))) return 'documents d’identité dans le chat';
  if (KYC_REFUSED.test(t)) return 'KYC refusé par le broker';
  if (MANUAL_ACCESS.test(t)) return 'demande d’accès ou de connexion manuelle';
  if (INCIDENT.test(t) || faq.topic === 'faq_incident') return 'incident, pertes, remboursement ou plainte';
  if (WITHDRAW.test(t) || faq.topic === 'faq_withdraw_30d') return 'retrait / cash out';
  if (ALREADY_DEPOSITED.test(t)) return '« I already deposited »';
  if (DEPOSIT_REFUSED.test(t)) return 'dépôt refusé ou qui ne s’affiche pas';
  if (AMOUNT_DISPUTE.test(t)) return 'contestation d’un montant';
  if (faq.topic && FAQ_CARD_ONLY.has(faq.topic as FaqTopic)) return 'thème à valider par Mathieu';
  return null;
}

export type WindowAction = 'outside' | 'auto_voice' | 'auto_text' | 'review_wait' | 'review_silent';
export type WindowDecision = { action: WindowAction; topic: string | null; reason: string; body?: string };

export type WindowInput = {
  cfg: WindowConfig;
  now?: number;
  text: string;
  faq: FaqClass;
  /** Claude a classé la réponse « auto » (il est sûr). Exigé pour partir seul, comme le vocal FAQ #583. */
  modelSure: boolean;
  topics?: ReadonlySet<WindowTopic>;
  sheets?: SheetMap;
  voiceExists?: boolean;
  waitAlreadySent?: boolean;
  hasMedia?: boolean;
  /** Mathieu a écrit dans la conversation il y a moins de 2 h : pas d'accusé d'attente, la carte lui reste. */
  manualHold?: boolean;
};

export function decideSupportWindow(i: WindowInput): WindowDecision {
  const now = i.now ?? Date.now();
  if (!i.cfg.enabled || !isInSupportAutoWindow(now, i.cfg)) return { action: 'outside', topic: i.faq.topic, reason: 'hors fenêtre ou interrupteur coupé' };

  const review = windowReviewReason(i.text, i.faq);
  const topics = i.topics ?? new Set(WINDOW_TOPIC_ALLOWLIST);
  const topic = i.faq.topic;
  const allowed = !!topic && isWindowTopic(topic) && topics.has(topic);
  const sheet = topic && isWindowTopic(topic) ? i.sheets?.[topic] : undefined;
  const confOk = i.faq.confidence >= FAQ_MIN_CONFIDENCE;
  const ambiguous = !topic || !confOk || (typeof i.faq.reason === 'string' && /plusieurs|ambigu/i.test(i.faq.reason));
  const otherStrong = Object.entries(i.faq.scores ?? {}).filter(([k, s]) => k !== topic && (s ?? 0) >= 0.9);
  const mixedSensitive = otherStrong.some(([k]) => k === 'faq_incident' || k === 'faq_withdraw_30d' || !isWindowTopic(k));

  let why: string | null = review;
  if (!why && i.hasMedia) why = 'pièce jointe ou capture : relecture';
  if (!why && !i.modelSure) why = 'confiance faible (le modèle n’est pas sûr)';
  if (!why && ambiguous) why = i.faq.reason ?? 'question ambiguë ou confiance faible';
  if (!why && mixedSensitive) why = 'plusieurs sujets dont un sensible';
  if (!why && !allowed) why = topic ? `sujet hors liste blanche (${topic})` : (i.faq.reason ?? 'aucun thème auto OK');
  if (!why && !sheet?.autoOk) why = 'fiche pas encore branchée (auto_ok)';
  if (!why && !i.voiceExists && !sheet?.body) why = 'ni vocal ni texte de fiche pour ce sujet';

  if (why) {
    if (i.manualHold || i.waitAlreadySent) return { action: 'review_silent', topic, reason: why };
    return { action: 'review_wait', topic, reason: why };
  }

  // Vocal XOR texte de fiche. Le vocal, s'il est tagué, l'emporte (sa ligne fixe #583 peut l'accompagner, pas le pavé).
  if (i.voiceExists) return { action: 'auto_voice', topic, reason: 'ok' };
  return { action: 'auto_text', topic, reason: 'ok', body: sheet!.body! };
}

/** Vrai si un accusé d'attente (vocal 19 ou texte) a déjà été envoyé dans CETTE fenêtre. */
export function waitSentInWindow(sentAt: Array<number | string>, now: number, cfg: WindowConfig): boolean {
  const { startMs, endMs } = supportAutoWindowBounds(now, cfg);
  return sentAt.some((x) => {
    const ms = typeof x === 'number' ? x : Date.parse(x);
    return Number.isFinite(ms) && ms >= startMs && ms < endMs;
  });
}
