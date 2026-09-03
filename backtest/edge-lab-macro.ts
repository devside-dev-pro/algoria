// LABO INTER-MARCHÉS — l'or contre le dollar et les taux (03/09/2026).
//
// L'IDÉE (texte de Mathieu) : « l'or est inversement corrélé au dollar (DXY) et aux rendements des obligations
// d'État (10 ans US). Un bot performant intègre les flux de taux pour anticiper le XAU/USD. » La corrélation est un
// fait. La question du labo est autre : est-ce qu'un mouvement DÉJÀ VU des taux ou du dollar dit quelque chose sur
// l'or des DIX JOURS SUIVANTS ? Si les deux bougent en même temps, savoir que les taux ont monté hier n'aide pas à
// vendre l'or demain — c'est déjà dans le prix. Règles posées avant de regarder, horizon 10 j, stop 2 ATR(20 j),
// entrée à l'ouverture du lendemain, jugées année par année contre la ligne de base Z10 (même horizon) :
//   X1. taux 10 ans : variation sur 5 j > +1 σ (σ des variations 5 j sur 250 j) → SHORT or ; < −1 σ → LONG or.
//   X2. dollar (indice large de la Fed, DTWEXBGS) : même règle.
//   X3. retard de réaction : la veille, les taux ont fait > +1 σ (1 j) et l'or a CLÔTURÉ EN HAUSSE ce jour-là →
//       SHORT (rattrapage attendu) ; symétrique pour le long.
//   X4. accord : X1 et X2 donnent le même sens le même jour.
//   Z10. ligne de base : chaque lundi, long et short, stop 2 ATR, horizon 10 j.
// Données : bougies D1 du broker (backtest/.cache/XAUUSD-D1-15.json) et deux séries publiques de la Fed
// (backtest/.cache/DGS10.csv, DTWEXBGS.csv — voir .github/workflows/lab.yml, entrée « macro »). La valeur
// macro utilisée à la clôture de la séance D est celle datée D (les taux US clôturent avant l'or), ou la dernière
// connue avant.
//
//   npx tsx backtest/edge-lab-macro.ts            (XAUUSD)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

const sym = process.argv[2] ?? 'XAUUSD';
const path = `backtest/.cache/${sym}-D1-15.json`;
for (const f of [path, 'backtest/.cache/DGS10.csv', 'backtest/.cache/DTWEXBGS.csv']) if (!existsSync(f)) { console.error(`${f} absent — lancer le workflow lab.yml avec macro=oui, ou télécharger les CSV FRED à la main`); process.exit(1); }
const bars = (JSON.parse(readFileSync(path, 'utf8')) as Bar[]).sort((a, b) => a.time - b.time);
const n = bars.length;
const costAt = (price: number) => (sym === 'BTCUSD' ? price * 0.0005 : 0.2 + 0.05 + 0.07);
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const pct = (a: number, d: number) => (d ? Math.round((100 * a) / d) : 0);
const year = (t: number) => String(new Date(t).getUTCFullYear());
const isMonday = (t: number) => new Date(t).getUTCDay() === 1;
const f2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);

// ===== Séries FRED : date → valeur (les « . » sont des jours fériés, ignorés) =====
function loadFred(file: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(','); const x = Number(v);
    if (d && v !== undefined && v.trim() !== '.' && Number.isFinite(x)) m.set(d.trim(), x);
  }
  return m;
}
const dgs10 = loadFred('backtest/.cache/DGS10.csv');
const dxy = loadFred('backtest/.cache/DTWEXBGS.csv');
// Séance D d'une bougie : la bougie journalière du broker ouvre la veille au soir (≈ 21-22 h UTC) → +4 h donne le bon jour.
const sessionDate = (t: number) => new Date(t + 4 * 3_600_000).toISOString().slice(0, 10);
// valeur macro connue à la clôture de la séance : datée D, sinon la dernière avant D (jusqu'à 10 jours en arrière)
function macroAt(series: Map<string, number>, d: string): number {
  const t0 = Date.parse(d + 'T00:00:00Z');
  for (let k = 0; k <= 10; k++) { const key = new Date(t0 - k * 86_400_000).toISOString().slice(0, 10); const v = series.get(key); if (v !== undefined) return v; }
  return NaN;
}
const y10 = bars.map((b) => macroAt(dgs10, sessionDate(b.time)));
const usd = bars.map((b) => macroAt(dxy, sessionDate(b.time)));
const covered = y10.filter((x) => !Number.isNaN(x)).length;

