// Le package pointe son import "." vers la build navigateur (window is not defined en Node).
// On force la build Node.
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
import { ensureDeployed } from './ensureDeployed';
import { freshDeployGuard, isRecoverableMetaApiError, nextBackoffMs } from './deployGuard';

// interop ESM/CJS : le SDK expose parfois la classe sous .default
const MetaApi: any = (MetaApiPkg as any).default ?? MetaApiPkg;

const token = process.env.METAAPI_TOKEN!;
const accountId = process.env.METAAPI_ACCOUNT_ID!; // le compte MT5 DÉMO master

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Connecte le compte master + ouvre la connexion streaming synchronisée.
 *  05/11/2026 : si le compte est UNDEPLOYED ou si waitConnected timeout / « no accounts deployed »,
 *  on n'appelle PLUS process.exit — alerte + deploy gardé (1×/30 min) + backoff 2→5→15 min. Le process
 *  reste vivant pour que Railway ne passe pas en CRASHED (boucle vécue 05/11 04:45→05:18 Dubai). */
export async function connectMaster() {
  const api = new MetaApi(token);
  let guard = freshDeployGuard();
  let attempt = 0;

  for (;;) {
    try {
      const account = await api.metatraderAccountApi.getAccount(accountId);
      const ensured = await ensureDeployed(account, guard, { accountId, reason: 'connectMaster au démarrage' });
      guard = ensured.guard;

      await account.waitConnected(); // attend que MetaApi joigne le broker

      // HISTORIQUE SYNCHRONISÉ BORNÉ À 14 JOURS (07/09/2026). Par défaut MetaApi rejoue TOUT l'historique du compte à
      // chaque synchronisation ; sur un master qui a des milliers de deals (scalp + modes show), la synchro dépasse
      // son délai — vécu le 07/09 sur S2 : « resynchronized since latest synchronization did not finish in time »
      // toutes les 2 min dès 05:55 UTC, websocket coupé à 06:03, puis un flux de prix qui ne revient que 2-3 min
      // après chaque réabonnement. Le runner n'a besoin des deals synchronisés que pour la réconciliation des
      // trades fermés pendant une coupure (voir reconcile dans runner/index.ts) : 14 jours suffisent largement.
      const stream = account.getStreamingConnection(undefined, new Date(Date.now() - 14 * 86_400_000));
      await stream.connect();
      await stream.waitSynchronized(); // synchronise l'état terminal local

      return { api, account, stream, terminal: stream.terminalState };
    } catch (e) {
      if (!isRecoverableMetaApiError(e)) throw e;
      const wait = nextBackoffMs(attempt++);
      console.error(`[algoria] MetaApi indisponible (${String((e as { message?: string })?.message ?? e).slice(0, 120)}) — nouvel essai dans ${Math.round(wait / 60_000)} min (pas de crash)`);
      // re-tenter un deploy gardé avant d'attendre (le compte peut être UNDEPLOYED sans que getAccount l'ait dit)
      try {
        const account = await api.metatraderAccountApi.getAccount(accountId);
        const ensured = await ensureDeployed(account, guard, { accountId, reason: `connectMaster retry #${attempt}` });
        guard = ensured.guard;
      } catch { /* best effort */ }
      await sleep(wait);
    }
  }
}

/** Connexion légère RPC-only (historique de bougies) — pas de flux temps réel. Idéal pour le backtest (même marché fermé). */
export async function connectAccount() {
  const api = new MetaApi(token);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  await account.waitConnected();
  return { api, account };
}
