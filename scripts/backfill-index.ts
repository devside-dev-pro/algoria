import 'dotenv/config'; // charge le .env AVANT que le client MetaApi lise process.env (no-op sur Railway)
// Backfill d'un symbole ARBITRAIRE (ex. un indice : US500, US30, USTEC/NAS100, GER40…) dans Supabase,
// pour pouvoir le BACKTESTER comme l'or. Réutilise le flux de backfill déjà éprouvé du runner
// (connectMaster → subscribeToMarketData → getHistoricalCandles) puis écrit via logCandles.
//
// USAGE (là où les env METAAPI_TOKEN / METAAPI_ACCOUNT_ID + SUPABASE existent — ta machine ou Railway) :
//   tsx scripts/backfill-index.ts <SYMBOLE_BROKER> [LABEL_STOCKAGE]
//   ex : tsx scripts/backfill-index.ts US500
//        tsx scripts/backfill-index.ts "USTEC" NAS100
// Le SYMBOLE_BROKER doit être EXACTEMENT celui de ton broker MT5 (visible dans le Market Watch).
import { connectMaster } from '../runner/metaapi/client';
import { backfill } from '../runner/metaapi/candles';
import { logCandles } from '../lib/supabase/sync';

const symbol = process.argv[2] ?? process.env.INDEX_SYMBOL ?? '';
const display = process.argv[3] ?? symbol;
if (!symbol) {
  console.error('usage: tsx scripts/backfill-index.ts <SYMBOLE_BROKER> [LABEL_STOCKAGE]\n  ex: tsx scripts/backfill-index.ts US500');
  process.exit(1);
}

// M1/M5 profonds → assez pour backtester une strat scalp ; TF hautes plus légères (contexte).
const PAGES: Record<string, number> = { M1: 20, M5: 10, M15: 5, H1: 5, D1: 3 };

async function main() {
  console.log('[backfill] connexion MetaApi…');
  const { account, stream } = await connectMaster();
  await stream.subscribeToMarketData(symbol);
  console.log(`[backfill] broker="${symbol}" → stocké sous symbol="${display}"`);
  for (const tf of ['M1', 'M5', 'M15', 'H1', 'D1']) {
    try {
      const hist = await backfill(account, symbol, tf, PAGES[tf] ?? 5);
      if (hist.length) await logCandles(display, hist, tf);
      console.log(`[backfill] ${tf}: ${hist.length} bougies`);
    } catch (e) {
      console.error(`[backfill] ${tf} échoué (symbole introuvable chez le broker ?):`, (e as { message?: string })?.message ?? e);
    }
  }
  console.log(`[backfill] terminé. Données dans Supabase sous symbol="${display}". Dis-le moi et je backteste.`);
  process.exit(0);
}
main().catch((e) => {
  console.error('[backfill] crash:', e);
  process.exit(1);
});
