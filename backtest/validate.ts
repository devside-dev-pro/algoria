// Validation d'un edge scalp pour UN symbole ARBITRAIRE, avec ses VRAIS coûts marché.
// Réutilise le simulateur causal (aucun lookahead) + les métriques honnêtes déjà éprouvés sur l'or/NAS100.
// Lit le cache M5 produit par `node scripts/pull-cache.mjs <SYMBOLE> M5` (données Supabase, clé anon).
//
// USAGE : npx tsx backtest/validate.ts EURUSD
//         npx tsx backtest/validate.ts DJ30
//
// winRate / PF / expectancyR sont INVARIANTS d'échelle → l'edge est mesuré honnêtement quel que soit le lot.
// On fait juste correspondre contractSize (moteur ET simulateur) pour que le risque %/trade et le kill switch
// journalier soient cohérents. Un edge est retenu s'il est RENTABLE sur les DEUX moitiés (robuste out-of-sample).
import { existsSync, readFileSync } from 'node:fs';
import { backtest } from './simulator';
import { metrics } from './metrics';
import { DEFAULT_CONFIG, type EngineConfig } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import type { Bar, Mode } from '../lib/engine/types';
import type { ContextOptions } from '../lib/engine/context';

// Spec marché par symbole. spread/maxSpread en PRIX (unités du symbole). commission en devise/lot (round turn).
interface Spec { spread: number; contractSize: number; commissionPerLot: number; maxSpread: number; priceStep: number; roundStep?: number }
const SPECS: Record<string, Spec> = {
  XAUUSD: { spread: 0.2, contractSize: 100, commissionPerLot: 7, maxSpread: 0.5, priceStep: 0.01 },
  NAS100: { spread: 0.95, contractSize: 1, commissionPerLot: 0, maxSpread: 5, priceStep: 0.1, roundStep: 100 },
  // Forex : 1 lot = 100 000 unités, commission ~7$/lot round turn, spread retail réaliste (pips → prix).
  // priceStep = tick broker (5 décimales pour les paires en USD, 3 pour le JPY) — CRUCIAL sinon riskDist≈0.
  EURUSD: { spread: 0.00012, contractSize: 100_000, commissionPerLot: 7, maxSpread: 0.0006, priceStep: 0.00001 }, // ~1.2 pips
  GBPUSD: { spread: 0.00018, contractSize: 100_000, commissionPerLot: 7, maxSpread: 0.0008, priceStep: 0.00001 }, // ~1.8 pips
  USDJPY: { spread: 0.015, contractSize: 100_000, commissionPerLot: 7, maxSpread: 0.05, priceStep: 0.001 }, //   ~1.5 pips (pip=0.01)
  // Indices CFD : spread-only (commission 0), spread en POINTS, niveaux ronds ~100.
  DJ30: { spread: 2.0, contractSize: 1, commissionPerLot: 0, maxSpread: 8, priceStep: 0.1, roundStep: 100 },
};

const SYMBOL = (process.argv[2] ?? '').toUpperCase();
const spec = SPECS[SYMBOL];
if (!SYMBOL || !spec) {
  console.error(`usage: npx tsx backtest/validate.ts <SYMBOLE>\n  connus: ${Object.keys(SPECS).join(', ')}`);
  process.exit(1);
}
const CACHE = `backtest/.cache/${SYMBOL}-M5-15.json`;
if (!existsSync(CACHE)) {
  console.error(`cache absent: ${CACHE}\n  génère-le d'abord: node scripts/pull-cache.mjs ${SYMBOL} M5`);
  process.exit(1);
}
const bars = JSON.parse(readFileSync(CACHE, 'utf8')) as Bar[];
if (bars.length < 300) {
  console.error(`pas assez de bougies (${bars.length}) — backfill plus profond`);
  process.exit(1);
}
const DAYS = (bars[bars.length - 1].time - bars[0].time) / 86_400_000;

const P = {
  symbol: SYMBOL,
  mode: 'scalp' as Mode,
  startBalance: 10_000,
  spread: spec.spread,
  slippage: spec.spread * 0.25, // slippage ~1/4 de spread
  commissionPerLot: spec.commissionPerLot,
  contractSize: spec.contractSize,
  warmup: 210,
  window: 600, // = ce que voit le moteur en live après un restart
};

// Contexte SCALP live : session asia tradable + gate de volatilité élargi (+ roundStep pour les indices).
const CTX: Partial<ContextOptions> = { tradeAsia: true, volMinPct: 0.05, volMaxPct: 0.995, ...(spec.roundStep ? { roundStep: spec.roundStep } : {}) };

