// L'ARÈNE DES EA (06/09/2026) — les règles EXACTES de deux Expert Advisors publics, rejouées sur DEUX ANS de
// bougies M5 de notre broker, avec nos coûts, contre une ligne de base au hasard.
//
// POURQUOI. Mathieu veut « prendre un truc déjà prêt ». Les dépôts publics n'apportent que des captures de
// backtest 2022-2025 (l'or de 1 800 à 4 000 $ : n'importe quel « acheter la cassure » y gagne) et, pour l'un
// d'eux, une branche vente en commentaire. Avant de mettre quoi que ce soit sur le master, on rejoue leurs
// règles ici, mois par mois, et on regarde ce qu'elles valent hors bull run — en particulier sur les 3
// derniers mois, ceux où notre propre moteur perd.
//
// LES DEUX EA (règles lues dans le code source, pas dans le README) :
//   A. blackXAU « H4 Zone Retest » v1.22 (phatnomenal), ventes RÉTABLIES (dans le dépôt elles sont commentées) :
//      zone = plus haut / plus bas de la VEILLE (jour broker). Sur M5 clôturée : cassure haussière si open ≤
//      zoneHigh < close et (corps ≥ 50 % de la bougie OU corps ≥ 2 $). Puis ATTENTE D'UN RETEST : le prix
//      revient toucher zoneHigh dans les 24 h → achat à zoneHigh. Filtre EMA H1 : clôture > EMA50 et > EMA200.
//      SL = entrée − 1,5 ATR(H1,14), TP = entrée + 3 ATR. Trailing : dès +2 $ de profit, SL = prix − 1 $ ;
//      break-even à +3 $. Session 7 h-22 h heure broker. Une position à la fois. Symétrique à la vente.
//      Variante A' : même entrée, SANS le trailing serré (SL/TP seuls) — le trailing à 1 $ sur l'or est un
//      scalp déguisé, on veut voir ce que vaut l'entrée elle-même.
//   B. GOLD_ORB (yulz008, 2023) : H1, ouverture du marché à 1 h heure broker. Range = 1re bougie H1 du jour,
//      étendu aux bougies suivantes qui font un nouveau haut/bas ; « final » après 3 bougies consécutives
//      DANS le range. Cassure du range final en clôture H1 → entrée au marché. SL 4 $, TP 12 $, 2 trades par
//      jour max, trailing dès +7 $ (garde 1 $ minimum). Les deux sens.
//   Z. LIGNE DE BASE : à chaque signal de A (resp. B), la même entrée avec une direction tirée au hasard.
//      Si l'EA ne bat pas sa propre version au hasard, la direction n'apporte rien.
//
// COÛTS : 0,32 $ l'aller-retour par once (spread 0,20 + glissement 0,05 + commission 0,07) — les mêmes que
// tous nos labos. Heure broker = UTC+3 (été) ; l'heure d'hiver décale d'une heure, sans conséquence ici.
// Résultats en $ POUR 1 LOT (100 onces), comme le compte master ; un membre à 0,01 lot divise par 100.
//
//   npx tsx backtest/ea-arena.ts XAUUSD
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

const sym = process.argv[2] ?? 'XAUUSD';
const path = `backtest/.cache/${sym}-M5-15.json`;
if (!existsSync(path)) { console.error(`${path} absent → node scripts/pull-cache.mjs ${sym} M5`); process.exit(1); }
const m5 = (JSON.parse(readFileSync(path, 'utf8')) as Bar[]).sort((a, b) => a.time - b.time);
const COST = 0.2 + 0.05 + 0.07; // $ par once, aller-retour
const LOT = 100; // onces par lot
const OFFSET = 3 * 3_600_000; // heure broker ≈ UTC+3
const brokerDay = (t: number) => Math.floor((t + OFFSET) / 86_400_000);
const brokerHour = (t: number) => new Date(t + OFFSET).getUTCHours();
const month = (t: number) => new Date(t).toISOString().slice(0, 7);

