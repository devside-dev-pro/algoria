import { connectMaster } from './metaapi/client';
import { loadHistory, makeAggregator, backfill } from './metaapi/candles';
import { readState } from './metaapi/state';
import { placeSignal } from './metaapi/execution';
import { runTick } from '../lib/engine/pipeline';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import { logEvents, logSignal, pushState, logCandle, logCandles, watchCommands } from '../lib/supabase/sync';
import type { Bar, EngineState, Mode } from '../lib/engine/types';

const SYMBOL = process.env.ALGORIA_SYMBOL ?? 'XAUUSD';
const TF = '5m';

async function main() {
  console.log('[algoria] runner démarre…');
  const { account, stream, terminal } = await connectMaster();
  await stream.subscribeToMarketData(SYMBOL);
  console.log(`[algoria] connecté · ${SYMBOL} · TF ${TF}`);

  // Backfill d'historique profond pour le chart (tous les timeframes).
  for (const tf of ['M5', 'M15', 'H1', 'D1']) {
    try {
      const hist = await backfill(account, SYMBOL, tf, 5);
      await logCandles(SYMBOL, hist, tf);
      console.log(`[algoria] backfill ${tf}: ${hist.length} bougies`);
    } catch (e) {
      console.error(`[algoria] backfill ${tf} échoué (getHistoricalCandles non supporté ?):`, e);
    }
  }

  const seed = await loadHistory(account, SYMBOL, TF, 300);
  let state: EngineState = readState(terminal, SYMBOL, { dayStartBalance: terminal.accountInformation?.balance });
  let mode: Mode = 'normal';

  // commandes venues du cockpit (mode, kill switch, flatten)
  watchCommands((cmd) => {
    if (cmd.type === 'set_mode' && (cmd.payload as any)?.mode) mode = (cmd.payload as any).mode;
    if (cmd.type === 'kill') state.killed = true;
    console.log('[algoria] commande:', cmd.type, cmd.payload ?? '');
  });

  const onClosed = async (bars: Bar[]) => {
    state = readState(terminal, SYMBOL, state);
    const { signal, events, context } = runTick({ symbol: SYMBOL, bars, mode, state, ctxOpts: { spread: state.spread } }, FEATURES, DEFAULT_CONFIG);
    await logCandle(SYMBOL, bars[bars.length - 1], 'M5');
    await logEvents(events);
    await pushState(context, state, mode);
    if (signal) {
      try {
        const res = await placeSignal(stream, signal);
        state.tradesToday++;
        state.lastTradeTime = signal.time;
        await logSignal(signal, res);
        console.log('[algoria] ORDRE', signal.direction, signal.symbol, signal.lot, '→', res.ticket);
      } catch (e) {
        console.error('[algoria] échec ordre:', e);
      }
    }
  };

  const agg = makeAggregator(TF, seed, onClosed);
  setInterval(() => {
    const p = terminal.price(SYMBOL);
    if (p) agg(p.bid, p.ask, Date.now());
  }, 1000);
}

main().catch((e) => {
  console.error('[algoria] runner crash:', e);
  process.exit(1);
});
