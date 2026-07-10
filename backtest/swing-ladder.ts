import { readFileSync } from 'node:fs';
// BACKTESTER D'ESCALIER (ladder trailing) pour le swing — teste l'idée « on remonte le SL palier par palier
// en suivant le prix, TP gardé loin ». Réplique FIDÈLEMENT la mécanique du lab (entrée à l'open de i+1,
// sizing 1% du solde, stop AVANT tp, kill-switch jour 4%) mais remplace la gestion BE/trail par une
// fonction d'escalier `stopR(peakR)` = niveau de stop (en R) voulu selon le plus-haut atteint (en R).
//   npx tsx backtest/swing-ladder.ts
import { computeIndicators, SPECS, RISK_PCT, START, type Indicators, type StrategyDef, type Spec } from './labcore';
import type { Bar } from '../lib/engine/types';

const load = (f: string): Bar[] => JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8'));
const dayOf = (t: number) => Math.floor(t / 86_400_000);
const MAX_DAILY_LOSS = 0.04;

// signaux (mêmes que la prod)
const trendDef = (slAtr: number, tpAtr: number): StrategyDef => ({
  family: 'sw-trend', params: 't', minBars: 700, exits: { be: 1 },
  onClose(i, d) {
    const { bars: b, atr, emaF, emaS, ema21 } = d; if (i < 601) return null; const bar = b[i], a = atr[i];
    const bull = emaF[i] > emaS[i] * 1.001, bear = emaF[i] < emaS[i] * 0.999;
    const dip = b[i - 1].low < ema21[i - 1] || b[i - 2].low < ema21[i - 2], pop = b[i - 1].high > ema21[i - 1] || b[i - 2].high > ema21[i - 2];
    if (bull && dip && bar.close > bar.open && bar.close > ema21[i]) return { direction: 'long', stopLoss: bar.close - slAtr * a, takeProfit: bar.close + tpAtr * a };
    if (bear && pop && bar.close < bar.open && bar.close < ema21[i]) return { direction: 'short', stopLoss: bar.close + slAtr * a, takeProfit: bar.close - tpAtr * a };
    return null;
  },
});
const brkDef = (N: number, slAtr: number, tpAtr: number): StrategyDef => ({
  family: 'sw-brk', params: 'b', minBars: 700, exits: { be: 1 },
  onClose(i, d) {
    const { bars: b, atr } = d; if (i < N + 1) return null; let hi = -Infinity, lo = Infinity;
    for (let k = i - N; k < i; k++) { hi = Math.max(hi, b[k].high); lo = Math.min(lo, b[k].low); }
    const bar = b[i], a = atr[i];
    if (bar.close > hi + 0.15 * a) return { direction: 'long', stopLoss: bar.close - slAtr * a, takeProfit: bar.close + tpAtr * a };
    if (bar.close < lo - 0.15 * a) return { direction: 'short', stopLoss: bar.close + slAtr * a, takeProfit: bar.close - tpAtr * a };
    return null;
  },
});

// === fonctions d'escalier : stopR(peakR) = niveau du stop voulu (en R) selon le plus-haut atteint (en R) ===
type Ladder = { name: string; stopR: (peakR: number) => number };
// escalier générique à partir de paliers [déclencheR, verrouilleR] (+ trail continu au-delà pour les runners)
const steps = (name: string, s: [number, number][], beyond?: number): Ladder => ({
  name,
  stopR: (p) => { let lock = -1; for (const [t, l] of s) if (p >= t) lock = l; if (beyond != null && p > s[s.length - 1][0]) lock = Math.max(lock, p - beyond); return lock; },
});
const LADDERS: Ladder[] = [
  { name: 'PROD (BE1 · trail 2.5@2.5)', stopR: (p) => (p >= 2.5 ? p - 2.5 : p >= 1 ? 0.05 : -1) },
  steps('escalier 1R (palier tous les 1R)', [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [8, 7], [10, 9], [12, 11], [14, 13]]),
  steps('escalier serré (lock peak−1)', [[1, 0]], 1),
  steps('escalier ÉLARGISSANT (serré tôt, lâche tard)', [[1, 0], [2, 0.8], [3, 1.5], [4, 2.2]], 2.5),
  steps('escalier doux (serré tôt → trail 2.5)', [[1.5, 0.3], [2.5, 1.2]], 2.5),
];

