// MOTEUR COMMUN DES LABOS MA / BOLLINGER À RR COURT (mabb-grid.ts, mabb-improve.ts) — 22/10/2026.
//
// Bougies M5 du broker, heure serveur « clôture de New York » (broker-time.ts), indicateurs aux conventions MT5
// (EMA, iATR = moyenne simple du TR, iADX de MetaQuotes), et le moteur d'exécution de l'EA mql5/Experts/Algoria_XAU_MABB :
// croisement EMA rapide / lente sur bougie close, entrée à la clôture, une position à la fois, 5 trades par jour broker,
// rattrapage dès 14 h s'il en manque (même croisement sans filtre de tendance), session 9 h-22 h, à plat à 23 h et le
// vendredi à 21 h, fermeture au premier tick d'un nouveau jour serveur, SL/TP sautés par un trou servis à l'ouverture,
// stop avant TP quand les deux sont touchés dans la même bougie (pire cas). Coûts 0,32 $/oz l'aller-retour, 1 lot.
//
// Options d'amélioration (mabb-improve.ts), toutes absentes = l'EA tel quel :
//   trend 0 → pas de filtre de tendance ; minTpCost → pas d'entrée si le TP vaut moins de N fois les coûts ;
//   sess → fenêtre d'entrée ; maxBars → sortie au marché après N bougies ; beAt → stop remonté au prix d'entrée quand
//   une clôture atteint cette fraction du TP ; body → bougie du croisement dans le sens du trade ; catchUpHour.
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';
import { brokerClock } from './broker-time';

export const sym = process.argv[2] ?? 'XAUUSD';
const path = `backtest/.cache/${sym}-M5-15.json`;
if (!existsSync(path)) { console.error(`${path} absent → node scripts/pull-cache.mjs ${sym} M5`); process.exit(1); }
export const m5 = (JSON.parse(readFileSync(path, 'utf8')) as Bar[]).sort((a, b) => a.time - b.time);
export const COST = 0.2 + 0.05 + 0.07, LOT = 100;
export const T = brokerClock(m5); // heure serveur : UTC+3 en heure d'été américaine, UTC+2 sinon (broker-time.ts)
export const SESSION_START = 9, SESSION_END = 22, FLAT_HOUR = 23, FRIDAY_FLAT = 21, MAX_PER_DAY = 5, MIN_PER_DAY = 4, CATCHUP_HOUR = 14;
export const MIN_TRADES_PER_DAY = 3.5; // contrainte de fréquence de la règle de choix
// Fenêtre de test (--months N) : seuls les N derniers mois sont tradés et mesurés, coupés en deux moitiés ; les
// indicateurs chauffent sur l'historique d'avant, comme l'EA sur l'historique du terminal. Sans l'option : tout le cache.
const monthsArg = process.argv.indexOf('--months');
export const MONTHS = monthsArg > 0 ? Number(process.argv[monthsArg + 1]) : 0;
const lastT = m5[m5.length - 1].time, from = new Date(lastT); from.setUTCMonth(from.getUTCMonth() - MONTHS);
export const START = MONTHS > 0 ? Math.max(300, m5.findIndex((b) => b.time >= from.getTime())) : 300;
const FIRST = MONTHS > 0 ? START : 0; // début des mesures (sans fenêtre : inchangé, tout le cache)

// ===== Indicateurs (valeur à la clôture de la bougie i, conventions MT5) =====
export const closes = m5.map((b) => b.close);
function ema(n: number) { const out = new Array<number>(m5.length).fill(NaN); const k = 2 / (n + 1); let s = 0;
  for (let i = 0; i < m5.length; i++) { if (i < n) { s += closes[i]; if (i === n - 1) out[i] = s / n; continue; } out[i] = closes[i] * k + out[i - 1] * (1 - k); } return out; }
