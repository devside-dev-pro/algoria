// LABO D'EDGE EN JOURNALIER — la direction de fond, sur dix ans (03/09/2026).
//
// POURQUOI UN LABO À PART. Sur deux ans de M5, aucune règle intraday ne passe la barre, sur l'or comme sur BTC
// (backtest/edge-lab.ts) : avec un stop de 1 ATR M5, les coûts pèsent 0,1 à 0,2 R par trade et le hasard perd
// −0,13 R avant toute variance. La seule structure que les données ont montrée est la direction du SEMESTRE
// (2025-H1 : longs au hasard 56 %). Un stop journalier de 2 ATR(20 j) ramène le coût à ~0,02 R : c'est là que la
// direction de fond a une chance de payer. Mais deux ans d'or, c'est UN régime (une hausse historique) — il faut
// dix ans pour séparer « la stratégie marche » de « l'or a monté ». D'où le journalier, et d'où --from 2014.
//
// LA BARRE, par ANNÉE cette fois (le journalier donne moins d'entrées) : +1R avant −1R ≥ ligne de base de la
// même année + 5 pts (en journalier avec un horizon de 20 jours, beaucoup d'entrées n'atteignent ni +1R ni −1R :
// le hasard n'est pas 50 %, c'est la ligne de base qui le dit), et espérance RÉELLE après coûts > 0 à TP 1R ou
// 2R — un trade coupé à l'horizon compte pour ce qu'il vaut à ce moment-là, pas pour une perte pleine. Toutes
// obligatoires, sur chaque année jugée (n ≥ 15). Paramètres conventionnels de la littérature (momentum 3/6/12 mois, SMA 200, Donchian 50/100),
// posés avant de regarder.
//
// FAMILLES :
//   M. Momentum temporel — direction = signe du rendement sur 3 / 6 / 12 mois, entrée chaque lundi à l'ouverture,
//      stop 2 ATR(20 j), horizon 20 jours de bourse.
//   S. Filtre SMA 200 — long si clôture > SMA200 et SMA200 montante, short si l'inverse ; même cadence, même stop.
//   K. Cassure de canal Donchian 50 / 100 jours — entrée à la clôture qui sort du canal, stop 2 ATR, horizon 40 j.
//   Z. Ligne de base — une entrée chaque lundi, long ET short, stop 2 ATR. Le hasard de chaque année.
//
//   npx tsx scripts/backfill-gaps.ts XAUUSD D1 --from 2014-01-01 --broker Gold
//   node scripts/pull-cache.mjs XAUUSD D1
//   npx tsx backtest/edge-lab-d1.ts            (BTCUSD : mêmes commandes avec --broker Bitcoin)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

const sym = process.argv[2] ?? 'XAUUSD';
const path = `backtest/.cache/${sym}-D1-15.json`;
if (!existsSync(path)) { console.error(`${path} absent → npx tsx scripts/backfill-gaps.ts ${sym} D1 --from 2014-01-01 --broker <nom broker> && node scripts/pull-cache.mjs ${sym} D1`); process.exit(1); }
const bars = JSON.parse(readFileSync(path, 'utf8')) as Bar[];
const n = bars.length;
const COST: Record<string, number> = { XAUUSD: 0.2 + 0.05 + 0.07, BTCUSD: 10 + 5 + 0 };
const cost = COST[sym] ?? COST.XAUUSD;
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const pct = (a: number, d: number) => (d ? Math.round((100 * a) / d) : 0);
const year = (t: number) => String(new Date(t).getUTCFullYear());
const isMonday = (t: number) => new Date(t).getUTCDay() === 1;

// ===== Indicateurs causaux =====
const atr20 = new Array<number>(n).fill(0);
{ const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low)); let s = 0; for (let i = 0; i < n; i++) { s += tr[i]; if (i >= 20) s -= tr[i - 20]; atr20[i] = s / Math.min(20, i + 1); } }
const sma200 = new Array<number>(n).fill(0);
{ let s = 0; for (let i = 0; i < n; i++) { s += bars[i].close; if (i >= 200) s -= bars[i - 200].close; sma200[i] = s / Math.min(200, i + 1); } }

