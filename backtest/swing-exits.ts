import { readFileSync } from 'node:fs';
// COMPARATEUR D'EXITS pour le SWING (gold trend + BTC breakout) sur les caches H1 committés.
// But : tester l'intuition « le TP à 16×ATR est trop loin, ça revient à BE tout le temps — il faut trailer
// palier par palier ». On mesure, par variante : PF, rendement, drawdown, ET la RÉPARTITION des sorties
// (tp / trail / be / sl) + le R moyen par type. C'est ça qui dit si l'edge vient des runners ou pas.
//   npx tsx backtest/swing-exits.ts
import { computeIndicators, labBacktest, SPECS, START, type StrategyDef, type Indicators, type Exits } from './labcore';
import { metrics } from './metrics';
import type { Bar } from '../lib/engine/types';

const load = (f: string): Bar[] => JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8'));

// --- stratégies (mêmes signaux que la prod GOLD_SWING trend / BTC_SWING breakout) ---
const trendDef = (slAtr: number, tpAtr: number, exits: Exits): StrategyDef => ({
  family: 'sw-trend', params: 't', minBars: 700, exits,
  onClose(i, d) {
    const { bars: b, atr, emaF, emaS, ema21 } = d; if (i < 601) return null; const bar = b[i], a = atr[i];
    const bull = emaF[i] > emaS[i] * 1.001, bear = emaF[i] < emaS[i] * 0.999;
    const dip = b[i - 1].low < ema21[i - 1] || b[i - 2].low < ema21[i - 2], pop = b[i - 1].high > ema21[i - 1] || b[i - 2].high > ema21[i - 2];
    if (bull && dip && bar.close > bar.open && bar.close > ema21[i]) return { direction: 'long', stopLoss: bar.close - slAtr * a, takeProfit: bar.close + tpAtr * a };
    if (bear && pop && bar.close < bar.open && bar.close < ema21[i]) return { direction: 'short', stopLoss: bar.close + slAtr * a, takeProfit: bar.close - tpAtr * a };
    return null;
  },
});
const brkDef = (N: number, slAtr: number, tpAtr: number, exits: Exits): StrategyDef => ({
  family: 'sw-brk', params: 'b', minBars: 700, exits,
  onClose(i, d) {
    const { bars: b, atr } = d; if (i < N + 1) return null; let hi = -Infinity, lo = Infinity;
    for (let k = i - N; k < i; k++) { hi = Math.max(hi, b[k].high); lo = Math.min(lo, b[k].low); }
    const bar = b[i], a = atr[i];
    if (bar.close > hi + 0.15 * a) return { direction: 'long', stopLoss: bar.close - slAtr * a, takeProfit: bar.close + tpAtr * a };
    if (bar.close < lo - 0.15 * a) return { direction: 'short', stopLoss: bar.close + slAtr * a, takeProfit: bar.close - tpAtr * a };
    return null;
  },
});

// --- variantes d'exit à comparer ---
type Variant = { name: string; tpAtr: number; exits: Exits };
const VARIANTS: Variant[] = [
  { name: 'PROD (TP16 · BE1 · trail 2.5@2.5)', tpAtr: 16, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5 } },
  { name: 'trail serré 1.5@1.5 (TP16)',        tpAtr: 16, exits: { be: 1, trailActivate: 1.5, trailDist: 1.5 } },
  { name: 'trail serré 1@1 (TP16)',            tpAtr: 16, exits: { be: 1, trailActivate: 1.0, trailDist: 1.0 } },
  { name: 'palier 1@1.5 (active tôt, lâche)',  tpAtr: 16, exits: { be: 1, trailActivate: 1.0, trailDist: 1.5 } },
  { name: 'TP proche 6 · trail 1.5@1.5',       tpAtr: 6,  exits: { be: 1, trailActivate: 1.5, trailDist: 1.5 } },
  { name: 'TP proche 4 · trail 1@1',           tpAtr: 4,  exits: { be: 1, trailActivate: 1.0, trailDist: 1.0 } },
  { name: 'TP 8 · trail 2@2',                  tpAtr: 8,  exits: { be: 1, trailActivate: 2.0, trailDist: 2.0 } },
];

function run(label: string, ind: Indicators, mk: (v: Variant) => StrategyDef, sym: 'XAUUSD' | 'BTCUSD') {
  console.log(`\n================  ${label}  (${sym})  ================`);
  console.log('variante'.padEnd(34), 'trades', ' PF ', 'win%', ' ret% ', ' DD% ', 'expR', '  répartition sorties (part · R moy)');
  for (const v of VARIANTS) {
    const r = labBacktest(ind, mk(v), SPECS[sym]);
    const m = metrics(r, START);
    const by: Record<string, { n: number; r: number }> = {};
    for (const t of r.trades) { (by[t.reason] ??= { n: 0, r: 0 }); by[t.reason].n++; by[t.reason].r += t.r; }
    const part = ['tp', 'trail', 'be', 'sl', 'eod'].filter((k) => by[k]).map((k) => `${k} ${Math.round(by[k].n / r.trades.length * 100)}%·${(by[k].r / by[k].n).toFixed(1)}R`).join('  ');
    console.log(
      v.name.padEnd(34),
      String(m.trades).padStart(5),
      m.profitFactor.toFixed(2).padStart(4),
      (Math.round(m.winRate * 100) + '%').padStart(4),
      ('+' + Math.round(m.totalReturnPct * 100) + '%').padStart(6),
      (m.maxDrawdownPct * 100).toFixed(0).padStart(4) + '%',
      m.expectancyR.toFixed(2).padStart(4),
      ' ', part,
    );
  }
}

const gold = computeIndicators(load('XAUUSD-H1-15.json'));
run('GOLD SWING (trend)', gold, (v) => trendDef(1, v.tpAtr, v.exits), 'XAUUSD');
try {
  const btc = computeIndicators(load('BTCUSD-H1-15.json'));
  run('BTC SWING (breakout N24)', btc, (v) => brkDef(24, 2, v.tpAtr, v.exits), 'BTCUSD');
} catch (e) { console.log('BTC skipped:', (e as { message?: string })?.message ?? e); }
