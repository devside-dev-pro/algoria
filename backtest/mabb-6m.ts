// L'EA SUR LES 6 DERNIERS MOIS SEULEMENT (22/10/2026) — Mathieu : « arrête de tester sur 2 ans, l'or est monté sans
// arrêt depuis 10 ans, teste sur les 6 derniers mois seulement ».
//
// Six mois, c'est environ 130 jours de bourse et 500 trades : assez pour voir comment l'EA se comporte sur le marché
// d'aujourd'hui, trop peu pour que le meilleur réglage d'une grille ne doive rien à la chance. Donc, comme sur les deux
// ans, on coupe la fenêtre en deux : on CHOISIT sur les 3 premiers mois, on JUGE sur les 3 derniers, puis à l'envers.
// RÈGLE, écrite avant de voir les chiffres : un changement n'entre dans l'EA que s'il fait mieux que le réglage actuel
// (la v1.10, BASE ci-dessous) sur la moitié qui n'a pas servi à le choisir.
//
//   npx tsx backtest/mabb-6m.ts XAUUSD --months 6        (bougies : node scripts/pull-cache.mjs XAUUSD M5)
import { CAPITAL, COST, MIN_TRADES_PER_DAY, START, T, cell, cutDay, daysIn, fmt, label, m5, run, spearman, st, sym, type Cfg, type Half, type St } from './mabb-core';

if (START <= 300) { console.error('--months N manquant : ce labo ne regarde que les derniers mois'); process.exit(1); }
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const serverDay = (d: number) => day(d * 86_400_000); // T.openDay → date du jour serveur
const NAME: Record<'h1' | 'h2', string> = { h1: `${serverDay(T.openDay[START])} → ${serverDay(cutDay - 1)}`, h2: `${serverDay(cutDay)} → ${serverDay(T.openDay[m5.length - 1])}` };

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

console.log(`L'EA SUR LES 6 DERNIERS MOIS — ${sym} · jours serveur ${serverDay(T.openDay[START])} → ${serverDay(T.openDay[m5.length - 1])} · 1 lot · coûts ${COST} $/oz`);
console.log(`Moitié de choix / moitié jugée : ${NAME.h1} (${daysIn.h1} jours) et ${NAME.h2} (${daysIn.h2} jours).\n`);

// ===== 1. L'EA tel qu'il est =====
const base = measure('v1.10', BASE);
console.log(`── L'EA v1.10 TEL QU'IL ÉTAIT (${label(BASE)})`);
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
  console.log(`      v1.10, même moitié jugée : ${cell(base[judge])}`);
  console.log(`      toute la grille sur la moitié jugée : PF > 1 pour ${grid.filter((g) => g[judge].pf > 1).length}/${grid.length}, PF ≥ 1,2 pour ${grid.filter((g) => g[judge].pf >= 1.2).length}`);
}
console.log(`   Corrélation de rang du PF entre les deux moitiés : ${spearman(grid.map((g) => g.h1.pf), grid.map((g) => g.h2.pf)).toFixed(2)} (0 = la 1re moitié ne dit rien de la 2e).`);

// ===== 3. Les améliorations de la v1.10, une famille à la fois =====
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
console.log(`\n── AMÉLIORATIONS DE LA v1.10 (une ligne = un seul changement)`);
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
  if (!adopted.length) { console.log('   aucune famille ne passe la règle : la v1.10 reste.'); continue; }
  for (const a of adopted) console.log(`   adoptée · ${a}`);
  const r = measure(`choisi sur ${NAME[pick]}`, combo);
  console.log(`   combinaison, moitié de choix : ${cell(r[pick])}`);
  console.log(`   combinaison, MOITIÉ JUGÉE    : ${cell(r[judge])}  (v1.10 : ${cell(base[judge])})`);
  console.log(`   → ${r[judge].pf > base[judge].pf ? 'PASSE : mieux que la v1.10 sur la moitié jugée' : 'ÉCHOUE : pas mieux que la v1.10 sur la moitié jugée'}`);
  card(r);
  console.log(`   ${JSON.stringify(combo)}`);
  if (r[judge].pf > base[judge].pf) verdicts.push(r);
}