// ===== Mesure : +1R / +2R avant −1R sur le trajet D1 à partir du lendemain (entrée à son open) =====
interface Entry { i: number; dir: 1 | -1; risk: number }
interface Out { i: number; dir: 1 | -1; risk: number; mfe: number; stopped: boolean; endR: number }
function measure(e: Entry, maxBars: number): Out | null {
  const i0 = e.i + 1;
  if (i0 >= n || !(e.risk > 0)) return null;
  const entry = bars[i0].open;
  let best = 0, stopped = false, endR = 0;
  for (let i = i0; i < n && i - i0 < maxBars; i++) {
    const b = bars[i];
    const adverse = (e.dir * (entry - (e.dir === 1 ? b.low : b.high))) / e.risk;
    if (adverse >= 1) { stopped = true; break; }
    endR = (e.dir * (b.close - entry)) / e.risk; // où en est le trade si l'horizon s'arrête ici // pessimiste : une journée qui touche les deux côtés compte comme un stop
    best = Math.max(best, (e.dir * ((e.dir === 1 ? b.high : b.low) - entry)) / e.risk);
  }
  return { i: i0, dir: e.dir, risk: e.risk, mfe: best, stopped, endR };
}

interface Cand { key: string; name: string; horizon: number; gen: () => Entry[] }
const CANDS: Cand[] = [];
const WARM = 260;

// M. Momentum temporel 3 / 6 / 12 mois (63 / 126 / 252 jours de bourse), chaque lundi.
for (const [label, k] of [['3 mois', 63], ['6 mois', 126], ['12 mois', 252]] as Array<[string, number]>) {
  CANDS.push({ key: `M-${k}`, name: `M · momentum ${label}, entrée le lundi, stop 2 ATR(20 j), horizon 20 j`, horizon: 20, gen: () => {
    const out: Entry[] = [];
    for (let i = Math.max(WARM, k); i < n; i++) {
      if (!isMonday(bars[i].time)) continue;
      const r = bars[i].close - bars[i - k].close; if (r === 0) continue;
      out.push({ i, dir: r > 0 ? 1 : -1, risk: 2 * atr20[i] });
    }
    return out;
  } });
}

// S. Filtre SMA 200 (clôture au-dessus ET moyenne montante sur 20 j → long ; l'inverse → short), chaque lundi.
CANDS.push({ key: 'S', name: 'S · SMA 200 (clôture > SMA et SMA montante → long, inverse → short), lundi, stop 2 ATR, horizon 20 j', horizon: 20, gen: () => {
  const out: Entry[] = [];
  for (let i = WARM; i < n; i++) {
    if (!isMonday(bars[i].time)) continue;
    const up = bars[i].close > sma200[i] && sma200[i] > sma200[i - 20];
    const dn = bars[i].close < sma200[i] && sma200[i] < sma200[i - 20];
    if (up) out.push({ i, dir: 1, risk: 2 * atr20[i] });
    else if (dn) out.push({ i, dir: -1, risk: 2 * atr20[i] });
  }
  return out;
} });

// K. Donchian 50 / 100 : clôture au-dessus du plus-haut des N derniers jours → long (inverse → short), stop 2 ATR, horizon 40 j, un trade par cassure.
for (const N of [50, 100]) {
  CANDS.push({ key: `K-${N}`, name: `K · cassure de canal Donchian ${N} j, stop 2 ATR, horizon 40 j`, horizon: 40, gen: () => {
    const out: Entry[] = []; let cool = 0;
    for (let i = Math.max(WARM, N); i < n; i++) {
      if (cool > 0) { cool--; continue; }
      let hi = -Infinity, lo = Infinity;
      for (let k = i - N; k < i; k++) { hi = Math.max(hi, bars[k].high); lo = Math.min(lo, bars[k].low); }
      if (bars[i].close > hi) { out.push({ i, dir: 1, risk: 2 * atr20[i] }); cool = 10; }
      else if (bars[i].close < lo) { out.push({ i, dir: -1, risk: 2 * atr20[i] }); cool = 10; }
    }
    return out;
  } });
}

// Z. Ligne de base : chaque lundi, long ET short, stop 2 ATR.
CANDS.push({ key: 'Z', name: 'Z · LIGNE DE BASE — chaque lundi, long et short, stop 2 ATR(20 j)', horizon: 20, gen: () => {
  const out: Entry[] = [];
  for (let i = WARM; i < n; i++) if (isMonday(bars[i].time)) { out.push({ i, dir: 1, risk: 2 * atr20[i] }); out.push({ i, dir: -1, risk: 2 * atr20[i] }); }
  return out;
} });

