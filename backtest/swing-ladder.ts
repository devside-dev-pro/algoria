import { readFileSync } from 'node:fs';
// BACKTESTER D'ESCALIER (ladder trailing) pour le swing — teste l'idée « on remonte le SL palier par palier
// en suivant le prix, TP gardé loin ». Réplique FIDÈLEMENT la mécanique du lab (entrée à l'open de i+1,
// sizing 1% du solde, stop AVANT tp, kill-switch jour 4%) mais remplace la gestion BE/trail par une
// fonction d'escalier `stopR(peakR)` = niveau de stop (en R) voulu selon le plus-haut atteint (en R).
//   npx tsx backtest/swing-ladder.ts
import { computeIndicators, SPECS, RISK_PCT, START, type Indicators, type StrategyDef, type Spec } from './labcore';
import type { Bar } from '../lib/engine/types';

const load = (f: string): Bar[] => JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8'));
const dayOf = (t: number) => Math.floor(t / 86_400_000);
const MAX_DAILY_LOSS = 0.04;

// signaux (mêmes que la prod)
const trendDef = (slAtr: number, tpAtr: number): StrategyDef => ({
  family: 'sw-trend', params: 't', minBars: 700, exits: { be: 1 },
  onClose(i, d) {
    const { bars: b, atr, emaF, emaS, ema21 } = d; if (i < 601) return null; const bar = b[i], a = atr[i];
    const bull = emaF[i] > emaS[i] * 1.001, bear = emaF[i] < emaS[i] * 0.999;
    const dip = b[i - 1].low < ema21[i - 1] || b[i - 2].low < ema21[i - 2], pop = b[i - 1].high > ema21[i - 1] || b[i - 2].high > ema21[i - 2];
    if (bull && dip && bar.close > bar.open && bar.close > ema21[i]) return { direction: 'long', stopLoss: bar.close - slAtr * a, takeProfit: bar.close + tpAtr * a };
    if (bear && pop && bar.close < bar.open && bar.close < ema21[i]) return { direction: 'short', stopLoss: bar.close + slAtr * a, takeProfit: bar.close - tpAtr * a };
    return null;
  },
});
const brkDef = (N: number, slAtr: number, tpAtr: number): StrategyDef => ({
  family: 'sw-brk', params: 'b', minBars: 700, exits: { be: 1 },
  onClose(i, d) {
    const { bars: b, atr } = d; if (i < N + 1) return null; let hi = -Infinity, lo = Infinity;
    for (let k = i - N; k < i; k++) { hi = Math.max(hi, b[k].high); lo = Math.min(lo, b[k].low); }
    const bar = b[i], a = atr[i];
    if (bar.close > hi + 0.15 * a) return { direction: 'long', stopLoss: bar.close - slAtr * a, takeProfit: bar.close + tpAtr * a };
    if (bar.close < lo - 0.15 * a) return { direction: 'short', stopLoss: bar.close + slAtr * a, takeProfit: bar.close - tpAtr * a };
    return null;
  },
});

