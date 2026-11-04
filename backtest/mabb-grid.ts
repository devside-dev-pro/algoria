// GRILLE EMA COURTES + ADX, RR 0,5 (22/10/2026) — la suite de mabb-arena.ts, demandée par Mathieu : « un filtre ADX en
// plus, des EMA plus courtes », et un RR « négatif » de 0,5 : TP = la moitié du stop, pour beaucoup de petits gains.
// RR fixé à 0,5 ; avec un TP court, la largeur du stop compte autant que le ratio : on la fait varier.
//
// LE PIÈGE. Essayer 420 réglages sur les mêmes deux ans et garder le meilleur, c'est trouver le réglage le plus
// chanceux, pas le meilleur. Donc :
//   1. On CHOISIT sur la première année seulement (avant la coupure au milieu de la fenêtre), avec une règle écrite
//      à l'avance : parmi les réglages qui tiennent ≥ 3,5 trades par jour en moyenne, le meilleur PF.
//   2. On JUGE ce choix sur la seconde année, qu'il n'a jamais vue. C'est ce chiffre-là qui compte.
//   3. On refait l'exercice à l'envers (choisir sur la 2e, juger sur la 1re), et on mesure la corrélation de rang
//      entre le PF d'une année et celui de l'autre sur toute la grille : proche de 0, la grille ne sait rien prédire.
//      Attention, les coûts créent à eux seuls de la corrélation (les EMA rapides tradent plus, paient plus, partout).
//   Sur une marche aléatoire, le réglage choisi a encore « battu » ses 10 tirages au hasard (60 sur 60 avec plus de
//   tirages) sur une graine, et pas sur deux autres : le tirage au hasard ne protège pas d'un choix parmi des centaines.
//   Seuls comptent l'année jugée et l'allure de la grille entière sur cette année.
//
// LA RÈGLE (celle de l'EA, M5, bougies closes, entrée à la clôture, une position à la fois) :
//   croisement EMA rapide / lente, clôture du bon côté de l'EMA de tendance, ADX(14) ≥ seuil (iADX de MT5 : DM
//   normalisés par le TR de la bougie, lissage EMA 2/(n+1) — ADX.mq5 de MetaQuotes), option +DI > −DI pour un achat.
//   SL = k × ATR14 (k = 1, 1,5, 2 ou 3), TP = 0,5 × SL. Rattrapage dès 14 h si < 4 trades : même croisement SANS filtre de tendance, avec
//   le filtre ADX. 5 trades par jour broker au plus, session 9 h-22 h, à plat à 23 h, vendredi à 21 h.
// EXÉCUTION (comme mabb-arena.ts) : heure serveur avec l'heure d'été américaine ; position fermée au premier tick d'un
// nouveau jour serveur ; stop ou TP sauté par un trou servi au prix d'ouverture.
// COÛTS 0,32 $/oz l'aller-retour, 1 lot = 100 oz. Avec un TP court, les coûts pèsent lourd : 0,32 $ sur un TP de
// 1,50 $, c'est un cinquième du gain. Et le pire cas (stop servi avant le TP dans une même M5) pèse plus aussi.
//
//   npx tsx backtest/mabb-grid.ts XAUUSD            (bougies : node scripts/pull-cache.mjs XAUUSD M5)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';
import { d1Check, reopenCheck } from './broker-time';
import { COST, MIN_PER_DAY, MIN_TRADES_PER_DAY, T, cell, cut, daysIn, fmt, label, m5, run, spearman, st, sym, type Cfg, type Half, type St } from './mabb-core';

// ===== La grille =====
const PAIRS: [number, number][] = [[3, 8], [4, 9], [5, 10], [5, 13], [8, 13], [8, 21], [9, 21]];
const TRENDS = [50, 100, 200];
const ADX: [number, boolean][] = [[0, false], [20, false], [25, false], [30, false], [20, true]];
const RR = 0.5;
const SLS = [1, 1.5, 2, 3];
const grid: { c: Cfg; h1: St; h2: St; all: St }[] = [];
for (const [fast, slow] of PAIRS) for (const trend of TRENDS) for (const [adxMin, di] of ADX) for (const sl of SLS) {
  const c: Cfg = { fast, slow, trend, adxMin, di, rr: RR, sl, catchUp: true };
  const res = run(c);
  grid.push({ c, h1: st(res, 'h1'), h2: st(res, 'h2'), all: st(res, 'all') });
}
console.log(`GRILLE EMA COURTES + ADX + RR — ${sym} · ${m5.length} bougies M5 · ${new Date(m5[0].time).toISOString().slice(0, 10)} → ${new Date(m5[m5.length - 1].time).toISOString().slice(0, 10)} · coupure ${new Date(cut).toISOString().slice(0, 10)} · ${daysIn.h1} + ${daysIn.h2} jours · 1 lot · coûts ${COST} $/oz`);
console.log(`Reprises après un trou (heure serveur) : ${reopenCheck(m5, T)}.`);
console.log(`Horloge serveur contre les D1 du broker : ${existsSync(`backtest/.cache/${sym}-D1-15.json`) ? d1Check(JSON.parse(readFileSync(`backtest/.cache/${sym}-D1-15.json`, 'utf8')) as Bar[]) : `D1 absentes → node scripts/pull-cache.mjs ${sym} D1`}.`);
console.log(`${grid.length} réglages. Règle de choix écrite à l'avance : ≥ ${MIN_TRADES_PER_DAY} trades/jour sur l'année de choix, puis meilleur PF.`);

