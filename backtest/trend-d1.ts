// SYSTÈME DE TENDANCE EN JOURNALIER — le premier candidat qui ressemble à un edge, mis en équité (03/09/2026).
//
// CE QUE LE LABO JOURNALIER A MONTRÉ (edge-lab-d1.ts, or 2008 → 2026, 18 ans) : la cassure de canal Donchian
// touche +1R avant −1R dans 58 % des cas (50 j, 149 entrées) et 63 % (100 j, 98 entrées) contre 43 % pour la ligne
// de base — +15 et +20 points, espérance +0,17 / +0,27 R par trade après coûts. C'est l'edge le plus ancien et le
// plus documenté qui existe (suivi de tendance à la cassure, dit « des Turtles »), et il a exactement le profil
// connu : des années fastes, et des sécheresses de plusieurs années (2015–2017, 2021, 2023).
//
// Un taux de +1R ne fait pas un produit. Ce fichier simule le SYSTÈME complet, année par année, pour répondre
// à ce qu'un client verrait : rendement annuel, pire année, pire perte depuis un sommet, durée de la plus longue
// traversée du désert, nombre de trades. Règles conventionnelles, posées avant de regarder l'équité :
//   · entrée : clôture au-dessus du plus-haut des N derniers jours → long ; sous le plus-bas → short (N = 50 et 100) ;
//   · stop initial : 2 ATR(20 j) ; sortie : clôture au-delà du canal opposé de N/2 jours (le stop suit, jamais ne recule) ;
//   · risque : 1 % de l'équité par trade (taille = 1 % / (2 ATR × contrat)) ; une position à la fois ;
//   · coûts : spread + glissement + commission par unité, à l'entrée et à la sortie ; pas de swap (à ajouter si
//     la tenue moyenne dépasse quelques semaines — noté, pas caché).
// Deux témoins : « achat et conservation » (ce que fait l'or tout seul) et « long seulement » (la moitié du
// système qui ne parie pas contre la dérive de l'or).
//
//   npx tsx backtest/trend-d1.ts            (XAUUSD · BTCUSD)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

const sym = process.argv[2] ?? 'XAUUSD';
const path = `backtest/.cache/${sym}-D1-15.json`;
if (!existsSync(path)) { console.error(`${path} absent → node scripts/pull-cache.mjs ${sym} D1`); process.exit(1); }
const bars = JSON.parse(readFileSync(path, 'utf8')) as Bar[];
const n = bars.length;
const SPEC: Record<string, { contract: number; cost: number }> = { XAUUSD: { contract: 100, cost: 0.32 }, BTCUSD: { contract: 1, cost: 15 } };
const spec = SPEC[sym] ?? SPEC.XAUUSD;
const START = 10_000, RISK = 0.01;
const year = (t: number) => new Date(t).getUTCFullYear();
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const f1 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);

const atr20 = new Array<number>(n).fill(0);
{ const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low)); let s = 0; for (let i = 0; i < n; i++) { s += tr[i]; if (i >= 20) s -= tr[i - 20]; atr20[i] = s / Math.min(20, i + 1); } }
const hh = (i: number, N: number) => { let h = -Infinity; for (let k = i - N; k < i; k++) h = Math.max(h, bars[k].high); return h; };
const ll = (i: number, N: number) => { let l = Infinity; for (let k = i - N; k < i; k++) l = Math.min(l, bars[k].low); return l; };

interface Trade { dir: 1 | -1; entryTime: number; exitTime: number; entry: number; exit: number; units: number; pnl: number; r: number; days: number }
interface Result { name: string; trades: Trade[]; equity: Array<{ t: number; eq: number }> }

function run(name: string, N: number, longOnly = false): Result {
  const EXIT = Math.max(10, Math.floor(N / 2));
  let eq = START;
  let pos: { dir: 1 | -1; entry: number; units: number; stop: number; i0: number; risk: number } | null = null;
  const trades: Trade[] = []; const equity: Array<{ t: number; eq: number }> = [];
  for (let i = Math.max(N, 260); i < n - 1; i++) {
    const b = bars[i];
    if (pos) {
      // 1) stop touché dans la journée (pessimiste : au stop, avec coûts)
      const hit = pos.dir === 1 ? b.low <= pos.stop : b.high >= pos.stop;
      // 2) sortie de canal opposé à la clôture
      const chan = pos.dir === 1 ? b.close < ll(i, EXIT) : b.close > hh(i, EXIT);
      if (hit || chan) {
        const px = hit ? pos.stop : b.close;
        const pnl = (px - pos.entry) * pos.dir * pos.units * spec.contract - spec.cost * pos.units * spec.contract;
        eq += pnl;
        trades.push({ dir: pos.dir, entryTime: bars[pos.i0].time, exitTime: b.time, entry: pos.entry, exit: px, units: pos.units, pnl, r: pnl / pos.risk, days: i - pos.i0 });
        pos = null;
      } else {
        // le stop suit le canal de sortie, jamais à reculons
        const trail = pos.dir === 1 ? ll(i, EXIT) : hh(i, EXIT);
        pos.stop = pos.dir === 1 ? Math.max(pos.stop, trail) : Math.min(pos.stop, trail);
      }
    }
    if (!pos) {
      const up = b.close > hh(i, N), dn = b.close < ll(i, N);
      if (up || (dn && !longOnly)) {
        const dir: 1 | -1 = up ? 1 : -1;
        const entry = bars[i + 1].open; // entrée à l'ouverture du lendemain
        const dist = 2 * atr20[i]; if (!(dist > 0)) continue;
        const risk = eq * RISK;
        const units = risk / (dist * spec.contract);
        pos = { dir, entry, units, stop: entry - dir * dist, i0: i + 1, risk };
      }
    }
    const floating = pos ? (b.close - pos.entry) * pos.dir * pos.units * spec.contract : 0;
    equity.push({ t: b.time, eq: eq + floating });
  }
  return { name, trades, equity };
}