// === fonctions d'escalier : stopR(peakR) = niveau du stop voulu (en R) selon le plus-haut atteint (en R) ===
type Ladder = { name: string; stopR: (peakR: number) => number };
// escalier générique à partir de paliers [déclencheR, verrouilleR] (+ trail continu au-delà pour les runners)
const steps = (name: string, s: [number, number][], beyond?: number): Ladder => ({
  name,
  stopR: (p) => { let lock = -1; for (const [t, l] of s) if (p >= t) lock = l; if (beyond != null && p > s[s.length - 1][0]) lock = Math.max(lock, p - beyond); return lock; },
});
// CONCLUSION de l'affinage (voir le comparatif complet dans l'historique) :
//  • config-only (juste trailActivate/trailDist) ne bouge quasi rien sur gold et ne règle pas le retour à BE.
//  • le VRAI gain gold vient d'un PALIER (verrouiller +0.5R à 2R), qui demande une extension moteur → I4.
//  • sur BTC, un trail plus LARGE (activate2 dist3, config-only) améliore l'edge (PF 2.02→2.25).
const cfg = (name: string, A: number, D: number): Ladder => ({ name, stopR: (p) => (p >= A ? p - D : p >= 1 ? 0.05 : -1) });
// CANDIDATS « VERROUILLER PLUS TÔT » (03/08, demande Mathieu). Le trade du jour est monté à 2,1R (~+1400$ sur
// le maître, 1R ≈ 668$) et s'est fermé à +502$ : le premier palier est à 2R et il ne verrouille que 0,5R, donc
// entre 1R et 2R le moteur ne sécurise rien du tout. Objectif énoncé : « assurer 500$ puis 1000$ », soit ~0,75R
// puis ~1,5R sur ce sizing. Les cinq candidats ci-dessous traduisent ça de plusieurs façons — le point de la
// mesure est justement de voir ce que ce confort coûte en espérance sur un suiveur de tendance qui vit de ses
// runners. Un escalier trop serré transforme les gros trades en petits ; c'est le comparatif qui tranche, pas
// l'intuition. NB : `beyond` ne peut jamais faire REDESCENDRE un palier (steps() prend le max).
const LADDERS: Ladder[] = [
  cfg('PROD (activate2.5 dist2.5)', 2.5, 2.5),
  steps('GOLD I4 · BE1 · lock .5R@2R · trail2.5', [[1, 0.05], [2, 0.5]], 2.5), // ← gagnant GOLD actuel (en prod)
  cfg('BTC · activate2.0 dist3.0 (config-only)', 2.0, 3.0),                     // ← gagnant BTC (juste des chiffres)
  // « 500$ puis 1000$ » au pied de la lettre : 0.75R verrouillé dès 1.2R, 1.5R verrouillé dès 2R
  steps('C1 · lock .75R@1.2R · 1.5R@2R · trail2', [[1, 0.05], [1.2, 0.75], [2, 1.5]], 2),
  // même idée, montée plus progressive (trois marches) et trail plus court derrière
  steps('C2 · .3R@1R · .75R@1.5R · 1.2R@2R · trail1.5', [[1, 0.3], [1.5, 0.75], [2, 1.2]], 1.5),
  // compromis : on laisse respirer jusqu'à 1.5R, puis on verrouille franchement
  steps('C3 · .5R@1.5R · 1.5R@2.5R · trail2', [[1, 0.05], [1.5, 0.5], [2.5, 1.5]], 2),
  // CONFIG-ONLY (aucune extension moteur) : trailing plus court, activé plus tôt. S'il tient la comparaison,
  // c'est la correction la moins chère de toutes — deux nombres à changer, rien d'autre.
  cfg('C4 · activate1.5 dist1.0 (config-only)', 1.5, 1.0),
  cfg('C5 · activate1.2 dist0.7 (config-only, très serré)', 1.2, 0.7),
];