const pct = (x: number) => (x * 100).toFixed(1) + '%';
const r2 = (x: number) => x.toFixed(2);
const pf = (v: number) => (v === Infinity ? '∞' : r2(v));

// Config scalp paramétrée : coûts/contractSize/maxSpread du symbole + grille (seuil, R:R, SL, breakeven).
function scalpCfg(o: { thr: number; targetRR: number; slAtr: number; be: number }): EngineConfig {
  return {
    ...DEFAULT_CONFIG,
    contractSize: spec.contractSize,
    priceStep: spec.priceStep,
    targetRR: o.targetRR,
    slAtrMult: o.slAtr,
    minRR: Math.min(0.2, o.targetRR * 0.8),
    minStopAtr: 0.3,
    maxStopAtr: Math.max(3, o.slAtr + 2),
    beTrigger: o.be,
    threshold: { soft: o.thr, normal: o.thr, turbo: o.thr, scalp: o.thr },
    risk: { ...DEFAULT_CONFIG.risk, maxSpread: spec.maxSpread, maxTradesPerDay: 200, minSecondsBetweenTrades: 0, maxOpenPositions: 2 },
  };
}

const mid = Math.floor(bars.length / 2);
const H1 = bars.slice(0, mid);
const H2 = bars.slice(mid);
const sim = (b: Bar[], cfg: EngineConfig) => metrics(backtest(b, FEATURES, cfg, { ...P, ctxOpts: CTX }), P.startBalance);

type Row = { thr: number; rr: number; sl: number; be: number; trades: number; perDay: string; win: string; PF: string; expR: string; net: string; DD: string; h1: string; h2: string; robuste: string };
const rows: Row[] = [];

for (const thr of [0.25, 0.28, 0.32, 0.38])
  for (const targetRR of [0.3, 0.5, 0.8])
    for (const slAtr of [0.6, 0.9, 1.2])
      for (const be of [0, 0.15]) {
        const cfg = scalpCfg({ thr, targetRR, slAtr, be });
        const m = sim(bars, cfg);
        if (m.trades < 30) continue;
        const a = sim(H1, cfg);
        const b = sim(H2, cfg);
        rows.push({
          thr, rr: targetRR, sl: slAtr, be,
          trades: m.trades, perDay: (m.trades / DAYS).toFixed(1), win: pct(m.winRate), PF: pf(m.profitFactor),
          expR: r2(m.expectancyR), net: '$' + m.netPnl.toFixed(0), DD: pct(m.maxDrawdownPct),
          h1: '$' + a.netPnl.toFixed(0), h2: '$' + b.netPnl.toFixed(0),
          robuste: a.netPnl > 0 && b.netPnl > 0 ? '✅' : '❌',
        });
      }

console.log(`\n=== VALIDATION ${SYMBOL} · ${bars.length} bougies M5 · ${DAYS.toFixed(1)} jours ===`);
console.log(`coûts: spread ${spec.spread} · contractSize ${spec.contractSize} · commission ${spec.commissionPerLot}/lot · maxSpread ${spec.maxSpread}${spec.roundStep ? ` · roundStep ${spec.roundStep}` : ''}`);
console.log(`${rows.length} configs ≥30 trades\n`);

const robust = rows.filter((r) => r.robuste === '✅').sort((a, b) => b.trades - a.trades);
console.log('========== ROBUSTES (rentable H1 ET H2) — triées par FRÉQUENCE ==========');
if (robust.length) console.table(robust.slice(0, 16));
else console.log('⚠️  AUCUNE config robuste — pas d\'edge scalp fiable sur ce symbole (ne pas activer).');

const byPF = [...rows].sort((a, b) => (parseFloat(b.PF) || 0) - (parseFloat(a.PF) || 0));
console.log('\n========== TOP 10 par PF (toutes, ≥30 trades) ==========');
console.table(byPF.slice(0, 10));

// Verdict synthétique : meilleure config robuste avec ≥ ~4 trades/jour (fréquence utile en stream).
const pick = robust.filter((r) => parseFloat(r.perDay) >= 4).sort((a, b) => (parseFloat(b.PF) || 0) - (parseFloat(a.PF) || 0))[0] ?? robust[0];
console.log('\n>>> VERDICT:', pick
  ? `edge robuste — seuil ${pick.thr} · R:R ${pick.rr} · SL ${pick.sl}×ATR · BE ${pick.be} → ${pick.perDay} trades/j · win ${pick.win} · PF ${pick.PF} · ${pick.net}`
  : `PAS d'edge robuste sur ${SYMBOL} — on n'active pas.`);
process.exit(0);
