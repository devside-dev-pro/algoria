// GARDE DEPLOY METAAPI (05/11/2026) — pure, testable, sans SDK.
//
// Vécu 05/11 ~04:45 Dubai : le compte master f9c888c5… est passé UNDEPLOYED (« no accounts deployed »).
// connectMaster() attendait waitConnected() sans déployer → TimeoutError → process.exit(1) → boucle Railway
// jusqu'au CRASHED. Ce module fixe : quand déployer (1× / 30 min), quand alerter (1× / 30 min), et le
// backoff (2 → 5 → 15 min) qui remplace la sortie immédiate. Les effets de bord (deploy(), Telegram, events)
// restent chez l'appelant (client.ts / index.ts).

export const DEPLOY_COOLDOWN_MS = 30 * 60_000;
export const ALERT_COOLDOWN_MS = 30 * 60_000;
/** 2 min, puis 5, puis 15 (plafond) — le process reste vivant, Railway ne crash-loop pas. */
export const BACKOFF_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000] as const;

export type DeployGuardState = {
  lastDeployAt: number | null;
  lastAlertAt: number | null;
};

export function freshDeployGuard(): DeployGuardState {
  return { lastDeployAt: null, lastAlertAt: null };
}

export function isDeployedState(state: string | null | undefined): boolean {
  return String(state ?? '').toUpperCase() === 'DEPLOYED';
}

export function canDeploy(s: DeployGuardState, now = Date.now()): boolean {
  return s.lastDeployAt == null || now - s.lastDeployAt >= DEPLOY_COOLDOWN_MS;
}

export function canAlert(s: DeployGuardState, now = Date.now()): boolean {
  return s.lastAlertAt == null || now - s.lastAlertAt >= ALERT_COOLDOWN_MS;
}

export function markDeployedAttempt(s: DeployGuardState, now = Date.now()): DeployGuardState {
  return { ...s, lastDeployAt: now };
}

export function markAlerted(s: DeployGuardState, now = Date.now()): DeployGuardState {
  return { ...s, lastAlertAt: now };
}

/** attempt = 0 → 2 min, 1 → 5 min, ≥2 → 15 min. */
export function nextBackoffMs(attempt: number): number {
  const i = Math.max(0, Math.min(Math.floor(attempt), BACKOFF_MS.length - 1));
  return BACKOFF_MS[i];
}

/** Erreurs où l'on reste en vie (backoff) au lieu de process.exit. */
export function isRecoverableMetaApiError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? '');
  return /no accounts deployed/i.test(msg)
    || /Timed out waiting for account/i.test(msg)
    || /TimeoutError/i.test(String((e as { name?: string })?.name ?? ''))
    || /UNDEPLOYED/i.test(msg);
}

/** Que faire face à un état de compte (sans I/O). */
export type DeployDecision = 'ok' | 'alert-and-deploy' | 'alert-only' | 'wait';
export function decideDeployAction(state: string | null | undefined, s: DeployGuardState, now = Date.now()): DeployDecision {
  if (isDeployedState(state)) return 'ok';
  const alert = canAlert(s, now);
  const deploy = canDeploy(s, now);
  if (alert && deploy) return 'alert-and-deploy';
  if (alert) return 'alert-only';
  if (deploy) return 'alert-and-deploy'; // deploy autorisé même si alerte encore en cooldown (on déploie quand même)
  return 'wait';
}