// ===== 4. Ajouté APRÈS avoir vu les sections 1 à 3 : une tendance plus lente (EMA 200, EMA 600) et la sortie au temps
// (1 h à 2 h) font mieux que la v1.10 sur les deux moitiés, et les deux choix automatiques de la section 3 les ont pris
// (le break-even aux 3/4 du TP et la fenêtre 9 h-19 h aussi, plus faiblement ou à moins de 3,5 trades/jour). Avant de
// les écrire dans l'EA, on regarde toute la surface durée × tendance : un vrai effet donne une zone large, un hasard
// donne une case isolée.
console.log('\n── SURFACE SORTIE AU TEMPS × TENDANCE (ajoutée après lecture des sections 1 à 3 ; PF des deux moitiés · net 6 mois · mois gagnants)');
const winMonths = (res: Res) => { const m = new Map<string, number>(); for (const t of res.trades) { const k = day(t.openT).slice(0, 7); m.set(k, (m.get(k) ?? 0) + t.pnl); } return `${[...m.values()].filter((v) => v > 0).length}/${m.size}`; };
for (const trend of [50, 200, 600]) for (const bars of [0, 6, 12, 18, 24, 30, 36]) {
  const r = measure('', { ...BASE, trend, maxBars: bars || undefined });
  console.log(`   EMA ${String(trend).padEnd(3)} · ${bars ? `sortie après ${String(bars * 5).padStart(3)} min` : 'sans sortie au temps'} │ PF ${r.h1.pf.toFixed(2)} / ${r.h2.pf.toFixed(2)} │ 6 mois PF ${r.all.pf.toFixed(2)} · ${fmt(r.all.net).padStart(8)} $ · DD ${fmt(r.all.dd).padStart(8)} $ · ${r.all.perDay.toFixed(1)} tr/j · ≥4 ${Math.round(100 * r.all.ge4)} % │ mois gagnants ${winMonths(r.res)}`);
}
for (const [name, c] of [['sortie après 90 min', { ...BASE, maxBars: 18 }], ['sortie après 120 min', { ...BASE, maxBars: 24 }]] as [string, Cfg][]) {
  const r = measure(name, c);
  console.log(`\n   ${name} (le reste de l'EA inchangé) :`);
  card(r);
}

// ===== 5. Le réglage retenu pour l'EA v1.20 : le cœur de la zone de la section 4 (tendance EMA 200, sortie après
// 90 min ; 60 et 120 min, EMA 600 font presque aussi bien). Choisi APRÈS avoir vu les 6 mois : ses chiffres sont
// optimistes par construction, et ses voisins disent s'il tient à une valeur exacte.
const CHOSEN: Cfg = { ...BASE, trend: 200, maxBars: 18 };
const chosen = measure('réglage retenu', CHOSEN);
console.log(`\n── RÉGLAGE RETENU POUR L'EA (${label(CHOSEN)} · sortie après 90 min)`);
console.log(`   ${NAME.h1} : ${cell(chosen.h1)} · DD ${fmt(chosen.h1.dd)} $`);
console.log(`   ${NAME.h2} : ${cell(chosen.h2)} · DD ${fmt(chosen.h2.dd)} $`);
card(chosen);
console.log(`   trades de rattrapage : ${chosen.res.trades.filter((t) => t.catchUp).length}/${chosen.res.trades.length}, net ${fmt(chosen.res.trades.filter((t) => t.catchUp).reduce((a, t) => a + t.pnl, 0))} $`);
console.log('   ses voisins (un seul changement à la fois) :');
const NEIGHBOURS: [string, Cfg, number?][] = [
  ['spread 0,30 $ (coûts 0,42)', CHOSEN, 0.42], ['spread 0,40 $ (coûts 0,52)', CHOSEN, 0.52],
  ['sortie après 60 min', { ...CHOSEN, maxBars: 12 }], ['sortie après 120 min', { ...CHOSEN, maxBars: 24 }],
  ['tendance EMA 100', { ...CHOSEN, trend: 100 }], ['tendance EMA 600', { ...CHOSEN, trend: 600 }],
  ['RR 0,4', { ...CHOSEN, rr: 0.4 }], ['RR 0,6', { ...CHOSEN, rr: 0.6 }], ['stop 2,5 ATR', { ...CHOSEN, sl: 2.5 }],
  ['ADX ≥ 20 sans DI', { ...CHOSEN, di: false }], ['sans rattrapage', { ...CHOSEN, catchUp: false }], ['EMA 4/9', { ...CHOSEN, fast: 4, slow: 9 }],
];
for (const [name, c, cost] of NEIGHBOURS) {
  const res = run(c, { randomDir: false, seed: 7, cost }), h1 = st(res, 'h1'), h2 = st(res, 'h2'), all = st(res, 'all');
  console.log(`      ${name.padEnd(28)} │ PF ${h1.pf.toFixed(2)} / ${h2.pf.toFixed(2)} │ 6 mois PF ${all.pf.toFixed(2)} · ${fmt(all.net).padStart(8)} $ · DD ${fmt(all.dd).padStart(8)} $ · ${all.perDay.toFixed(1)} tr/j · ≥4 ${Math.round(100 * all.ge4)} %`);
}