function run(label: string, ind: Indicators, strat: StrategyDef, spec: Spec, tpAtr: number) {
  const bars = ind.bars, slippage = spec.spread * 0.25;
  console.log(`\n================  ${label}  ================`);
  console.log('escalier'.padEnd(40), 'trades', ' PF ', 'win%', ' ret% ', ' DD% ', 'expR', '  sorties (part · R moy)');
  for (const L of LADDERS) {
    let balance = START, dayStart = balance, dayKilled = false, lastDay = dayOf(bars[strat.minBars].time);
    let peakEq = START, maxDD = 0, gW = 0, gL = 0;
    const trades: { r: number; reason: string }[] = [];
    let open: { dir: 1 | -1; entry: number; lot: number; risk: number; riskDist: number; stopR: number; tp: number; peak: number } | null = null;
    const close = (px: number, reasonHint: string) => {
      if (!open) return; const o = open;
      const pnl = (px - o.entry) * o.dir * o.lot * spec.contractSize - spec.commissionPerLot * o.lot;
      const r = o.risk ? pnl / o.risk : 0; trades.push({ r, reason: reasonHint });
      if (pnl > 0) gW += pnl; else gL += -pnl; balance += pnl; open = null;
    };
    for (let i = strat.minBars; i < bars.length - 1; i++) {
      const bar = bars[i];
      if (open) {
        const o = open; const stopPx = o.entry + o.dir * o.stopR * o.riskDist;
        const hitStop = o.dir === 1 ? bar.low <= stopPx : bar.high >= stopPx;
        const hitTp = o.dir === 1 ? bar.high >= o.tp : bar.low <= o.tp;
        if (hitStop) close(stopPx, o.stopR > 0.1 ? 'ladder' : o.stopR >= -1e-9 ? 'be' : 'sl');
        else if (hitTp) close(o.tp, 'tp');
        else {
          o.peak = o.dir === 1 ? Math.max(o.peak, bar.high) : Math.min(o.peak, bar.low);
          const peakR = (o.dir * (o.peak - o.entry)) / o.riskDist;
          o.stopR = Math.max(o.stopR, L.stopR(peakR)); // ratchet : jamais dans le mauvais sens
        }
      }
      const d = dayOf(bar.time); if (d !== lastDay) { lastDay = d; dayStart = balance; dayKilled = false; }
      const floating = open ? (bar.close - open.entry) * open.dir * open.lot * spec.contractSize : 0;
      const eq = balance + floating; peakEq = Math.max(peakEq, eq); maxDD = Math.max(maxDD, (peakEq - eq) / peakEq);
      if ((dayStart - eq) / dayStart >= MAX_DAILY_LOSS) dayKilled = true;
      if (open || dayKilled) continue;
      const sig = strat.onClose(i, ind); if (!sig) continue;
      const next = bars[i + 1], dir = sig.direction === 'long' ? 1 : -1;
      const entry = next.open + dir * (spec.spread / 2 + slippage);
      const riskDist = Math.abs(entry - sig.stopLoss);
      if (riskDist <= 0 || dir * (sig.takeProfit - entry) <= 0) continue;
      const lot = Math.max(0.01, +((balance * RISK_PCT) / (riskDist * spec.contractSize)).toFixed(2));
      open = { dir: dir as 1 | -1, entry, lot, risk: riskDist * lot * spec.contractSize, riskDist, stopR: -1, tp: sig.takeProfit, peak: entry };
    }
    close(bars[bars.length - 1].close, 'eod');
    const n = trades.length, wins = trades.filter((t) => t.r > 0).length;
    const by: Record<string, { n: number; r: number }> = {};
    for (const t of trades) { (by[t.reason] ??= { n: 0, r: 0 }); by[t.reason].n++; by[t.reason].r += t.r; }
    const part = ['tp', 'ladder', 'be', 'sl', 'eod'].filter((k) => by[k]).map((k) => `${k} ${Math.round(by[k].n / n * 100)}%·${(by[k].r / by[k].n).toFixed(1)}R`).join('  ');
    const expR = trades.reduce((s, t) => s + t.r, 0) / n;
    console.log(
      L.name.padEnd(40), String(n).padStart(5),
      (gL ? gW / gL : 0).toFixed(2).padStart(4),
      (Math.round(wins / n * 100) + '%').padStart(4),
      ('+' + Math.round((balance - START) / START * 100) + '%').padStart(6),
      (maxDD * 100).toFixed(0).padStart(4) + '%', expR.toFixed(2).padStart(4), ' ', part,
    );
  }
}

const TP = 16;
run(`GOLD SWING (trend) · TP ${TP}×ATR`, computeIndicators(load('XAUUSD-H1-15.json')), trendDef(1, TP), SPECS.XAUUSD, TP);
try { run(`BTC SWING (breakout N24) · TP ${TP}×ATR`, computeIndicators(load('BTCUSD-H1-15.json')), brkDef(24, 2, TP), SPECS.BTCUSD, TP); }
catch (e) { console.log('BTC skipped:', (e as { message?: string })?.message ?? e); }