{ const res = run({ fast: 9, slow: 21, trend: 200, adxMin: 0, di: false, rr: 2, sl: 1.5, catchUp: true });
  console.log(`\nRéférence = EA actuel (EMA 9/21/200, sans ADX, SL 1,5 ATR, RR 2), hors grille :\n   1re année ${cell(st(res, 'h1'))}\n   2e année  ${cell(st(res, 'h2'))}`); }

for (const [pick, judge, name] of [['h1', 'h2', 'CHOISI SUR LA 1re ANNÉE, JUGÉ SUR LA 2e'], ['h2', 'h1', 'À L’ENVERS : CHOISI SUR LA 2e, JUGÉ SUR LA 1re']] as [Half, Half, string][]) {
  const eligible = grid.filter((g) => g[pick].perDay >= MIN_TRADES_PER_DAY).sort((a, b) => b[pick].pf - a[pick].pf);
  console.log(`\n── ${name} (${eligible.length} réglages assez fréquents)`);
  console.log(`   ${'réglage'.padEnd(54)} │ année de choix${' '.repeat(38)}│ année jugée`);
  for (const g of eligible.slice(0, 10)) console.log(`   ${label(g.c).padEnd(54)} │ ${cell(g[pick])} │ ${cell(g[judge])}`);
  const best = eligible[0];
  if (best) {
    const nets = Array.from({ length: 10 }, (_, k) => st(run(best.c, { randomDir: true, seed: 11 + 31 * k }), judge).net);
    console.log(`   → choix : ${label(best.c)} — année jugée ${cell(best[judge])} · DD ${fmt(best[judge].dd)} $ · bat ${nets.filter((v) => v < best[judge].net).length}/10 tirages au hasard`);
    const res = run(best.c), all = st(res, 'all');
    const allNets = Array.from({ length: 20 }, (_, k) => st(run(best.c, { randomDir: true, seed: 11 + 31 * k }), 'all').net);
    console.log(`     sur 2 ans : ${cell(all)} · win ${Math.round(100 * all.win)} % · DD ${fmt(all.dd)} $ · depuis le 1er juin 2026 ${fmt(res.trades.filter((t) => t.openT >= Date.UTC(2026, 5, 1)).reduce((a, t) => a + t.pnl, 0))} $ · bat ${allNets.filter((v) => v < all.net).length}/20 tirages`);
  }
  const pfs = (g: (typeof grid)[number]) => g[judge].pf;
  console.log(`   Sur l'année jugée, toute la grille : PF > 1 pour ${grid.filter((g) => pfs(g) > 1).length}/${grid.length}, PF ≥ 1,2 pour ${grid.filter((g) => pfs(g) >= 1.2).length}, PF ≥ 1,5 pour ${grid.filter((g) => pfs(g) >= 1.5).length} (dont ${grid.filter((g) => pfs(g) >= 1.5 && g[judge].perDay >= MIN_TRADES_PER_DAY).length} à ≥ ${MIN_TRADES_PER_DAY} tr/j).`);
}
console.log(`\nCorrélation de rang du PF entre les deux années, sur les ${grid.length} réglages : ${spearman(grid.map((g) => g.h1.pf), grid.map((g) => g.h2.pf)).toFixed(2)} (0 = la 1re année ne dit rien de la 2e).`);

