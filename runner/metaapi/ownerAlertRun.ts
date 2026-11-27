// ENVOI + PERSISTANCE de l'alerte propriétaire MetaApi.
// Réutilise notifyOwner (DM OWNER_TG_IDS / ADMIN_TG_USERNAMES, push seulement si aucun DM n'est parti).
// L'état tient dans support_settings (clé metaapi_owner_incident), déjà écrite par le runner :
// un redémarrage Railway relit la même ligne, donc une seule alerte par incident.
// Tout est avalé : un échec ici ne sort pas du process et ne retarde pas waitConnected.
import { notifyOwner } from '../../lib/member/notifyOwner';
import { SECONDARY, getSetting, setSetting } from '../../lib/supabase/sync';
import {
  OWNER_ALERT_SETTING_KEY,
  classifyBrokerError,
  ownerAlertsEnabled,
  runOwnerAlertStep,
  type OwnerAlertDeps,
  type OwnerAlertInput,
} from './ownerAlert';

const POLL_MS = 60_000;

function productionDeps(): OwnerAlertDeps {
  return {
    active: () => ownerAlertsEnabled() && !SECONDARY,
    load: () => getSetting(OWNER_ALERT_SETTING_KEY),
    save: (value) => setSetting(OWNER_ALERT_SETTING_KEY, value),
    // silent : notifyOwner ne logue pas l'échec total. C'est cette boucle qui écrit la ligne, au plus
    // toutes les 30 minutes, pour ne pas répéter le motif à chaque passage de 60 s.
    send: async (effect) => {
      const r = await notifyOwner({ title: effect.title, lines: effect.lines, tag: effect.tag, path: '/' }, { silent: true });
      return { dm: r.dm, push: r.push, diagnostic: r.diagnostic };
    },
    log: (msg) => {
      const line = `[algoria] ${msg}`;
      if (msg.startsWith('alerte MetaApi propriétaire envoyée')) console.warn(line);
      else console.error(line);
    },
  };
}

let tail: Promise<void> = Promise.resolve();

function enqueue(input: OwnerAlertInput): void {
  const job = tail.then(() => runOwnerAlertStep(input, productionDeps()));
  tail = job.then(() => undefined, () => undefined);
}

/** Rappels pendant que connectMaster boucle (le feed watchdog ne tourne pas encore). */
export function startOwnerAlertReminders(): () => void {
  const timer = setInterval(() => {
    try { enqueue({ type: 'clock', now: Date.now() }); } catch (e) { console.error('[algoria] alerte MetaApi propriétaire:', e); }
  }, POLL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function noteBrokerFailure(error: unknown): void {
  try {
    const message = String((error as { message?: string })?.message ?? error ?? '');
    const kind = classifyBrokerError(message);
    if (kind === 'other') return;
    const accountId = process.env.METAAPI_ACCOUNT_ID ?? '';
    const now = Date.now();
    enqueue(kind === 'timeout'
      ? { type: 'broker-timeout', now, accountId }
      : { type: 'broker-disconnected', now, accountId });
  } catch (e) {
    console.error('[algoria] alerte MetaApi propriétaire:', e);
  }
}

export function noteBrokerUp(now = Date.now()): void {
  try { enqueue({ type: 'broker-up', now }); } catch (e) { console.error('[algoria] alerte MetaApi propriétaire:', e); }
}

export function noteMasterHealth(sample: {
  now: number;
  quoteAt: number | null;
  silenceFloor: number;
  connectionStatus: string;
  accountId: string;
  watchGold: boolean;
}): void {
  try {
    enqueue({
      type: 'health',
      now: sample.now,
      quoteAt: sample.quoteAt,
      silenceFloor: sample.silenceFloor,
      connectionStatus: sample.connectionStatus,
      accountId: sample.accountId,
      watchGold: sample.watchGold,
    });
  } catch (e) {
    console.error('[algoria] alerte MetaApi propriétaire:', e);
  }
}

export function masterConnectionStatus(account: { connectionStatus?: unknown } | null | undefined): string {
  const v = account?.connectionStatus;
  return typeof v === 'string' ? v : '';
}
