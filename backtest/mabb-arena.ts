// L'ARÈNE MA / BOLLINGER (22/10/2026) — l'EA MT5 « 4 à 5 trades par jour » sur l'or, avant qu'il existe.
//
// POURQUOI. Mathieu veut un EA court terme sur croisements de moyennes mobiles et/ou bandes de Bollinger, avec
// un MINIMUM de 4 et un MAXIMUM de 5 trades par jour, inspiré de robots publics « prouvés ». Les robots publics
// trouvés ne prouvent rien (BBRSI de geraked : backtest XAUUSD M5 2021-2023 obtenu avec une GRILLE ×1,1 sur 20
// niveaux et SL/TP ignorés). Avant d'écrire l'EA, on rejoue leurs règles d'entrée ici, sans grille, avec nos
// coûts, contre la même entrée en direction tirée au hasard, et on mesure ce que coûte le « minimum 4 ».
//
// LES RÈGLES (toutes sur bougie close, entrée au marché à la clôture, une position à la fois) :
//   MQ   « Moving Average » de MetaQuotes (livré avec chaque MT5, Experts\Examples) : SMA 12 décalée de 6 ; achat
//        quand la bougie close ouvre sous la MA et clôture au-dessus (vente symétrique), sortie au croisement
//        inverse. Pas de stop dans l'original : stop de secours 3 × ATR ajouté pour pouvoir compter en R.
//   EX   EMA 9 / 21 + filtre EMA 200 (le « scalp or » le plus recopié) : croisement 9/21 dans le sens de l'EMA 200,
//        SL 1,5 × ATR14, TP 2 × SL. Variante EXs : sortie aussi au croisement inverse.
//   BR   BBRSI de geraked (github.com/geraked/metatrader5, v1.6), SANS la grille : BB(500, 2), RSI 7 ; la bougie
//        d'avant clôture hors bande avec RSI < 30, la close revient dedans avec RSI entre 30 et 50 → achat.
//        SL = bande basse − 0,9 × (médiane − basse), TP = 1 R. Symétrique.
//   BV   Bollinger 20/2 en retour à la moyenne + RSI 14 : clôture hors bande puis retour dedans, RSI de la
//        bougie hors bande < 30 (> 70) ; TP = médiane au moment de l'entrée, SL = 1,5 × ATR.
//   BK   Bollinger 20/2 en cassure, dans le sens de l'EMA 200 : clôture qui sort de la bande, SL 1,5 × ATR, TP 2 × SL.
//   Z    LIGNE DE BASE pour chacune : mêmes entrées, mêmes sorties, direction tirée au hasard (SL/TP en miroir).
//
// LE QUOTA : 5 trades par jour broker au plus ; session 9 h-22 h broker (≈ Londres + New York), tout est fermé à
// 23 h, et le vendredi dès 21 h (comme l'EA). Le « minimum 4 » ne se décrète pas : une règle qui ne voit que 2 signaux un jour calme ne peut en voir 4
// qu'en baissant ses exigences. On mesure donc (1) la part des jours où chaque règle atteint 4 seule, et (2) un
// RATTRAPAGE : à partir de 16 h broker, s'il manque des trades, une seconde règle plus rapide prend le relais
// (EX → EMA 9/21 sans filtre 200 ; BV → BB 20/1,5). Si le rattrapage perd, le minimum coûte de l'argent.
//
// COÛTS : 0,32 $ l'aller-retour par once (comme ea-arena.ts). Résultats en $ POUR 1 LOT (100 onces).
//
//   npx tsx backtest/mabb-arena.ts XAUUSD            (bougies : node scripts/pull-cache.mjs XAUUSD M5)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

const sym = process.argv[2] ?? 'XAUUSD';
const path = `backtest/.cache/${sym}-M5-15.json`;
if (!existsSync(path)) { console.error(`${path} absent → node scripts/pull-cache.mjs ${sym} M5`); process.exit(1); }
const m5 = (JSON.parse(readFileSync(path, 'utf8')) as Bar[]).sort((a, b) => a.time - b.time);
const COST = 0.2 + 0.05 + 0.07; // $ par once, aller-retour
const LOT = 100;
const OFFSET = 3 * 3_600_000; // heure broker ≈ UTC+3
const brokerDay = (t: number) => Math.floor((t + OFFSET) / 86_400_000);
const brokerHour = (t: number) => new Date(t + OFFSET).getUTCHours();
const month = (t: number) => new Date(t).toISOString().slice(0, 7);
const SESSION_START = 9, SESSION_END = 22, FLAT_HOUR = 23, FRIDAY_FLAT = 21, MAX_PER_DAY = 5, MIN_PER_DAY = 4, CATCHUP_HOUR = 16;

