import { readFileSync } from 'node:fs';
// WALK-FORWARD — le vaccin contre l'overfitting (étude 28/07). Le péché originel des configs actuelles :
// chaque paramètre a été choisi PARCE QU'il embellissait la fenêtre juin-juillet (le « net » des commentaires
// grimpe +9k → +23k sur la MÊME fenêtre). Ici : on règle sur la fenêtre A (tune), on évalue UNIQUEMENT sur
// la fenêtre B suivante (test, jamais vue), et on roule. La somme des fenêtres TEST est la seule performance
// qu'on a le droit de croire. RÈGLE D'OR : aucun changement de config ne passe en live s'il ne bat pas la
// prod sur les fenêtres test.
//   npx tsx backtest/walkforward.ts            → scalp M5 (S2 par défaut, grille de configs)
//   npx tsx backtest/walkforward.ts swing      → swing H1 (variantes d'exit)
import { backtest, type SimParams } from './simulator';
import { metrics } from './metrics';
import { FEATURES } from '../lib/engine/features';
import { STRATEGIES } from '../lib/engine/strategies';
import { computeIndicators, labBacktest, SPECS, START, type Exits, type StrategyDef } from './labcore';
import { cfgFor, ctxFor, SIM_BASE } from './wiring';
import type { EngineConfig } from '../lib/engine/config';
import type { Bar } from '../lib/engine/types';

const load = (f: string): Bar[] => JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8'));
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

// ===== SCALP M5 : grille de configs candidates (S2 comme base) =====
function scalpWF() {
  const bars = load('XAUUSD-M5-15.json');
  const profile = STRATEGIES['2'];
  type Cand = { name: string; cfg?: Partial<EngineConfig>; sim?: Partial<SimParams> };
  const CANDS: Cand[] = [
    { name: 'PROD S2' },
    { name: 'RR0.4 minRR0.2 (façon S1)', cfg: { targetRR: 0.4, minRR: 0.2, trailActivate: undefined, trailDist: undefined } },
    { name: 'RR0.8 minRR0.5', cfg: { targetRR: 0.8, minRR: 0.5 } },
    { name: 'sans trailing', cfg: { trailActivate: undefined, trailDist: undefined } },
    { name: 'BE retardé 0.3→+0.1', sim: { beTrigger: 0.3, beOffset: 0.1 } },
    { name: 'seuil 0.30 (plus sélectif)', cfg: { threshold: { soft: 0.3, normal: 0.3, turbo: 0.3, scalp: 0.3 } } },
    // filtre de session (étude 29/07) : le live 20→29/07 perd −12,7k sur Londres+US-open, l'edge sim vit
    // la nuit/Asie. Les overnights restent intacts — on bloque seulement les NOUVELLES entrées de jour.
    { name: 'sans entrées 07-17 UTC', sim: { blockEntryHours: [[7, 17]] } },
    { name: 'sans entrées 12-17 UTC', sim: { blockEntryHours: [[12, 17]] } },
    // FILTRE DE RÉGIME (01/08). Deux familles de mesure, testées séparément avant d'être combinées :
    // si l'une seule suffit, on garde la plus simple. Seuils volontairement dans les conventions de
    // place (ADX 20/25, ER 0.25/0.35) plutôt qu'optimisés — un seuil choisi sur la donnée serait
    // exactement le péché que ce fichier existe pour empêcher.
    { name: 'régime ADX ≥ 20', sim: { regime: { adxMin: 20 } } },
    { name: 'régime ADX ≥ 25', sim: { regime: { adxMin: 25 } } },
    { name: 'régime ER ≥ 0.25', sim: { regime: { erMin: 0.25 } } },
    { name: 'régime ER ≥ 0.35', sim: { regime: { erMin: 0.35 } } },
    { name: 'régime ADX ≥ 20 + ER ≥ 0.25', sim: { regime: { adxMin: 20, erMin: 0.25 } } },
    { name: 'régime ADX ≥ 20 + nuit only', sim: { regime: { adxMin: 20 }, blockEntryHours: [[12, 17]] } },
  ];
  // folds : ~15 jours de tune → ~5 jours de test, en roulant (bornes par index de bougie)
  const days = [...new Set(bars.map((b) => dayStr(b.time)))].sort();
  const TUNE = 15, TEST = 5;
  console.log(`\n========== WALK-FORWARD SCALP (S2 base) — ${days.length} jours · tune ${TUNE} → test ${TEST} ==========`);
  console.log('fold  (tune → test)             choisi sur tune            tune $     TEST $   TEST PF');
  let oosTotal = 0, tuneIllusion = 0, folds = 0;
  const oosByCand = new Map<string, number>();
  for (let start = 0; start + TUNE + TEST <= days.length; start += TEST) {
    const tuneDays = new Set(days.slice(start, start + TUNE));
    const testDays = new Set(days.slice(start + TUNE, start + TUNE + TEST));
    const tuneBars = bars.filter((b) => tuneDays.has(dayStr(b.time)));
    const testBars = bars.filter((b) => testDays.has(dayStr(b.time)));
    if (tuneBars.length < 400 || testBars.length < 300) continue;
    let best: { c: Cand; net: number } | null = null;
    for (const c of CANDS) {
      const cfg = { ...cfgFor(profile), ...(c.cfg ?? {}) };
      const m = metrics(backtest(tuneBars, FEATURES, cfg, { ...SIM_BASE, ...(c.sim ?? {}), ctxOpts: ctxFor(profile) }), SIM_BASE.startBalance);
      if (!best || m.netPnl > best.net) best = { c, net: m.netPnl };
    }
    if (!best) continue;
    const cfg = { ...cfgFor(profile), ...(best.c.cfg ?? {}) };
    const t = metrics(backtest(testBars, FEATURES, cfg, { ...SIM_BASE, ...(best.c.sim ?? {}), ctxOpts: ctxFor(profile) }), SIM_BASE.startBalance);
    // OOS par candidat SANS sélection : chaque candidat évalué sur CHAQUE fenêtre test — le vrai classement
    for (const c of CANDS) {
      const tc = metrics(backtest(testBars, FEATURES, { ...cfgFor(profile), ...(c.cfg ?? {}) }, { ...SIM_BASE, ...(c.sim ?? {}), ctxOpts: ctxFor(profile) }), SIM_BASE.startBalance);
      oosByCand.set(c.name, (oosByCand.get(c.name) ?? 0) + tc.netPnl);
    }
    oosTotal += t.netPnl; tuneIllusion += best.net; folds++;
    console.log(
      `#${folds}`.padEnd(5), `(${days[start]}→${days[start + TUNE + TEST - 1]})`.padEnd(26),
      best.c.name.padEnd(26), ('$' + best.net.toFixed(0)).padStart(8), ('$' + t.netPnl.toFixed(0)).padStart(9),
      (t.profitFactor === Infinity ? '∞' : t.profitFactor.toFixed(2)).padStart(8),
    );
  }
  console.log(`\n→ ILLUSION in-sample (somme des tunes gagnants) : $${tuneIllusion.toFixed(0)}`);
  console.log(`→ RÉALITÉ out-of-sample (somme des fenêtres test) : $${oosTotal.toFixed(0)} — c'est CE chiffre qu'on a le droit de croire.`);
  console.log('→ OOS par candidat (somme des fenêtres test, sans sélection) :');
  for (const [name, v] of [...oosByCand.entries()].sort((a, b) => b[1] - a[1])) console.log('   ', name.padEnd(30), '$' + v.toFixed(0));
}