function report(r: Result) {
  const years = [...new Set(r.equity.map((e) => year(e.t)))];
  let peak = -Infinity, maxDd = 0, ddStart = 0, longestDd = 0, ddFrom = 0;
  for (const e of r.equity) {
    if (e.eq > peak) { peak = e.eq; ddFrom = e.t; }
    const dd = (peak - e.eq) / peak; if (dd > maxDd) { maxDd = dd; ddStart = ddFrom; }
    longestDd = Math.max(longestDd, (e.t - ddFrom) / 86_400_000);
  }
  const first = r.equity[0].eq, last = r.equity[r.equity.length - 1].eq;
  const yrs = (r.equity[r.equity.length - 1].t - r.equity[0].t) / (365.25 * 86_400_000);
  const cagr = Math.pow(last / first, 1 / yrs) - 1;
  console.log(`\n────────  ${r.name}  ·  ${r.trades.length} trades · ${dayStr(r.equity[0].t)} → ${dayStr(r.equity[r.equity.length - 1].t)}  ────────`);
  const wins = r.trades.filter((t) => t.pnl > 0).length;
  const avgR = r.trades.reduce((s, t) => s + t.r, 0) / Math.max(1, r.trades.length);
  const avgDays = r.trades.reduce((s, t) => s + t.days, 0) / Math.max(1, r.trades.length);
  console.log(`rendement annualisé ${f1(cagr * 100)} % · pire perte depuis un sommet −${(maxDd * 100).toFixed(1)} % (depuis ${dayStr(ddStart)}) · plus longue traversée du désert ${Math.round(longestDd)} j · trades gagnants ${Math.round((100 * wins) / Math.max(1, r.trades.length))} % · R moyen ${avgR.toFixed(2)} · tenue moyenne ${avgDays.toFixed(0)} j`);
  const line: string[] = [];
  for (const y of years) {
    const pts = r.equity.filter((e) => year(e.t) === y);
    const prev = r.equity[r.equity.indexOf(pts[0]) - 1]?.eq ?? pts[0].eq;
    const ret = pts[pts.length - 1].eq / prev - 1;
    const nt = r.trades.filter((t) => year(t.exitTime) === y).length;
    line.push(`${y} ${f1(ret * 100)} % (${nt})`);
  }
  console.log('par année (trades) : ' + line.join(' · '));
  const neg = years.filter((y) => { const pts = r.equity.filter((e) => year(e.t) === y); const prev = r.equity[r.equity.indexOf(pts[0]) - 1]?.eq ?? pts[0].eq; return pts[pts.length - 1].eq / prev - 1 < 0; }).length;
  console.log(`années négatives : ${neg}/${years.length}`);
}

console.log(`\n================  SYSTÈME DE TENDANCE JOURNALIER — ${sym} · ${n} jours · ${dayStr(bars[0].time)} → ${dayStr(bars[n - 1].time)} · risque ${RISK * 100} %/trade · départ ${START} $  ================`);
// Témoin : achat et conservation (ce que fait l'actif tout seul, même échelle de temps)
{
  const i0 = 260; const units = START / (bars[i0].close * spec.contract);
  const equity = bars.slice(i0, n - 1).map((b) => ({ t: b.time, eq: units * b.close * spec.contract }));
  report({ name: 'TÉMOIN · achat et conservation', trades: [], equity });
}
report(run('Donchian 50 j (sortie canal 25 j, stop 2 ATR) · long et short', 50));
report(run('Donchian 50 j · LONG SEULEMENT', 50, true));
report(run('Donchian 100 j (sortie canal 50 j, stop 2 ATR) · long et short', 100));
report(run('Donchian 100 j · LONG SEULEMENT', 100, true));
report(run('Donchian 20 j (sortie canal 10 j) · long et short — le réglage rapide, témoin de robustesse', 20));
console.log('');