// ===== Indicateurs =====
const atr20 = new Array<number>(n).fill(0);
{ const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low)); let s = 0; for (let i = 0; i < n; i++) { s += tr[i]; if (i >= 20) s -= tr[i - 20]; atr20[i] = s / Math.min(20, i + 1); } }
/** variation sur k séances d'une série, et son écart-type glissant sur 250 séances (causal) */
function zChange(series: number[], k: number): number[] {
  const ch = series.map((v, i) => (i >= k && !Number.isNaN(v) && !Number.isNaN(series[i - k]) ? v - series[i - k] : NaN));
  const z = new Array<number>(n).fill(NaN);
  for (let i = 250; i < n; i++) {
    const w = ch.slice(i - 250, i).filter((x) => !Number.isNaN(x)); if (w.length < 100 || Number.isNaN(ch[i])) continue;
    const m = w.reduce((a, b) => a + b, 0) / w.length; const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
    z[i] = sd > 0 ? (ch[i] - m) / sd : NaN;
  }
  return z;
}
const zY5 = zChange(y10, 5), zU5 = zChange(usd, 5), zY1 = zChange(y10, 1), zU1 = zChange(usd, 1);

// ===== Mesure (identique à edge-lab-d1.ts) =====
interface Entry { i: number; dir: 1 | -1; risk: number }
interface Out { i: number; dir: 1 | -1; risk: number; mfe: number; stopped: boolean; endR: number }
function measure(e: Entry, maxBars: number): Out | null {
  const i0 = e.i + 1; if (i0 >= n || !(e.risk > 0)) return null;
  const entry = bars[i0].open; let best = 0, stopped = false, endR = 0;
  for (let i = i0; i < n && i - i0 < maxBars; i++) {
    const b = bars[i];
    const adverse = (e.dir * (entry - (e.dir === 1 ? b.low : b.high))) / e.risk;
    if (adverse >= 1) { stopped = true; break; }
    endR = (e.dir * (b.close - entry)) / e.risk;
    best = Math.max(best, (e.dir * ((e.dir === 1 ? b.high : b.low) - entry)) / e.risk);
  }
  return { i: i0, dir: e.dir, risk: e.risk, mfe: best, stopped, endR };
}
interface Cand { key: string; name: string; gen: () => Entry[] }
const CANDS: Cand[] = []; const WARM = 260; const HZ = 10;
const family = (key: string, name: string, sig: (i: number) => 1 | -1 | 0) => CANDS.push({ key, name, gen: () => {
  const out: Entry[] = []; let cool = 0;
  for (let i = WARM; i < n; i++) { if (cool > 0) { cool--; continue; } const d = sig(i); if (d) { out.push({ i, dir: d, risk: 2 * atr20[i] }); cool = 3; } }
  return out;
} });
family('X1', 'X1 · taux 10 ans : variation 5 j > +1 σ → short or, < −1 σ → long or', (i) => (zY5[i] > 1 ? -1 : zY5[i] < -1 ? 1 : 0));
family('X2', 'X2 · dollar (Fed, indice large) : variation 5 j > +1 σ → short or, < −1 σ → long or', (i) => (zU5[i] > 1 ? -1 : zU5[i] < -1 ? 1 : 0));
family('X3', 'X3 · retard de réaction : taux > +1 σ sur la journée ET or en hausse le même jour → short (symétrique)', (i) => {
  const up = bars[i].close > bars[i - 1].close;
  if (zY1[i] > 1 && up) return -1; if (zY1[i] < -1 && !up) return 1; return 0;
});
family('X4', 'X4 · accord taux ET dollar (X1 et X2 dans le même sens)', (i) => {
  const a = zY5[i] > 1 ? -1 : zY5[i] < -1 ? 1 : 0, b = zU5[i] > 1 ? -1 : zU5[i] < -1 ? 1 : 0;
  return a !== 0 && a === b ? a : 0;
});
CANDS.push({ key: 'Z10', name: 'Z10 · LIGNE DE BASE — chaque lundi, long et short, stop 2 ATR(20 j), horizon 10 j', gen: () => {
  const out: Entry[] = [];
  for (let i = WARM; i < n; i++) if (isMonday(bars[i].time)) { out.push({ i, dir: 1, risk: 2 * atr20[i] }); out.push({ i, dir: -1, risk: 2 * atr20[i] }); }
  return out;
} });

