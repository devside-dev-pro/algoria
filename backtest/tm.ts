// Expériences de gestion de trade (breakeven + trailing) sur le cache de bougies créé par `npm run backtest`.
// Lancer : npx tsx backtest/tm.ts
import { existsSync, readFileSync } from 'node:fs';
import { backtest, type BacktestRun } from './simulator';
import { metrics } from './metrics';
import { DEFAULT_CONFIG, type EngineConfig } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import type { Bar } from '../lib/engine/types';

const CACHE = `backtest/.cache/${process.env.ALGORIA_SYMBOL ?? 'Gold'}-M5-${process.env.BT_PAGES ?? 15}.json`;
if (!existsSync(CACHE)) {
  console.error(`Cache absent (${CACHE}). Lance d'abord: BT_PAGES=15 npm run backtest`);
  process.exit(1);
}
const bars: Bar[] = JSON.parse(readFileSync(CACHE, 'utf8'));

const P = { symbol: 'XAUUSD', mode: 'normal' as const, startBalance: 10_000, spread: 0.2, slippage: 0.05, commissionPerLot: 7, contractSize: 100, warmup: 210, window: 600 };
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const r2 = (x: number) => x.toFixed(2);

// même base d'entrées que la config validée (sl 1.2, seuil 0.55), R:R variable
const base = (targetRR: number): EngineConfig => ({ ...DEFAULT_CONFIG, slAtrMult: 1.2, targetRR, minRR: 0.24, maxStopAtr: 4.2, threshold: { soft: 0.55, normal: 0.55, turbo: 0.55 } });

interface TM { beTrigger?: number; trailActivate?: number; trailDist?: number; ignoreTp?: boolean }
const exits = (run: BacktestRun) => run.trades.reduce<Record<string, number>>((a, t) => ((a[t.reason] = (a[t.reason] ?? 0) + 1), a), {});

const configs: { name: string; rr: number; tm: TM }[] = [
  { name: 'RR0.3 fixe (ACTUEL)', rr: 0.3, tm: {} },
  { name: 'RR0.3 + BE@0.15', rr: 0.3, tm: { beTrigger: 0.15 } },
  { name: 'RR1.0 fixe', rr: 1.0, tm: {} },
  { name: 'RR1.0 + BE@0.5', rr: 1.0, tm: { beTrigger: 0.5 } },
  { name: 'RR1.0 + BE@0.5 + trail 1/1', rr: 1.0, tm: { beTrigger: 0.5, trailActivate: 1.0, trailDist: 1.0 } },
  { name: 'RR2.0 + BE@0.7 + trail 1/1', rr: 2.0, tm: { beTrigger: 0.7, trailActivate: 1.0, trailDist: 1.0 } },
  { name: 'noTP trail 1/1 + BE@0.5', rr: 1.0, tm: { ignoreTp: true, beTrigger: 0.5, trailActivate: 1.0, trailDist: 1.0 } },
  { name: 'noTP trail 1/0.7 + BE@0.5', rr: 1.0, tm: { ignoreTp: true, beTrigger: 0.5, trailActivate: 1.0, trailDist: 0.7 } },
  { name: 'noTP trail 0.7/0.7 + BE@0.3', rr: 1.0, tm: { ignoreTp: true, beTrigger: 0.3, trailActivate: 0.7, trailDist: 0.7 } },
];

console.log(`[tm] ${bars.length} bougies · gestion de trade (breakeven + trailing)\n`);
const rows = configs.map((c) => {
  const run = backtest(bars, FEATURES, base(c.rr), { ...P, ...c.tm });
  const m = metrics(run, P.startBalance);
  const e = exits(run);
  return {
    strat: c.name,
    trades: m.trades,
    winRate: pct(m.winRate),
    PF: m.profitFactor === Infinity ? '∞' : r2(m.profitFactor),
    expR: r2(m.expectancyR),
    net: '$' + m.netPnl.toFixed(0),
    maxDD: pct(m.maxDrawdownPct),
    sl: e.sl ?? 0,
    be: e.be ?? 0,
    trail: e.trail ?? 0,
    tp: e.tp ?? 0,
  };
});
console.table(rows);

// Robustesse du gagnant (RR0.3 + breakeven) : sensibilité du trigger + out-of-sample (2 moitiés).
const mid = Math.floor(bars.length / 2);
const h1 = bars.slice(0, mid);
const h2 = bars.slice(mid);
const pf = (v: number) => (v === Infinity ? '∞' : r2(v));
const oos = [0.1, 0.15, 0.2, 0.25].map((be) => {
  const cfg = base(0.3);
  const full = metrics(backtest(bars, FEATURES, cfg, { ...P, beTrigger: be }), P.startBalance);
  const a = metrics(backtest(h1, FEATURES, cfg, { ...P, beTrigger: be }), P.startBalance);
  const b = metrics(backtest(h2, FEATURES, cfg, { ...P, beTrigger: be }), P.startBalance);
  return { 'BE trig': be, 'full win': pct(full.winRate), 'full PF': pf(full.profitFactor), 'full net': '$' + full.netPnl.toFixed(0), 'H1 win': pct(a.winRate), 'H1 PF': pf(a.profitFactor), 'H2 win': pct(b.winRate), 'H2 PF': pf(b.profitFactor) };
});
console.log('\nRR0.3 + breakeven — sensibilité du trigger + out-of-sample :');
console.table(oos);
