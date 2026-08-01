import { readFileSync } from 'node:fs';
// HARNAIS BREAKOUT — l'angle mort du système (étude 29/07). Constat qui a déclenché ce fichier :
// la couche breakout est la SEULE sans harnais de backtest, et c'est celle qui saigne en live :
// juillet S2 −4 612 $, 28/07 −2 451 $, matin du 29/07 −2 384 $. Ses sorties ont été re-réglées
// in-sample (étude 2/6→20/7, voir lib/engine/breakout.ts) — exactement le péché originel des configs
// scalp. Ici : on rejoue la VRAIE fonction breakoutSignal() (pas une réécriture) sur les bougies M5
// réelles, avec la gestion BE/trailing du live, les frais mesurés, et on répond à 3 questions :
//   1. PARITÉ : le sim breakout vit-il les mêmes jours que la couche breakout live de juillet ?
//   2. VARIANTES : la config prod bat-elle les alternatives simples (dont l'ANCIENNE config) ?
//   3. STRESS : la couche survit-elle à des coûts ×2/×3 ?
// Différences ASSUMÉES avec le live (notées, pas cachées) : pas de cap de perte journalier ni de
// dayLock (partagés entre couches en live — les simuler sur la couche seule fausserait dans les 2 sens),
// pas de news-lockout, pas de priorité scalp (le scalp prend la bougie avant le breakout en live).
//   npx tsx backtest/breakout.ts
import { GOLD_BREAKOUT, type BreakoutConfig } from '../lib/engine/breakout';
import { type RegimeFilter } from '../lib/engine/regime';
import { metrics } from './metrics';
import type { Bar } from '../lib/engine/types';
import type { BacktestRun } from './simulator';
import { simBreakout as simBk, BK_COSTS, BK_START, type BkOpts } from './breakout-core';

const bars: Bar[] = JSON.parse(readFileSync('backtest/.cache/XAUUSD-M5-15.json', 'utf8'));
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const COSTS = BK_COSTS;
const START = BK_START;
const simBreakout = (cfg: BreakoutConfig, c = COSTS, opts?: BkOpts) => simBk(bars, cfg, c, opts);

const pct = (x: number) => Math.round(x * 100) + '%';
const fmt = (r: BacktestRun, name: string) => {
  const m = metrics(r, START);
  const by: Record<string, { n: number; r: number }> = {};
  for (const t of r.trades) { (by[t.reason] ??= { n: 0, r: 0 }); by[t.reason].n++; by[t.reason].r += t.r; }
  const part = ['tp', 'trail', 'be', 'sl', 'eod'].filter((k) => by[k]).map((k) => `${k} ${Math.round((by[k].n / Math.max(1, r.trades.length)) * 100)}%·${(by[k].r / by[k].n).toFixed(1)}R`).join('  ');
  console.log(name.padEnd(44), String(m.trades).padStart(5), (m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)).padStart(4), pct(m.winRate).padStart(4), ('$' + m.netPnl.toFixed(0)).padStart(7), (m.maxDrawdownPct * 100).toFixed(0).padStart(4) + '%', m.expectancyR.toFixed(2).padStart(4), ' ', part);
};

// Gestion RÉALISTE : le live remonte le stop à la seconde. Tout ce qui suit tourne avec, sauf la
// section 0 qui existe précisément pour montrer ce que l'ancien modèle inventait.
const REAL = { intrabarManage: true };