const tr = m5.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - m5[i - 1].close), Math.abs(b.low - m5[i - 1].close)) : b.high - b.low));
export const atr = new Array<number>(m5.length).fill(NaN); // iATR = moyenne simple du true range
{ let s = 0; for (let i = 0; i < m5.length; i++) { s += tr[i]; if (i >= 14) s -= tr[i - 14]; if (i >= 13) atr[i] = s / 14; } }
// iADX(14) de MT5, ligne à ligne d'après ADX.mq5 (MetaQuotes) : +DM/−DM exclusifs, normalisés par le TR de la bougie,
// puis +DI, −DI et ADX lissés par ExponentialMA (pr = 2 / (n + 1)), départ à 0.
const ADX_N = 14;
export const pdi = new Array<number>(m5.length).fill(0), ndi = pdi.slice(), adx = pdi.slice();
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
export const E = (n: number) => emaCache.get(n) ?? emaCache.set(n, ema(n)).get(n)!;

// ===== Réglage =====
export interface Cfg {
  fast: number; slow: number; trend: number; adxMin: number; di: boolean; rr: number; sl: number; catchUp: boolean;
  minTpCost?: number; sess?: [number, number]; maxBars?: number; beAt?: number; body?: boolean; catchUpHour?: number;
}
export const label = (c: Cfg) => `EMA ${c.fast}/${c.slow}/${c.trend || '-'} · ADX ${c.adxMin ? `≥${c.adxMin}${c.di ? '+DI' : ''}` : c.di ? 'DI' : 'off'} · SL ${c.sl} ATR · RR ${c.rr}${c.catchUp ? '' : ' · sans rattrapage'}`;
export function signal(c: Cfg, i: number, withTrend: boolean): 1 | -1 | 0 {
  const f = E(c.fast), s = E(c.slow);
  const dir = f[i - 1] <= s[i - 1] && f[i] > s[i] ? 1 : f[i - 1] >= s[i - 1] && f[i] < s[i] ? -1 : 0;
  if (!dir) return 0;
  if (withTrend && c.trend > 0) { const t = E(c.trend)[i]; if (!(dir === 1 ? closes[i] > t : closes[i] < t)) return 0; }
  if (c.body && (closes[i] - m5[i].open) * dir <= 0) return 0;
  if (c.adxMin && adx[i] < c.adxMin) return 0;
  if (c.di && (dir === 1 ? pdi[i] <= ndi[i] : ndi[i] <= pdi[i])) return 0;
  return dir;
}