// ===== Rapport =====
const periods = [...new Set(bars.map((b) => year(b.time)))].sort();
type Cell = { n: number; p1: number; p2: number; costR: number; r1: number; r2: number };
const empty = (): Cell => ({ n: 0, p1: 0, p2: 0, costR: 0, r1: 0, r2: 0 });
// Résultat RÉEL d'un trade à TP fixe k : +k si le TP est touché, −1 si le stop l'est, sinon le résultat à
// l'horizon (le trade est coupé au close). Une entrée qui n'atteint ni l'un ni l'autre n'est pas une perte pleine.
const outcome = (o: Out, k: number) => (o.mfe >= k ? k : o.stopped ? -1 : o.endR);
const add = (c: Cell, o: Out) => { c.n++; if (o.mfe >= 1) c.p1++; if (o.mfe >= 2) c.p2++; c.costR += cost / o.risk; c.r1 += outcome(o, 1); c.r2 += outcome(o, 2); };
const exp1 = (c: Cell) => (c.n ? (c.r1 - c.costR) / c.n : 0); // espérance en R à TP 1R, après coûts
const exp2 = (c: Cell) => (c.n ? (c.r2 - c.costR) / c.n : 0); // idem à TP 2R
const f2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);
const MIN_N = 15;

console.log(`\n================  LABO D'EDGE JOURNALIER — ${sym} D1 · ${n} jours · ${dayStr(bars[0].time)} → ${dayStr(bars[n - 1].time)}  ================`);
console.log(`Barre : +1R avant −1R ≥ base + 5 pts · espérance réelle après coûts > 0 (TP 1R ou 2R) · sur chaque année jugée (n ≥ ${MIN_N}).`);
if (n < 1500) console.log(`⚠️ ${n} jours seulement (${(n / 252).toFixed(1)} ans) : l'historique est court pour juger une direction de fond — voir --from dans backfill-gaps.`);

const baseCells = new Map<string, Cell>();
for (const cand of [...CANDS].sort((a, b) => (a.key === 'Z' ? -1 : b.key === 'Z' ? 1 : 0))) {
  const outs = cand.gen().map((e) => measure(e, cand.horizon)).filter((o): o is Out => !!o);
  const byP = new Map<string, Cell>(); const byDir: Record<string, Cell> = { long: empty(), short: empty() }; const tot = empty();
  for (const o of outs) { const p = year(bars[o.i].time); if (!byP.has(p)) byP.set(p, empty()); add(byP.get(p)!, o); add(byDir[o.dir === 1 ? 'long' : 'short'], o); add(tot, o); }
  if (cand.key === 'Z') for (const [p, c] of byP) baseCells.set(p, c);
  console.log(`\n────────  ${cand.name}  ·  ${outs.length} entrées  ────────`);
  console.log(`${'année'.padEnd(8)} ${'n'.padStart(5)} ${'+1R'.padStart(5)} ${'+2R'.padStart(5)} ${'base'.padStart(5)} ${'E[TP1R]'.padStart(8)} ${'E[TP2R]'.padStart(8)}`);
  const judged: boolean[] = [];
  for (const p of periods) {
    const c = byP.get(p); if (!c || !c.n) continue;
    const base = baseCells.get(p); const b1 = base && base.n ? pct(base.p1, base.n) : NaN;
    const p1 = pct(c.p1, c.n);
    const ok = !Number.isNaN(b1) && p1 >= b1 + 5 && (exp1(c) > 0 || exp2(c) > 0);
    if (c.n >= MIN_N) judged.push(ok);
    console.log(`${p.padEnd(8)} ${String(c.n).padStart(5)} ${(p1 + '%').padStart(5)} ${(pct(c.p2, c.n) + '%').padStart(5)} ${(Number.isNaN(b1) ? '—' : b1 + '%').padStart(5)} ${f2(exp1(c)).padStart(8)} ${f2(exp2(c)).padStart(8)}${c.n < MIN_N ? '   (trop peu)' : ok ? '   ✓' : '   ✗'}`);
  }
  console.log(`${'TOTAL'.padEnd(8)} ${String(tot.n).padStart(5)} ${(pct(tot.p1, tot.n) + '%').padStart(5)} ${(pct(tot.p2, tot.n) + '%').padStart(5)} ${''.padStart(5)} ${f2(exp1(tot)).padStart(8)} ${f2(exp2(tot)).padStart(8)}   long ${byDir.long.n} · ${pct(byDir.long.p1, byDir.long.n)} %  ·  short ${byDir.short.n} · ${pct(byDir.short.p1, byDir.short.n)} %`);
  if (cand.key !== 'Z') {
    const fails = judged.filter((j) => !j).length;
    const verdict = judged.length >= 5 && fails === 0 ? '✅ PASSE LA BARRE sur chaque année jugée' : judged.length < 5 ? `— ${judged.length} année(s) jugeable(s), il en faut 5` : `✗ tombe (${fails}/${judged.length} années sous la barre)`;
    console.log(`VERDICT : ${verdict}`);
  }
}
console.log('');