// ===== H1 et D1 (jour broker) dérivés du M5 =====
interface HBar extends Bar { i0: number; i1: number } // indices M5 couverts
const h1: HBar[] = [];
{ let cur: HBar | null = null; let key = -1;
  for (let i = 0; i < m5.length; i++) { const b = m5[i]; const k = Math.floor((b.time + OFFSET) / 3_600_000);
    if (k !== key) { if (cur) h1.push(cur); cur = { ...b, i0: i, i1: i }; key = k; } else if (cur) { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; cur.i1 = i; } }
  if (cur) h1.push(cur); }
const d1 = new Map<number, { high: number; low: number }>();
for (const b of m5) { const d = brokerDay(b.time); const x = d1.get(d); if (!x) d1.set(d, { high: b.high, low: b.low }); else { x.high = Math.max(x.high, b.high); x.low = Math.min(x.low, b.low); } }
const prevDay = (d: number) => { for (let k = 1; k <= 4; k++) { const x = d1.get(d - k); if (x) return x; } return null; };
// EMA50 / EMA200 / ATR14 sur H1, valeur à la CLÔTURE de la bougie H1 (indice h) — causal
const ema = (len: number) => { const out = new Array<number>(h1.length).fill(0); const k = 2 / (len + 1); for (let i = 0; i < h1.length; i++) out[i] = i ? h1[i].close * k + out[i - 1] * (1 - k) : h1[i].close; return out; };
const ema50 = ema(50), ema200 = ema(200);
const atrH1 = new Array<number>(h1.length).fill(0);
{ let s = 0; for (let i = 0; i < h1.length; i++) { const b = h1[i]; const tr = i ? Math.max(b.high - b.low, Math.abs(b.high - h1[i - 1].close), Math.abs(b.low - h1[i - 1].close)) : b.high - b.low; s = i < 14 ? s + tr : s - s / 14 + tr; atrH1[i] = i < 14 ? s / (i + 1) : s / 14; } }
const h1IndexOfM5: number[] = new Array(m5.length).fill(0);
for (let h = 0; h < h1.length; h++) for (let i = h1[h].i0; i <= h1[h].i1; i++) h1IndexOfM5[i] = h;

// ===== Moteur de position commun (sur M5, pire cas : le stop est servi avant le TP dans une même bougie) =====
interface Trade { openT: number; closeT: number; dir: 1 | -1; entry: number; exit: number; sl0: number; pnl: number; r: number; reason: string }
interface Pos { dir: 1 | -1; entry: number; sl: number; tp: number; sl0: number; openT: number; peakProfit: number }
type Mgmt = (p: Pos, b: Bar) => void; // ajuste p.sl à la clôture de la bougie (trailing)
function step(p: Pos, b: Bar, mgmt: Mgmt | null): Trade | null {
  const hit = (px: number) => { const gross = (px - p.entry) * p.dir; const pnl = (gross - COST) * LOT; return { openT: p.openT, closeT: b.time, dir: p.dir, entry: p.entry, exit: px, sl0: p.sl0, pnl, r: gross / Math.abs(p.entry - p.sl0), reason: '' }; };
  if (p.dir === 1) { if (b.low <= p.sl) return { ...hit(p.sl), reason: p.sl >= p.entry ? 'trail' : 'sl' }; if (b.high >= p.tp) return { ...hit(p.tp), reason: 'tp' }; }
  else { if (b.high >= p.sl) return { ...hit(p.sl), reason: p.sl <= p.entry ? 'trail' : 'sl' }; if (b.low <= p.tp) return { ...hit(p.tp), reason: 'tp' }; }
  if (mgmt) mgmt(p, b);
  return null;
}

