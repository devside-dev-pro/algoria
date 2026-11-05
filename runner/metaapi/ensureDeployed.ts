// EFFETS DE BORD DU DEPLOY (05/11/2026) — alert Telegram + deploy() gardé + event en base.
// Utilisé par connectMaster (démarrage) et le feed watchdog (compte devenu UNDEPLOYED en cours de route).
import { notifyOwner } from '../../lib/member/notifyOwner';
import { logNote } from '../../lib/supabase/sync';
import {
  canAlert, decideDeployAction, isDeployedState, markAlerted, markDeployedAttempt,
  type DeployGuardState,
} from './deployGuard';

async function noteEvent(msg: string, data: Record<string, unknown>): Promise<void> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) { await logNote(msg, 'veto'); return; }
    const db = createClient(url, key, { auth: { persistSession: false } });
    await db.from('events').insert({ ts: new Date().toISOString(), level: 'veto', msg, data: data as never });
  } catch {
    await logNote(msg, 'veto').catch(() => null);
  }
}

/**
 * Si le compte n'est pas DEPLOYED : alerte admin (throttle 30 min) + deploy() au plus 1× / 30 min.
 * Ne boucle jamais. Retourne l'état du compte après l'action.
 */
export async function ensureDeployed(
  account: { state?: string; reload?: () => Promise<unknown>; deploy?: () => Promise<unknown>; id?: string },
  guard: DeployGuardState,
  ctx: { accountId: string; reason: string },
): Promise<{ state: string; guard: DeployGuardState; deployed: boolean }> {
  try { await account.reload?.(); } catch { /* best effort */ }
  let state = String(account.state ?? 'UNKNOWN');
  if (isDeployedState(state)) return { state, guard, deployed: false };

  const action = decideDeployAction(state, guard);
  let next = guard;
  let deployed = false;

  if (action === 'alert-and-deploy' || action === 'alert-only') {
    if (canAlert(next)) {
      next = markAlerted(next);
      const title = '🚨 MetaApi master UNDEPLOYED';
      await notifyOwner({
        title,
        lines: [
          `Compte ${ctx.accountId}`,
          `État : ${state}`,
          `Contexte : ${ctx.reason}`,
          "Vérifier D'ABORD le solde / billing MetaApi (cause du 05/11 : balance à zéro → undeploy auto).",
          action === 'alert-and-deploy' ? 'Deploy MetaApi demandé automatiquement (garde 30 min).' : 'Deploy en cooldown — action manuelle possible sur le dashboard MetaApi.',
        ],
        tag: 'metaapi-undeployed',
      }).catch(() => null);
      await noteEvent('metaapi-undeployed', { accountId: ctx.accountId, state, reason: ctx.reason, action }).catch(() => null);
      console.error(`[algoria] MetaApi master UNDEPLOYED (${state}) — ${ctx.reason}`);
    }
  }

  if (action === 'alert-and-deploy') {
    next = markDeployedAttempt(next);
    try {
      await account.deploy?.();
      deployed = true;
      await noteEvent('metaapi-deploy-requested', { accountId: ctx.accountId, reason: ctx.reason }).catch(() => null);
      console.warn(`[algoria] MetaApi deploy() demandé pour ${ctx.accountId} (${ctx.reason})`);
      try { await account.reload?.(); } catch { /* */ }
      state = String(account.state ?? state);
    } catch (e) {
      console.error('[algoria] MetaApi deploy() échoué:', (e as { message?: string })?.message ?? e);
      await noteEvent('metaapi-deploy-failed', { accountId: ctx.accountId, error: String((e as { message?: string })?.message ?? e).slice(0, 200) }).catch(() => null);
    }
  }

  return { state, guard: next, deployed };
}
