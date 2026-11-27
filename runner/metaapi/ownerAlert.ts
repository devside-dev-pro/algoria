// ALERTE PROPRIÉTAIRE METAAPI (26/11/2026).
//
// Ce jour-là, à 04:24 (Dubaï), le websocket MetaApi a lâché. À 04:35 le flux or était périmé, à 04:45
// FEED DEAD a redéployé le compte puis le process est sorti. Railway a relancé le runner, qui a ensuite
// écrit en boucle « Timed out waiting for account … to connect to the broker » toutes les 15 à 20 min.
// Aucun DM : la seule alerte était le watchdog du cron, à 10:00. La panne est restée invisible 36 h.
//
// Ce module est PUR (pas de réseau, pas de base). Il décide quand ouvrir UNE alerte, quand rappeler,
// quand annoncer le rétablissement. L'envoi et la persistance sont dans ownerAlertRun.ts.
//
// Horloge de marché : goldFeedExpected (America/New_York). Le serveur MT5 tourne à l'heure de New York
// + 7 h : la pause quotidienne 17:00–18:00 NY et le week-end ven 17:00 → dim 18:00 NY (plus la grâce
// déjà codée) sont exactement les heures où l'or ne cote pas. On ne réécrit pas cette horloge.
import { goldFeedExpected } from '../../lib/market/goldHours';

/** Échecs « connect to the broker » d'affilée avant la première alerte. */
export const BROKER_TIMEOUT_STREAK = 2;
/** Silence XAUUSD qui ouvre l'alerte (FEED STALE). */
export const FEED_SILENCE_MS = 10 * 60_000;
/** En dessous, un tick compte comme « les prix sont revenus ». */
export const TICK_FRESH_MS = 2 * 60_000;
/**
 * Après l'alerte initiale : 30 min, puis 1 h, puis toutes les 3 h.
 * Le plafond est la fréquence (3 h), pas le nombre : on rappelle jusqu'au rétablissement
 * (la panne du 26/11 a duré 36 h).
 */
export const REMINDER_GAPS_MS = [30 * 60_000, 60 * 60_000, 3 * 60 * 60_000] as const;
/** `off` / `0` / `false` coupe les DM. Absent ou toute autre valeur : alertes actives. */
export const OWNER_ALERTS_ENV = 'RUNNER_OWNER_ALERTS';
/** Ligne support_settings déjà écrite par le runner (setSetting). Pas de migration. */
export const OWNER_ALERT_SETTING_KEY = 'metaapi_owner_incident';

export const IMPACT_LINE = "Ce que ça casse : le bot ne trade pas, l'app n'est pas à jour, pas de TP au VIP.";
// Incident général MetaApi (ticket metaapi/metaapi-javascript-sdk#20) : Undeploy/Deploy ne répare rien
// et chaque déploiement raté est facturé. On ne le conseille pas par défaut.
export const ACTION_LINE = 'Quoi faire : ouvre le compte master sur le tableau de bord MetaApi et lis l\'état et le message d\'erreur. Si une erreur indique l\'identifiant ou le serveur MT5, corrige-les. Si c\'est seulement "Disconnected" sans erreur, ne redéploie pas en boucle (chaque essai est facturé) : vérifie s\'il y a un incident MetaApi et contacte leur support. Le bot se reconnecte tout seul dès que MetaApi revient. Pendant la panne, le bot ne protège plus les trades : mets un stop dans MT5 sur chaque trade manuel.';

const DUBAI = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Asia/Dubai',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type OwnerAlertCause = 'broker-timeout' | 'broker-disconnected' | 'feed-stale';

export interface OwnerIncident {
  startedAt: number;
  cause: OwnerAlertCause;
  /** 4 caractères + points de suspension, ou vide. Jamais l'identifiant complet. */
  accountHint: string;
  initialSent: boolean;
  remindersSent: number;
  lastSentAt: number | null;
  brokerUp: boolean;
  ticksUp: boolean;
}

export interface OwnerAlertPersisted {
  streak: number;
  streakSince: number | null;
  incident: OwnerIncident | null;
}

export type OwnerAlertInput =
  | { type: 'broker-timeout'; now: number; accountId: string }
  | { type: 'broker-disconnected'; now: number; accountId: string }
  | { type: 'broker-up'; now: number }
  | { type: 'gold-quote'; now: number; quoteAt: number | null; silenceFloor: number; accountId: string }
  | { type: 'health'; now: number; quoteAt: number | null; silenceFloor: number; connectionStatus: string; accountId: string; watchGold: boolean }
  | { type: 'clock'; now: number };