// ===== Rapport (même barre que edge-lab-d1.ts) =====
const periods = [...new Set(bars.map((b) => year(b.time)))].sort();
type Cell = { n: number; p1: number; p2: number; costR: number; r1: number; r2: number };
const empty = (): Cell => ({ n: 0, p1: 0, p2: 0, costR: 0, r1: 0, r2: 0 });
const outcome = (o: Out, k: number) => (o.mfe >= k ? k : o.stopped ? -1 : o.endR);
const add = (c: Cell, o: Out) => { c.n++; if (o.mfe >= 1) c.p1++; if (o.mfe >= 2) c.p2++; c.costR += costAt(bars[o.i].open) / o.risk; c.r1 += outcome(o, 1); c.r2 += outcome(o, 2); };
const exp1 = (c: Cell) => (c.n ? (c.r1 - c.costR) / c.n : 0);
const exp2 = (c: Cell) => (c.n ? (c.r2 - c.costR) / c.n : 0);
const MIN_N = 15;

console.log(`\n================  LABO INTER-MARCHÉS — ${sym} D1 · ${n} jours · ${dayStr(bars[0].time)} → ${dayStr(bars[n - 1].time)} · séries FRED : taux 10 ans ${dgs10.size} pts, dollar ${dxy.size} pts · couverture ${pct(covered, n)} % des séances  ================`);
console.log(`Barre : +1R avant −1R ≥ base + 5 pts · espérance réelle après coûts > 0 (TP 1R ou 2R) · sur chaque année jugée (n ≥ ${MIN_N}) · horizon ${HZ} j.`);
let baseByYear = new Map<string, Cell>();
for (const cand of [...CANDS].sort((a, b) => (a.key === 'Z10' ? -1 : b.key === 'Z10' ? 1 : 0))) {
  const outs = cand.gen().map((e) => measure(e, HZ)).filter((o): o is Out => !!o);
  const byP = new Map<string, Cell>(); const byDir: Record<string, Cell> = { long: empty(), short: empty() }; const tot = empty();
  for (const o of outs) { const p = year(bars[o.i].time); if (!byP.has(p)) byP.set(p, empty()); add(byP.get(p)!, o); add(byDir[o.dir === 1 ? 'long' : 'short'], o); add(tot, o); }
  if (cand.key === 'Z10') baseByYear = byP;
  console.log(`\n────────  ${cand.name}  ·  ${outs.length} entrées  ────────`);
  console.log(`${'année'.padEnd(8)} ${'n'.padStart(5)} ${'+1R'.padStart(5)} ${'+2R'.padStart(5)} ${'base'.padStart(5)} ${'E[TP1R]'.padStart(8)} ${'E[TP2R]'.padStart(8)}`);
  const judged: boolean[] = [];
  for (const p of periods) {
    const c = byP.get(p); if (!c || !c.n) continue;
    const base = baseByYear.get(p); const b1 = base && base.n ? pct(base.p1, base.n) : NaN;
    const p1 = pct(c.p1, c.n);
    const ok = !Number.isNaN(b1) && p1 >= b1 + 5 && (exp1(c) > 0 || exp2(c) > 0);
    if (c.n >= MIN_N) judged.push(ok);
    console.log(`${p.padEnd(8)} ${String(c.n).padStart(5)} ${(p1 + '%').padStart(5)} ${(pct(c.p2, c.n) + '%').padStart(5)} ${(Number.isNaN(b1) ? '—' : b1 + '%').padStart(5)} ${f2(exp1(c)).padStart(8)} ${f2(exp2(c)).padStart(8)}${c.n < MIN_N ? '   (trop peu)' : ok ? '   ✓' : '   ✗'}`);
  }
  console.log(`${'TOTAL'.padEnd(8)} ${String(tot.n).padStart(5)} ${(pct(tot.p1, tot.n) + '%').padStart(5)} ${(pct(tot.p2, tot.n) + '%').padStart(5)} ${''.padStart(5)} ${f2(exp1(tot)).padStart(8)} ${f2(exp2(tot)).padStart(8)}   long ${byDir.long.n} · ${pct(byDir.long.p1, byDir.long.n)} %  ·  short ${byDir.short.n} · ${pct(byDir.short.p1, byDir.short.n)} %`);
  if (cand.key !== 'Z10') {
    const fails = judged.filter((j) => !j).length;
    console.log(`VERDICT : ${judged.length >= 5 && fails === 0 ? '✅ PASSE LA BARRE sur chaque année jugée' : judged.length < 5 ? `— ${judged.length} année(s) jugeable(s), il en faut 5` : `✗ tombe (${fails}/${judged.length} années sous la barre)`}`);
  }
}
console.log('');
