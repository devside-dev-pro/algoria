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
import { brokerClock, reopenCheck } from './broker-time';

const sym = process.argv[2] ?? 'XAUUSD';
const path = `backtest/.cache/${sym}-M5-15.json`;
if (!existsSync(path)) { console.error(`${path} absent → node scripts/pull-cache.mjs ${sym} M5`); process.exit(1); }
const m5 = (JSON.parse(readFileSync(path, 'utf8')) as Bar[]).sort((a, b) => a.time - b.time);
const COST = 0.2 + 0.05 + 0.07, LOT = 100;
const T = brokerClock(m5); // heure serveur : UTC+3 en heure d'été américaine, UTC+2 sinon (broker-time.ts)
const SESSION_START = 9, SESSION_END = 22, FLAT_HOUR = 23, FRIDAY_FLAT = 21, MAX_PER_DAY = 5, MIN_PER_DAY = 4, CATCHUP_HOUR = 14;
const MIN_TRADES_PER_DAY = 3.5; // contrainte de fréquence de la règle de choix

// ===== Indicateurs (valeur à la clôture de la bougie i, conventions MT5) =====
const closes = m5.map((b) => b.close);
function ema(n: number) { const out = new Array<number>(m5.length).fill(NaN); const k = 2 / (n + 1); let s = 0;
  for (let i = 0; i < m5.length; i++) { if (i < n) { s += closes[i]; if (i === n - 1) out[i] = s / n; continue; } out[i] = closes[i] * k + out[i - 1] * (1 - k); } return out; }
const tr = m5.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - m5[i - 1].close), Math.abs(b.low - m5[i - 1].close)) : b.high - b.low));
const atr = new Array<number>(m5.length).fill(NaN); // iATR = moyenne simple du true range
{ let s = 0; for (let i = 0; i < m5.length; i++) { s += tr[i]; if (i >= 14) s -= tr[i - 14]; if (i >= 13) atr[i] = s / 14; } }
// iADX(14) de MT5, ligne à ligne d'après ADX.mq5 (MetaQuotes) : +DM/−DM exclusifs, normalisés par le TR de la bougie,
// puis +DI, −DI et ADX lissés par ExponentialMA (pr = 2 / (n + 1)), départ à 0.
const ADX_N = 14;
const pdi = new Array<number>(m5.length).fill(0), ndi = pdi.slice(), adx = pdi.slice();
{ const pr = 2 / (ADX_N + 1);
  for (let i = 1; i < m5.length; i++) {
    const b = m5[i], p = m5[i - 1];
    let up = b.high - p.high, dn = p.low - b.low;
    if (up < 0) up = 0; if (dn < 0) dn = 0;
    if (up > dn) dn = 0; else if (up < dn) up = 0; else { up = 0; dn = 0; }
    const t = Math.max(Math.abs(b.high - b.low), Math.abs(b.high - p.close), Math.abs(b.low - p.close));
    const pd = t ? (100 * up) / t : 0, nd = t ? (100 * dn) / t : 0;
    pdi[i] = pd * pr + pdi[i - 1] * (1 - pr); ndi[i] = nd * pr + ndi[i - 1] * (1 - pr);
    const s = pdi[i] + ndi[i], dx = s ? (100 * Math.abs(pdi[i] - ndi[i])) / s : 0;
    adx[i] = dx * pr + adx[i - 1] * (1 - pr);
  } }
const emaCache = new Map<number, number[]>();
const E = (n: number) => emaCache.get(n) ?? emaCache.set(n, ema(n)).get(n)!;

// ===== Réglage =====
interface Cfg { fast: number; slow: number; trend: number; adxMin: number; di: boolean; rr: number; sl: number; catchUp: boolean }
const label = (c: Cfg) => `EMA ${c.fast}/${c.slow}/${c.trend} · ADX ${c.adxMin ? `≥${c.adxMin}${c.di ? '+DI' : ''}` : 'off'} · SL ${c.sl} ATR · RR ${c.rr}${c.catchUp ? '' : ' · sans rattrapage'}`;
function signal(c: Cfg, i: number, withTrend: boolean): 1 | -1 | 0 {
  const f = E(c.fast), s = E(c.slow);
  const dir = f[i - 1] <= s[i - 1] && f[i] > s[i] ? 1 : f[i - 1] >= s[i - 1] && f[i] < s[i] ? -1 : 0;
  if (!dir) return 0;
  if (withTrend) { const t = E(c.trend)[i]; if (!(dir === 1 ? closes[i] > t : closes[i] < t)) return 0; }
  if (c.adxMin && adx[i] < c.adxMin) return 0;
  if (c.di && (dir === 1 ? pdi[i] <= ndi[i] : ndi[i] <= pdi[i])) return 0;
  return dir;
}