export type OwnerAlertEffect =
  | { kind: 'none' }
  | { kind: 'initial' | 'reminder' | 'recovered'; title: string; lines: string[]; tag: string };

export interface OwnerAlertStep {
  /** À écrire avant l'envoi (l'incident est posé, l'envoi pas encore confirmé). */
  pending: OwnerAlertPersisted;
  effect: OwnerAlertEffect;
  /** À écrire seulement si le DM (ou le push de secours) est parti. null = rien à confirmer. */
  acknowledged: OwnerAlertPersisted | null;
}

export function emptyOwnerAlert(): OwnerAlertPersisted {
  return { streak: 0, streakSince: null, incident: null };
}

/** Absent, vide ou toute valeur autre que off / 0 / false : les alertes partent. */
export function ownerAlertsEnabled(raw: string | undefined = process.env.RUNNER_OWNER_ALERTS): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v !== 'off' && v !== '0' && v !== 'false';
}

export function reminderGapMs(remindersSent: number): number {
  const i = Math.min(Math.max(0, Math.floor(remindersSent)), REMINDER_GAPS_MS.length - 1);
  return REMINDER_GAPS_MS[i];
}

/** Préfixe court. Un identifiant de 4 caractères ou moins n'est pas montré du tout. */
export function accountHint(accountId: string): string {
  const id = accountId.trim();
  if (id.length <= 4) return '';
  return `${id.slice(0, 4)}…`;
}

/** Le libellé du catch connectMaster : timeout broker, déconnexion, ou autre (pas notre alerte). */
export function classifyBrokerError(message: string): 'timeout' | 'disconnected' | 'other' {
  if (/connect to the broker/i.test(message)) return 'timeout';
  if (/disconnected/i.test(message)) return 'disconnected';
  return 'other';
}

export function connectionSignal(status: string): 'up' | 'down' | 'unknown' {
  const s = status.trim().toUpperCase();
  if (s === 'CONNECTED') return 'up';
  if (s.includes('DISCONNECTED')) return 'down';
  return 'unknown';
}

