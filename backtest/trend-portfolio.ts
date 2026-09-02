// PORTEFEUILLE DE TENDANCE — l'or ET BTC dans une seule équité (03/09/2026).
//
// POURQUOI. Le système de cassure de canal en journalier a passé la barre sur deux marchés séparément (or 2008 →
// 2026 : 58–63 % à +1R contre 43 % ; BTC 2012 → 2026 : 62–63 % contre 41 %). Mais chaque marché seul donne 3 à
// 12 % par an à 1 % de risque, avec des déserts de plusieurs années. Toute la valeur de cette famille est dans
// la DIVERSIFICATION : quand l'or dort (2011–2019), BTC travaille, et inversement. La question qu'un produit doit
// poser n'est pas « combien rapporte l'or » mais « à quoi ressemble la courbe quand on tient les deux ».
//
// RÈGLES (identiques à trend-d1.ts, aucun réglage) : entrée à la clôture hors du canal N, stop 2 ATR(20 j), sortie
// à la clôture hors du canal opposé N/2 (le stop suit), 1 % de l'équité COMMUNE par trade et par marché, une
// position par marché, coûts à l'entrée et à la sortie (or 0,32 $/once ; BTC 0,05 % du prix). Chaque marché
// est simulé jour par jour sur un calendrier fusionné ; l'équité est marquée au marché chaque jour.
//
//   npx tsx backtest/trend-portfolio.ts          (N = 50 · variantes 100 et long seulement)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

interface Market { sym: string; bars: Bar[]; contract: number; cost: (p: number) => number; atr: number[]; byTime: Map<number, number> }
const load = (sym: string, contract: number, cost: (p: number) => number): Market | null => {
  const p = `backtest/.cache/${sym}-D1-15.json`;
  if (!existsSync(p)) { console.error(`${p} absent`); return null; }
  const bars = JSON.parse(readFileSync(p, 'utf8')) as Bar[];
  const n = bars.length;
  const atr = new Array<number>(n).fill(0);
  const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low));
  let s = 0; for (let i = 0; i < n; i++) { s += tr[i]; if (i >= 20) s -= tr[i - 20]; atr[i] = s / Math.min(20, i + 1); }
  const byTime = new Map<number, number>(); bars.forEach((b, i) => byTime.set(Math.floor(b.time / 86_400_000), i));
  return { sym, bars, contract, cost, atr, byTime };
};
const gold = load('XAUUSD', 100, () => 0.32);
const btc = load('BTCUSD', 1, (p) => p * 0.0005);
if (!gold || !btc) process.exit(1);

const START = 10_000, RISK = 0.01;
const year = (t: number) => new Date(t).getUTCFullYear();
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const f1 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);
const hh = (m: Market, i: number, N: number) => { let h = -Infinity; for (let k = i - N; k < i; k++) h = Math.max(h, m.bars[k].high); return h; };
const ll = (m: Market, i: number, N: number) => { let l = Infinity; for (let k = i - N; k < i; k++) l = Math.min(l, m.bars[k].low); return l; };

interface Pos { dir: 1 | -1; entry: number; units: number; stop: number; risk: number; day: number }
interface Leg { market: Market; pos: Pos | null; trades: number; wins: number; pnl: number }

