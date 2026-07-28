import { readFileSync } from 'node:fs';
// STRESS DES COÛTS — 3e brique du harnais de confiance (étude 28/07). Question : « si le broker est
// pire que prévu (spread élargi, slippage news, requotes), est-ce que la stratégie survit ? »
// On rejoue les configs PROD (et les variantes candidates) avec des coûts ×2 et ×3. Une config qui ne
// gagne QUE à coûts parfaits est une config morte en live — c'est exactement le genre d'écart
// backtest/réalité que Mathieu constate. Verdict par config : ✅ robuste (reste vert à ×3),
// ⚠️ fragile (vert à ×2, rouge à ×3), ❌ artefact de coûts (rouge dès ×2).
//   npx tsx backtest/stress.ts
import { backtest, type SimParams } from './simulator';
import { metrics } from './metrics';
import { FEATURES } from '../lib/engine/features';
import { STRATEGIES, type StrategyProfile } from '../lib/engine/strategies';
import { computeIndicators, labBacktest, SPECS, START, type Exits, type StrategyDef, type Indicators } from './labcore';
import { cfgFor, ctxFor, SIM_BASE } from './wiring';
import type { Bar } from '../lib/engine/types';

const load = (f: string): Bar[] => JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8'));

// niveaux de stress : baseline = frais RaiseFX mesurés ; ×2 ≈ mauvaise exécution chronique ; ×3 ≈ news/requotes
const LEVELS = [
  { name: 'coûts ×1 (mesurés)', mult: 1 },
  { name: 'coûts ×2', mult: 2 },
  { name: 'coûts ×2.5', mult: 2.5 },
  { name: 'coûts ×3', mult: 3 },
];

// nets[i] = net $, ns[i] = nb de trades. 0 trade ≠ perte : le moteur scalp a un gate maxSpread 0.5$ qui
// coupe tout seul quand le spread simulé le dépasse (défense réelle du live, pas un échec de la stratégie).
const verdict = (nets: number[], ns: number[]) => {
  const alive = nets.filter((_, i) => ns[i] > 0);
  if (ns.some((n) => n === 0)) return alive.every((n) => n > 0) ? '🛡 vert jusqu\'au gate spread' : '⚠️ rouge avant même le gate';
  if (alive.every((n) => n > 0)) return '✅ robuste (vert à tous les niveaux)';
  const firstRed = nets.findIndex((n) => n <= 0);
  return firstRed === 0 ? '⛔ rouge partout' : firstRed === 1 ? '❌ artefact de coûts (rouge dès ×2)' : `⚠️ fragile (rouge à ${LEVELS[firstRed].name.replace('coûts ', '')})`;
};

// ===== SCALP M5 (moteur réel) — S1 et S2 PROD =====
function scalpStress(bars: Bar[]) {
  console.log('\n================  STRESS COÛTS — SCALP M5 (juin 2026)  ================');
  console.log('config'.padEnd(26), ...LEVELS.map((l) => l.name.padStart(18)), '  verdict');
  const rows: Array<{ name: string; profile: StrategyProfile }> = [
    { name: 'PROD S1', profile: STRATEGIES['1'] },
    { name: 'PROD S2', profile: STRATEGIES['2'] },
  ];
  for (const row of rows) {
    const nets: number[] = [];
    const ns: number[] = [];
    const cells: string[] = [];
    for (const l of LEVELS) {
      const sim: SimParams = { ...SIM_BASE, spread: SIM_BASE.spread * l.mult, slippage: SIM_BASE.slippage * l.mult, ctxOpts: ctxFor(row.profile) };
      const m = metrics(backtest(bars, FEATURES, cfgFor(row.profile), sim), SIM_BASE.startBalance);
      nets.push(m.netPnl); ns.push(m.trades);
      cells.push((m.trades === 0 ? '0 trade (gate)' : `$${m.netPnl.toFixed(0)} PF ${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}`).padStart(18));
    }
    console.log(row.name.padEnd(26), ...cells, ' ', verdict(nets, ns));
  }
}

// ===== SWING H1 (~21 mois) — PROD et variantes candidates =====
const trendDef = (exits: Exits, tpAtr: number): StrategyDef => ({
  family: 'sw', params: 't', minBars: 700, exits,
  onClose(i, d) {
    const { bars: b, atr, emaF, emaS, ema21 } = d; if (i < 601) return null; const bar = b[i], a = atr[i];
    const bull = emaF[i] > emaS[i] * 1.001, bear = emaF[i] < emaS[i] * 0.999;
    const dip = b[i - 1].low < ema21[i - 1] || b[i - 2].low < ema21[i - 2], pop = b[i - 1].high > ema21[i - 1] || b[i - 2].high > ema21[i - 2];
    if (bull && dip && bar.close > bar.open && bar.close > ema21[i]) return { direction: 'long', stopLoss: bar.close - a, takeProfit: bar.close + tpAtr * a };
    if (bear && pop && bar.close < bar.open && bar.close < ema21[i]) return { direction: 'short', stopLoss: bar.close + a, takeProfit: bar.close - tpAtr * a };
    return null;
  },
});

function swingStress(ind: Indicators) {
  console.log('\n================  STRESS COÛTS — SWING H1 (~21 mois)  ================');
  console.log('config'.padEnd(42), ...LEVELS.map((l) => l.name.padStart(18)), '  verdict');
  const CANDS: Array<{ name: string; tpAtr: number; exits: Exits }> = [
    { name: 'PROD (TP16 · ladder 2R→.5 · trail 2.5)', tpAtr: 16, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5, ladder: [[2, 0.5]] } },
    { name: 'TP8 · trail 2@2', tpAtr: 8, exits: { be: 1, trailActivate: 2, trailDist: 2 } },
    { name: 'PROD + WE perdants + ven 12h', tpAtr: 16, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5, ladder: [[2, 0.5]], weekendFlatLosers: true, noEntryFriFrom: 12 } },
  ];
  for (const c of CANDS) {
    const nets: number[] = [];
    const ns: number[] = [];
    const cells: string[] = [];
    for (const l of LEVELS) {
      // labcore : slippage = spread × 0.25 → multiplier le spread du spec stresse les deux d'un coup
      const spec = { ...SPECS.XAUUSD, spread: SPECS.XAUUSD.spread * l.mult };
      const m = metrics(labBacktest(ind, trendDef(c.exits, c.tpAtr), spec), START);
      nets.push(m.netPnl); ns.push(m.trades);
      cells.push(`$${m.netPnl.toFixed(0)} PF ${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}`.padStart(18));
    }
    console.log(c.name.padEnd(42), ...cells, ' ', verdict(nets, ns));
  }
}

scalpStress(load('XAUUSD-M5-15.json'));
swingStress(computeIndicators(load('XAUUSD-H1-15.json')));
console.log('\n[stress] terminé — backtest only. Règle : une config doit rester verte à coûts ×2 minimum pour être candidate au live.');
