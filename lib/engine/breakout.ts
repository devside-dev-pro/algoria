// STRATÉGIE BREAKOUT (Donchian) — 2ᵉ cerveau d'Algoria sur l'or, EN PLUS du scalp de confluence (on n'y touche pas).
// Le scalp joue les REJETS de niveaux ; le breakout joue les CASSURES — deux régimes de marché couverts.
// Validée par le labo (backtest/lab.ts, 30.5 j de M5 or réel, mêmes règles causales que l'edge historique) :
//   breakout N96 : 109 trades (~3.6/j) · win 62% · PF 1.50 · net +$2248 · DD 4.5% · TIERS $264/$606/$749 ✅
//   (toute la famille N24/48/96 ±volume est robuste — signature d'un vrai edge, pas d'une config chanceuse.)
// Sorties validées : SL 1.5×ATR · TP 3×ATR · breakeven à 0.8R · trailing 1.2R activé à 1.2R.
import type { Bar, Confluence, Mode, Signal } from './types';

export interface BreakoutConfig {
  N: number; // fenêtre Donchian (bougies M5) — 96 ≈ 8 h
  confirmAtr: number; // la clôture doit dépasser le canal d'au moins confirmAtr × ATR (anti-mèche)
  slAtr: number; // stop en × ATR
  tpAtr: number; // objectif en × ATR (le trailing prend le relais avant, en général)
  lot: number; // lot FIXE (comme le scalp or — le copieur redimensionne par compte)
  beTrigger: number; // breakeven à × riskDist (0.8 — tard : une cassure a besoin d'air, pas comme le scalp 0.15)
  trailActivate: number; // active le trailing à × riskDist
  trailDist: number; // distance du trailing en × riskDist
}

/** Config OR validée par le labo — voir l'en-tête. */
export const GOLD_BREAKOUT: BreakoutConfig = { N: 96, confirmAtr: 0.1, slAtr: 1.5, tpAtr: 3, lot: 1, beTrigger: 0.8, trailActivate: 1.2, trailDist: 1.2 };

const atr14 = (bars: Bar[]): number => {
  const n = bars.length;
  const from = Math.max(1, n - 14);
  let sum = 0;
  for (let i = from; i < n; i++)
    sum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  return sum / (n - from);
};

/**
 * Détection sur CLÔTURE de la dernière bougie (même cadence M5 que le moteur) : clôture au-delà du plus
 * haut/bas des N bougies PRÉCÉDENTES (la bougie courante est exclue du canal) + marge anti-mèche en ATR.
 * Auto-dédupliquant : la bougie de cassure entre ensuite dans le canal → pas de re-tir sans nouvelle poussée.
 */
export function breakoutSignal(symbol: string, bars: Bar[], cfg: BreakoutConfig, mode: Mode, priceStep = 0.01): Signal | null {
  if (bars.length < cfg.N + 15) return null;
  const b = bars[bars.length - 1];
  const atr = atr14(bars);
  if (!atr) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = bars.length - 1 - cfg.N; k < bars.length - 1; k++) {
    hi = Math.max(hi, bars[k].high);
    lo = Math.min(lo, bars[k].low);
  }
  let direction: 'long' | 'short';
  let excess: number;
  if (b.close > hi + cfg.confirmAtr * atr) { direction = 'long'; excess = (b.close - hi) / atr; }
  else if (b.close < lo - cfg.confirmAtr * atr) { direction = 'short'; excess = (lo - b.close) / atr; }
  else return null;

  const dec = Math.max(0, Math.round(-Math.log10(priceStep))); // 0.01 → 2 décimales (coupe le bruit flottant du ×step)
  const roundP = (x: number) => +(Math.round(x / priceStep) * priceStep).toFixed(dec);
  const dir = direction === 'long' ? 1 : -1;
  const entry = roundP(b.close);
  const stopLoss = roundP(entry - dir * cfg.slAtr * atr);
  const tp = roundP(entry + dir * cfg.tpAtr * atr);
  // Confiance HONNÊTE : force de la cassure (dépassement en ATR), bornée — pas un score de confluence.
  const confidence = Math.min(0.9, 0.55 + excess * 0.3);
  const level = direction === 'long' ? hi : lo;
  const confluence: Confluence = {
    direction, rawScore: dir, alignment: 1, quality: Math.min(1, excess), macro: 1, confidence,
    contributions: [{ key: 'breakout', weight: 1, score: dir, weighted: dir }],
  };
  return {
    id: `${symbol}-${b.time}-bk-${direction}`,
    symbol,
    time: b.time,
    direction,
    mode,
    confidence,
    entry,
    stopLoss,
    takeProfits: [tp],
    riskReward: cfg.tpAtr / cfg.slAtr,
    lot: cfg.lot,
    rationale: [
      `BREAKOUT ${direction.toUpperCase()} — ${((cfg.N * 5) / 60).toFixed(0)}h ${direction === 'long' ? 'high' : 'low'} ${level.toFixed(1)} broken (+${excess.toFixed(2)}×ATR)`,
      `SL ${cfg.slAtr}×ATR · TP ${cfg.tpAtr}×ATR · trailing exit ${cfg.trailDist}R after ${cfg.trailActivate}R`,
    ],
    confluence,
  };
}
