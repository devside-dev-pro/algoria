import { readFileSync } from 'node:fs';
// WALK-FORWARD — le vaccin contre l'overfitting (étude 28/07). Le péché originel des configs actuelles :
// chaque paramètre a été choisi PARCE QU'il embellissait la fenêtre juin-juillet (le « net » des commentaires
// grimpe +9k → +23k sur la MÊME fenêtre). Ici : on règle sur la fenêtre A (tune), on évalue UNIQUEMENT sur
// la fenêtre B suivante (test, jamais vue), et on roule. La somme des fenêtres TEST est la seule performance
// qu'on a le droit de croire. RÈGLE D'OR : aucun changement de config ne passe en live s'il ne bat pas la
// prod sur les fenêtres test.
//   npx tsx backtest/walkforward.ts            → scalp M5 (S2 par défaut, grille de configs)
//   npx tsx backtest/walkforward.ts breakout   → breakout M5 (variantes + filtres de régime)
//   npx tsx backtest/walkforward.ts swing      → swing H1 (variantes d'exit)
//   npx tsx backtest/walkforward.ts all        → les trois
import { backtest, type SimParams } from './simulator';
import { metrics } from './metrics';
import { FEATURES } from '../lib/engine/features';
import { STRATEGIES } from '../lib/engine/strategies';
import { computeIndicators, labBacktest, SPECS, START, type Exits, type StrategyDef } from './labcore';
import { cfgFor, ctxFor, simFor, SIM_BASE } from './wiring';
import { simBreakout, BK_COSTS, BK_START, type BkOpts } from './breakout-core';
import { GOLD_BREAKOUT, type BreakoutConfig } from '../lib/engine/breakout';
import type { EngineConfig } from '../lib/engine/config';
import type { Bar } from '../lib/engine/types';

const load = (f: string): Bar[] => JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8'));
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

