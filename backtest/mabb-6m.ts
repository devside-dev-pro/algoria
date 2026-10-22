// L'EA SUR LES 6 DERNIERS MOIS SEULEMENT (22/10/2026) — Mathieu : « arrête de tester sur 2 ans, l'or est monté sans
// arrêt depuis 10 ans, teste sur les 6 derniers mois seulement ».
//
// Six mois, c'est environ 130 jours de bourse et 500 trades : assez pour voir comment l'EA se comporte sur le marché
// d'aujourd'hui, trop peu pour que le meilleur réglage d'une grille ne doive rien à la chance. Donc, comme sur les deux
// ans, on coupe la fenêtre en deux : on CHOISIT sur les 3 premiers mois, on JUGE sur les 3 derniers, puis à l'envers.
// RÈGLE, écrite avant de voir les chiffres : un changement n'entre dans l'EA que s'il fait mieux que le réglage actuel
// sur la moitié qui n'a pas servi à le choisir.
//
//   npx tsx backtest/mabb-6m.ts XAUUSD --months 6        (bougies : node scripts/pull-cache.mjs XAUUSD M5)
import { COST, MIN_TRADES_PER_DAY, START, cell, cut, daysIn, fmt, label, m5, run, spearman, st, sym, type Cfg, type Half, type St } from './mabb-core';

if (START <= 300) { console.error('--months N manquant : ce labo ne regarde que les derniers mois'); process.exit(1); }
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const NAME: Record<'h1' | 'h2', string> = { h1: `${day(m5[START].time)} → ${day(cut)}`, h2: `${day(cut)} → ${day(m5[m5.length - 1].time)}` };

const BASE: Cfg = { fast: 3, slow: 8, trend: 50, adxMin: 20, di: true, rr: 0.5, sl: 3, catchUp: true };
type Res = ReturnType<typeof run>;
type Row = { name: string; c: Cfg; h1: St; h2: St; all: St; res: Res };
const measure = (name: string, c: Cfg): Row => { const res = run(c); return { name, c, h1: st(res, 'h1'), h2: st(res, 'h2'), all: st(res, 'all'), res }; };
const byMonth = (res: Res) => {
  const m = new Map<string, number>();
  for (const t of res.trades) { const k = day(t.openT).slice(0, 7); m.set(k, (m.get(k) ?? 0) + t.pnl); }
  return [...m.entries()].map(([k, v]) => `${k} ${fmt(v)}`).join(' · ');
};
const beats = (c: Cfg, half: Half, net: number) => Array.from({ length: 20 }, (_, k) => st(run(c, { randomDir: true, seed: 11 + 31 * k }), half).net).filter((v) => v < net).length;
function card(r: Row) {
  const sp = st(run(r.c, { randomDir: false, seed: 7, cost: COST + 0.1 }), 'all');
  console.log(`   6 mois : ${cell(r.all)} · win ${Math.round(100 * r.all.win)} % · DD ${fmt(r.all.dd)} $ · bat ${beats(r.c, 'all', r.all.net)}/20 tirages au hasard · avec 0,10 $ de spread en plus : PF ${sp.pf.toFixed(2)}, ${fmt(sp.net)} $`);
  console.log(`   mois par mois : ${byMonth(r.res)}`);
}

console.log(`L'EA SUR LES 6 DERNIERS MOIS — ${sym} · ${day(m5[START].time)} → ${day(m5[m5.length - 1].time)} · 1 lot · coûts ${COST} $/oz`);
console.log(`Moitié de choix / moitié jugée : ${NAME.h1} (${daysIn.h1} jours) et ${NAME.h2} (${daysIn.h2} jours).\n`);

// ===== 1. L'EA tel qu'il est =====
const base = measure('réglage actuel', BASE);
console.log(`── L'EA TEL QU'IL EST (${label(BASE)})`);
console.log(`   ${NAME.h1} : ${cell(base.h1)}`);
console.log(`   ${NAME.h2} : ${cell(base.h2)}`);
card(base);

// ===== 2. La grille des réglages EMA courtes + ADX, RR 0,5 =====
const PAIRS: [number, number][] = [[3, 8], [4, 9], [5, 10], [5, 13], [8, 13], [8, 21], [9, 21]];
const TRENDS = [50, 100, 200];
const ADX: [number, boolean][] = [[0, false], [20, false], [25, false], [30, false], [20, true]];
const SLS = [1, 1.5, 2, 3];
const grid: Row[] = [];
for (const [fast, slow] of PAIRS) for (const trend of TRENDS) for (const [adxMin, di] of ADX) for (const sl of SLS)
  grid.push(measure('', { fast, slow, trend, adxMin, di, rr: 0.5, sl, catchUp: true }));
console.log(`\n── GRILLE : ${grid.length} réglages (EMA courtes, tendance, ADX, stop), RR 0,5 · choix : ≥ ${MIN_TRADES_PER_DAY} trades/jour puis meilleur PF`);
for (const [pick, judge] of [['h1', 'h2'], ['h2', 'h1']] as ['h1' | 'h2', 'h1' | 'h2'][]) {
  const eligible = grid.filter((g) => g[pick].perDay >= MIN_TRADES_PER_DAY).sort((a, b) => b[pick].pf - a[pick].pf);
  console.log(`   choisi sur ${NAME[pick]}, jugé sur ${NAME[judge]} :`);
  for (const g of eligible.slice(0, 5)) console.log(`      ${label(g.c).padEnd(52)} │ choix ${cell(g[pick])} │ JUGÉ ${cell(g[judge])}`);
  console.log(`      réglage actuel de l'EA, même moitié jugée : ${cell(base[judge])}`);
  console.log(`      toute la grille sur la moitié jugée : PF > 1 pour ${grid.filter((g) => g[judge].pf > 1).length}/${grid.length}, PF ≥ 1,2 pour ${grid.filter((g) => g[judge].pf >= 1.2).length}`);
}
console.log(`   Corrélation de rang du PF entre les deux moitiés : ${spearman(grid.map((g) => g.h1.pf), grid.map((g) => g.h2.pf)).toFixed(2)} (0 = la 1re moitié ne dit rien de la 2e).`);

