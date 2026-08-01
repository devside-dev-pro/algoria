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
import { breakoutSignal, GOLD_BREAKOUT, type BreakoutConfig } from '../lib/engine/breakout';
import { regimeMask, type RegimeFilter } from '../lib/engine/regime';
import { SCALP_CONFIG } from '../lib/engine/config';
import { metrics } from './metrics';
import type { Bar } from '../lib/engine/types';
import type { BacktestRun, SimTrade } from './simulator';

const bars: Bar[] = JSON.parse(readFileSync('backtest/.cache/XAUUSD-M5-15.json', 'utf8'));
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const COSTS = { spread: 0.2, slippage: 0.05, commissionPerLot: 7, contractSize: 100 }; // frais RaiseFX mesurés (= SIM_BASE)
const START = 70_000;
const WINDOW = 600; // le runner ne voit qu'une fenêtre glissante de bougies — même discipline ici

interface Pos { dir: 1 | -1; direction: 'long' | 'short'; entryPrice: number; entryTime: number; riskDist: number; risk: number; stop: number; tp: number; peak: number; lot: number; confidence: number }

// Sim breakout : mêmes règles causales que simulator.ts (stop avant TP, entrée à l'open de i+1,
// stop figé par les bougies précédentes), 1 position à la fois (checkRisk live = 1 pos/symbole).
function simBreakout(cfg: BreakoutConfig, c = COSTS, opts?: { noEntryFriFrom?: number; regime?: RegimeFilter }): BacktestRun {
  let balance = START;
  // FILTRE DE RÉGIME (01/08) : le breakout est la couche la plus exposée au marché latéral — un canal
  // Donchian percé sans tendance derrière, c'est un faux départ qui paie le spread puis le stop.
  const regimeOk = opts?.regime ? regimeMask(bars, opts.regime) : null;
  let pos: Pos | null = null;
  const trades: SimTrade[] = [];
  const equity: { time: number; equity: number }[] = [];
  const close = (px: number, time: number, reason: SimTrade['reason']) => {
    if (!pos) return;
    const pnl = (px - pos.entryPrice) * pos.dir * pos.lot * c.contractSize - c.commissionPerLot * pos.lot;
    balance += pnl;
    trades.push({ dir: pos.direction, entryTime: pos.entryTime, entryPrice: pos.entryPrice, exitTime: time, exitPrice: px, reason, lot: pos.lot, pnl, r: pos.risk ? pnl / pos.risk : 0, confidence: pos.confidence });
    pos = null;
  };
  for (let i = cfg.N + 20; i < bars.length - 1; i++) {
    const bar = bars[i];
    if (pos) {
      const long = pos.dir === 1;
      const hitStop = long ? bar.low <= pos.stop : bar.high >= pos.stop;
      const hitTp = long ? bar.high >= pos.tp : bar.low <= pos.tp;
      if (hitStop) {
        const above = pos.dir * (pos.stop - pos.entryPrice);
        close(pos.stop, bar.time, above > 0.1 * pos.riskDist ? 'trail' : above >= -1e-9 ? 'be' : 'sl');
      } else if (hitTp) close(pos.tp, bar.time, 'tp');
      else {
        pos.peak = long ? Math.max(pos.peak, bar.high) : Math.min(pos.peak, bar.low);
        const fav = pos.dir * (pos.peak - pos.entryPrice);
        if (cfg.beTrigger && fav >= cfg.beTrigger * pos.riskDist) {
          const be = pos.entryPrice + pos.dir * 0.05 * pos.riskDist; // BE+ couvre les coûts (= manage.ts)
          pos.stop = long ? Math.max(pos.stop, be) : Math.min(pos.stop, be);
        }
        if (cfg.trailActivate && cfg.trailDist && fav >= cfg.trailActivate * pos.riskDist) {
          const trail = pos.peak - pos.dir * cfg.trailDist * pos.riskDist;
          pos.stop = long ? Math.max(pos.stop, trail) : Math.min(pos.stop, trail);
        }
      }
    }
    equity.push({ time: bar.time, equity: balance + (pos ? (bar.close - pos.entryPrice) * pos.dir * pos.lot * c.contractSize : 0) });
    if (!pos && !(regimeOk && !regimeOk[i])) {
      const lo = Math.max(0, i + 1 - WINDOW);
      const sig = breakoutSignal('XAUUSD', bars.slice(lo, i + 1), cfg, 'scalp');
      if (sig) {
        const next = bars[i + 1];
        if (opts?.noEntryFriFrom != null) { const d = new Date(next.time); if (d.getUTCDay() === 5 && d.getUTCHours() >= opts.noEntryFriFrom) continue; }
        const dir = sig.direction === 'long' ? 1 : -1;
        const entryPrice = next.open + dir * (c.spread / 2 + c.slippage);
        const riskDist = Math.abs(entryPrice - sig.stopLoss);
        if (riskDist <= 0) continue;
        // GARDE LIVE maxOpenRiskPct (risk.ts:21) : les gaps de week-end gonflent l'ATR → SL à 50-160$ de
        // distance = 7-23% du solde risqués. Le live REFUSE ces entrées (expo max 3%) — sans cette garde,
        // le sim affichait +$89k/mois portés par 5 trades-monstres jamais pris en réel (bug attrapé le 29/07).
        if ((riskDist * sig.lot * c.contractSize) / balance > SCALP_CONFIG.risk.maxOpenRiskPct) continue;
        pos = { dir: dir as 1 | -1, direction: sig.direction, entryPrice, entryTime: next.time, riskDist, risk: riskDist * sig.lot * c.contractSize, stop: sig.stopLoss, tp: sig.takeProfits[0], peak: entryPrice, lot: sig.lot, confidence: sig.confidence };
      }
    }
  }
  if (pos !== null) close(bars[bars.length - 1].close, bars[bars.length - 1].time, 'eod');
  return { trades, equity, finalBalance: balance };
}