// ===== Effet moyen de chaque choix, toutes autres choses égales (moyenne du PF sur les deux années séparément) =====
console.log('\n── EFFET MOYEN DE CHAQUE CHOIX (PF moyen sur la grille : 1re année / 2e année · trades/jour)');
type G = (typeof grid)[number];
const avg = (xs: G[], f: (g: G) => number) => xs.reduce((a, g) => a + f(g), 0) / xs.length;
const effect = (name: string, groups: [string, (g: G) => boolean][]) => {
  console.log(`   ${name}`);
  for (const [k, pred] of groups) { const xs = grid.filter(pred); console.log(`      ${k.padEnd(14)} ${avg(xs, (g) => g.h1.pf).toFixed(3)} / ${avg(xs, (g) => g.h2.pf).toFixed(3)} · ${avg(xs, (g) => g.all.perDay).toFixed(1)} tr/j`); }
};
effect('EMA rapide / lente', PAIRS.map(([f, s]): [string, (g: G) => boolean] => [`${f}/${s}`, (g) => g.c.fast === f && g.c.slow === s]));
effect('EMA de tendance', TRENDS.map((t): [string, (g: G) => boolean] => [`${t}`, (g) => g.c.trend === t]));
effect('filtre ADX', ADX.map(([a, d]): [string, (g: G) => boolean] => [a ? `≥${a}${d ? '+DI' : ''}` : 'off', (g) => g.c.adxMin === a && g.c.di === d]));
effect('stop (× ATR), TP = moitié du stop', SLS.map((k): [string, (g: G) => boolean] => [`${k}`, (g) => g.c.sl === k]));
// ===== Les réglages demandés (EMA courtes, avec ou sans ADX, RR 0,5), écrits AVANT de voir la grille, face à l'EA actuel
console.log('\n── RÉGLAGES DEMANDÉS FACE À L’EA ACTUEL (2 ans · PF 1re / 2e année · depuis le 1er juin 2026 · hasard sur 20 tirages)');
const since = (res: ReturnType<typeof run>) => res.trades.filter((t) => t.openT >= Date.UTC(2026, 5, 1)).reduce((a, t) => a + t.pnl, 0);
const CANDIDATES: Cfg[] = [
  { fast: 9, slow: 21, trend: 200, adxMin: 0, di: false, rr: 2, sl: 1.5, catchUp: true }, // EA actuel
  { fast: 5, slow: 13, trend: 200, adxMin: 0, di: false, rr: 2, sl: 1.5, catchUp: true },
];
for (const [fast, slow] of [[9, 21], [5, 13], [3, 8]] as [number, number][])
  for (const adxMin of [0, 20])
    for (const sl of [1.5, 2, 3]) CANDIDATES.push({ fast, slow, trend: 200, adxMin, di: false, rr: 0.5, sl, catchUp: true });
for (const c of CANDIDATES) {
  const res = run(c), all = st(res, 'all');
  const nets = Array.from({ length: 20 }, (_, k) => st(run(c, { randomDir: true, seed: 11 + 31 * k }), 'all').net);
  console.log(`   ${label(c).padEnd(50)} │ ${cell(all)} · win ${Math.round(100 * all.win)} % · DD ${fmt(all.dd).padStart(8)} $ │ PF ${st(res, 'h1').pf.toFixed(2)} / ${st(res, 'h2').pf.toFixed(2)} │ juin→ ${fmt(since(res)).padStart(8)} $ │ bat ${nets.filter((v) => v < all.net).length}/20`);
}

// ===== Le réglage par défaut de l'EA, et ses voisins : un réglage qui ne tient qu'à lui-même n'en est pas un =====
console.log('\n── RÉGLAGE PAR DÉFAUT DE L’EA ET SES VOISINS (2 ans · PF 1re / 2e année · hasard sur 20 tirages ; une ligne = un seul changement)');
const DEF: Cfg = { fast: 3, slow: 8, trend: 50, adxMin: 20, di: true, rr: 0.5, sl: 3, catchUp: true };
const NEIGHBOURS: [string, Cfg, number?][] = [
  ['défaut de l’EA', DEF], ['spread 0,30 $ (coûts 0,42)', DEF, 0.42], ['spread 0,40 $ (coûts 0,52)', DEF, 0.52],
  ['sans rattrapage', { ...DEF, catchUp: false }], ['RR 0,4', { ...DEF, rr: 0.4 }], ['RR 0,6', { ...DEF, rr: 0.6 }],
  ['stop 2,5 ATR', { ...DEF, sl: 2.5 }], ['tendance EMA 200', { ...DEF, trend: 200 }], ['ADX ≥ 20 sans DI', { ...DEF, di: false }],
  ['EMA 4/9', { ...DEF, fast: 4, slow: 9 }],
];
for (const [name, c, cost] of NEIGHBOURS) {
  const res = run(c, { randomDir: false, seed: 7, cost }), all = st(res, 'all');
  const nets = Array.from({ length: 20 }, (_, k) => st(run(c, { randomDir: true, seed: 11 + 31 * k, cost }), 'all').net);
  console.log(`   ${name.padEnd(28)} │ ${cell(all)} · win ${Math.round(100 * all.win)} % · DD ${fmt(all.dd).padStart(8)} $ │ PF ${st(res, 'h1').pf.toFixed(2)} / ${st(res, 'h2').pf.toFixed(2)} │ juin→ ${fmt(since(res)).padStart(8)} $ │ bat ${nets.filter((v) => v < all.net).length}/20`);
}

console.log('\nLecture : seul le chiffre de l’année jugée compte. Un réglage brillant l’année de choix et quelconque l’année jugée a été trouvé par chance.');
