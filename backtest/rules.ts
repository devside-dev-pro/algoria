import { readFileSync } from 'node:fs';
// COMPARATEUR DES 3 RÈGLES DE SORTIE — étude du 28/07 (discussion Mathieu après la semaine à −11k) :
//   1. FLAT WEEK-END : les 2 stops de ~−1850$ du dim. 26 étaient des shorts SWING portés depuis ven. 19h
//      (Trump a parlé le week-end → gap à la réouverture). Les overnights en semaine restent INTACTS.
//   2. ÉCHELLE DE TRAILING (swing) : « à +1000 lock +500, à +1500 lock +1000 » — le trade sauvé à la main
//      le 28/07 (+1499$, ticket 46056508) avait son SL à ~0 à +1000 car le 1er palier prod n'arrive qu'à 2R.
//   3. BE SCALP RETARDÉ : beTrigger 0.15 verrou +0.05R = l'usine à sorties « +13$ » (60/86 trades S2 en 'be'
//      la semaine du 21). On teste un BE plus tardif/haut ± échelle courte. + question R:R de S1 (TP 0.4R).
// Tout est BACKTEST-ONLY : aucun changement live tant que Mathieu n'a pas arbitré sur ces chiffres.
//   npx tsx backtest/rules.ts
import { computeIndicators, labBacktest, SPECS, START, type StrategyDef, type Indicators, type Exits } from './labcore';
import { backtest, type SimParams } from './simulator';
import { metrics } from './metrics';
import { SCALP_CONFIG, type EngineConfig } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import { STRATEGIES, type StrategyProfile } from '../lib/engine/strategies';
import type { Bar, Mode } from '../lib/engine/types';

const load = (f: string): Bar[] => JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8'));
const pct = (x: number) => Math.round(x * 100) + '%';

// ===== partie SWING (H1 gold, ~21 mois) — signaux identiques à GOLD_SWING trend (miroir swing-exits.ts) =====
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

// échelle « spec Mathieu » : dès 1R, verrou = palier − 0.5R, par pas de 0.5R (au-delà, le trail prod 2.5 prend le relais)
const LADDER_M: Array<[number, number]> = [[1, 0.5], [1.5, 1], [2, 1.5], [2.5, 2], [3, 2.5], [4, 3.5], [5, 4.5]];
const PROD_EXITS: Exits = { be: 1, trailActivate: 2.5, trailDist: 2.5, ladder: [[2, 0.5]] }; // = GOLD_SWING live

const SWING_VARIANTS: Array<{ name: string; exits: Exits }> = [
  { name: 'PROD (BE1 · palier 2R→0.5 · trail 2.5@2.5)', exits: PROD_EXITS },
  { name: 'PROD + flat week-end', exits: { ...PROD_EXITS, weekendFlat: true } },
  { name: 'échelle M (paliers 0.5R dès 1R)', exits: { be: 1, ladder: LADDER_M, trailActivate: 2.5, trailDist: 2.5 } },
  { name: 'échelle M + flat week-end', exits: { be: 1, ladder: LADDER_M, trailActivate: 2.5, trailDist: 2.5, weekendFlat: true } },
  { name: 'trail continu 1R@0.5 (M serré)', exits: { be: 1, trailActivate: 1.0, trailDist: 0.5 } },
  { name: 'PROD + flat WE PERDANTS seulement', exits: { ...PROD_EXITS, weekendFlatLosers: true } },
  { name: 'PROD + pas d\'entrée ven ≥ 12h UTC', exits: { ...PROD_EXITS, noEntryFriFrom: 12 } },
  { name: 'PROD + pas d\'entrée vendredi (0h)', exits: { ...PROD_EXITS, noEntryFriFrom: 0 } },
  { name: 'PROD + WE perdants + pas d\'entrée ven 12h', exits: { ...PROD_EXITS, weekendFlatLosers: true, noEntryFriFrom: 12 } },
];

function runSwing(ind: Indicators) {
  console.log('\n================  SWING GOLD H1 (trend · TP16 · ~21 mois)  ================');
  console.log('variante'.padEnd(38), 'trades', ' PF ', 'win%', '  net$ ', ' DD% ', 'expR', '  sorties (part · R moy)');
  for (const v of SWING_VARIANTS) {
    const r = labBacktest(ind, trendDef(1, 16, v.exits), SPECS.XAUUSD);
    const m = metrics(r, START);
    const by: Record<string, { n: number; r: number }> = {};
    for (const t of r.trades) { (by[t.reason] ??= { n: 0, r: 0 }); by[t.reason].n++; by[t.reason].r += t.r; }
    const part = ['tp', 'trail', 'be', 'sl', 'wkd', 'eod'].filter((k) => by[k]).map((k) => `${k} ${Math.round((by[k].n / r.trades.length) * 100)}%·${(by[k].r / by[k].n).toFixed(1)}R`).join('  ');
    console.log(v.name.padEnd(38), String(m.trades).padStart(5), m.profitFactor.toFixed(2).padStart(4), pct(m.winRate).padStart(4), ('$' + m.netPnl.toFixed(0)).padStart(7), (m.maxDrawdownPct * 100).toFixed(0).padStart(4) + '%', m.expectancyR.toFixed(2).padStart(4), ' ', part);
  }
}