// ===== SWING H1 : variantes d'exit en walk-forward (tune 9 mois → test 3 mois) =====
function swingWF() {
  const ind = computeIndicators(load('XAUUSD-H1-15.json'));
  const bars = ind.bars;
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
  const CANDS: Array<{ name: string; tpAtr: number; exits: Exits }> = [
    { name: 'PROD (TP16 · ladder 2R→.5 · trail 2.5)', tpAtr: 16, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5, ladder: [[2, 0.5]] } },
    { name: 'TP8 · trail 2@2', tpAtr: 8, exits: { be: 1, trailActivate: 2, trailDist: 2 } },
    { name: 'PROD + WE perdants + sans entrée ven 12h', tpAtr: 16, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5, ladder: [[2, 0.5]], weekendFlatLosers: true, noEntryFriFrom: 12 } },
    { name: 'TP8 trail2@2 + WE perdants + ven 12h', tpAtr: 8, exits: { be: 1, trailActivate: 2, trailDist: 2, weekendFlatLosers: true, noEntryFriFrom: 12 } },
  ];
  const N = bars.length, TUNE = Math.floor(N * 0.43), TEST = Math.floor(N * 0.14); // ~9 mois / ~3 mois
  console.log(`\n========== WALK-FORWARD SWING (H1, ${N} bougies) — tune ~9 mois → test ~3 mois ==========`);
  console.log('fold  test window                 choisi sur tune                          TEST $   TEST PF');
  let oos = 0, folds = 0;
  const oosByCand = new Map<string, number>();
  for (let start = 0; start + TUNE + TEST <= N; start += TEST) {
    const tuneBars = bars.slice(start, start + TUNE);
    const testBars = bars.slice(Math.max(0, start + TUNE - 700), start + TUNE + TEST); // 700 barres de warmup réutilisées
    let best: { c: (typeof CANDS)[number]; net: number } | null = null;
    for (const c of CANDS) {
      const m = metrics(labBacktest(computeIndicators(tuneBars), trendDef(c.exits, c.tpAtr), SPECS.XAUUSD), START);
      if (!best || m.netPnl > best.net) best = { c, net: m.netPnl };
    }
    if (!best) continue;
    const t = metrics(labBacktest(computeIndicators(testBars), trendDef(best.c.exits, best.c.tpAtr), SPECS.XAUUSD), START);
    oos += t.netPnl; folds++;
    for (const c of CANDS) {
      const tc = metrics(labBacktest(computeIndicators(testBars), trendDef(c.exits, c.tpAtr), SPECS.XAUUSD), START);
      oosByCand.set(c.name, (oosByCand.get(c.name) ?? 0) + tc.netPnl);
    }
    console.log(`#${folds}`.padEnd(5), `${dayStr(testBars[700]?.time ?? testBars[0].time)}→${dayStr(testBars[testBars.length - 1].time)}`.padEnd(26), best.c.name.padEnd(40), ('$' + t.netPnl.toFixed(0)).padStart(8), (t.profitFactor === Infinity ? '∞' : t.profitFactor.toFixed(2)).padStart(8));
  }
  console.log(`\n→ OOS de la sélection par tune : $${oos.toFixed(0)} sur ${folds} folds`);
  console.log('→ OOS par candidat (somme des fenêtres test, sans sélection) :');
  for (const [name, v] of [...oosByCand.entries()].sort((a, b) => b[1] - a[1])) console.log('   ', name.padEnd(42), '$' + v.toFixed(0));
}

const which = process.argv[2] ?? 'scalp';
if (which === 'swing') swingWF();
else if (which === 'all') { scalpWF(); swingWF(); }
else scalpWF();
console.log('\n[walkforward] terminé — backtest only.');