// ===== 6. La limite de perte du jour (InpDailyLossPct), absente des sections précédentes. Mathieu (26/10) : 2 000 $ par
// jour sur son compte maître de 50 000 $ à 1 lot, soit 4 % (20 $ pour un abonné à 500 $ et 0,01 lot). Une fois atteinte, plus
// de nouveau trade ; le trade en cours garde sa chance d'aller au TP, donc un jour peut finir au-delà de la limite.
// À 2 %, un seul stop (1 à 3 % du compte) suffisait à couper la journée.
console.log(`\n── LIMITE DE PERTE DU JOUR (réglage retenu ; compte de ${fmt(CAPITAL)} $ à 1 lot, soit 500 $ à 0,01 lot)`);
{
  const ts = chosen.res.trades, pct = (v: number) => (100 * v) / CAPITAL;
  const risks = ts.map((t) => pct(t.risk)).sort((a, b) => a - b), q = (p: number) => risks[Math.min(risks.length - 1, Math.floor(p * risks.length))];
  console.log(`   un stop coûte : médiane ${q(0.5).toFixed(1)} % du compte, 9 trades sur 10 sous ${q(0.9).toFixed(1)} %, au plus ${q(1).toFixed(1)} %`);
  const days = new Map<number, number>(); for (const t of ts) days.set(t.day, (days.get(t.day) ?? 0) + t.pnl);
  const dv = [...days.values()], worst = Math.min(...dv);
  console.log(`   sans limite : ${dv.length} jours tradés, jours à −2 % ou pire : ${dv.filter((v) => pct(v) <= -2).length}, à −4 % ou pire : ${dv.filter((v) => pct(v) <= -4).length}, pire jour ${fmt(worst)} $ (${pct(worst).toFixed(1)} %)`);
}
for (const lim of [0, 2, 3, 4, 5, 6]) {
  const c: Cfg = { ...CHOSEN, dayLossPct: lim || undefined }, res = run(c), h1 = st(res, 'h1'), h2 = st(res, 'h2'), all = st(res, 'all');
  const days = new Map<number, number>(); for (const t of res.trades) days.set(t.day, (days.get(t.day) ?? 0) + t.pnl);
  const over = lim ? [...days.values()].filter((v) => v <= (-CAPITAL * lim) / 100).length : 0;
  console.log(`   ${(lim ? `limite ${lim} % (${fmt((CAPITAL * lim) / 100)} $)` : 'sans limite').padEnd(26)} │ PF ${h1.pf.toFixed(2)} / ${h2.pf.toFixed(2)} │ 6 mois PF ${all.pf.toFixed(2)} · ${fmt(all.net).padStart(8)} $ · DD ${fmt(all.dd).padStart(8)} $ · ${all.perDay.toFixed(1)} tr/j · ≥4 ${Math.round(100 * all.ge4)} % │ jours bloqués ${res.blocked.size}, jours finis au-delà de la limite ${over}, pire jour ${fmt(Math.min(...days.values()))} $`);
}

console.log(`\nVerdict des choix automatiques (section 3) : ${verdicts.length ? `${verdicts.length} combinaison(s) sur 2 passe(nt) la règle sur la moitié jugée.` : 'aucune amélioration ne tient sur la moitié qu’elle n’a pas vue.'} Le réglage retenu (section 5) a été choisi après lecture : il n'est pas jugé par la règle.`);
console.log('Lecture : seule la moitié jugée compte. Sur 3 mois, un écart de PF de quelques centièmes reste du bruit.');