// ===== 0. MODÈLE DE GESTION — d'où venait l'écart de parité (étude 01/08) =====
// Constat qui a déclenché cette section : en juillet, le sim breakout affichait +$4 037 quand le live
// perdait −$4 612, avec une corrélation journalière de 0,59 (mêmes jours, montants opposés). La table des
// sorties réelles (Supabase, trades S2 -bk- de juillet) donne la réponse en une ligne : 66 % de sorties
// au BREAKEVEN en live contre 6 % en sim, et 7 % de TRAILING contre 41 %. Tout le profit simulé venait
// d'un seau qui n'existe pas dans la vraie vie.
// La cause n'est ni les prix ni les lots (lot 1 des deux côtés) : c'est le TEMPS. Le sim ne déplaçait le
// stop qu'en fin de bougie et ne le testait qu'à la suivante — un sursis de 5 minutes que le live,
// qui gère à la seconde, n'accorde jamais.
console.log(`\n================  MODÈLE DE GESTION — sim vs live  ================`);
console.log('LIVE juillet S2 (source : table trades)   90 trades   be 66%  trail 7%  sl 18%  tp 2%   net $-6240');
console.log('variante'.padEnd(44), 'trades', ' PF ', 'win%', '  net$ ', ' DD% ', 'expR', '  sorties (part · R moy)');
fmt(simBreakout(GOLD_BREAKOUT), 'PROD — ancien modèle (stop bougé 1×/bougie)');
fmt(simBreakout(GOLD_BREAKOUT, COSTS, REAL), 'PROD — modèle réaliste (stop à la seconde)');

console.log(`\n================  BREAKOUT GOLD M5 — ${dayStr(bars[0].time)} → ${dayStr(bars[bars.length - 1].time)}  ================`);
console.log('(gestion réaliste — les chiffres d\'hier, plus flatteurs, tournaient sur l\'ancien modèle)');
console.log('variante'.padEnd(44), 'trades', ' PF ', 'win%', '  net$ ', ' DD% ', 'expR', '  sorties (part · R moy)');
const OLD: BreakoutConfig = { ...GOLD_BREAKOUT, beTrigger: 0.8, trailActivate: 1.2, trailDist: 1.2 }; // config d'avant l'étude 2/6→20/7
const VARIANTS: Array<{ name: string; cfg: BreakoutConfig; opts?: { noEntryFriFrom?: number; regime?: RegimeFilter } }> = [
  { name: 'PROD (N96 · BE .7 · trail .5@.8)', cfg: GOLD_BREAKOUT },
  { name: 'ANCIENNE (BE .8 · trail 1.2@1.2)', cfg: OLD },
  { name: 'sans trailing (TP 3ATR sec)', cfg: { ...GOLD_BREAKOUT, trailActivate: 0, trailDist: 0 } },
  { name: 'sans BE ni trailing (SL/TP purs)', cfg: { ...GOLD_BREAKOUT, beTrigger: 0, trailActivate: 0, trailDist: 0 } },
  { name: 'N48 (canal 4h)', cfg: { ...GOLD_BREAKOUT, N: 48 } },
  { name: 'N192 (canal 16h)', cfg: { ...GOLD_BREAKOUT, N: 192 } },
  { name: 'confirmation 0.25 ATR (plus stricte)', cfg: { ...GOLD_BREAKOUT, confirmAtr: 0.25 } },
  { name: 'PROD + pas d\'entrée ven ≥ 12h UTC', cfg: GOLD_BREAKOUT, opts: { noEntryFriFrom: 12 } },
  // FILTRE DE RÉGIME (01/08) — c'est ICI qu'on l'attend : un canal percé sans tendance derrière est un
  // faux départ qui paie le spread puis le stop. Si le filtre a une valeur quelque part, c'est sur cette
  // couche. Le nombre de trades restants compte autant que le net : un filtre qui ne laisse passer que
  // 5 trades sur 3 mois n'a rien prouvé, il a juste arrêté de jouer.
  { name: 'PROD + régime ADX ≥ 20', cfg: GOLD_BREAKOUT, opts: { regime: { adxMin: 20 } } },
  { name: 'PROD + régime ADX ≥ 25', cfg: GOLD_BREAKOUT, opts: { regime: { adxMin: 25 } } },
  { name: 'PROD + régime ER ≥ 0.25', cfg: GOLD_BREAKOUT, opts: { regime: { erMin: 0.25 } } },
  { name: 'PROD + régime ER ≥ 0.35', cfg: GOLD_BREAKOUT, opts: { regime: { erMin: 0.35 } } },
  { name: 'PROD + régime ADX ≥ 20 + ER ≥ 0.25', cfg: GOLD_BREAKOUT, opts: { regime: { adxMin: 20, erMin: 0.25 } } },
];
for (const v of VARIANTS) fmt(simBreakout(v.cfg, COSTS, { ...REAL, ...(v.opts ?? {}) }), v.name);