// ===== A. blackXAU — zone de la veille, cassure M5, retest, EMA H1, ATR H1 =====
function runBlackXAU(opts: { tightTrail: boolean; randomDir: boolean; seed: number }): Trade[] {
  const trades: Trade[] = []; let pos: Pos | null = null; let rnd = opts.seed;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  let waiting = false, dir: 1 | -1 = 1, bkTime = 0, zoneDay = -1, zh = 0, zl = 0;
  const mgmt: Mgmt = (p, b) => {
    if (!opts.tightTrail) return;
    const profit = (b.close - p.entry) * p.dir;
    if (profit > 2) { const ns = p.dir === 1 ? b.close - 1 : b.close + 1; if ((p.dir === 1 && ns > p.sl) || (p.dir === -1 && ns < p.sl)) p.sl = ns; }
    if (profit >= 3 && ((p.dir === 1 && p.sl < p.entry) || (p.dir === -1 && p.sl > p.entry))) p.sl = p.entry;
  };
  for (let i = 1; i < m5.length; i++) {
    const b = m5[i];
    if (pos) { const t = step(pos, b, mgmt); if (t) { trades.push(t); pos = null; } }
    const d = brokerDay(b.time);
    if (d !== zoneDay) { const pd = prevDay(d); if (!pd) continue; zoneDay = d; zh = pd.high; zl = pd.low; waiting = false; }
    const hr = brokerHour(b.time);
    if (hr < 7 || hr > 22) continue;
    // cassure sur la bougie M5 qui vient de clôturer (b)
    const body = Math.abs(b.close - b.open), range = b.high - b.low;
    const ok = (range > 0 && body >= 0.5 * range) || body >= 2;
    if (!waiting) {
      if (b.close > zh && b.open <= zh && ok) { waiting = true; dir = 1; bkTime = b.time; }
      else if (b.close < zl && b.open >= zl && ok) { waiting = true; dir = -1; bkTime = b.time; }
      continue; // le retest se cherche à partir de la bougie suivante
    }
    if (b.time - bkTime > 86_400_000) { waiting = false; continue; }
    // retest : le prix revient toucher le bord de la zone
    const level = dir === 1 ? zh : zl;
    const touched = dir === 1 ? b.low <= level : b.high >= level;
    if (!touched || pos) continue;
    const h = h1IndexOfM5[i];
    const emaOk = dir === 1 ? h1[h].close > ema50[h] && h1[h].close > ema200[h] : h1[h].close < ema50[h] && h1[h].close < ema200[h];
    waiting = false;
    if (!emaOk || h < 1) continue;
    const atr = atrH1[h - 1]; if (!atr) continue;
    const useDir: 1 | -1 = opts.randomDir ? (rand() < 0.5 ? 1 : -1) : dir;
    const entry = level;
    pos = { dir: useDir, entry, sl: entry - useDir * 1.5 * atr, tp: entry + useDir * 3 * atr, sl0: entry - useDir * 1.5 * atr, openT: b.time, peakProfit: 0 };
    // la bougie de retest peut déjà toucher le stop/TP
    const t = step(pos, b, null); if (t) { trades.push(t); pos = null; }
  }
  return trades;
}

// ===== B. GOLD_ORB — range d'ouverture H1, final après 3 bougies dedans, cassure en clôture =====
function runGoldORB(opts: { randomDir: boolean; seed: number }): Trade[] {
  const trades: Trade[] = []; let pos: Pos | null = null; let rnd = opts.seed;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  let day = -1, rh = 0, rl = 0, inside = 0, final = false, tradesToday = 0, started = false;
  const mgmt: Mgmt = (p, b) => { const profit = (b.close - p.entry) * p.dir; if (profit >= 7) { const ns = p.dir === 1 ? b.close - 1 : b.close + 1; if ((p.dir === 1 && ns > p.sl) || (p.dir === -1 && ns < p.sl)) p.sl = ns; } };
  for (let h = 0; h < h1.length; h++) {
    const bar = h1[h];
    // gestion intra-heure sur les M5 de la bougie
    if (pos) for (let i = bar.i0; i <= bar.i1 && pos; i++) { const t = step(pos, m5[i], mgmt); if (t) { trades.push(t); pos = null; } }
    const d = brokerDay(bar.time), hr = brokerHour(bar.time);
    if (d !== day) { day = d; started = false; final = false; inside = 0; tradesToday = 0; }
    if (hr === 1) { rh = bar.high; rl = bar.low; started = true; inside = 0; final = false; continue; }
    if (!started) continue;
    if (!final) {
      if (bar.high <= rh && bar.low >= rl) { inside++; if (inside >= 3) final = true; }
      else { rh = Math.max(rh, bar.high); rl = Math.min(rl, bar.low); inside = 0; }
      continue;
    }
    if (pos || tradesToday >= 2) continue;
    let dir: 1 | -1 | 0 = bar.close > rh ? 1 : bar.close < rl ? -1 : 0;
    if (!dir) continue;
    tradesToday++;
    if (opts.randomDir) dir = rand() < 0.5 ? 1 : -1;
    const entry = bar.close;
    pos = { dir, entry, sl: entry - dir * 4, tp: entry + dir * 12, sl0: entry - dir * 4, openT: bar.time, peakProfit: 0 };
  }
  return trades;
}