// ===== 3. Les améliorations du réglage actuel, une famille à la fois =====
const FAMILIES: { name: string; variants: [string, Partial<Cfg>][] }[] = [
  { name: 'tendance', variants: [['sans filtre de tendance', { trend: 0 }], ['EMA 200', { trend: 200 }], ['EMA 600 (≈ EMA 50 H1)', { trend: 600 }]] },
  { name: 'TP minimum', variants: [['TP ≥ 4 × coûts', { minTpCost: 4 }], ['TP ≥ 6 × coûts', { minTpCost: 6 }], ['TP ≥ 8 × coûts', { minTpCost: 8 }]] },
  { name: 'fenêtre', variants: [['10 h-20 h', { sess: [10, 20] }], ['9 h-19 h', { sess: [9, 19] }], ['Londres 9 h-17 h', { sess: [9, 17] }], ['New York 15 h-22 h', { sess: [15, 22] }]] },
  { name: 'sortie au temps', variants: [['après 30 min', { maxBars: 6 }], ['après 1 h', { maxBars: 12 }], ['après 1 h 30', { maxBars: 18 }], ['après 2 h', { maxBars: 24 }], ['après 3 h', { maxBars: 36 }], ['après 4 h', { maxBars: 48 }]] },
  { name: 'break-even', variants: [['à mi-TP', { beAt: 0.5 }], ['aux 3/4 du TP', { beAt: 0.75 }]] },
  { name: 'bougie', variants: [['bougie dans le sens du trade', { body: true }]] },
  { name: 'rattrapage', variants: [['dès 11 h', { catchUpHour: 11 }], ['dès 12 h', { catchUpHour: 12 }]] },
  { name: 'stop / RR', variants: [['stop 2 ATR', { sl: 2 }], ['stop 2,5 ATR', { sl: 2.5 }], ['RR 0,4', { rr: 0.4 }], ['RR 0,6', { rr: 0.6 }]] },
];
const rows = FAMILIES.map((f) => ({ f, rs: f.variants.map(([n, p]) => measure(n, { ...BASE, ...p })) }));
console.log(`\n── AMÉLIORATIONS DU RÉGLAGE ACTUEL (une ligne = un seul changement)`);
console.log(`   ${'variante'.padEnd(30)} │ ${NAME.h1.padEnd(50)} │ ${NAME.h2}`);
const line = (r: Row) => `   ${r.name.padEnd(30)} │ ${cell(r.h1)} │ ${cell(r.h2)}`;
console.log(line(base));
for (const { f, rs } of rows) { console.log(`   — ${f.name}`); for (const r of rs) console.log(line(r)); }

const MIN_GAIN = 0.02;
const verdicts: Row[] = [];
for (const [pick, judge] of [['h1', 'h2'], ['h2', 'h1']] as ['h1' | 'h2', 'h1' | 'h2'][]) {
  console.log(`\n── CHOIX SUR ${NAME[pick]}, JUGEMENT SUR ${NAME[judge]} (famille adoptée si sa meilleure variante gagne ≥ ${MIN_GAIN} de PF à ≥ ${MIN_TRADES_PER_DAY} trades/jour)`);
  let combo: Cfg = { ...BASE }; const adopted: string[] = [];
  for (const { f, rs } of rows) {
    const ok = rs.filter((r) => r[pick].perDay >= MIN_TRADES_PER_DAY).sort((a, b) => b[pick].pf - a[pick].pf)[0];
    if (ok && ok[pick].pf >= base[pick].pf + MIN_GAIN) { adopted.push(`${f.name} : ${ok.name} (PF ${base[pick].pf.toFixed(2)} → ${ok[pick].pf.toFixed(2)})`); combo = { ...combo, ...f.variants.find(([n]) => n === ok.name)![1] }; }
  }
  if (!adopted.length) { console.log('   aucune famille ne passe la règle : le réglage actuel reste.'); continue; }
  for (const a of adopted) console.log(`   adoptée · ${a}`);
  const r = measure(`choisi sur ${NAME[pick]}`, combo);
  console.log(`   combinaison, moitié de choix : ${cell(r[pick])}`);
  console.log(`   combinaison, MOITIÉ JUGÉE    : ${cell(r[judge])}  (réglage actuel : ${cell(base[judge])})`);
  console.log(`   → ${r[judge].pf > base[judge].pf ? 'PASSE : mieux que le réglage actuel sur la moitié jugée' : 'ÉCHOUE : pas mieux que le réglage actuel sur la moitié jugée'}`);
  card(r);
  console.log(`   ${JSON.stringify(combo)}`);
  if (r[judge].pf > base[judge].pf) verdicts.push(r);
}

console.log(`\nVerdict : ${verdicts.length ? `${verdicts.length} combinaison(s) passe(nt) la règle sur la moitié jugée.` : 'aucune amélioration ne tient sur la moitié qu’elle n’a pas vue ; le réglage actuel reste.'}`);
console.log('Lecture : seule la moitié jugée compte. Sur 3 mois, un écart de PF de quelques centièmes reste du bruit.');