function run(label: string, ind: Indicators, strat: StrategyDef, spec: Spec, tpAtr: number) {
  const bars = ind.bars, slippage = spec.spread * 0.25;
  console.log(`\n================  ${label}  ================`);
  console.log('escalier'.padEnd(40), 'trades', ' PF ', 'win%', ' ret% ', ' DD% ', 'expR', '  sorties (part · R moy)');
  for (const L of LADDERS) {
    let balance = START, dayStart = balance, dayKilled = false, lastDay = dayOf(bars[strat.minBars].time);
    let peakEq = START, maxDD = 0, gW = 0, gL = 0;
    const trades: { r: number; reason: string }[] = [];
    let open: { dir: 1 | -1; entry: number; lot: number; risk: number; riskDist: number; stopR: number; tp: number; peak: number } | null = null;
    const close = (px: number, reasonHint: string) => {
      if (!open) return; const o = open;
      const pnl = (px - o.entry) * o.dir * o.lot * spec.contractSize - spec.commissionPerLot * o.lot;
      const r = o.risk ? pnl / o.risk : 0; trades.push({ r, reason: reasonHint });
      if (pnl > 0) gW += pnl; else gL += -pnl; balance += pnl; open = null;
    };
    for (let i = strat.minBars; i < bars.length - 1; i++) {
      const bar = bars[i];
      if (open) {
        const o = open; const stopPx = o.entry + o.dir * o.stopR * o.riskDist;
        const hitStop = o.dir === 1 ? bar.low <= stopPx : bar.high >= stopPx;
        const hitTp = o.dir === 1 ? bar.high >= o.tp : bar.low <= o.tp;
        if (hitStop) close(stopPx, o.stopR > 0.1 ? 'ladder' : o.stopR >= -1e-9 ? 'be' : 'sl');
        else if (hitTp) close(o.tp, 'tp');
        else {
          o.peak = o.dir === 1 ? Math.max(o.peak, bar.high) : Math.min(o.peak, bar.low);
          const peakR = (o.dir * (o.peak - o.entry)) / o.riskDist;
          o.stopR = Math.max(o.stopR, L.stopR(peakR)); // ratchet : jamais dans le mauvais sens
        }
      }
      const d = dayOf(bar.time); if (d !== lastDay) { lastDay = d; dayStart = balance; dayKilled = false; }
      const floating = open ? (bar.close - open.entry) * open.dir * open.lot * spec.contractSize : 0;
      const eq = balance + floating; peakEq = Math.max(peakEq, eq); maxDD = Math.max(maxDD, (peakEq - eq) / peakEq);
      if ((dayStart - eq) / dayStart >= MAX_DAILY_LOSS) dayKilled = true;
      if (open || dayKilled) continue;
      const sig = strat.onClose(i, ind); if (!sig) continue;
      const next = bars[i + 1], dir = sig.direction === 'long' ? 1 : -1;
      const entry = next.open + dir * (spec.spread / 2 + slippage);
      const riskDist = Math.abs(entry - sig.stopLoss);
      if (riskDist <= 0 || dir * (sig.takeProfit - entry) <= 0) continue;
      const lot = Math.max(0.01, +((balance * RISK_PCT) / (riskDist * spec.contractSize)).toFixed(2));
      open = { dir: dir as 1 | -1, entry, lot, risk: riskDist * lot * spec.contractSize, riskDist, stopR: -1, tp: sig.takeProfit, peak: entry };
    }
    close(bars[bars.length - 1].close, 'eod');
    const n = trades.length, wins = trades.filter((t) => t.r > 0).length;
    const by: Record<string, { n: number; r: number }> = {};
    for (const t of trades) { (by[t.reason] ??= { n: 0, r: 0 }); by[t.reason].n++; by[t.reason].r += t.r; }
    const part = ['tp', 'ladder', 'be', 'sl', 'eod'].filter((k) => by[k]).map((k) => `${k} ${Math.round(by[k].n / n * 100)}%·${(by[k].r / by[k].n).toFixed(1)}R`).join('  ');
    const expR = trades.reduce((s, t) => s + t.r, 0) / n;
    console.log(
      L.name.padEnd(40), String(n).padStart(5),
      (gL ? gW / gL : 0).toFixed(2).padStart(4),
      (Math.round(wins / n * 100) + '%').padStart(4),
      ('+' + Math.round((balance - START) / START * 100) + '%').padStart(6),
      (maxDD * 100).toFixed(0).padStart(4) + '%', expR.toFixed(2).padStart(4), ' ', part,
    );
  }
}

const TP = 16;
run(`GOLD SWING (trend) · TP ${TP}×ATR`, computeIndicators(load('XAUUSD-H1-15.json')), trendDef(1, TP), SPECS.XAUUSD, TP);
try { run(`BTC SWING (breakout N24) · TP ${TP}×ATR`, computeIndicators(load('BTCUSD-H1-15.json')), brkDef(24, 2, TP), SPECS.BTCUSD, TP); }
catch (e) { console.log('BTC skipped:', (e as { message?: string })?.message ?? e); }
