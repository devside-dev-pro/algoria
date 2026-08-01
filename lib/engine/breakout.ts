// STRATÉGIE BREAKOUT (Donchian) — 2ᵉ cerveau d'Algoria sur l'or, EN PLUS du scalp de confluence (on n'y touche pas).
// Le scalp joue les REJETS de niveaux ; le breakout joue les CASSURES — deux régimes de marché couverts.
// Validée par le labo (backtest/lab.ts, 30.5 j de M5 or réel, mêmes règles causales que l'edge historique) :
//   breakout N96 : 109 trades (~3.6/j) · win 62% · PF 1.50 · net +$2248 · DD 4.5% · TIERS $264/$606/$749 ✅
//   (toute la famille N24/48/96 ±volume est robuste — signature d'un vrai edge, pas d'une config chanceuse.)
// Sorties validées : SL 1.5×ATR · TP 3×ATR · breakeven à 0.8R · trailing 1.2R activé à 1.2R.
import type { Bar, Confluence, Mode, Signal } from './types';
import { passesRegime, type RegimeFilter } from './regime';

export interface BreakoutConfig {
  N: number; // fenêtre Donchian (bougies M5) — 96 ≈ 8 h
  confirmAtr: number; // la clôture doit dépasser le canal d'au moins confirmAtr × ATR (anti-mèche)
  slAtr: number; // stop en × ATR
  tpAtr: number; // objectif en × ATR (le trailing prend le relais avant, en général)
  lot: number; // lot FIXE (comme le scalp or — le copieur redimensionne par compte)
  beTrigger: number; // breakeven à × riskDist (0.8 — tard : une cassure a besoin d'air, pas comme le scalp 0.15)
  trailActivate: number; // active le trailing à × riskDist
  trailDist: number; // distance du trailing en × riskDist
  // FILTRE DE RÉGIME — refuse la cassure quand le marché n'a pas de direction (voir GOLD_BREAKOUT).
  // undefined = aucun filtre. Appliqué DANS breakoutSignal : le live et le simulateur exécutent donc
  // strictement le même code sur les mêmes bougies, ils ne peuvent pas diverger.
  regime?: RegimeFilter;
}

/** Config OR validée par le labo — voir l'en-tête.
 *  SORTIES RESSERRÉES (étude 2/6→20/7, split-half) : l'ancien trailing 1.2R@1.2R laissait un trou entre le BE
 *  (0.8R) et 1.2R — un trade à +1.1R qui se retournait finissait ~0$ (vécu en live le 22/7 : +1 100$ → BE).
 *  BE 0.7 · trail 0.5R dès 0.8R : net ×3.6 (+740→+2 698$), juillet −451→+437$, et les 48 combinaisons
 *  voisines (be 0.7-0.9 × act 0.7-1.0 × dist 0.45-0.6) DOMINENT toutes l'ancienne config sur les DEUX moitiés.
 *  CONFIRMATION 0.25 ATR (harnais breakout 29/07, validé Mathieu « go tout ») : la marge anti-mèche à 0.1
 *  laissait passer trop de fausses cassures — à 0.25, PF 1.37→1.62 et juillet (OOS) ×2 (+7 957→+16 291$)
 *  sur N96 ; N32 (S3) gagne aussi (+47,8k→+49,5k, les deux mois verts). Coûts ×3 : toujours vert.
 *
 *  FILTRE DE RÉGIME ADX ≥ 25 (01/08, walk-forward 7 fenêtres jamais vues + feu vert Mathieu) — LE premier
 *  changement de config adossé à une preuve hors échantillon, tous les précédents ayant été réglés in-sample.
 *  Un canal Donchian percé sans tendance derrière est un faux départ qui paie le spread puis le stop.
 *  OOS par seuil (35 jours de test) : 20 → +$4 108 · 22 → +$6 826 · 25 → +$10 313 · 28 → +$4 570 ·
 *  30 → +$4 505 · AUCUN FILTRE → −$934. Les cinq seuils sont verts, le seul rouge est l'absence de filtre :
 *  ce n'est donc pas la valeur 25 qui porte le résultat, c'est le fait de filtrer. 25 est à la fois le pic
 *  et le centre du plateau, donc une dérive du marché nous laisse dans le vert n'importe où entre 20 et 30.
 *  Mesuré sur un simulateur dont l'écart au live vaut $571 sur CETTE couche (parité juillet, après le
 *  correctif de gestion intra-bougie). Coût assumé : 146 → 102 trades sur 35 jours.
 *  État remplacé, prouvé mauvais en réel : breakout non filtré = −$1 089 (S2) et −$1 232 (S3) en 11 jours. */
export const GOLD_BREAKOUT: BreakoutConfig = { N: 96, confirmAtr: 0.25, slAtr: 1.5, tpAtr: 3, lot: 1, beTrigger: 0.7, trailActivate: 0.8, trailDist: 0.5, regime: { adxMin: 25 } };

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

  // RÉGIME : la cassure est là, mais y a-t-il une tendance pour la porter ? Testé APRÈS la détection —
  // on ne paie le calcul que sur les rares bougies qui percent réellement le canal.
  if (cfg.regime && !passesRegime(bars, cfg.regime)) return null;

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