function run(name: string, N: number, longOnly: boolean, markets: Market[]) {
  const EXIT = Math.max(10, Math.floor(N / 2));
  let eq = START;
  const legs: Leg[] = markets.map((market) => ({ market, pos: null, trades: 0, wins: 0, pnl: 0 }));
  // calendrier fusionné : tous les jours où au moins un marché a une bougie, à partir du moment où les deux ont 260 jours d'historique
  const days = [...new Set(markets.flatMap((m) => m.bars.map((b) => Math.floor(b.time / 86_400_000))))].sort((a, b) => a - b);
  const startDay = Math.max(...markets.map((m) => Math.floor(m.bars[Math.max(N, 260)].time / 86_400_000)));
  const equity: Array<{ t: number; eq: number }> = [];
  const pending: Array<{ leg: Leg; dir: 1 | -1; dist: number }> = [];
  for (const d of days) {
    if (d < startDay) continue;
    let floating = 0;
    for (const leg of legs) {
      const m = leg.market; const i = m.byTime.get(d); if (i === undefined) { if (leg.pos) floating += 0; continue; }
      const b = m.bars[i];
      // entrées décidées la veille : exécutées à l'ouverture du jour
      for (const p of pending.filter((x) => x.leg === leg)) {
        const risk = eq * RISK; const units = risk / (p.dist * m.contract);
        leg.pos = { dir: p.dir, entry: b.open, units, stop: b.open - p.dir * p.dist, risk, day: d };
      }
      pending.splice(0, pending.length, ...pending.filter((x) => x.leg !== leg));
      if (leg.pos) {
        const pos = leg.pos;
        const hit = pos.dir === 1 ? b.low <= pos.stop : b.high >= pos.stop;
        const chan = i >= EXIT && (pos.dir === 1 ? b.close < ll(m, i, EXIT) : b.close > hh(m, i, EXIT));
        if (hit || chan) {
          const px = hit ? pos.stop : b.close;
          const pnl = (px - pos.entry) * pos.dir * pos.units * m.contract - ((m.cost(pos.entry) + m.cost(px)) / 2) * pos.units * m.contract;
          eq += pnl; leg.trades++; if (pnl > 0) leg.wins++; leg.pnl += pnl; leg.pos = null;
        } else {
          const trail = pos.dir === 1 ? ll(m, i, EXIT) : hh(m, i, EXIT);
          pos.stop = pos.dir === 1 ? Math.max(pos.stop, trail) : Math.min(pos.stop, trail);
        }
      }
      if (!leg.pos && i >= N && i < m.bars.length - 1) {
        const up = b.close > hh(m, i, N), dn = b.close < ll(m, i, N);
        if (up || (dn && !longOnly)) { const dist = 2 * m.atr[i]; if (dist > 0) pending.push({ leg, dir: up ? 1 : -1, dist }); }
      }
      if (leg.pos) floating += (b.close - leg.pos.entry) * leg.pos.dir * leg.pos.units * m.contract;
    }
    equity.push({ t: d * 86_400_000, eq: eq + floating });
  }
  // rapport
  let peak = -Infinity, maxDd = 0, ddStart = 0, longest = 0, from = 0;
  for (const e of equity) { if (e.eq > peak) { peak = e.eq; from = e.t; } const dd = (peak - e.eq) / peak; if (dd > maxDd) { maxDd = dd; ddStart = from; } longest = Math.max(longest, (e.t - from) / 86_400_000); }
  const yrs = (equity[equity.length - 1].t - equity[0].t) / (365.25 * 86_400_000);
  const cagr = Math.pow(equity[equity.length - 1].eq / equity[0].eq, 1 / yrs) - 1;
  const years = [...new Set(equity.map((e) => year(e.t)))];
  const rets = years.map((y) => { const pts = equity.filter((e) => year(e.t) === y); const prev = equity[equity.indexOf(pts[0]) - 1]?.eq ?? pts[0].eq; return pts[pts.length - 1].eq / prev - 1; });
  console.log(`\n────────  ${name}  ·  ${dayStr(equity[0].t)} → ${dayStr(equity[equity.length - 1].t)}  ────────`);
  console.log(`rendement annualisé ${f1(cagr * 100)} % · pire perte depuis un sommet −${(maxDd * 100).toFixed(1)} % (depuis ${dayStr(ddStart)}) · plus longue traversée du désert ${Math.round(longest)} j · années négatives ${rets.filter((r) => r < 0).length}/${years.length} · pire année ${f1(Math.min(...rets) * 100)} %`);
  console.log('par année : ' + years.map((y, k) => `${y} ${f1(rets[k] * 100)} %`).join(' · '));
  console.log('par marché : ' + legs.map((l) => `${l.market.sym} ${l.trades} trades · ${l.trades ? Math.round((100 * l.wins) / l.trades) : 0} % gagnants · ${f1(l.pnl / START * 100)} % de l'équité de départ`).join('  |  '));
}

console.log(`\n================  PORTEFEUILLE DE TENDANCE — or + BTC · risque ${RISK * 100} %/trade/marché · départ ${START} $  ================`);
console.log(`or : ${dayStr(gold.bars[0].time)} → ${dayStr(gold.bars[gold.bars.length - 1].time)} · BTC : ${dayStr(btc.bars[0].time)} → ${dayStr(btc.bars[btc.bars.length - 1].time)} · période commune à partir du moment où les deux ont un an d'historique`);
run('Donchian 50 j · long et short · or + BTC', 50, false, [gold, btc]);
run('Donchian 50 j · LONG SEULEMENT · or + BTC', 50, true, [gold, btc]);
run('Donchian 100 j · long et short · or + BTC', 100, false, [gold, btc]);
run('Donchian 50 j · long et short · OR SEUL (même période, pour comparer)', 50, false, [gold]);
run('Donchian 50 j · long et short · BTC SEUL (même période, pour comparer)', 50, false, [btc]);
console.log('');
