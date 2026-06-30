import { existsSync, readFileSync } from 'node:fs';
import { backtest } from './simulator';
import { metrics } from './metrics';
import { DEFAULT_CONFIG, type EngineConfig } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import type { Bar, Mode } from '../lib/engine/types';

// Scan dédié au MODE SCALP : on cherche la config qui TRADE BEAUCOUP (valeur stream) tout en restant
// robustement rentable (positive sur les DEUX moitiés). Lit le cache M5 produit par scripts/pull-cache / MCP.
const CACHE = 'backtest/.cache/XAUUSD-M5-15.json';
if (!existsSync(CACHE)) {
  console.error('cache absent:', CACHE);
  process.exit(1);
}
const bars = JSON.parse(readFileSync(CACHE, 'utf8')) as Bar[];
const DAYS = (bars[bars.length - 1].time - bars[0].time) / 86_400_000;

const P = {
  symbol: 'XAUUSD',
  mode: 'normal' as Mode,
  startBalance: 10_000,
  spread: 0.2,
  slippage: 0.05,
  commissionPerLot: 7,
  contractSize: 100,
  warmup: 210,
  window: 600,
};

const pct = (x: number) => (x * 100).toFixed(1) + '%';
const r2 = (x: number) => x.toFixed(2);
const pf = (v: number) => (v === Infinity ? '∞' : r2(v));

// Profil scalp : SL serré, TP rapide, breakeven précoce, cadence élevée (seuil bas), plus de trades/jour.
function scalpCfg(o: { thr: number; targetRR: number; slAtr: number; be: number }): EngineConfig {
  return {
    ...DEFAULT_CONFIG,
    targetRR: o.targetRR,
    slAtrMult: o.slAtr,
    minRR: Math.min(0.2, o.targetRR * 0.8),
    minStopAtr: 0.35,
    maxStopAtr: Math.max(3, o.slAtr + 2),
    beTrigger: o.be,
    threshold: { soft: o.thr, normal: o.thr, turbo: o.thr, scalp: o.thr },
    risk: { ...DEFAULT_CONFIG.risk, maxTradesPerDay: 200, minSecondsBetweenTrades: 0, maxOpenPositions: 2 },
  };
}

const mid = Math.floor(bars.length / 2);
const H1 = bars.slice(0, mid);
const H2 = bars.slice(mid);

type Row = {
  thr: number; rr: number; sl: number; be: number;
  trades: number; perDay: string; win: string; PF: string; expR: string; net: string; DD: string;
  h1: string; h2: string; robuste: string;
};
const rows: Row[] = [];

for (const thr of [0.25, 0.3, 0.35, 0.4])
  for (const targetRR of [0.2, 0.3, 0.4])
    for (const slAtr of [0.6, 0.9, 1.2])
      for (const be of [0, 0.15]) {
        const cfg = scalpCfg({ thr, targetRR, slAtr, be });
        const m = metrics(backtest(bars, FEATURES, cfg, { ...P }), P.startBalance);
        if (m.trades < 40) continue;
        const a = metrics(backtest(H1, FEATURES, cfg, { ...P }), P.startBalance);
        const b = metrics(backtest(H2, FEATURES, cfg, { ...P }), P.startBalance);
        rows.push({
          thr, rr: targetRR, sl: slAtr, be,
          trades: m.trades, perDay: (m.trades / DAYS).toFixed(1), win: pct(m.winRate), PF: pf(m.profitFactor),
          expR: r2(m.expectancyR), net: '$' + m.netPnl.toFixed(0), DD: pct(m.maxDrawdownPct),
          h1: '$' + a.netPnl.toFixed(0), h2: '$' + b.netPnl.toFixed(0),
          robuste: a.netPnl > 0 && b.netPnl > 0 ? '✅' : '❌',
        });
      }

console.log(`SCAN SCALP · ${bars.length} bougies M5 · ${DAYS.toFixed(1)} jours · ${rows.length} configs ≥40 trades\n`);

// On veut BEAUCOUP de trades ET robuste. Tri : robustes d'abord, puis par nb de trades (fréquence = valeur stream).
const robust = rows.filter((r) => r.robuste === '✅').sort((a, b) => b.trades - a.trades);
console.log('========== ROBUSTES (rentable H1 ET H2) — triés par FRÉQUENCE ==========');
console.table(robust.slice(0, 16));

const byNet = [...rows].sort((a, b) => parseFloat(b.net.slice(1)) - parseFloat(a.net.slice(1)));
console.log('\n========== TOP 10 par NET PnL (toutes) ==========');
console.table(byNet.slice(0, 10));
