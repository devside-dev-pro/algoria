import MetaApiPkg from 'metaapi.cloud-sdk';

// interop ESM/CJS : le SDK expose parfois la classe sous .default
const MetaApi: any = (MetaApiPkg as any).default ?? MetaApiPkg;

const token = process.env.METAAPI_TOKEN!;
const accountId = process.env.METAAPI_ACCOUNT_ID!; // le compte MT5 DÉMO master

/** Connecte le compte master + ouvre la connexion streaming synchronisée. */
export async function connectMaster() {
  const api = new MetaApi(token);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  await account.waitConnected(); // attend que MetaApi joigne le broker

  const stream = account.getStreamingConnection();
  await stream.connect();
  await stream.waitSynchronized(); // synchronise l'état terminal local

  return { api, account, stream, terminal: stream.terminalState };
}
