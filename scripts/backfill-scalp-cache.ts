import 'dotenv/config'; // charge le .env AVANT le client MetaApi (no-op sur Railway où les env existent déjà)
// BACKFILL PROFOND du M5 gold pour le backtest SCALP (→ 12 mois du backtest COMBINÉ « tous les trades »).
// Le cache actuel (backtest/.cache/XAUUSD-M5-15.json) n'a qu'~1 mois : ce script va chercher jusqu'à ~12 mois
// de bougies M5 chez ton broker (MetaApi, paginé) et RÉÉCRIT directement ce fichier — aucune étape Supabase.
//
// À LANCER là où les env METAAPI_TOKEN / METAAPI_ACCOUNT_ID existent (ta machine locale, ou Railway) :
//   tsx scripts/backfill-scalp-cache.ts            (symbole broker = ALGORIA_SYMBOL, ex. "Gold")
//   tsx scripts/backfill-scalp-cache.ts Gold       (force le symbole broker si besoin)
//   M5_PAGES=120 tsx scripts/backfill-scalp-cache.ts   (va chercher encore plus loin)
// Puis : git add backtest/.cache/XAUUSD-M5-15.json && git commit -m "chore: deeper M5" && git push
//        → dis-le moi et je régénère algoria.tech/backtest en 12 mois, tous les trades.
import { writeFileSync } from 'node:fs';
import { connectMaster } from '../runner/metaapi/client';
import { backfill } from '../runner/metaapi/candles';
import type { Bar } from '../lib/engine/types';

const brokerSymbol = process.argv[2] ?? process.env.ALGORIA_SYMBOL ?? 'XAUUSD'; // nom EXACT chez le broker (Market Watch)
const CACHE = 'backtest/.cache/XAUUSD-M5-15.json'; // le fichier que lit le backtester scalp
// 1 mois de M5 gold ≈ 6 000 bougies. 100 pages × 1000 ≈ 16 mois de marge : la pagination s'arrête d'elle-même
// quand le broker n'a plus d'historique (donc on récupère AUTANT que le broker conserve, sans risque).
const PAGES = Number(process.env.M5_PAGES ?? 100);

async function main() {
  console.log(`[backfill-m5] connexion MetaApi…  (broker="${brokerSymbol}")`);
  const { account, stream } = await connectMaster();
  await stream.subscribeToMarketData(brokerSymbol);
  console.log(`[backfill-m5] récupération M5 · jusqu'à ${PAGES} pages (~${(PAGES * 1000 / 6000).toFixed(0)} mois)…`);
  const raw = await backfill(account, brokerSymbol, 'M5', PAGES);

  // dédoublonnage par timestamp + tri ascendant (le cache doit être propre et ordonné)
  const byTime = new Map<number, Bar>();
  for (const b of raw) if (b && Number.isFinite(b.time)) byTime.set(b.time, b);
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (!bars.length) { console.error('[backfill-m5] aucune bougie reçue — symbole broker incorrect ?'); process.exit(1); }

  writeFileSync(CACHE, JSON.stringify(bars));
  const days = ((bars[bars.length - 1].time - bars[0].time) / 86_400_000).toFixed(0);
  console.log(`[backfill-m5] ✅ ${bars.length} bougies M5 écrites dans ${CACHE}`);
  console.log(`[backfill-m5]    du ${new Date(bars[0].time).toISOString().slice(0, 10)} au ${new Date(bars[bars.length - 1].time).toISOString().slice(0, 10)} (${days} jours)`);
  console.log('[backfill-m5]    → git add ' + CACHE + ' && git commit -m "chore: deeper M5" && git push, puis dis-le moi.');
  process.exit(0);
}
main().catch((e) => { console.error('[backfill-m5] crash:', e); process.exit(1); });
