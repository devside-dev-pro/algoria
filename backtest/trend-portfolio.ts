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
// SWAP (03/09, spécifications MT5 du broker, lues par Mathieu) — en points, 1 point = 0,01 $, mercredi ×3 :
//   Gold    long −64 pts = −64 $/lot/jour (lot 100 oz ≈ 330 k$) → 0,019 %/jour · short −6 pts → 0,002 %/jour
//   Bitcoin long et short −3 600 pts = −36 $/BTC/jour (≈ 110 k$) → 0,033 %/jour
// Avec le mercredi triple : or ×7/5 (5 jours de cotation), BTC ×9/7 (7 jours). En % du notionnel, pour rester
// valable sur toute l'histoire (le broker recale ses points avec le prix). À 1 % de risque et 2 ATR de stop, la
// position or vaut ~25 % de l'équité : 47 jours de tenue en long ≈ 0,35 R par trade sur +0,85 R d'espérance —
// quarante pour cent de l'edge de l'or part en swap dans le sens long. BTC : ~14 % de l'équité, ≈ 0,3 R sur +3 R.
// PROTECTION DES GAINS (pré-enregistrée) : le défaut connu de cette famille est de rendre beaucoup de profit latent
// (avril 2013 : −62 % depuis un sommet gonflé par une position ouverte sur un ×10). Variante : dès que le profit
// latent dépasse 4 R, on sort si on en rend la moitié. Un seul réglage, posé avant de regarder.
//
//   npx tsx backtest/trend-portfolio.ts          (N = 50 · variantes 100, long seulement, protection des gains)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

interface Market { sym: string; bars: Bar[]; contract: number; cost: (p: number) => number; swap: { long: number; short: number }; atr: number[]; byTime: Map<number, number> }
const load = (sym: string, contract: number, cost: (p: number) => number, swap: { long: number; short: number }): Market | null => {
  const p = `backtest/.cache/${sym}-D1-15.json`;
  if (!existsSync(p)) { console.error(`${p} absent`); return null; }
  const bars = JSON.parse(readFileSync(p, 'utf8')) as Bar[];
  const n = bars.length;
  const atr = new Array<number>(n).fill(0);
  const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low));
  let s = 0; for (let i = 0; i < n; i++) { s += tr[i]; if (i >= 20) s -= tr[i - 20]; atr[i] = s / Math.min(20, i + 1); }
  const byTime = new Map<number, number>(); bars.forEach((b, i) => byTime.set(Math.floor(b.time / 86_400_000), i));
  return { sym, bars, contract, cost, swap, atr, byTime };
};
const gold = load('XAUUSD', 100, () => 0.32, { long: 0.00019 * 7 / 5, short: 0.00002 * 7 / 5 });
const btc = load('BTCUSD', 1, (p) => p * 0.0005, { long: 0.00033 * 9 / 7, short: 0.00033 * 9 / 7 });
if (!gold || !btc) process.exit(1);

const START = 10_000, RISK = 0.01;
const year = (t: number) => new Date(t).getUTCFullYear();
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const f1 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);
const hh = (m: Market, i: number, N: number) => { let h = -Infinity; for (let k = i - N; k < i; k++) h = Math.max(h, m.bars[k].high); return h; };
const ll = (m: Market, i: number, N: number) => { let l = Infinity; for (let k = i - N; k < i; k++) l = Math.min(l, m.bars[k].low); return l; };

interface Pos { dir: 1 | -1; entry: number; units: number; stop: number; risk: number; day: number; peakR: number }
interface Leg { market: Market; pos: Pos | null; trades: number; wins: number; pnl: number; lastClose: number }

