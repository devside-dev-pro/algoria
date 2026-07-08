// COUCHE SWING — la stratégie "de fond" d'Algoria : positions H1 tenues des JOURS (week-end inclus),
// SL structurel, objectif loin, stop remonté par paliers (breakeven à 1R puis trailing). Complète le scalp
// (spectacle intraday) sans le toucher : slot de position séparé, lots dédiés.
// Validée par le labo (backtest/lab.ts <SYM> H1, portes moitiés+tiers+week-end) :
//   BTCUSD  breakout N24 trail2.5 — 2.7 ans · 56% win · PF 2.02 · +39% à 1% de risque · DD 9.2% · week-end PF 2.7
//   XAUUSD  sw-trend   trail2.5 — 1.75 an · 57% win · PF 2.21 · +88% · DD 11.4% · en position 67% du temps
import type { Bar, Confluence, Mode, Signal } from './types';

export interface SwingConfig {
  kind: 'breakout' | 'trend';
  N?: number; // fenêtre Donchian en HEURES (kind breakout)
  confirmAtr: number; // marge anti-mèche (× ATR H1)
  slAtr: number; // stop structurel (× ATR H1)
  tpAtr: number; // objectif LOIN (× ATR H1) — le trailing sort en général avant
  lot: number; // lot FIXE dédié à la couche swing
  beTrigger: number; // breakeven à × riskDist (1R — un swing a besoin d'air)
  trailActivate: number; // trailing activé à × riskDist
  trailDist: number; // distance du trailing (× riskDist) — les "paliers" qui sécurisent
}

/** BTC — cassure du range 24h (labo : PF 2.02 sur 2.7 ans, robuste tiers + week-end).
 *  Lot 1 (choix produit) : 1R = 2×ATR H1 (~250-380$) × lot — à 0.5 les gains faisaient ~250-380$, maigres
 *  dans l'historique face au gold ; à 1 les sorties ~1R tombent dans la cible 500-800$. Revers assumé :
 *  un SL plein pèse pareil (~500-760$). */
export const BTC_SWING: SwingConfig = { kind: 'breakout', N: 24, confirmAtr: 0.15, slAtr: 2, tpAtr: 16, lot: 1, beTrigger: 1, trailActivate: 2.5, trailDist: 2.5 };
/** OR — suivi de tendance EMA longues + reprise après repli.
 *  STOP RESSERRÉ slAtr 1 (au lieu de 2) : le copieur des clients est en LOT FIXE (~0.05), donc le risque
 *  client = largeur du stop × son lot, indépendant du lot master. Un stop 2×ATR (~37 pts) = −187$ sur un
 *  compte 500$ (37% en un trade) ; à 1×ATR (~18 pts) ça tombe à −93$ (19%). L'edge tient : backtest 637j
 *  gold H1 → PF 1.79, robuste sur les 3 tiers (T1 1.28 · T2 2.23 · T3 1.69) ; il ne s'écroule qu'en dessous
 *  (slAtr 0.5 → PF 1.29, DD 27%). LOT 0.5 (au lieu de 0.25) : le stop ayant fondu de moitié, 0.5 lot garde
 *  le MÊME risque master qu'avant (−935$/stop) tout en rapprochant la fraction copiée du scalp (10% vs 5%,
 *  au lieu de 20%) → bilans client↔master 2× plus cohérents. Le vrai fix (copie proportionnelle) viendra
 *  avec l'API STH. NB : 1.0 lot resterait impossible ici (−1870$/stop souffle un master à ~2300$). */
export const GOLD_SWING: SwingConfig = { kind: 'trend', confirmAtr: 0, slAtr: 1, tpAtr: 16, lot: 0.5, beTrigger: 1, trailActivate: 2.5, trailDist: 2.5 };
/** NAS100 — cassure du range 72h (labo 2.2 ans : PF 1.94, +$3086, DD 6.9%, tiers ✅ · tenue moy 8.5 j). */
export const NAS_SWING: SwingConfig = { kind: 'breakout', N: 72, confirmAtr: 0.15, slAtr: 2, tpAtr: 16, lot: 3, beTrigger: 1, trailActivate: 2.5, trailDist: 2.5 };

