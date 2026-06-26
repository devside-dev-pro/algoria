import { connectMaster } from '../runner/metaapi/client';
import { loadHistory } from '../runner/metaapi/candles';
import { backtest } from './simulator';
import { metrics } from './metrics';
import { tune } from './optimize';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';

const P = {
  symbol: 'XAUUSD',
  mode: 'normal' as const,
  startBalance: 10_000,
  spread: 0.2,
  slippage: 0.05,
  commissionPerLot: 7,
  contractSize: 100,
  warmup: 210,
};

async function main() {
  const { account } = await connectMaster();
  const bars = await loadHistory(account, P.symbol, '5m', 5000); // ⚠️ paginer pour de longues séries
  console.log('Bougies chargées:', bars.length);

  console.log('\n— Baseline (DEFAULT_CONFIG) —');
  console.table(metrics(backtest(bars, FEATURES, DEFAULT_CONFIG, P), P.startBalance));

  console.log('\n— Tuning (recherche aléatoire, split 70/30) —');
  const t = tune(bars, FEATURES, DEFAULT_CONFIG, P, 200);
  console.log('TRAIN', t.train);
  console.log('TEST  (out-of-sample)', t.test); // si TEST s'effondre vs TRAIN → surajustement → poubelle
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
