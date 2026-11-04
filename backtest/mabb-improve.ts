// AMÉLIORER L'EA SANS SE MENTIR (22/10/2026) — Mathieu : « on doit encore l'améliorer ».
//
// Point de départ : le réglage par défaut de mql5/Experts/Algoria_XAU_MABB (EMA 3/8 + EMA 50, ADX ≥ 20 avec DI, stop
// 3 ATR, RR 0,5, rattrapage dès 14 h), choisi par mabb-grid.ts : PF 0,95 la 1re année, 1,05 la 2e.
//
// Sept familles d'améliorations, écrites AVANT de voir le moindre résultat, chacune avec 1 à 4 variantes :
//   tendance (aucune, EMA 200, EMA 600 ≈ EMA 50 en H1) · TP minimum face aux coûts (4, 6, 8 fois) · fenêtre d'entrée ·
//   sortie au temps (30 min, 1 h, 2 h) · break-even (à mi-TP, aux trois quarts) · bougie du croisement dans le sens du
//   trade · heure de rattrapage (11 h, 12 h).
// RÈGLE DE DÉCISION, écrite elle aussi avant : sur l'année de choix seulement, une famille est adoptée si sa meilleure
// variante gagne au moins 0,02 de PF sur le réglage de départ en gardant ≥ 3,5 trades par jour. Les familles adoptées
// sont combinées, et la combinaison est jugée sur l'autre année. On le fait dans les deux sens. Une amélioration qui
// ne tient pas sur l'année jugée n'en est pas une.
//
//   npx tsx backtest/mabb-improve.ts XAUUSD          (bougies : node scripts/pull-cache.mjs XAUUSD M5)
import { COST, MIN_TRADES_PER_DAY, cell, daysIn, fmt, run, st, sym, m5, type Cfg, type Half, type St } from './mabb-core';

const BASE: Cfg = { fast: 3, slow: 8, trend: 50, adxMin: 20, di: true, rr: 0.5, sl: 3, catchUp: true };
const FAMILIES: { name: string; variants: [string, Partial<Cfg>][] }[] = [
  { name: 'tendance', variants: [['sans filtre de tendance', { trend: 0 }], ['EMA 200', { trend: 200 }], ['EMA 600 (≈ EMA 50 H1)', { trend: 600 }]] },
  { name: 'TP minimum', variants: [['TP ≥ 4 × coûts', { minTpCost: 4 }], ['TP ≥ 6 × coûts', { minTpCost: 6 }], ['TP ≥ 8 × coûts', { minTpCost: 8 }]] },
  { name: 'fenêtre', variants: [['10 h-20 h', { sess: [10, 20] }], ['9 h-19 h', { sess: [9, 19] }], ['Londres 9 h-17 h', { sess: [9, 17] }], ['New York 15 h-22 h', { sess: [15, 22] }]] },
  { name: 'sortie au temps', variants: [['après 30 min', { maxBars: 6 }], ['après 1 h', { maxBars: 12 }], ['après 2 h', { maxBars: 24 }]] },
  { name: 'break-even', variants: [['à mi-TP', { beAt: 0.5 }], ['aux 3/4 du TP', { beAt: 0.75 }]] },
  { name: 'bougie', variants: [['bougie dans le sens du trade', { body: true }]] },
  { name: 'rattrapage', variants: [['dès 11 h', { catchUpHour: 11 }], ['dès 12 h', { catchUpHour: 12 }]] },
];
const MIN_GAIN = 0.02;

type Row = { name: string; c: Cfg; h1: St; h2: St; all: St };
const measure = (name: string, c: Cfg): Row => { const r = run(c); return { name, c, h1: st(r, 'h1'), h2: st(r, 'h2'), all: st(r, 'all') }; };
const base = measure('réglage actuel', BASE);
const rows = FAMILIES.map((f) => ({ f, rs: f.variants.map(([n, p]) => measure(n, { ...BASE, ...p })) }));