const ema = (src: number[], n: number): number[] => {
  const k = 2 / (n + 1);
  const out = new Array(src.length);
  out[0] = src[0];
  for (let i = 1; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
  return out;
};

const atr14 = (bars: Bar[]): number => {
  const n = bars.length;
  const from = Math.max(1, n - 14);
  let sum = 0;
  for (let i = from; i < n; i++)
    sum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  return sum / (n - from);
};

/** Bougies H1 minimum requises avant de trader (les EMA longues du mode trend doivent être mûres). */
export const swingMinBars = (cfg: SwingConfig): number => (cfg.kind === 'trend' ? 620 : (cfg.N ?? 24) + 20);

/**
 * Détection sur CLÔTURE H1 (bars = historique H1, la dernière bougie vient de clore). Mêmes règles que le labo :
 * - breakout : clôture au-delà du plus haut/bas des N heures PRÉCÉDENTES (+ marge ATR anti-mèche) ;
 * - trend    : biais EMA(240/600) net + repli sous l'EMA21 dans les 2 dernières bougies + bougie de reprise.
 */
export function swingSignal(symbol: string, bars: Bar[], cfg: SwingConfig, mode: Mode, priceStep = 0.01): Signal | null {
  if (bars.length < swingMinBars(cfg)) return null;
  const b = bars[bars.length - 1];
  const a = atr14(bars);
  if (!a) return null;

  let direction: 'long' | 'short' | null = null;
  let note = '';
  if (cfg.kind === 'breakout') {
    const N = cfg.N ?? 24;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = bars.length - 1 - N; k < bars.length - 1; k++) {
      hi = Math.max(hi, bars[k].high);
      lo = Math.min(lo, bars[k].low);
    }
    if (b.close > hi + cfg.confirmAtr * a) { direction = 'long'; note = `${N}h high ${hi.toFixed(1)} broken`; }
    else if (b.close < lo - cfg.confirmAtr * a) { direction = 'short'; note = `${N}h low ${lo.toFixed(1)} broken`; }
  } else {
    const close = bars.map((x) => x.close);
    const eF = ema(close, 240);
    const eS = ema(close, 600);
    const e21 = ema(close, 21);
    const i = bars.length - 1;
    const bull = eF[i] > eS[i] * 1.001;
    const bear = eF[i] < eS[i] * 0.999;
    const dipped = bars[i - 1].low < e21[i - 1] || bars[i - 2].low < e21[i - 2];
    const popped = bars[i - 1].high > e21[i - 1] || bars[i - 2].high > e21[i - 2];
    if (bull && dipped && b.close > b.open && b.close > e21[i]) { direction = 'long'; note = 'uptrend pullback resumed'; }
    else if (bear && popped && b.close < b.open && b.close < e21[i]) { direction = 'short'; note = 'downtrend pullback resumed'; }
  }
  if (!direction) return null;

  const dec = Math.max(0, Math.round(-Math.log10(priceStep)));
  const roundP = (x: number) => +(Math.round(x / priceStep) * priceStep).toFixed(dec);
  const dir = direction === 'long' ? 1 : -1;
  const entry = roundP(b.close);
  const stopLoss = roundP(entry - dir * cfg.slAtr * a);
  const tp = roundP(entry + dir * cfg.tpAtr * a);
  const confluence: Confluence = {
    direction, rawScore: dir, alignment: 1, quality: 1, macro: 1, confidence: 0.75,
    contributions: [{ key: 'swing', weight: 1, score: dir, weighted: dir }],
  };
  return {
    id: `${symbol}-swing-${b.time}-${direction}`,
    symbol,
    time: b.time,
    direction,
    mode,
    confidence: 0.75,
    entry,
    stopLoss,
    takeProfits: [tp],
    riskReward: cfg.tpAtr / cfg.slAtr,
    lot: cfg.lot,
    rationale: [
      `SWING ${direction.toUpperCase()} (${cfg.kind}) — ${note}`,
      `H1 layer · SL ${cfg.slAtr}×ATR · target ${cfg.tpAtr}×ATR · BE at 1R then ${cfg.trailDist}R trailing — held for days`,
    ],
    confluence,
  };
}