// ===== Indicateurs, valeur à la CLÔTURE de la bougie i (causal), conventions MT5 =====
const closes = m5.map((b) => b.close);
function ema(src: number[], n: number) { const out = new Array<number>(src.length).fill(NaN); const k = 2 / (n + 1); let s = 0;
  for (let i = 0; i < src.length; i++) { if (i < n) { s += src[i]; if (i === n - 1) out[i] = s / n; continue; } out[i] = src[i] * k + out[i - 1] * (1 - k); } return out; }
function sma(src: number[], n: number) { const out = new Array<number>(src.length).fill(NaN); let s = 0;
  for (let i = 0; i < src.length; i++) { s += src[i]; if (i >= n) s -= src[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
function bands(n: number, k: number) { const mid = sma(closes, n); const up = new Array<number>(m5.length).fill(NaN), lo = up.slice();
  for (let i = n - 1; i < m5.length; i++) { let v = 0; for (let j = i - n + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2; const sd = Math.sqrt(v / n); up[i] = mid[i] + k * sd; lo[i] = mid[i] - k * sd; }
  return { mid, up, lo }; }
function rsi(n: number) { const out = new Array<number>(m5.length).fill(NaN); let ag = 0, al = 0; // lissage de Wilder, comme iRSI
  for (let i = 1; i < m5.length; i++) { const d = closes[i] - closes[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) { ag += g / n; al += l / n; if (i < n) continue; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return out; }
const tr = m5.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - m5[i - 1].close), Math.abs(b.low - m5[i - 1].close)) : b.high - b.low));
const atr = sma(tr, 14); // iATR de MT5 = moyenne SIMPLE du true range
const e9 = ema(closes, 9), e21 = ema(closes, 21), e200 = ema(closes, 200);
const sma12 = sma(closes, 12);
const bb500 = bands(500, 2), bb20 = bands(20, 2), bb20t = bands(20, 1.5);
const rsi7 = rsi(7), rsi14 = rsi(14);

// ===== Signaux : direction à la clôture de la bougie i (0 = rien) =====
type Sig = (i: number) => 1 | -1 | 0;
const crossUp = (a: number[], b: number[], i: number) => a[i - 1] <= b[i - 1] && a[i] > b[i];
const crossDn = (a: number[], b: number[], i: number) => a[i - 1] >= b[i - 1] && a[i] < b[i];
const mqMa: Sig = (i) => { if (i < 6) return 0; const ma = sma12[i - 5]; const b = m5[i]; // SMA12 décalée de 6 = valeur calculée 5 bougies avant la close
  return b.open < ma && b.close > ma ? 1 : b.open > ma && b.close < ma ? -1 : 0; };
const emaX: Sig = (i) => crossUp(e9, e21, i) && closes[i] > e200[i] ? 1 : crossDn(e9, e21, i) && closes[i] < e200[i] ? -1 : 0;
const emaXfast: Sig = (i) => crossUp(e9, e21, i) ? 1 : crossDn(e9, e21, i) ? -1 : 0;
const bbRsi: Sig = (i) => {
  const { up, mid, lo } = bb500;
  if (rsi7[i - 1] < 30 && closes[i - 1] < lo[i - 1] && rsi7[i] > 30 && closes[i] > lo[i] && rsi7[i] < 50 && closes[i] < mid[i]) return 1;
  if (rsi7[i - 1] > 70 && closes[i - 1] > up[i - 1] && rsi7[i] < 70 && closes[i] < up[i] && rsi7[i] > 50 && closes[i] > mid[i]) return -1;
  return 0; };
const bbRev = (bb: typeof bb20, lim: number): Sig => (i) => {
  if (closes[i - 1] < bb.lo[i - 1] && closes[i] > bb.lo[i] && rsi14[i - 1] < lim) return 1;
  if (closes[i - 1] > bb.up[i - 1] && closes[i] < bb.up[i] && rsi14[i - 1] > 100 - lim) return -1;
  return 0; };
const bbBrk: Sig = (i) => closes[i - 1] <= bb20.up[i - 1] && closes[i] > bb20.up[i] && closes[i] > e200[i] ? 1
  : closes[i - 1] >= bb20.lo[i - 1] && closes[i] < bb20.lo[i] && closes[i] < e200[i] ? -1 : 0;

// ===== Stratégie = signal + sortie + rattrapage =====
interface Strat {
  name: string; sig: Sig; catchUp?: Sig;
  levels: (i: number, dir: 1 | -1, entry: number) => { sl: number; tp: number } | null; // null = on passe
  exitOnSig?: Sig; // sortie à la clôture quand ce signal pointe à l'opposé de la position
}
const atrLevels = (slAtr: number, rr: number) => (i: number, dir: 1 | -1, entry: number) => {
  const d = slAtr * atr[i]; if (!(d > 0)) return null; return { sl: entry - dir * d, tp: entry + dir * rr * d }; };
const STRATS: Strat[] = [
  { name: 'MQ  Moving Average MetaQuotes', sig: mqMa, exitOnSig: mqMa, levels: (i, dir, e) => { const d = 3 * atr[i]; return d > 0 ? { sl: e - dir * d, tp: e + dir * 1e6 } : null; } },
  { name: 'EX  EMA 9/21 + EMA200, TP 2R', sig: emaX, levels: atrLevels(1.5, 2) },
  { name: 'EXs EX + sortie au croisement', sig: emaX, exitOnSig: emaXfast, levels: atrLevels(1.5, 2) },
  { name: 'BR  BBRSI geraked sans grille', sig: bbRsi, levels: (i, dir, e) => {
    const { up, mid, lo } = bb500; const sl = dir === 1 ? lo[i] - 0.9 * (mid[i] - lo[i]) : up[i] + 0.9 * (up[i] - mid[i]);
    const d = Math.abs(e - sl); return d > 0 && (sl - e) * dir < 0 ? { sl, tp: e + dir * d } : null; } },
  { name: 'BV  BB20 retour moyenne + RSI', sig: bbRev(bb20, 30), levels: (i, dir, e) => {
    const tp = bb20.mid[i], d = 1.5 * atr[i]; return d > 0 && (tp - e) * dir > 0.3 * atr[i] ? { sl: e - dir * d, tp } : null; } },
  { name: 'BK  BB20 cassure + EMA200, 2R', sig: bbBrk, levels: atrLevels(1.5, 2) },
];
const WITH_CATCHUP: Strat[] = [
  { ...STRATS[1], name: 'EX+ EX, rattrapage EMA 9/21 nu', catchUp: emaXfast },
  { ...STRATS[4], name: 'BV+ BV, rattrapage BB20/1,5', catchUp: (i) => { const s = bbRev(bb20t, 40)(i); return s; } },
];

// ===== Moteur (pire cas : dans une même bougie, le stop passe avant le TP) =====
interface Trade { openT: number; closeT: number; dir: 1 | -1; pnl: number; r: number; catchUp: boolean }
interface Pos { dir: 1 | -1; sigDir: 1 | -1; entry: number; sl: number; tp: number; openT: number; catchUp: boolean }
function run(s: Strat, opts: { randomDir: boolean; seed: number; catchUpHour?: number; cost?: number }): { trades: Trade[]; perDay: Map<number, number> } {
  const cost = opts.cost ?? COST, catchUpHour = opts.catchUpHour ?? CATCHUP_HOUR;
  const trades: Trade[] = []; const perDay = new Map<number, number>(); let pos: Pos | null = null; let rnd = opts.seed >>> 0;
  // mulberry32 : le LCG des autres labos perd sa précision en double et boucle tous les 10 466 tirages
  const rand = () => { rnd = (rnd + 0x6d2b79f5) >>> 0; let z = rnd; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const close = (px: number, t: number) => { const p = pos!; const gross = (px - p.entry) * p.dir;
    trades.push({ openT: p.openT, closeT: t, dir: p.dir, pnl: (gross - cost) * LOT, r: gross / Math.abs(p.entry - p.sl), catchUp: p.catchUp }); pos = null; };
  for (let i = 501; i < m5.length; i++) {
    const b = m5[i];
    if (pos) { // SL / TP touchés pendant la bougie i
      if (pos.dir === 1) { if (b.low <= pos.sl) close(pos.sl, b.time); else if (b.high >= pos.tp) close(pos.tp, b.time); }
      else { if (b.high >= pos.sl) close(pos.sl, b.time); else if (b.low <= pos.tp) close(pos.tp, b.time); }
    }
    const hr = brokerHour(b.time + 300_000), d = brokerDay(b.time); // heure de la CLÔTURE de la bougie
    const gap = i + 1 < m5.length && m5[i + 1].time - b.time > 3_600_000; // trou de cotation (nuit, week-end)
    const friday = new Date(b.time + 300_000 + OFFSET).getUTCDay() === 5 && hr >= FRIDAY_FLAT;
    if (pos && (hr >= FLAT_HOUR || friday || gap || brokerDay(b.time + 300_000) !== brokerDay(pos.openT))) { close(b.close, b.time); continue; }
    if (pos && s.exitOnSig && s.exitOnSig(i) === -pos.sigDir) { close(b.close, b.time); continue; } // comme l'original : pas de retournement sur la même bougie
    if (pos || friday || hr < SESSION_START || hr >= SESSION_END) continue;
    const n = perDay.get(d) ?? 0; if (n >= MAX_PER_DAY) continue;
    let sigDir = s.sig(i), catchUp = false;
    if (!sigDir && s.catchUp && hr >= catchUpHour && n < MIN_PER_DAY) { sigDir = s.catchUp(i); catchUp = sigDir !== 0; }
    if (!sigDir) continue;
    const lv = s.levels(i, sigDir, b.close); if (!lv) continue;
    const dir: 1 | -1 = opts.randomDir ? (rand() < 0.5 ? 1 : -1) : sigDir;
    const flip = dir !== sigDir; // direction au hasard : mêmes distances, en miroir
    pos = { dir, sigDir, entry: b.close, sl: flip ? 2 * b.close - lv.sl : lv.sl, tp: flip ? 2 * b.close - lv.tp : lv.tp, openT: b.time, catchUp };
    perDay.set(d, n + 1);
  }
  if (pos) close(m5[m5.length - 1].close, m5[m5.length - 1].time);
  return { trades, perDay };
}

// ===== Rapport =====
const fmt = (v: number) => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US');
const tradingDays = new Set(m5.filter((b) => { const h = brokerHour(b.time); return h >= SESSION_START && h < SESSION_END; }).map((b) => brokerDay(b.time))).size;
function stats(ts: Trade[]) {
  const net = ts.reduce((a, t) => a + t.pnl, 0), wins = ts.filter((t) => t.pnl > 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0), gl = ts.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  let eq = 0, peak = 0, dd = 0; for (const t of ts) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  return { n: ts.length, net, win: ts.length ? wins.length / ts.length : 0, pf: gl ? gp / -gl : Infinity, dd, r: ts.length ? ts.reduce((a, t) => a + t.r, 0) / ts.length : 0 };
}
function line(label: string, ts: Trade[]) {
  if (!ts.length) return `${label.padEnd(32)} aucun trade`;
  const x = stats(ts);
  return `${label.padEnd(32)} n ${String(x.n).padStart(5)} · win ${String(Math.round(100 * x.win)).padStart(3)}% · net ${fmt(x.net).padStart(9)} $ · /tr ${fmt(x.net / x.n).padStart(5)} $ · R/tr ${(x.r >= 0 ? '+' : '') + x.r.toFixed(2)} · PF ${x.pf.toFixed(2)} · DD ${fmt(x.dd).padStart(8)} $`;
}
const cut = Math.floor((m5[0].time + m5[m5.length - 1].time) / 2);
console.log(`ARÈNE MA / BOLLINGER — ${sym} · ${m5.length} bougies M5 · ${new Date(m5[0].time).toISOString().slice(0, 10)} → ${new Date(m5[m5.length - 1].time).toISOString().slice(0, 10)} · ${tradingDays} jours de bourse · 1 lot · coûts ${COST} $/oz`);
console.log(`Session ${SESSION_START} h-${SESSION_END} h broker, à plat à ${FLAT_HOUR} h, ${MAX_PER_DAY} trades/jour max, rattrapage dès ${CATCHUP_HOUR} h si < ${MIN_PER_DAY}.`);
const results: { s: Strat; real: Trade[]; rnd: Trade[]; perDay: Map<number, number> }[] = [];
for (const s of [...STRATS, ...WITH_CATCHUP]) {
  const real = run(s, { randomDir: false, seed: 7 });
  // ligne de base : moyenne de 20 tirages, pour ne pas juger sur une pièce chanceuse
  const rnds = Array.from({ length: 20 }, (_, k) => run(s, { randomDir: true, seed: 11 + 31 * k }).trades);
  const rndNets = rnds.map((ts) => stats(ts).net).sort((a, b) => a - b);
  results.push({ s, real: real.trades, rnd: rnds[0], perDay: real.perDay });
  const x = stats(real.trades); const beat = rndNets.filter((v) => v < x.net).length;
  const days = [...real.perDay.values()];
  const ge4 = days.filter((v) => v >= MIN_PER_DAY).length, at5 = days.filter((v) => v >= MAX_PER_DAY).length;
  console.log(`\n── ${s.name}`);
  console.log('   ' + line('réel', real.trades));
  console.log(`   hasard (20 tirages) : net médian ${fmt(rndNets[10])} $ · fourchette ${fmt(rndNets[0])} → ${fmt(rndNets[19])} $ · le réel bat ${beat}/20 tirages`);
  console.log(`   fréquence : ${(real.trades.length / tradingDays).toFixed(1)} trades/jour · ≥ ${MIN_PER_DAY} trades ${Math.round((100 * ge4) / tradingDays)} % des jours · plafond ${MAX_PER_DAY} atteint ${Math.round((100 * at5) / tradingDays)} % · jours sans trade ${Math.round((100 * (tradingDays - days.length)) / tradingDays)} %`);
  console.log('   ' + line('1re moitié', real.trades.filter((t) => t.openT < cut)));
  console.log('   ' + line('2e moitié', real.trades.filter((t) => t.openT >= cut)));
  console.log('   ' + line('depuis le 1er juin 2026', real.trades.filter((t) => t.openT >= Date.UTC(2026, 5, 1))));
  if (s.catchUp) { console.log('   ' + line('dont trades de rattrapage', real.trades.filter((t) => t.catchUp))); console.log('   ' + line('dont trades de la règle', real.trades.filter((t) => !t.catchUp))); }
  const byHourDir = [1, -1].map((dd) => line(dd === 1 ? 'achats' : 'ventes', real.trades.filter((t) => t.dir === dd)));
  for (const l of byHourDir) console.log('   ' + l);
}
console.log('\n── PAR MOIS (net $ pour 1 lot)');
for (const { s, real } of results) {
  const m = new Map<string, number>(); for (const t of real) m.set(month(t.closeT), (m.get(month(t.closeT)) ?? 0) + t.pnl);
  const keys = [...m.keys()].sort(); const green = keys.filter((k) => m.get(k)! > 0).length;
  console.log(`  ${s.name}: ${green}/${keys.length} mois verts`);
  for (let i = 0; i < keys.length; i += 8) console.log('    ' + keys.slice(i, i + 8).map((k) => `${k.slice(2)} ${fmt(m.get(k)!).padStart(7)}`).join(' · '));
}
// ===== Sensibilité de la seule règle qui bat le hasard (EX+) : un avantage qui ne tient qu'à un réglage n'en est pas un
console.log(`\n── SENSIBILITÉ DE EX+ (une ligne = un seul réglage changé ; hasard sur 10 tirages)`);
function sensi(label: string, s: Strat, o: { catchUpHour?: number; cost?: number } = {}) {
  const real = run(s, { randomDir: false, seed: 7, ...o });
  const nets = Array.from({ length: 10 }, (_, k) => stats(run(s, { randomDir: true, seed: 11 + 31 * k, ...o }).trades).net);
  const x = stats(real.trades), ge4 = [...real.perDay.values()].filter((v) => v >= MIN_PER_DAY).length;
  const h1 = stats(real.trades.filter((t) => t.openT < cut)).net, h2 = stats(real.trades.filter((t) => t.openT >= cut)).net;
  console.log(`   ${label.padEnd(30)} net ${fmt(x.net).padStart(9)} $ · PF ${x.pf.toFixed(2)} · DD ${fmt(x.dd).padStart(8)} $ · moitiés ${fmt(h1)} / ${fmt(h2)} · ≥ 4 trades ${Math.round((100 * ge4) / tradingDays)} % des jours · bat ${nets.filter((v) => v < x.net).length}/10 tirages`);
}
const exPlus = WITH_CATCHUP[0];
sensi('référence (16 h, TP 2R)', exPlus);
sensi('rattrapage dès 14 h', exPlus, { catchUpHour: 14 });
sensi('rattrapage dès 18 h', exPlus, { catchUpHour: 18 });
sensi('TP 1,5R', { ...exPlus, levels: atrLevels(1.5, 1.5) });
sensi('TP 3R', { ...exPlus, levels: atrLevels(1.5, 3) });
sensi('stop 1 ATR, TP 2R', { ...exPlus, levels: atrLevels(1, 2) });
sensi('spread 0,30 $ (coûts 0,42)', exPlus, { cost: 0.42 });
sensi('spread 0,40 $ (coûts 0,52)', exPlus, { cost: 0.52 });
sensi('EMA 9/21 nu toute la journée', { ...exPlus, sig: emaXfast, catchUp: undefined });

console.log('\nLecture : une règle qui ne bat pas ses tirages au hasard n’a pas de direction ; un rattrapage qui perd veut dire que le « minimum 4 » se paie.');