console.log(`AMÉLIORATIONS DE L'EA — ${sym} · ${m5.length} bougies M5 · ${daysIn.h1} + ${daysIn.h2} jours · 1 lot · coûts ${COST} $/oz`);
console.log(`Règle : sur l'année de choix, famille adoptée si sa meilleure variante gagne ≥ ${MIN_GAIN} de PF et garde ≥ ${MIN_TRADES_PER_DAY} trades/jour ; combinaison jugée sur l'autre année.\n`);
console.log(`   ${'variante'.padEnd(34)} │ 1re année${' '.repeat(43)}│ 2e année`);
const line = (r: Row) => `   ${r.name.padEnd(34)} │ ${cell(r.h1)} │ ${cell(r.h2)}`;
console.log(line(base));
for (const { f, rs } of rows) { console.log(`   — ${f.name}`); for (const r of rs) console.log(line(r)); }

function protocol(pick: Half, judge: Half, title: string) {
  console.log(`\n── ${title}`);
  let combo: Cfg = { ...BASE }; const adopted: string[] = [];
  for (const { f, rs } of rows) {
    const ok = rs.filter((r) => r[pick].perDay >= MIN_TRADES_PER_DAY).sort((a, b) => b[pick].pf - a[pick].pf)[0];
    if (ok && ok[pick].pf >= base[pick].pf + MIN_GAIN) { adopted.push(`${f.name} : ${ok.name} (PF ${base[pick].pf.toFixed(2)} → ${ok[pick].pf.toFixed(2)})`); combo = { ...combo, ...f.variants.find(([n]) => n === ok.name)![1] }; }
  }
  if (!adopted.length) { console.log('   aucune famille ne passe la règle : le réglage actuel reste.'); return null; }
  for (const a of adopted) console.log(`   adoptée · ${a}`);
  const res = run(combo), r: Row = { name: 'combinaison', c: combo, h1: st(res, 'h1'), h2: st(res, 'h2'), all: st(res, 'all') };
  console.log(`   combinaison, année de choix : ${cell(r[pick])}`);
  console.log(`   combinaison, ANNÉE JUGÉE    : ${cell(r[judge])}  (réglage actuel : ${cell(base[judge])})`);
  const nets = Array.from({ length: 20 }, (_, k) => st(run(combo, { randomDir: true, seed: 11 + 31 * k }), 'all').net);
  const sp = st(run(combo, { randomDir: false, seed: 7, cost: COST + 0.1 }), 'all');
  const since = res.trades.filter((t) => t.openT >= Date.UTC(2026, 5, 1)).reduce((a, t) => a + t.pnl, 0);
  console.log(`   combinaison, 2 ans : ${cell(r.all)} · win ${Math.round(100 * r.all.win)} % · DD ${fmt(r.all.dd)} $ · depuis le 1er juin 2026 ${fmt(since)} $ · bat ${nets.filter((v) => v < r.all.net).length}/20 tirages · avec 0,10 $ de spread en plus : PF ${sp.pf.toFixed(2)}, ${fmt(sp.net)} $`);
  console.log(`   ${JSON.stringify(combo)}`);
  return r;
}
protocol('h1', 'h2', 'CHOIX SUR LA 1re ANNÉE, JUGEMENT SUR LA 2e');
protocol('h2', 'h1', 'À L’ENVERS : CHOIX SUR LA 2e ANNÉE, JUGEMENT SUR LA 1re');
// La sortie au temps de 2 h est la seule variante qui fait mieux les deux années, sans passer la règle. Un vrai effet
// donne un plateau sur toute une plage de durées ; un pic isolé à 2 h serait du bruit. Courbe complète, sans choix.
console.log('\n── SORTIE AU TEMPS, COURBE COMPLÈTE (aucun choix fait ici : on regarde si 2 h est un plateau ou un pic)');
for (const bars of [18, 24, 30, 36, 48, 60, 72, 96]) {
  const r = measure(`après ${bars * 5} min`, { ...BASE, maxBars: bars });
  console.log(`${line(r)} │ 2 ans ${fmt(r.all.net)} $ · DD ${fmt(r.all.dd)} $`);
}
console.log(`${line(base)} │ 2 ans ${fmt(base.all.net)} $ · DD ${fmt(base.all.dd)} $  (sans sortie au temps)`);

console.log(`\nRéglage actuel, 2 ans : ${cell(base.all)} · win ${Math.round(100 * base.all.win)} % · DD ${fmt(base.all.dd)} $`);
console.log('Lecture : une famille adoptée sur une année et qui n’améliore pas l’autre a été trouvée par chance.');