// ===== partie SCALP (M5, moteur réel via runTick) — S1 / S2 câblées comme instruments.ts =====
function cfgFor(p: StrategyProfile): EngineConfig {
  return {
    ...SCALP_CONFIG,
    fixedLot: 1,
    emaGate: 'notOpposed',
    targetRR: p.targetRR,
    minRR: p.minRR,
    trailActivate: p.trailActivate,
    trailDist: p.trailDist,
    regimeGate: p.regimeGate,
    maxStopAtr: p.maxStopAtr ?? SCALP_CONFIG.maxStopAtr,
    threshold: { ...SCALP_CONFIG.threshold, scalp: p.thresholdScalp },
    risk: { ...SCALP_CONFIG.risk, dailyProfitTargetPct: p.dailyProfitTargetPct, maxDailyLossPct: p.maxDailyLossPct, dayLockTriggerPct: p.dayLockTriggerPct, dayLockFloorPct: p.dayLockFloorPct },
  };
}

const SIM_BASE = { symbol: 'XAUUSD', mode: 'scalp' as Mode, startBalance: 70_000, spread: 0.2, slippage: 0.05, commissionPerLot: 7, contractSize: 100, warmup: 210, window: 600 };

type ScalpVariant = { name: string; cfg?: Partial<EngineConfig>; sim?: Partial<SimParams> };
function runScalp(bars: Bar[], profile: StrategyProfile, variants: ScalpVariant[]) {
  console.log(`\n================  SCALP M5 — ${profile.label}  (juin 2026, 1 mois)  ================`);
  console.log('variante'.padEnd(44), 'trades', ' PF ', 'win%', '  net$ ', ' DD% ', 'expR', '  sorties (part · R moy)');
  for (const v of variants) {
    const cfg = { ...cfgFor(profile), ...(v.cfg ?? {}) };
    const sim: SimParams = { ...SIM_BASE, ...(v.sim ?? {}), ctxOpts: { tradeAsia: profile.tradeAsia, volMinPct: 0.05, volMaxPct: 0.995 } };
    const r = backtest(bars, FEATURES, cfg, sim);
    const m = metrics(r, SIM_BASE.startBalance);
    const by: Record<string, { n: number; r: number }> = {};
    for (const t of r.trades) { (by[t.reason] ??= { n: 0, r: 0 }); by[t.reason].n++; by[t.reason].r += t.r; }
    const part = ['tp', 'trail', 'be', 'sl', 'wkd', 'eod'].filter((k) => by[k]).map((k) => `${k} ${Math.round((by[k].n / Math.max(1, r.trades.length)) * 100)}%·${(by[k].r / by[k].n).toFixed(1)}R`).join('  ');
    console.log(v.name.padEnd(44), String(m.trades).padStart(5), (m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)).padStart(4), pct(m.winRate).padStart(4), ('$' + m.netPnl.toFixed(0)).padStart(7), (m.maxDrawdownPct * 100).toFixed(0).padStart(4) + '%', m.expectancyR.toFixed(2).padStart(4), ' ', part);
  }
}

const S1_VARIANTS: ScalpVariant[] = [
  { name: 'PROD S1 (RR0.4 · BE 0.15→+0.05)' },
  { name: 'BE retardé (0.45→+0.15)', sim: { beTrigger: 0.45, beOffset: 0.15 } },
  { name: 'R:R relevé (TP 0.8R · minRR 0.6)', cfg: { targetRR: 0.8, minRR: 0.6 } },
  { name: 'R:R relevé + BE retardé', cfg: { targetRR: 0.8, minRR: 0.6 }, sim: { beTrigger: 0.45, beOffset: 0.15 } },
  { name: 'aligné S2 (TP 1R · minRR 0.75 · trail .6@.35)', cfg: { targetRR: 1.0, minRR: 0.75, trailActivate: 0.6, trailDist: 0.35 } },
];

const S2_VARIANTS: ScalpVariant[] = [
  { name: 'PROD S2 (RR1 · BE 0.15→+0.05 · trail .6@.35)' },
  { name: 'BE retardé (0.45→+0.15)', sim: { beTrigger: 0.45, beOffset: 0.15 } },
  { name: 'BE retardé + échelle courte (.6→.3 · .9→.55)', sim: { beTrigger: 0.45, beOffset: 0.15, ladder: [[0.6, 0.3], [0.9, 0.55]] } },
  { name: 'BE retardé doux (0.3→+0.1)', sim: { beTrigger: 0.3, beOffset: 0.1 } },
  { name: 'PROD + flat week-end', sim: { weekendFlat: true } },
  { name: 'BE retardé + flat week-end', sim: { beTrigger: 0.45, beOffset: 0.15, weekendFlat: true } },
];

const gold5 = load('XAUUSD-M5-15.json');
runScalp(gold5, STRATEGIES['1'], S1_VARIANTS);
runScalp(gold5, STRATEGIES['2'], S2_VARIANTS);
runSwing(computeIndicators(load('XAUUSD-H1-15.json')));
console.log('\n[rules] terminé — backtest only, zéro impact live.');