// ===== Rapport =====
const fmt = (v: number) => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US');
function summary(label: string, ts: Trade[]) {
  if (!ts.length) { console.log(`${label.padEnd(34)} aucun trade`); return; }
  const net = ts.reduce((a, t) => a + t.pnl, 0);
  const wins = ts.filter((t) => t.pnl > 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0), gl = ts.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  let eq = 0, peak = 0, dd = 0; for (const t of ts) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const days = (ts[ts.length - 1].closeT - ts[0].openT) / 86_400_000;
  const avgR = ts.reduce((a, t) => a + t.r, 0) / ts.length;
  console.log(`${label.padEnd(34)} n ${String(ts.length).padStart(4)} · ${(ts.length / (days / 7)).toFixed(1)} tr/sem · win ${String(Math.round((100 * wins.length) / ts.length)).padStart(3)}% · net ${fmt(net).padStart(9)} $ · /tr ${fmt(net / ts.length).padStart(6)} $ · R/tr ${(avgR >= 0 ? '+' : '') + avgR.toFixed(2)} · PF ${gl ? (gp / -gl).toFixed(2) : '∞'} · DD max ${fmt(dd)} $`);
}
function byMonth(label: string, ts: Trade[]) {
  const m = new Map<string, Trade[]>(); for (const t of ts) (m.get(month(t.closeT)) ?? m.set(month(t.closeT), []).get(month(t.closeT))!).push(t);
  const keys = [...m.keys()].sort();
  const cells = keys.map((k) => { const xs = m.get(k)!; const net = xs.reduce((a, t) => a + t.pnl, 0); return `${k.slice(2)} ${fmt(net).padStart(7)} (${xs.length})`; });
  const green = keys.filter((k) => m.get(k)!.reduce((a, t) => a + t.pnl, 0) > 0).length;
  console.log(`  ${label}: ${green}/${keys.length} mois verts`);
  for (let i = 0; i < cells.length; i += 6) console.log('    ' + cells.slice(i, i + 6).join(' · '));
}

console.log(`ARÈNE DES EA — ${sym} · ${m5.length} bougies M5 · ${new Date(m5[0].time).toISOString().slice(0, 10)} → ${new Date(m5[m5.length - 1].time).toISOString().slice(0, 10)} · 1 lot · coûts ${COST} $/oz`);
const A = runBlackXAU({ tightTrail: true, randomDir: false, seed: 7 });
const A2 = runBlackXAU({ tightTrail: false, randomDir: false, seed: 7 });
const AZ = runBlackXAU({ tightTrail: true, randomDir: true, seed: 11 });
const AZ2 = runBlackXAU({ tightTrail: false, randomDir: true, seed: 11 });
const B = runGoldORB({ randomDir: false, seed: 7 });
const BZ = runGoldORB({ randomDir: true, seed: 11 });
console.log('\n── SYNTHÈSE (2 ans)');
summary('A  blackXAU tel quel (trail 1 $)', A);
summary('A′ blackXAU sans trail (SL/TP)', A2);
summary('Z  blackXAU direction au hasard', AZ);
summary('Z′ idem sans trail', AZ2);
summary('B  GOLD_ORB tel quel', B);
summary('Z  GOLD_ORB direction au hasard', BZ);
console.log('\n── PAR MOIS (net $ pour 1 lot, nombre de trades)');
byMonth('A  blackXAU', A); byMonth('A′ blackXAU sans trail', A2); byMonth('B  GOLD_ORB', B);
const last3 = (ts: Trade[]) => ts.filter((t) => t.closeT >= Date.UTC(2026, 5, 1));
console.log('\n── DEPUIS LE 1er JUIN 2026 (la période où notre moteur perd)');
summary('A  blackXAU', last3(A)); summary('A′ blackXAU sans trail', last3(A2)); summary('B  GOLD_ORB', last3(B));
console.log('\nLecture : un EA qui ne bat pas sa version au hasard n’a pas de direction ; un EA vert seulement sur 2025 a surfé le bull run.');