// ===== 2. PAR MOIS (la config prod a été réglée sur 2/6→20/7 : juillet tardif = premier vrai OOS) =====
console.log('\n================  PROD PAR MOIS (net $)  ================');
{
  const r = simBreakout(GOLD_BREAKOUT, COSTS, REAL);
  const byM = new Map<string, { n: number; pnl: number }>();
  for (const t of r.trades) { const m = dayStr(t.exitTime).slice(0, 7); const cur = byM.get(m) ?? { n: 0, pnl: 0 }; cur.n++; cur.pnl += t.pnl; byM.set(m, cur); }
  for (const [m, v] of [...byM.entries()].sort()) console.log(m, String(v.n).padStart(5), 'trades', ('$' + v.pnl.toFixed(0)).padStart(9));
}

// ===== 2bis. RÉGIME MOIS PAR MOIS — le seul garde-fou anti-illusion disponible ici =====
// Les seuils du filtre ne sont PAS optimisés sur la donnée (20/25 et 0.25/0.35 sont des conventions),
// donc pas de tune/test à faire. Reste la question qui compte : le gain est-il régulier, ou porté par
// un seul mois ? Un filtre qui gagne partout est crédible ; un filtre qui gagne sur un mois et perd sur
// les autres est un hasard qu'on a confondu avec un edge.
console.log('\n================  RÉGIME MOIS PAR MOIS (net $ · trades)  ================');
{
  const REG: Array<{ name: string; regime?: RegimeFilter }> = [
    { name: 'PROD' },
    { name: 'ADX≥20', regime: { adxMin: 20 } },
    { name: 'ADX≥25', regime: { adxMin: 25 } },
    { name: 'ER≥0.25', regime: { erMin: 0.25 } },
    { name: 'ADX≥20+ER≥0.25', regime: { adxMin: 20, erMin: 0.25 } },
  ];
  const months = new Set<string>();
  const rows = REG.map((v) => {
    const r = simBreakout(GOLD_BREAKOUT, COSTS, { ...REAL, ...(v.regime ? { regime: v.regime } : {}) });
    const by = new Map<string, { n: number; pnl: number }>();
    for (const t of r.trades) {
      const m = dayStr(t.exitTime).slice(0, 7);
      months.add(m);
      const cur = by.get(m) ?? { n: 0, pnl: 0 };
      cur.n++; cur.pnl += t.pnl; by.set(m, cur);
    }
    return { name: v.name, by };
  });
  const ms = [...months].sort();
  console.log('variante'.padEnd(18), ms.map((m) => m.padStart(14)).join(''));
  for (const r of rows) {
    console.log(r.name.padEnd(18), ms.map((m) => { const v = r.by.get(m); return (v ? `$${v.pnl.toFixed(0)}·${v.n}` : '—').padStart(14); }).join(''));
  }
}