const pct = (x: number) => Math.round(x * 100) + '%';
const fmt = (r: BacktestRun, name: string) => {
  const m = metrics(r, START);
  const by: Record<string, { n: number; r: number }> = {};
  for (const t of r.trades) { (by[t.reason] ??= { n: 0, r: 0 }); by[t.reason].n++; by[t.reason].r += t.r; }
  const part = ['tp', 'trail', 'be', 'sl', 'eod'].filter((k) => by[k]).map((k) => `${k} ${Math.round((by[k].n / Math.max(1, r.trades.length)) * 100)}%·${(by[k].r / by[k].n).toFixed(1)}R`).join('  ');
  console.log(name.padEnd(44), String(m.trades).padStart(5), (m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)).padStart(4), pct(m.winRate).padStart(4), ('$' + m.netPnl.toFixed(0)).padStart(7), (m.maxDrawdownPct * 100).toFixed(0).padStart(4) + '%', m.expectancyR.toFixed(2).padStart(4), ' ', part);
};

// ===== 1. VARIANTES (période complète du cache) =====
console.log(`\n================  BREAKOUT GOLD M5 — ${dayStr(bars[0].time)} → ${dayStr(bars[bars.length - 1].time)}  ================`);
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
for (const v of VARIANTS) fmt(simBreakout(v.cfg, COSTS, v.opts), v.name);

// ===== 2. PAR MOIS (la config prod a été réglée sur 2/6→20/7 : juillet tardif = premier vrai OOS) =====
console.log('\n================  PROD PAR MOIS (net $)  ================');
{
  const r = simBreakout(GOLD_BREAKOUT);
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
    const r = simBreakout(GOLD_BREAKOUT, COSTS, v.regime ? { regime: v.regime } : undefined);
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
  const r = simBreakout(GOLD_BREAKOUT);
  const simByDay = new Map<string, { n: number; pnl: number }>();
  for (const t of r.trades) { const d = dayStr(t.exitTime); const cur = simByDay.get(d) ?? { n: 0, pnl: 0 }; cur.n++; cur.pnl += t.pnl; simByDay.set(d, cur); }
  console.log('\n================  PARITÉ JUILLET — couche breakout S2 live vs sim  ================');
  console.log('jour        live n  live $   sim n   sim $     Δ$');
  let lp = 0, sp = 0;
  const daily: Array<{ live: number; sim: number }> = [];
  for (const d of liveBk.filter((x) => barDays.has(x.day))) {
    const s = simByDay.get(d.day) ?? { n: 0, pnl: 0 };
    lp += d.pnl; sp += s.pnl;
    daily.push({ live: d.pnl, sim: s.pnl });
    console.log(d.day, String(d.n).padStart(7), String(d.pnl).padStart(7), String(s.n).padStart(7), s.pnl.toFixed(0).padStart(7), (s.pnl - d.pnl).toFixed(0).padStart(7));
  }
  if (daily.length >= 3) {
    const mL = lp / daily.length, mS = sp / daily.length;
    let cov = 0, vL = 0, vS = 0;
    for (const d of daily) { cov += (d.live - mL) * (d.sim - mS); vL += (d.live - mL) ** 2; vS += (d.sim - mS) ** 2; }
    const corr = vL && vS ? cov / Math.sqrt(vL * vS) : 0;
    console.log(`TOTAL        live $${lp}  sim $${sp.toFixed(0)}   corr(jours) = ${corr.toFixed(2)}`);
    console.log(corr > 0.5 ? '✅ le sim breakout vit les mêmes jours que le live' : '⚠️ corrélation faible — priorité scalp/caps live non simulés, ou config live ≠ sim sur la période');
  }
} else {
  console.log('\n[breakout] fixture sans couche breakout suffisante — parité juillet sautée.');
}

// ===== 4. STRESS COÛTS sur la PROD =====
console.log('\n================  STRESS COÛTS — PROD  ================');
for (const mult of [1, 2, 3]) {
  const m = metrics(simBreakout(GOLD_BREAKOUT, { ...COSTS, spread: COSTS.spread * mult, slippage: COSTS.slippage * mult }), START);
  console.log(`coûts ×${mult}`.padEnd(10), String(m.trades).padStart(5), 'trades', ('$' + m.netPnl.toFixed(0)).padStart(9), 'PF', m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2));
}
console.log('\n[breakout] terminé — backtest only, zéro impact live.');