function run(name: string, N: number, longOnly: boolean, markets: Market[], protect = false) {
  const EXIT = Math.max(10, Math.floor(N / 2));
  let eq = START;
  const legs: Leg[] = markets.map((market) => ({ market, pos: null, trades: 0, wins: 0, pnl: 0, lastClose: 0 }));
  // calendrier fusionné : tous les jours où au moins un marché a une bougie, à partir du moment où les deux ont 260 jours d'historique
  const days = [...new Set(markets.flatMap((m) => m.bars.map((b) => Math.floor(b.time / 86_400_000))))].sort((a, b) => a - b);
  const startDay = Math.max(...markets.map((m) => Math.floor(m.bars[Math.max(N, 260)].time / 86_400_000)));
  const equity: Array<{ t: number; eq: number }> = [];
  const pending: Array<{ leg: Leg; dir: 1 | -1; dist: number }> = [];
  let maxLever = 0; // notionnel total / équité — la taille « 1 % de risque » peut cacher un levier énorme quand l'ATR est faible
  for (const d of days) {
    if (d < startDay) continue;
    let floating = 0;
    for (const leg of legs) {
      const m = leg.market; const i = m.byTime.get(d);
      // JOUR SANS BOUGIE POUR CE MARCHÉ (week-end de l'or, fin de l'historique BTC le 20/08/2026) : la position
      // ouverte reste marquée à son DERNIER close. La première version l'oubliait (floating = 0) — une position
      // BTC en perte latente disparaissait de l'équité à la fin de ses données, et le portefeuille affichait
      // +35 % en 2026 quand ses deux jambes faisaient +6 % et +1 %. Trouvé le 03/09 en comparant aux témoins.
      if (i === undefined) { if (leg.pos) floating += (leg.lastClose - leg.pos.entry) * leg.pos.dir * leg.pos.units * m.contract; continue; }
      const b = m.bars[i]; leg.lastClose = b.close;
      // entrées décidées la veille : exécutées à l'ouverture du jour
      for (const p of pending.filter((x) => x.leg === leg)) {
        const risk = eq * RISK; const units = risk / (p.dist * m.contract);
        leg.pos = { dir: p.dir, entry: b.open, units, stop: b.open - p.dir * p.dist, risk, day: d, peakR: 0 };
      }
      pending.splice(0, pending.length, ...pending.filter((x) => x.leg !== leg));
      if (leg.pos) {
        const pos = leg.pos;
        // swap : prélevé chaque jour de tenue sur le notionnel
        eq -= (pos.dir === 1 ? m.swap.long : m.swap.short) * pos.units * m.contract * b.close;
        const hit = pos.dir === 1 ? b.low <= pos.stop : b.high >= pos.stop;
        const chan = i >= EXIT && (pos.dir === 1 ? b.close < ll(m, i, EXIT) : b.close > hh(m, i, EXIT));
        const openR = ((b.close - pos.entry) * pos.dir * pos.units * m.contract) / pos.risk;
        pos.peakR = Math.max(pos.peakR, openR);
        const giveBack = protect && pos.peakR >= 4 && openR <= pos.peakR / 2; // protection des gains : > 4 R atteints, on en rend la moitié → dehors
        if (hit || chan || giveBack) {
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
    const notional = legs.reduce((s, l) => { const i = l.market.byTime.get(d); return s + (l.pos && i !== undefined ? l.pos.units * l.market.contract * l.market.bars[i].close : 0); }, 0);
    maxLever = Math.max(maxLever, notional / Math.max(1, eq + floating));
    equity.push({ t: d * 86_400_000, eq: eq + floating });
  }
  // rapport
  const ddOf = (pts: Array<{ t: number; eq: number }>) => { let peak = -Infinity, maxDd = 0, ddStart = 0, longest = 0, from = 0, peakEq = 0, troughEq = 0, troughT = 0; for (const e of pts) { if (e.eq > peak) { peak = e.eq; from = e.t; } const dd = (peak - e.eq) / peak; if (dd > maxDd) { maxDd = dd; ddStart = from; peakEq = peak; troughEq = e.eq; troughT = e.t; } longest = Math.max(longest, (e.t - from) / 86_400_000); } return { maxDd, ddStart, longest, peakEq, troughEq, troughT }; };
  const { maxDd, ddStart, longest } = ddOf(equity);
  const since2014 = ddOf(equity.filter((e) => year(e.t) >= 2014));
  const yrs = (equity[equity.length - 1].t - equity[0].t) / (365.25 * 86_400_000);
  const cagr = Math.pow(equity[equity.length - 1].eq / equity[0].eq, 1 / yrs) - 1;
  const years = [...new Set(equity.map((e) => year(e.t)))];
  const rets = years.map((y) => { const pts = equity.filter((e) => year(e.t) === y); const prev = equity[equity.indexOf(pts[0]) - 1]?.eq ?? pts[0].eq; return pts[pts.length - 1].eq / prev - 1; });
  console.log(`\n────────  ${name}  ·  ${dayStr(equity[0].t)} → ${dayStr(equity[equity.length - 1].t)}  ────────`);
  console.log(`rendement annualisé ${f1(cagr * 100)} % · pire perte depuis un sommet −${(maxDd * 100).toFixed(1)} % (depuis ${dayStr(ddStart)}) · depuis 2014 : −${(since2014.maxDd * 100).toFixed(1)} % (sommet ${dayStr(since2014.ddStart)} à ${Math.round(since2014.peakEq)} $ → creux ${dayStr(since2014.troughT)} à ${Math.round(since2014.troughEq)} $), désert ${Math.round(since2014.longest)} j · années négatives ${rets.filter((r) => r < 0).length}/${years.length} · pire année ${f1(Math.min(...rets) * 100)} %`);
  console.log('par année : ' + years.map((y, k) => `${y} ${f1(rets[k] * 100)} %`).join(' · '));
  console.log(`levier max (notionnel / équité) : ${maxLever.toFixed(2)}× — au-delà de ~3×, le swap et la marge deviennent le sujet`);
  console.log('par marché : ' + legs.map((l) => `${l.market.sym} ${l.trades} trades · ${l.trades ? Math.round((100 * l.wins) / l.trades) : 0} % gagnants · ${f1(l.pnl / START * 100)} % de l'équité de départ`).join('  |  '));
}

console.log(`\n================  PORTEFEUILLE DE TENDANCE — or + BTC · risque ${RISK * 100} %/trade/marché · départ ${START} $  ================`);
console.log(`or : ${dayStr(gold.bars[0].time)} → ${dayStr(gold.bars[gold.bars.length - 1].time)} · BTC : ${dayStr(btc.bars[0].time)} → ${dayStr(btc.bars[btc.bars.length - 1].time)} · période commune à partir du moment où les deux ont un an d'historique`);
console.log(`swap (spécifications MT5, mercredi ×3 lissé) : or long ${(gold.swap.long * 100).toFixed(3)} % · short ${(gold.swap.short * 100).toFixed(3)} % · BTC ${(btc.swap.long * 100).toFixed(3)} %/jour du notionnel`);
run('Donchian 50 j · long et short · or + BTC', 50, false, [gold, btc]);
run('Donchian 50 j · long et short · or + BTC · PROTECTION DES GAINS (> 4 R atteints, sortie si moitié rendue)', 50, false, [gold, btc], true);
run('Donchian 50 j · LONG SEULEMENT · or + BTC', 50, true, [gold, btc]);
run('Donchian 100 j · long et short · or + BTC', 100, false, [gold, btc]);
run('Donchian 50 j · long et short · OR SEUL (même période, pour comparer)', 50, false, [gold]);
run('Donchian 50 j · long et short · BTC SEUL (même période, pour comparer)', 50, false, [btc]);
console.log('');
