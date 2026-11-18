// Nouvel essai d'un envoi Telegram coupé net (timeout, abort). SUPPORT_TG_SEND_RETRY, absent = coupé :
// un seul essai, comme avant. Toute la journée. Pas un second webhook.
//
// Idempotence : un succès arrête la boucle (pas de second envoi dans le même appel). Un refus métier
// (bloqué, message trop long) n'est pas retenté. Deux appels concurrents : le verrou tg_send_lock et
// answered_at / draft_sent_at empêchent un autre envoi (outboundSendGate).

export const TG_RETRY_MAX = 3;
export const TG_SEND_METHODS = new Set(['sendMessage', 'sendVoice', 'sendVideoNote', 'sendVideo']);
export const SEND_LOCK_MS = 45_000;

const BACKOFF_MS = [0, 400, 1200];

export const telegramRetryDelayMs = (attemptIndex: number): number => BACKOFF_MS[attemptIndex] ?? BACKOFF_MS[BACKOFF_MS.length - 1];

export function tgSendRetryEnabled(raw: string | null | undefined = process.env.SUPPORT_TG_SEND_RETRY): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

export function isRetryableTelegramFailure(description: string | null | undefined): boolean {
  return /timeout|timed out|aborted|abort|econnreset|socket hang up|network error|fetch failed/i.test(String(description ?? ''));
}

export function outboundSendGate(
  detail: { answered_at?: unknown; draft_sent_at?: unknown; tg_send_lock?: unknown } | null | undefined,
  now: number,
): 'send' | 'already_sent' | 'in_flight' {
  if (detail?.answered_at || detail?.draft_sent_at) return 'already_sent';
  const lock = Number(detail?.tg_send_lock ?? 0);
  if (Number.isFinite(lock) && lock > 0 && now - lock < SEND_LOCK_MS) return 'in_flight';
  return 'send';
}

export type TgAttempt = { ok: boolean; description?: string };

/** Un seul aller si le drapeau est coupé, ou si la méthode n'envoie pas de contenu au prospect. */
export async function runTelegramAttempts(
  once: () => Promise<TgAttempt>,
  opts: { enabled: boolean; method: string; sleep?: (ms: number) => Promise<void> },
): Promise<TgAttempt> {
  const retry = opts.enabled && TG_SEND_METHODS.has(opts.method);
  const max = retry ? TG_RETRY_MAX : 1;
  let last: TgAttempt = { ok: false, description: 'network error' };
  for (let i = 0; i < max; i++) {
    if (i > 0) await (opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(telegramRetryDelayMs(i));
    last = await once();
    if (last.ok || !retry || !isRetryableTelegramFailure(last.description)) return last;
  }
  return last;
}
