import 'dotenv/config';
import { runTick } from '../lib/engine/pipeline';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import { logEvents, logSignal, pushState, logCandle } from '../lib/supabase/sync';
import type { Bar, EngineState } from '../lib/engine/types';

// Alimente Supabase avec le VRAI moteur sur des bougies synthétiques — sans MetaApi.
// Écrit via la service key (sync.ts) → nécessite SUPABASE_SERVICE_KEY dans .env.
const SYMBOL = 'XAUUSD';
const STEP = 300_000; // 5 min
const cfg = { ...DEFAULT_CONFIG, threshold: { soft: 0.35, normal: 0.25, turbo: 0.2 } }; // seuils bas POUR la démo

let seed = 73244;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const noise = () => (rnd() + rnd() + rnd() - 1.5) * 1.7;

function genBars(n: number, startTime: number, startPrice: number): Bar[] {
  const bars: Bar[] = [];
  let price = startPrice;
  let drift = 0;
  for (let i = 0; i < n; i++) {
    if (i % 24 === 0) drift = (rnd() - 0.5) * 0.5;
    const open = price;
    price = Math.max(1900, price + drift + noise());
    const high = Math.max(open, price) + Math.abs(noise()) * 0.6;
    const low = Math.min(open, price) - Math.abs(noise()) * 0.6;
    bars.push({ time: startTime + i * STEP, open, high, low, close: price, volume: 60 + Math.floor(rnd() * 240) });
  }
  return bars;
}

async function main() {
  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.error('[demo] SUPABASE_SERVICE_KEY manquant dans .env (Supabase → Settings → API → service_role).');
    process.exit(1);
  }
  console.log('[demo] génération de l’historique synthétique…');
  const base = Math.floor(Date.now() / STEP) * STEP - 240 * STEP; // bougies ancrées ~maintenant
  const bars = genBars(260, base, 2400);
  const state: EngineState = {
    balance: 10000, equity: 10000, dayStartBalance: 10000, dayPnL: 0,
    openPositions: 0, openRiskPct: 0, tradesToday: 0, spread: 0.2, newsWindows: [], killed: false,
  };
  let i = 220;
  console.log('[demo] boucle live (Ctrl+C pour arrêter) — ouvre le cockpit (npm run dev).');

  const tick = async () => {
    if (i >= bars.length - 1) {
      const lastBar = bars[bars.length - 1];
      bars.push(...genBars(40, lastBar.time + STEP, lastBar.close));
    }
    const window = bars.slice(0, i + 1);
    const cur = window[window.length - 1];
    // forceTradable : la démo trade quelle que soit l'heure réelle
    const { signal, events, context } = runTick({ symbol: SYMBOL, bars: window, mode: 'normal', state, ctxOpts: { spread: 0.2, forceTradable: true } }, FEATURES, cfg);
    state.equity = +(state.balance + (rnd() - 0.45) * 60).toFixed(2);
    state.dayPnL = +(state.equity - state.dayStartBalance).toFixed(2);
    await logCandle(SYMBOL, cur);
    await logEvents(events);
    await pushState(context, state, 'normal');
    if (signal) {
      await logSignal(signal, { ticket: 'DEMO-' + i, code: 'DEMO' });
      console.log('[demo] signal', signal.direction, '@', signal.entry, 'conf', (signal.confidence * 100) | 0);
    }
    i++;
  };

  await tick();
  setInterval(tick, 1500);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
