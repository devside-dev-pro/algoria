// Le package pointe son import "." vers la build navigateur (window is not defined en Node).
// On force la build Node.
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';

// interop ESM/CJS : le SDK expose parfois la classe sous .default
const MetaApi: any = (MetaApiPkg as any).default ?? MetaApiPkg;

const token = process.env.METAAPI_TOKEN!;
const accountId = process.env.METAAPI_ACCOUNT_ID!; // le compte MT5 DÉMO master

/** Connecte le compte master + ouvre la connexion streaming synchronisée. */
export async function connectMaster() {
  const api = new MetaApi(token);
  const account = await api.metatraderAccountApi.getAccount(accountId);
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
}

/** Connexion légère RPC-only (historique de bougies) — pas de flux temps réel. Idéal pour le backtest (même marché fermé). */
export async function connectAccount() {
  const api = new MetaApi(token);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  await account.waitConnected();
  return { api, account };
}
