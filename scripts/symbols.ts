import 'dotenv/config';
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';

const MetaApi: any = (MetaApiPkg as any).default ?? MetaApiPkg;

// Détecte le nom exact du symbole "or" (et liste les symboles dispo) sur le compte connecté.
async function main() {
  const api = new MetaApi(process.env.METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(process.env.METAAPI_ACCOUNT_ID);
  await account.waitConnected();

  let symbols: string[] = [];
  try {
    const rpc = account.getRPCConnection();
    await rpc.connect();
    await rpc.waitSynchronized();
    symbols = await rpc.getSymbols();
  } catch (e: any) {
    console.error('RPC getSymbols failed:', e?.message);
    try {
      const stream = account.getStreamingConnection();
      await stream.connect();
      await stream.waitSynchronized();
      symbols = (stream.terminalState.specifications ?? []).map((s: any) => s.symbol);
    } catch (e2: any) {
      console.error('streaming specifications failed:', e2?.message);
    }
  }

  const gold = symbols.filter((s) => /XAU|GOLD/i.test(s));
  console.log('SYMBOLS_TOTAL:', symbols.length);
  console.log('GOLD_SYMBOLS:', JSON.stringify(gold));
  process.exit(0);
}

main().catch((e: any) => {
  console.error('SCRIPT_ERROR:', e?.message ?? e);
  process.exit(1);
});
