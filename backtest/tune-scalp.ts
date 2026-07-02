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

const SYMBOL = (process.argv[2] ?? 'XAUUSD').toUpperCase();
const SPEC: Record<string, { spread: number; slippage: number; contractSize: number; priceStep: number; maxSpread: number }> = {
  XAUUSD: { spread: 0.3, slippage: 0.08, contractSize: 100, priceStep: 0.01, maxSpread: 0.5 },
  NAS100: { spread: 0.95, slippage: 0.25, contractSize: 1, priceStep: 0.1, maxSpread: 5 },
};
const spec = SPEC[SYMBOL] ?? SPEC.XAUUSD;
const CACHE = `backtest/.cache/${SYMBOL}-M5-15.json`;
if (!existsSync(CACHE)) { console.error('cache absent:', CACHE); process.exit(1); }
const bars = JSON.parse(readFileSync(CACHE, 'utf8')) as Bar[];
const DAYS = (bars[bars.length - 1].time - bars[0].time) / 86_400_000;

// Coûts réels + LOT FIXE (le copieur redimensionne par compte → seul le PROFIL relatif compte : PF, DD%, robustesse).
const P: SimParams = { symbol: SYMBOL, mode: 'scalp', startBalance: 70_000, spread: spec.spread, slippage: spec.slippage, commissionPerLot: 0, contractSize: spec.contractSize, warmup: 210, window: 600 };
const CTX: Partial<ContextOptions> = { tradeAsia: true, volMinPct: 0.05, volMaxPct: 0.995 };

const pct = (x: number) => (x * 100).toFixed(1) + '%';
const pf = (v: number) => (v === Infinity ? '∞' : v.toFixed(2));
const r2 = (x: number) => x.toFixed(2);

// base scalp + lot fixe 1 ; on fait varier R:R, SL, breakeven, trailing
function cfg(o: { rr: number; sl: number; be: number; maxOpen?: number; emaGate?: 'off' | 'align' | 'notOpposed'; thr?: number }): EngineConfig {
  const thr = o.thr ?? SCALP_CONFIG.threshold.scalp;
  return { ...SCALP_CONFIG, fixedLot: 1, priceStep: spec.priceStep, targetRR: o.rr, slAtrMult: o.sl, minRR: Math.min(0.2, o.rr * 0.8), minStopAtr: 0.3, maxStopAtr: Math.max(3, o.sl + 2), beTrigger: o.be, emaGate: o.emaGate ?? 'off', threshold: { soft: thr, normal: thr, turbo: thr, scalp: thr }, risk: { ...SCALP_CONFIG.risk, maxSpread: spec.maxSpread, maxOpenPositions: o.maxOpen ?? 1 } };
}

interface Variant { name: string; rr: number; sl: number; be: number; maxOpen?: number; emaGate?: 'off' | 'align' | 'notOpposed'; thr?: number; tm?: { trailActivate?: number; trailDist?: number; ignoreTp?: boolean } }
// Paramètres de base = config live du symbole (or : RR0.4/sl1.2 ; NAS : RR0.8/sl0.6). Leviers de FRÉQUENCE : gate EMA + seuil.
const BASE = SYMBOL === 'NAS100' ? { rr: 0.8, sl: 0.6 } : { rr: 0.4, sl: 1.2 };
const VARIANTS: Variant[] = [
  { name: 'LIVE gate align thr.25', rr: BASE.rr, sl: BASE.sl, be: 0.15, maxOpen: 1, emaGate: 'align' },
  { name: 'gate notOpposed thr.25', rr: BASE.rr, sl: BASE.sl, be: 0.15, maxOpen: 1, emaGate: 'notOpposed' },
  { name: 'gate OFF thr.25', rr: BASE.rr, sl: BASE.sl, be: 0.15, maxOpen: 1 },
  { name: 'gate align thr.22', rr: BASE.rr, sl: BASE.sl, be: 0.15, maxOpen: 1, emaGate: 'align', thr: 0.22 },
  { name: 'gate align thr.20', rr: BASE.rr, sl: BASE.sl, be: 0.15, maxOpen: 1, emaGate: 'align', thr: 0.20 },
  { name: 'gate align thr.18', rr: BASE.rr, sl: BASE.sl, be: 0.15, maxOpen: 1, emaGate: 'align', thr: 0.18 },
  { name: 'gate notOpp thr.22', rr: BASE.rr, sl: BASE.sl, be: 0.15, maxOpen: 1, emaGate: 'notOpposed', thr: 0.22 },
  { name: 'gate OFF thr.22', rr: BASE.rr, sl: BASE.sl, be: 0.15, maxOpen: 1, thr: 0.22 },
];

const mid = Math.floor(bars.length / 2);
const H1 = bars.slice(0, mid), H2 = bars.slice(mid);
const run = (b: Bar[], v: Variant): BacktestRun => backtest(b, FEATURES, cfg({ rr: v.rr, sl: v.sl, be: v.be, maxOpen: v.maxOpen, emaGate: v.emaGate }), { ...P, ...(v.tm ?? {}), ctxOpts: CTX });

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