// ===== SCALP M5 : grille de configs candidates (S2 comme base) =====
function scalpWF() {
  const bars = load('XAUUSD-M5-15.json');
  const profile = STRATEGIES['2'];
  // `profile` par candidat : sans ça, on ne testait que des BOUTS de S1 (RR + trailing) sur le châssis de S2,
  // en laissant de côté ce qui la définit — objectif du jour à +1 %, Asie coupée, plafond de stop par défaut.
  // « Façon S1 » n'était pas S1. Ici on peut enfin faire tourner le profil ENTIER, tel qu'il tourne en live.
  type Cand = { name: string; profile?: typeof profile; cfg?: Partial<EngineConfig>; sim?: Partial<SimParams> };
  const CANDS: Cand[] = [
    { name: 'PROD S2 (filtre 12-17 inclus)' },
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
    // POURQUOI S1 TIENT (01/08) — S1 fait +$308 en live sur 11 jours quand le scalp S2 fait −$7 098, avec le
    // MÊME générateur de signaux. La différence est entièrement dans le profil. On teste donc le profil
    // ENTIER, puis chaque différence isolée : si une seule d'entre elles porte le résultat, on veut savoir
    // laquelle — une config qu'on ne comprend pas est une config qu'on ne saura pas défendre le jour où
    // elle cassera.
    // NUIT vs JOUR (01/08, forensique sur les 358 trades scalp de juillet en base) :
    //   NUIT 19h-05h : 95 trades, +$10 411, 92 % de reussite
    //   JOUR 05h-19h : 263 trades, −$19 560, 74 %
    // La perte MOYENNE est la meme des deux cotes (−$726 vs −$751) : le jour ne perd pas plus gros, il
    // perd bien plus souvent. Le filtre actuel ne bloque que 12-17h — un tiers du jour perdant.
    // On ne teste PAS heure par heure (ce serait du sur-mesure sur un mois) : une seule frontiere de
    // session, deplacee de 2 h autour, pour verifier que le resultat ne tient pas a un reglage fin.
    { name: 'nuit seule 19h-05h', sim: { blockEntryHours: [[5, 19]] } },
    { name: 'nuit large 18h-06h', sim: { blockEntryHours: [[6, 18]] } },
    { name: 'nuit stricte 20h-04h', sim: { blockEntryHours: [[4, 20]] } },
    // GEOMETRIE (meme forensique) : gain moyen +$167, perte moyenne −$749 — une perte efface 4,5 gains.
    // Les 10 pires trades pesent −$12 179, soit PLUS que la perte du mois (−$9 149) : sans eux, +$3 030.
    // Tous sortent au stop avec une distance de 9,5 a 15 $/once, soit $950-1 500 de risque. maxStopAtr 2.8
    // ne les arrete pas. On serre le plafond — en sachant que trop serrer tue l'edge (deja vu le 22/07).
    { name: 'stop max 2.0 ATR', cfg: { maxStopAtr: 2.0 } },
    { name: 'stop max 1.5 ATR', cfg: { maxStopAtr: 1.5 } },
    { name: 'nuit 19h-05h + stop max 2.0', cfg: { maxStopAtr: 2.0 }, sim: { blockEntryHours: [[5, 19]] } },
    { name: 'PROFIL S1 COMPLET', profile: STRATEGIES['1'] },
    { name: 'PROFIL S1 + nuit 19h-05h', profile: STRATEGIES['1'], sim: { blockEntryHours: [[5, 19]] } },
    { name: 'S2 + objectif jour +1%', cfg: { risk: { ...cfgFor(profile).risk, dailyProfitTargetPct: 0.01 } } },
    { name: 'S2 sans Asie', sim: {} }, // ctxOpts remplacé plus bas (tradeAsia piloté par le profil)
    { name: 'S2 + TP court 0.4R', cfg: { targetRR: 0.4, minRR: 0.2 } },
  ];
  // « S2 sans Asie » = même config moteur, contexte de S1 : c'est le seul candidat dont la différence vit
  // dans ctxOpts et pas dans la config — on l'aiguille ici plutôt que d'ajouter un champ pour un seul cas.
  const ctxOf = (c: Cand) => (c.name === 'S2 sans Asie' ? { ...ctxFor(profile), tradeAsia: false } : ctxFor(c.profile ?? profile));
  // folds : ~15 jours de tune → ~5 jours de test, en roulant (bornes par index de bougie)
  const days = [...new Set(bars.map((b) => dayStr(b.time)))].sort();
  const TUNE = 15, TEST = 5;
  console.log(`\n========== WALK-FORWARD SCALP (S2 base) — ${days.length} jours · tune ${TUNE} → test ${TEST} ==========`);
  console.log('fold  (tune → test)             choisi sur tune            tune $     TEST $   TEST PF');
  let oosTotal = 0, tuneIllusion = 0, folds = 0;
  const oosByCand = new Map<string, { pnl: number; n: number }>();
  for (let start = 0; start + TUNE + TEST <= days.length; start += TEST) {
    const tuneDays = new Set(days.slice(start, start + TUNE));
    const testDays = new Set(days.slice(start + TUNE, start + TUNE + TEST));
    const tuneBars = bars.filter((b) => tuneDays.has(dayStr(b.time)));
    const testBars = bars.filter((b) => testDays.has(dayStr(b.time)));
    if (tuneBars.length < 400 || testBars.length < 300) continue;
    let best: { c: Cand; net: number } | null = null;
    for (const c of CANDS) {
      const cfg = { ...cfgFor(c.profile ?? profile), ...(c.cfg ?? {}) };
      const m = metrics(backtest(tuneBars, FEATURES, cfg, { ...simFor(c.profile ?? profile), ...(c.sim ?? {}), ctxOpts: ctxOf(c) }), SIM_BASE.startBalance);
      if (!best || m.netPnl > best.net) best = { c, net: m.netPnl };
    }
    if (!best) continue;
    const cfg = { ...cfgFor(best.c.profile ?? profile), ...(best.c.cfg ?? {}) };
    const t = metrics(backtest(testBars, FEATURES, cfg, { ...simFor(best.c.profile ?? profile), ...(best.c.sim ?? {}), ctxOpts: ctxOf(best.c) }), SIM_BASE.startBalance);
    // OOS par candidat SANS sélection : chaque candidat évalué sur CHAQUE fenêtre test — le vrai classement
    for (const c of CANDS) {
      const tc = metrics(backtest(testBars, FEATURES, { ...cfgFor(c.profile ?? profile), ...(c.cfg ?? {}) }, { ...simFor(c.profile ?? profile), ...(c.sim ?? {}), ctxOpts: ctxOf(c) }), SIM_BASE.startBalance);
      const cur = oosByCand.get(c.name) ?? { pnl: 0, n: 0 };
      cur.pnl += tc.netPnl; cur.n += tc.trades;
      oosByCand.set(c.name, cur);
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
  console.log('→ OOS par candidat (somme des fenêtres test, sans sélection) — le nb de trades compte autant :');
  for (const [name, v] of [...oosByCand.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
    console.log('   ', name.padEnd(30), ('$' + v.pnl.toFixed(0)).padStart(9), String(v.n).padStart(6), 'trades');
  }
}

// ===== BREAKOUT M5 : la couche qui n'avait aucun walk-forward (01/08) =====
// Ses chiffres étaient TOUS in-sample, y compris le filtre de régime qui semblait prometteur (ADX ≥ 25 :
// espérance doublée, deux mois sur deux). « Semblait » est le mot : un résultat in-sample sur une couche
// dont la config a déjà été re-réglée in-sample une fois n'est pas une preuve, c'est une répétition du
// même péché. Ici on règle sur la fenêtre A et on n'évalue que sur la B, jamais vue.
// Gestion INTRA-BOUGIE partout : depuis le 01/08 le sim déplace le stop comme le live (à la seconde).
function breakoutWF() {
  const bars = load('XAUUSD-M5-15.json');
  type Cand = { name: string; cfg?: Partial<BreakoutConfig>; opts?: BkOpts };
  const CANDS: Cand[] = [
    { name: 'PROD' },
    { name: 'ANCIENNE (BE .8 · trail 1.2@1.2)', cfg: { beTrigger: 0.8, trailActivate: 1.2, trailDist: 1.2 } },
    { name: 'sans BE ni trailing', cfg: { beTrigger: 0, trailActivate: 0, trailDist: 0 } },
    { name: 'N48 (canal 4h)', cfg: { N: 48 } },
    { name: 'N192 (canal 16h)', cfg: { N: 192 } },
    { name: 'régime ADX ≥ 20', opts: { regime: { adxMin: 20 } } },
    { name: 'régime ADX ≥ 25', opts: { regime: { adxMin: 25 } } },
    { name: 'régime ER ≥ 0.25', opts: { regime: { erMin: 0.25 } } },
    { name: 'régime ER ≥ 0.35', opts: { regime: { erMin: 0.35 } } },
    { name: 'régime ADX ≥ 25 + ER ≥ 0.25', opts: { regime: { adxMin: 25, erMin: 0.25 } } },
    { name: 'pas d\'entrée ven ≥ 12h UTC', opts: { noEntryFriFrom: 12 } },
  ];
  const run = (bs: Bar[], c: Cand) => metrics(simBreakout(bs, { ...GOLD_BREAKOUT, ...(c.cfg ?? {}) }, BK_COSTS, { intrabarManage: true, ...(c.opts ?? {}) }), BK_START);
  const days = [...new Set(bars.map((b) => dayStr(b.time)))].sort();
  const TUNE = 15, TEST = 5;
  console.log(`\n========== WALK-FORWARD BREAKOUT (M5) — ${days.length} jours · tune ${TUNE} → test ${TEST} ==========`);
  console.log('fold  (tune → test)             choisi sur tune            tune $     TEST $   TEST n');
  let oosTotal = 0, tuneIllusion = 0, folds = 0;
  const oosByCand = new Map<string, { pnl: number; n: number }>();
  for (let start = 0; start + TUNE + TEST <= days.length; start += TEST) {
    const tuneDays = new Set(days.slice(start, start + TUNE));
    const testDays = new Set(days.slice(start + TUNE, start + TUNE + TEST));
    // le canal Donchian a besoin de N=96 bougies d'amorce : sans ce préfixe, chaque fenêtre démarrerait
    // aveugle et le premier tiers des jours ne produirait aucun signal (biais silencieux contre le test).
    const tuneBars = bars.filter((b) => tuneDays.has(dayStr(b.time)));
    const testBars = bars.filter((b) => testDays.has(dayStr(b.time)));
    if (tuneBars.length < 400 || testBars.length < 300) continue;
    let best: { c: Cand; net: number } | null = null;
    for (const c of CANDS) {
      const m = run(tuneBars, c);
      if (!best || m.netPnl > best.net) best = { c, net: m.netPnl };
    }
    if (!best) continue;
    const t = run(testBars, best.c);
    for (const c of CANDS) {
      const tc = run(testBars, c);
      const cur = oosByCand.get(c.name) ?? { pnl: 0, n: 0 };
      cur.pnl += tc.netPnl; cur.n += tc.trades;
      oosByCand.set(c.name, cur);
    }
    oosTotal += t.netPnl; tuneIllusion += best.net; folds++;
    console.log(
      `#${folds}`.padEnd(5), `(${days[start]}→${days[start + TUNE + TEST - 1]})`.padEnd(26),
      best.c.name.padEnd(26), ('$' + best.net.toFixed(0)).padStart(8), ('$' + t.netPnl.toFixed(0)).padStart(9), String(t.trades).padStart(7),
    );
  }
  console.log(`\n→ ILLUSION in-sample (somme des tunes gagnants) : $${tuneIllusion.toFixed(0)}`);
  console.log(`→ RÉALITÉ out-of-sample (somme des fenêtres test) : $${oosTotal.toFixed(0)}`);
  console.log('→ OOS par candidat (somme des fenêtres test, sans sélection) — le nb de trades compte autant :');
  for (const [name, v] of [...oosByCand.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
    console.log('   ', name.padEnd(30), ('$' + v.pnl.toFixed(0)).padStart(9), String(v.n).padStart(6), 'trades');
  }
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
else if (which === 'breakout') breakoutWF();
else if (which === 'all') { scalpWF(); breakoutWF(); swingWF(); }
else scalpWF();
console.log('\n[walkforward] terminé — backtest only.');