// ===== Moteur (identique à mabb-arena.ts : pire cas, le stop passe avant le TP dans une même bougie ; trou servi à l'ouverture) =====
export interface Trade { openT: number; closeT: number; dir: 1 | -1; pnl: number; r: number; catchUp: boolean }
export function run(c: Cfg, opts: { randomDir: boolean; seed: number; cost?: number } = { randomDir: false, seed: 7 }) {
  const cost = opts.cost ?? COST;
  const trades: Trade[] = []; const perDay = new Map<number, number>();
  let pos: { dir: 1 | -1; entry: number; sl: number; sl0: number; tp: number; openT: number; i0: number; day: number; catchUp: boolean; be: boolean } | null = null;
  const [sessStart, sessEnd] = c.sess ?? [SESSION_START, SESSION_END], catchUpHour = c.catchUpHour ?? CATCHUP_HOUR;
  let rnd = opts.seed >>> 0; // mulberry32
  const rand = () => { rnd = (rnd + 0x6d2b79f5) >>> 0; let z = rnd; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const close = (px: number, t: number) => { const p = pos!; const gross = (px - p.entry) * p.dir;
    trades.push({ openT: p.openT, closeT: t, dir: p.dir, pnl: (gross - cost) * LOT, r: gross / Math.abs(p.entry - p.sl0), catchUp: p.catchUp }); pos = null; };
  for (let i = START; i < m5.length; i++) {
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
    if (pos && c.maxBars && i - pos.i0 >= c.maxBars) { close(b.close, b.time); continue; } // sortie au temps, à la clôture
    if (pos && c.beAt && !pos.be && (b.close - pos.entry) * pos.dir >= c.beAt * Math.abs(pos.tp - pos.entry)) { pos.sl = pos.entry; pos.be = true; }
    if (pos || friday || hr < sessStart || hr >= sessEnd) continue;
    const n = perDay.get(d) ?? 0; if (n >= MAX_PER_DAY) continue;
    let sigDir = signal(c, i, true), catchUp = false;
    if (!sigDir && c.catchUp && hr >= catchUpHour && n < MIN_PER_DAY) { sigDir = signal(c, i, false); catchUp = sigDir !== 0; }
    if (!sigDir) continue;
    const dist = c.sl * atr[i]; if (!(dist > 0)) continue;
    if (c.minTpCost && c.rr * dist < c.minTpCost * cost) continue; // TP trop court face aux coûts
    const dir: 1 | -1 = opts.randomDir ? (rand() < 0.5 ? 1 : -1) : sigDir;
    pos = { dir, entry: b.close, sl: b.close - dir * dist, sl0: b.close - dir * dist, tp: b.close + dir * c.rr * dist, openT: b.time, i0: i, day: T.closeDay[i], catchUp, be: false };
    perDay.set(d, n + 1);
  }
  if (pos) close(m5[m5.length - 1].close, m5[m5.length - 1].time);
  return { trades, perDay };
}

// ===== Mesures, par moitié =====
// Fenêtre --months : coupure à minuit serveur, pour qu'un jour entier (ses trades et son quota) tombe dans une seule
// moitié. Sur tout le cache, les labos gardent la coupure au milieu exact, avec laquelle leurs chiffres ont été publiés.
const mid = Math.floor((m5[FIRST].time + lastT) / 2);
export const cutDay = T.openDay[m5.findIndex((b) => b.time >= mid)];
export const cut = MONTHS > 0 ? m5[m5.findIndex((_, i) => T.openDay[i] >= cutDay)].time : mid;
const sessionDays = [...new Set(m5.map((_, i) => i).filter((i) => i >= FIRST && T.openHour[i] >= SESSION_START && T.openHour[i] < SESSION_END).map((i) => T.openDay[i]))];
export const daysIn = { h1: sessionDays.filter((d) => d < cutDay).length, h2: sessionDays.filter((d) => d >= cutDay).length, all: sessionDays.length };
export type Half = 'h1' | 'h2' | 'all';
export interface St { n: number; net: number; pf: number; dd: number; perDay: number; ge4: number; win: number; r: number }
export function st(res: ReturnType<typeof run>, half: Half): St {
  const ts = res.trades.filter((t) => half === 'all' || (half === 'h1' ? t.openT < cut : t.openT >= cut));
  const net = ts.reduce((a, t) => a + t.pnl, 0);
  const gp = ts.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0), gl = ts.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  let eq = 0, peak = 0, dd = 0; for (const t of ts) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const days = [...res.perDay.entries()].filter(([d]) => half === 'all' || (half === 'h1' ? d < cutDay : d >= cutDay));
  return { n: ts.length, net, pf: gl ? gp / -gl : gp ? 99 : 0, dd, perDay: ts.length / daysIn[half], ge4: days.filter(([, v]) => v >= MIN_PER_DAY).length / daysIn[half],
    win: ts.length ? ts.filter((t) => t.pnl > 0).length / ts.length : 0, r: ts.length ? ts.reduce((a, t) => a + t.r, 0) / ts.length : 0 };
}
export const fmt = (v: number) => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US');
export const cell = (x: St) => `PF ${x.pf.toFixed(2)} · net ${fmt(x.net).padStart(8)} $ · ${x.perDay.toFixed(1)} tr/j · ≥4 ${String(Math.round(100 * x.ge4)).padStart(3)} %`;
export function spearman(a: number[], b: number[]) {
  const rank = (v: number[]) => { const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array<number>(v.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
  const ra = rank(a), rb = rank(b), n = a.length, ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; }
  return num / Math.sqrt(da * db);
}