export function formatDubai(ms: number): string {
  const p = Object.fromEntries(DUBAI.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

export function formatOutage(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function causeLabel(cause: OwnerAlertCause): string {
  switch (cause) {
    case 'broker-timeout':
      return 'la connexion du compte master au broker a échoué 2 fois de suite (délai « connect to the broker »)';
    case 'broker-disconnected':
      return 'le compte master est déconnecté du broker';
    case 'feed-stale':
      return 'aucun tick XAUUSD depuis 10 minutes';
    default: {
      const _never: never = cause;
      return _never;
    }
  }
}

function messageLines(inc: OwnerIncident, extra: string[]): string[] {
  const lines = [
    `Cause : ${causeLabel(inc.cause)}.`,
    `Début : ${formatDubai(inc.startedAt)} (heure de Dubaï).`,
    inc.accountHint ? `Compte : ${inc.accountHint}.` : '',
    ...extra,
    IMPACT_LINE,
    ACTION_LINE,
  ];
  return lines.filter((l) => l.length > 0);
}

export function initialMessage(inc: OwnerIncident): { title: string; lines: string[] } {
  return { title: '🚨 MetaApi en panne', lines: messageLines(inc, []) };
}

export function reminderMessage(inc: OwnerIncident, now: number): { title: string; lines: string[] } {
  const dur = formatOutage(now - inc.startedAt);
  return {
    title: `⏳ MetaApi toujours en panne — ${dur}`,
    lines: messageLines(inc, [`En panne depuis ${dur}.`]),
  };
}

export function recoveryMessage(inc: OwnerIncident, now: number): { title: string; lines: string[] } {
  return {
    title: '✅ MetaApi rétabli',
    lines: [
      'La connexion au broker est revenue et les ticks XAUUSD ont repris.',
      `Durée totale de la panne : ${formatOutage(now - inc.startedAt)} (depuis le ${formatDubai(inc.startedAt)}, heure de Dubaï).`,
    ],
  };
}

function clone(s: OwnerAlertPersisted): OwnerAlertPersisted {
  return {
    streak: s.streak,
    streakSince: s.streakSince,
    incident: s.incident ? { ...s.incident } : null,
  };
}

function openIncident(o: {
  startedAt: number;
  cause: OwnerAlertCause;
  accountId: string;
  brokerUp: boolean;
  ticksUp: boolean;
}): OwnerIncident {
  return {
    startedAt: o.startedAt,
    cause: o.cause,
    accountHint: accountHint(o.accountId),
    initialSent: false,
    remindersSent: 0,
    lastSentAt: null,
    brokerUp: o.brokerUp,
    ticksUp: o.ticksUp,
  };
}

function markBrokerDown(state: OwnerAlertPersisted, now: number, accountId: string, cause: 'broker-timeout' | 'broker-disconnected'): void {
  if (state.incident) {
    // La panne a commencé plus tôt (souvent le flux). On garde l'heure, on dit la cause actuelle.
    state.incident.brokerUp = false;
    state.incident.ticksUp = false;
    state.incident.cause = cause;
    if (!state.incident.accountHint) state.incident.accountHint = accountHint(accountId);
    return;
  }
  const startedAt = cause === 'broker-timeout' ? (state.streakSince ?? now) : now;
  state.incident = openIncident({ startedAt, cause, accountId, brokerUp: false, ticksUp: false });
}

function quoteIsFresh(now: number, quoteAt: number | null): boolean {
  if (quoteAt == null || !Number.isFinite(quoteAt)) return false;
  const age = now - quoteAt;
  return age <= TICK_FRESH_MS && age >= -60_000;
}

function applyQuote(state: OwnerAlertPersisted, now: number, quoteAt: number | null, silenceFloor: number, accountId: string): void {
  const fresh = quoteIsFresh(now, quoteAt);
  if (fresh) {
    state.streak = 0;
    state.streakSince = null;
    if (state.incident) state.incident.ticksUp = true;
    return;
  }
  if (state.incident) state.incident.ticksUp = false;
  const anchor = Math.max(quoteAt ?? 0, silenceFloor);
  const silentFor = Math.max(0, now - anchor);
  if (!state.incident && silentFor >= FEED_SILENCE_MS) {
    state.incident = openIncident({
      startedAt: now - silentFor,
      cause: 'feed-stale',
      accountId,
      brokerUp: true,
      ticksUp: false,
    });
  }
}

function applyConnection(state: OwnerAlertPersisted, status: string, now: number, accountId: string, marketOpen: boolean): void {
  const sig = connectionSignal(status);
  if (sig === 'up') {
    state.streak = 0;
    state.streakSince = null;
    if (state.incident) state.incident.brokerUp = true;
    return;
  }
  if (sig !== 'down') return;
  if (state.incident) {
    state.incident.brokerUp = false;
    if (marketOpen) state.incident.ticksUp = false;
    return;
  }
  if (!marketOpen) return;
  state.incident = openIncident({ startedAt: now, cause: 'broker-disconnected', accountId, brokerUp: false, ticksUp: false });
}

function decide(state: OwnerAlertPersisted, now: number, marketOpen: boolean): OwnerAlertStep {
  const inc = state.incident;
  if (!inc) return { pending: state, effect: { kind: 'none' }, acknowledged: null };

  if (inc.brokerUp && inc.ticksUp) {
    return {
      pending: state,
      effect: { kind: 'recovered', ...recoveryMessage(inc, now), tag: 'metaapi-owner-up' },
      acknowledged: emptyOwnerAlert(),
    };
  }
  if (!inc.initialSent) {
    return {
      pending: state,
      effect: { kind: 'initial', ...initialMessage(inc), tag: 'metaapi-owner' },
      acknowledged: {
        ...state,
        incident: { ...inc, initialSent: true, lastSentAt: now },
      },
    };
  }
  // Week-end et pause : l'incident reste ouvert, mais on ne rappelle pas.
  if (!marketOpen) return { pending: state, effect: { kind: 'none' }, acknowledged: null };
  const sinceSend = inc.lastSentAt == null ? Number.POSITIVE_INFINITY : now - inc.lastSentAt;
  if (sinceSend < reminderGapMs(inc.remindersSent)) {
    return { pending: state, effect: { kind: 'none' }, acknowledged: null };
  }
  return {
    pending: state,
    effect: { kind: 'reminder', ...reminderMessage(inc, now), tag: 'metaapi-owner' },
    acknowledged: {
      ...state,
      incident: { ...inc, remindersSent: inc.remindersSent + 1, lastSentAt: now },
    },
  };
}

/** Un pas de la machine. N'écrit rien, n'envoie rien, ne mute pas `prev`. */
export function reduceOwnerAlert(prev: OwnerAlertPersisted, input: OwnerAlertInput): OwnerAlertStep {
  const now = input.now;
  const marketOpen = goldFeedExpected(new Date(now));
  const state = clone(prev);
  if (!marketOpen) {
    state.streak = 0;
    state.streakSince = null;
  }

  switch (input.type) {
    case 'broker-timeout': {
      if (!marketOpen) break;
      state.streak += 1;
      if (state.streakSince == null) state.streakSince = now;
      if (state.streak >= BROKER_TIMEOUT_STREAK) markBrokerDown(state, now, input.accountId, 'broker-timeout');
      break;
    }
    case 'broker-disconnected': {
      if (!marketOpen) break;
      markBrokerDown(state, now, input.accountId, 'broker-disconnected');
      break;
    }
    case 'broker-up': {
      state.streak = 0;
      state.streakSince = null;
      if (state.incident) state.incident.brokerUp = true;
      break;
    }
    case 'gold-quote': {
      if (!marketOpen) break;
      applyQuote(state, now, input.quoteAt, input.silenceFloor, input.accountId);
      break;
    }
    case 'health': {
      // La déconnexion gagne sur un tick encore en cache : pas de « rétabli » dans la même lecture.
      if (connectionSignal(input.connectionStatus) === 'down') {
        applyConnection(state, input.connectionStatus, now, input.accountId, marketOpen);
        break;
      }
      if (input.watchGold && marketOpen) applyQuote(state, now, input.quoteAt, input.silenceFloor, input.accountId);
      applyConnection(state, input.connectionStatus, now, input.accountId, marketOpen);
      break;
    }
    case 'clock':
      break;
    default: {
      const _never: never = input;
      return _never;
    }
  }

  return decide(state, now, marketOpen);
}

function nonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function msOrNull(n: unknown): number | null {
  if (n == null) return null;
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

function isCause(v: unknown): v is OwnerAlertCause {
  return v === 'broker-timeout' || v === 'broker-disconnected' || v === 'feed-stale';
}

function parseIncident(v: unknown): OwnerIncident | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isCause(o.cause)) return null;
  const startedAt = msOrNull(o.startedAt);
  if (startedAt == null) return null;
  const hint = typeof o.accountHint === 'string' ? o.accountHint.slice(0, 8) : '';
  return {
    startedAt,
    cause: o.cause,
    accountHint: hint,
    initialSent: o.initialSent === true,
    remindersSent: nonNeg(o.remindersSent),
    lastSentAt: msOrNull(o.lastSentAt),
    brokerUp: o.brokerUp === true,
    ticksUp: o.ticksUp === true,
  };
}

export function parseOwnerAlert(raw: string | null | undefined): OwnerAlertPersisted {
  if (!raw) return emptyOwnerAlert();
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return emptyOwnerAlert();
    const o = v as Record<string, unknown>;
    return {
      streak: nonNeg(o.streak),
      streakSince: msOrNull(o.streakSince),
      incident: parseIncident(o.incident),
    };
  } catch {
    return emptyOwnerAlert();
  }
}

export function serializeOwnerAlert(s: OwnerAlertPersisted): string {
  return JSON.stringify({
    streak: s.streak,
    streakSince: s.streakSince,
    incident: s.incident,
  });
}

export interface OwnerAlertDeps {
  active: () => boolean;
  /** undefined = illisible : on n'invente pas un incident et on n'écrase rien. */
  load: () => Promise<string | null | undefined>;
  save: (value: string) => Promise<boolean>;
  send: (effect: Exclude<OwnerAlertEffect, { kind: 'none' }>) => Promise<{ dm: number; push: number }>;
  log?: (msg: string) => void;
}

/**
 * Un pas avec I/O injecté. Ne lance jamais : un échec de lecture, d'écriture ou d'envoi
 * est avalé pour ne pas bloquer la boucle de reconnexion.
 */
export async function runOwnerAlertStep(input: OwnerAlertInput, deps: OwnerAlertDeps): Promise<void> {
  try {
    if (!deps.active()) return;
    const raw = await deps.load();
    if (raw === undefined) {
      deps.log?.('alerte MetaApi propriétaire : état illisible, passage sauté');
      return;
    }
    const prev = parseOwnerAlert(raw);
    const step = reduceOwnerAlert(prev, input);
    const pendingRaw = serializeOwnerAlert(step.pending);
    if (pendingRaw !== serializeOwnerAlert(prev)) await deps.save(pendingRaw);
    if (step.effect.kind === 'none' || !step.acknowledged) return;
    const sent = await deps.send(step.effect);
    if ((sent?.dm ?? 0) + (sent?.push ?? 0) <= 0) {
      deps.log?.('alerte MetaApi propriétaire non délivrée, nouvel essai au prochain passage');
      return;
    }
    await deps.save(serializeOwnerAlert(step.acknowledged));
    deps.log?.(`alerte MetaApi propriétaire envoyée (${step.effect.kind})`);
  } catch (e) {
    deps.log?.(`alerte MetaApi propriétaire échouée: ${e instanceof Error ? e.message : String(e)}`);
  }
}