// ===== Moteur (identique à mabb-arena.ts : pire cas, le stop passe avant le TP dans une même bougie ; trou servi à l'ouverture) =====
interface Trade { openT: number; closeT: number; dir: 1 | -1; pnl: number; r: number; catchUp: boolean }
function run(c: Cfg, opts: { randomDir: boolean; seed: number } = { randomDir: false, seed: 7 }) {
  const trades: Trade[] = []; const perDay = new Map<number, number>();
  let pos: { dir: 1 | -1; entry: number; sl: number; tp: number; openT: number; day: number; catchUp: boolean } | null = null;
  let rnd = opts.seed >>> 0; // mulberry32
  const rand = () => { rnd = (rnd + 0x6d2b79f5) >>> 0; let z = rnd; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const close = (px: number, t: number) => { const p = pos!; const gross = (px - p.entry) * p.dir;
    trades.push({ openT: p.openT, closeT: t, dir: p.dir, pnl: (gross - COST) * LOT, r: gross / Math.abs(p.entry - p.sl), catchUp: p.catchUp }); pos = null; };
  for (let i = 300; i < m5.length; i++) {
    const b = m5[i];
    if (pos && T.openDay[i] !== pos.day) close(b.open, b.time); // nouveau jour serveur : l'EA ferme au premier tick
    if (pos) {
      if (pos.dir === 1) {
        if (b.open >= pos.tp || b.open <= pos.sl) close(b.open, b.time);
        else if (b.low <= pos.sl) close(pos.sl, b.time); else if (b.high >= pos.tp) close(pos.tp, b.time);
      } else {
        if (b.open <= pos.tp || b.open >= pos.sl) close(b.open, b.time);
        else if (b.high >= pos.sl) close(pos.sl, b.time); else if (b.low <= pos.tp) close(pos.tp, b.time);
      }
    }
    const hr = T.closeHour[i], d = T.openDay[i];
    const friday = T.closeDow[i] === 5 && hr >= FRIDAY_FLAT;
    if (pos && (hr >= FLAT_HOUR || friday)) { close(b.close, b.time); continue; }
    if (pos || friday || hr < SESSION_START || hr >= SESSION_END) continue;
    const n = perDay.get(d) ?? 0; if (n >= MAX_PER_DAY) continue;
    let sigDir = signal(c, i, true), catchUp = false;
    if (!sigDir && c.catchUp && hr >= CATCHUP_HOUR && n < MIN_PER_DAY) { sigDir = signal(c, i, false); catchUp = sigDir !== 0; }
    if (!sigDir) continue;
    const dist = c.sl * atr[i]; if (!(dist > 0)) continue;
    const dir: 1 | -1 = opts.randomDir ? (rand() < 0.5 ? 1 : -1) : sigDir;
    pos = { dir, entry: b.close, sl: b.close - dir * dist, tp: b.close + dir * c.rr * dist, openT: b.time, day: T.closeDay[i], catchUp };
    perDay.set(d, n + 1);
  }
  if (pos) close(m5[m5.length - 1].close, m5[m5.length - 1].time);
  return { trades, perDay };
}

// ===== Mesures, par moitié =====
const cut = Math.floor((m5[0].time + m5[m5.length - 1].time) / 2);
const sessionDays = [...new Set(m5.map((_, i) => i).filter((i) => T.openHour[i] >= SESSION_START && T.openHour[i] < SESSION_END).map((i) => T.openDay[i]))];
const cutDay = T.openDay[m5.findIndex((b) => b.time >= cut)];
const daysIn = { h1: sessionDays.filter((d) => d < cutDay).length, h2: sessionDays.filter((d) => d >= cutDay).length, all: sessionDays.length };
type Half = 'h1' | 'h2' | 'all';
interface St { n: number; net: number; pf: number; dd: number; perDay: number; ge4: number; win: number; r: number }
function st(res: ReturnType<typeof run>, half: Half): St {
  const ts = res.trades.filter((t) => half === 'all' || (half === 'h1' ? t.openT < cut : t.openT >= cut));
  const net = ts.reduce((a, t) => a + t.pnl, 0);
  const gp = ts.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0), gl = ts.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  let eq = 0, peak = 0, dd = 0; for (const t of ts) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const days = [...res.perDay.entries()].filter(([d]) => half === 'all' || (half === 'h1' ? d < cutDay : d >= cutDay));
  return { n: ts.length, net, pf: gl ? gp / -gl : gp ? 99 : 0, dd, perDay: ts.length / daysIn[half], ge4: days.filter(([, v]) => v >= MIN_PER_DAY).length / daysIn[half],
    win: ts.length ? ts.filter((t) => t.pnl > 0).length / ts.length : 0, r: ts.length ? ts.reduce((a, t) => a + t.r, 0) / ts.length : 0 };
}
const fmt = (v: number) => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US');
const cell = (x: St) => `PF ${x.pf.toFixed(2)} · net ${fmt(x.net).padStart(8)} $ · ${x.perDay.toFixed(1)} tr/j · ≥4 ${String(Math.round(100 * x.ge4)).padStart(3)} %`;
function spearman(a: number[], b: number[]) {
  const rank = (v: number[]) => { const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array<number>(v.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
  const ra = rank(a), rb = rank(b), n = a.length, ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; }
  return num / Math.sqrt(da * db);
}

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
console.log(`Reprise quotidienne en heure serveur : ${reopenCheck(m5, T)} — une seule heure attendue si le calendrier d'été est le bon.`);
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

console.log('\nLecture : seul le chiffre de l’année jugée compte. Un réglage brillant l’année de choix et quelconque l’année jugée a été trouvé par chance.');