// ===== 3. PARITÉ JUILLET : sim ↔ couche breakout LIVE (fixture par couche) =====
interface LiveDay { day: string; strategy: number; layer: string; n: number; pnl: number }
const LIVE: LiveDay[] = JSON.parse(readFileSync('backtest/fixtures/live-daily.json', 'utf8')).days;
const liveBk = LIVE.filter((d) => d.layer === 'breakout' && d.strategy === 2); // S2 = tout juillet (S3 même moteur mais ne démarre que le 20/07)
if (liveBk.length >= 3) {
  const barDays = new Set(bars.map((b) => dayStr(b.time)));
  // LE VERDICT du modèle de gestion : les deux moteurs jugés sur les MÊMES jours réels. La corrélation
  // ne suffit pas — l'ancien modèle la passait déjà (0,59) tout en se trompant de $8 649 sur le total.
  // Ce qui compte ici, c'est l'écart au live : si la gestion intra-bougie est la bonne explication,
  // le total du modèle réaliste doit s'effondrer vers le live.
  const byDay = (r: BacktestRun) => {
    const m = new Map<string, { n: number; pnl: number }>();
    for (const t of r.trades) { const d = dayStr(t.exitTime); const cur = m.get(d) ?? { n: 0, pnl: 0 }; cur.n++; cur.pnl += t.pnl; m.set(d, cur); }
    return m;
  };
  const oldDay = byDay(simBreakout(GOLD_BREAKOUT));
  const newDay = byDay(simBreakout(GOLD_BREAKOUT, COSTS, REAL));
  console.log('\n================  PARITÉ JUILLET — couche breakout S2 live vs sim  ================');
  console.log('jour        live n  live $   ancien $   réaliste $   Δ réaliste');
  let lp = 0, so = 0, sn = 0;
  const daily: Array<{ live: number; old: number; neo: number }> = [];
  for (const d of liveBk.filter((x) => barDays.has(x.day))) {
    const o = oldDay.get(d.day) ?? { n: 0, pnl: 0 };
    const n = newDay.get(d.day) ?? { n: 0, pnl: 0 };
    lp += d.pnl; so += o.pnl; sn += n.pnl;
    daily.push({ live: d.pnl, old: o.pnl, neo: n.pnl });
    console.log(d.day, String(d.n).padStart(7), String(d.pnl).padStart(7), o.pnl.toFixed(0).padStart(10), n.pnl.toFixed(0).padStart(12), (n.pnl - d.pnl).toFixed(0).padStart(12));
  }
  if (daily.length >= 3) {
    const corr = (pick: (d: (typeof daily)[number]) => number) => {
      const mL = lp / daily.length, mS = daily.reduce((s, d) => s + pick(d), 0) / daily.length;
      let cov = 0, vL = 0, vS = 0;
      for (const d of daily) { cov += (d.live - mL) * (pick(d) - mS); vL += (d.live - mL) ** 2; vS += (pick(d) - mS) ** 2; }
      return vL && vS ? cov / Math.sqrt(vL * vS) : 0;
    };
    console.log(`TOTAL        live $${lp}     ancien $${so.toFixed(0)}     réaliste $${sn.toFixed(0)}`);
    console.log(`écart au live               ancien $${(so - lp).toFixed(0)}     réaliste $${(sn - lp).toFixed(0)}`);
    console.log(`corr(jours)                 ancien ${corr((d) => d.old).toFixed(2)}        réaliste ${corr((d) => d.neo).toFixed(2)}`);
    const better = Math.abs(sn - lp) < Math.abs(so - lp);
    console.log(better
      ? `✅ la gestion intra-bougie explique ${Math.round((1 - Math.abs(sn - lp) / Math.abs(so - lp)) * 100)} % de l'écart — le sim ment beaucoup moins`
      : '⚠️ la gestion intra-bougie n\'explique pas l\'écart — chercher ailleurs (priorité scalp, caps journaliers, news-lockout)');
  }
} else {
  console.log('\n[breakout] fixture sans couche breakout suffisante — parité juillet sautée.');
}

// ===== 4. STRESS COÛTS sur la PROD =====
console.log('\n================  STRESS COÛTS — PROD  ================');
for (const mult of [1, 2, 3]) {
  const m = metrics(simBreakout(GOLD_BREAKOUT, { ...COSTS, spread: COSTS.spread * mult, slippage: COSTS.slippage * mult }, REAL), START);
  console.log(`coûts ×${mult}`.padEnd(10), String(m.trades).padStart(5), 'trades', ('$' + m.netPnl.toFixed(0)).padStart(9), 'PF', m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2));
}
console.log('\n[breakout] terminé — backtest only, zéro impact live.');
