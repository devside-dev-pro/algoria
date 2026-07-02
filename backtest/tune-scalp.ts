// Tuning du scalp OR : le live montre des pertes >> gains + un breakeven qui scratch trop tôt.
// On compare, à coûts réels et LOT FIXE 1 (pour que les $ collent au compte réel), plusieurs profils de
// gestion de sortie (breakeven tardif, trailing, R:R plus large, SL plus serré) sur ~30 j de M5 réel.
// Métriques honnêtes : PF, expectancy R, MAIS surtout gain moyen $ vs perte moyenne $ (le vrai reproche).
import { existsSync, readFileSync } from 'node:fs';
import { backtest, type BacktestRun, type SimParams } from './simulator';
import { metrics } from './metrics';
import { SCALP_CONFIG, type EngineConfig } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import type { Bar } from '../lib/engine/types';
import type { ContextOptions } from '../lib/engine/context';

const CACHE = 'backtest/.cache/XAUUSD-M5-15.json';
if (!existsSync(CACHE)) { console.error('cache absent:', CACHE); process.exit(1); }
const bars = JSON.parse(readFileSync(CACHE, 'utf8')) as Bar[];
const DAYS = (bars[bars.length - 1].time - bars[0].time) / 86_400_000;

// Coûts OR réalistes + LOT FIXE 1 (contractSize 100 → 1 pt = 100$, comme le compte).
const P: SimParams = { symbol: 'XAUUSD', mode: 'scalp', startBalance: 70_000, spread: 0.3, slippage: 0.08, commissionPerLot: 0, contractSize: 100, warmup: 210, window: 600 };
const CTX: Partial<ContextOptions> = { tradeAsia: true, volMinPct: 0.05, volMaxPct: 0.995 };

const pct = (x: number) => (x * 100).toFixed(1) + '%';
const pf = (v: number) => (v === Infinity ? '∞' : v.toFixed(2));
const r2 = (x: number) => x.toFixed(2);

// base scalp + lot fixe 1 ; on fait varier R:R, SL, breakeven, trailing
function cfg(o: { rr: number; sl: number; be: number; maxOpen?: number }): EngineConfig {
  return { ...SCALP_CONFIG, fixedLot: 1, targetRR: o.rr, slAtrMult: o.sl, minRR: Math.min(0.2, o.rr * 0.8), minStopAtr: 0.3, maxStopAtr: Math.max(3, o.sl + 2), beTrigger: o.be, risk: { ...SCALP_CONFIG.risk, maxOpenPositions: o.maxOpen ?? 2 } };
}

interface Variant { name: string; rr: number; sl: number; be: number; maxOpen?: number; tm?: { trailActivate?: number; trailDist?: number; ignoreTp?: boolean } }
const VARIANTS: Variant[] = [
  { name: 'ACTUEL RR0.4 sl1.2 BE0.15 (2pos)', rr: 0.4, sl: 1.2, be: 0.15, maxOpen: 2 },
  { name: 'ACTUEL + 1 POS MAX', rr: 0.4, sl: 1.2, be: 0.15, maxOpen: 1 },
  { name: 'BE tardif RR0.4 sl1.2 BE0.5', rr: 0.4, sl: 1.2, be: 0.5 },
  { name: 'BE off RR0.4 sl1.2', rr: 0.4, sl: 1.2, be: 0 },
  { name: 'SL serré RR0.4 sl0.9 BE0.3', rr: 0.4, sl: 0.9, be: 0.3 },
  { name: 'SL serré RR0.5 sl0.8 BE0.4', rr: 0.5, sl: 0.8, be: 0.4 },
  { name: 'TP large RR0.8 sl1.2 BE0.5', rr: 0.8, sl: 1.2, be: 0.5 },
  { name: 'TP large RR1.0 sl1.0 BE0.5', rr: 1.0, sl: 1.0, be: 0.5 },
  { name: 'TRAIL 1.0/0.8 BE0.5 sl1.2', rr: 1.0, sl: 1.2, be: 0.5, tm: { ignoreTp: true, trailActivate: 1.0, trailDist: 0.8 } },
  { name: 'TRAIL 0.8/0.6 BE0.4 sl1.0', rr: 1.0, sl: 1.0, be: 0.4, tm: { ignoreTp: true, trailActivate: 0.8, trailDist: 0.6 } },
  { name: 'TRAIL 1.2/1.0 BE0.6 sl1.0', rr: 1.0, sl: 1.0, be: 0.6, tm: { ignoreTp: true, trailActivate: 1.2, trailDist: 1.0 } },
];

const mid = Math.floor(bars.length / 2);
const H1 = bars.slice(0, mid), H2 = bars.slice(mid);
const run = (b: Bar[], v: Variant): BacktestRun => backtest(b, FEATURES, cfg({ rr: v.rr, sl: v.sl, be: v.be, maxOpen: v.maxOpen }), { ...P, ...(v.tm ?? {}), ctxOpts: CTX });

function stats(v: Variant) {
  const r = run(bars, v);
  const m = metrics(r, P.startBalance);
  const wins = r.trades.filter((t) => t.pnl > 0), losses = r.trades.filter((t) => t.pnl < 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const scratch = r.trades.filter((t) => t.reason === 'be').length; // sorties au breakeven
  const a = metrics(run(H1, v), P.startBalance), b = metrics(run(H2, v), P.startBalance);
  return {
    variante: v.name,
    trades: m.trades, '/j': (m.trades / DAYS).toFixed(1), win: pct(m.winRate), PF: pf(m.profitFactor), expR: r2(m.expectancyR),
    'gain moy$': avgWin.toFixed(0), 'perte moy$': avgLoss.toFixed(0), 'ratio G/P': avgLoss ? (avgWin / -avgLoss).toFixed(2) : '∞',
    'BE%': pct(m.trades ? scratch / m.trades : 0), net$: m.netPnl.toFixed(0), maxDD: pct(m.maxDrawdownPct),
    robuste: a.netPnl > 0 && b.netPnl > 0 ? '✅' : '❌',
  };
}

console.log(`\n=== TUNING SCALP OR · ${bars.length} bougies M5 · ${DAYS.toFixed(1)} j · lot fixe 1 · coûts spread 0.3 ===`);
console.log('Objectif : réduire l\'asymétrie perte>>gain (ratio G/P) et le scratch prématuré au BE, sans casser le PF.\n');
console.table(VARIANTS.map(stats));
console.log('\nLecture : "ratio G/P" = gain moyen ÷ perte moyenne (plus haut = mieux). "BE%" = part de trades sortis au breakeven (scratch). "robuste" = rentable sur les 2 moitiés.');
process.exit(0);
