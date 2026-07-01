import type { Mode, Regime } from './types';

export type WeightTable = Record<Regime, Record<string, number>>;

export interface RiskLimits {
  maxDailyLossPct: number; // ex 0.04 → -4% ⇒ kill switch
  maxOpenPositions: number;
  maxOpenRiskPct: number; // expo totale max (% solde)
  maxTradesPerDay: number;
  maxSpread: number; // en prix ($/once)
  minSecondsBetweenTrades: number;
  newsLockoutBeforeSec: number;
  newsLockoutAfterSec: number;
  dailyProfitTargetPct?: number; // option : stop quand vert
}

export interface EngineConfig {
  weights: WeightTable;
  threshold: Record<Mode, number>; // confiance mini pour tirer
  riskPct: Record<Mode, number>; // fraction du solde risquée / trade
  macroBeta: number; // force du tilt macro β
  slAtrMult: number; // buffer ATR au-delà de la structure
  targetRR: number; // R:R cible avant clamp structure
  contractSize: number; // XAUUSD ≈ 100 oz (préférer la spec broker)
  priceStep?: number; // pas d'arrondi des PRIX (entrée/SL/TP). Défaut 0.01 (or). EURUSD 0.00001, USDJPY 0.001, indices 0.1…
  lotStep: number;
  minLot: number;
  minStopAtr: number;
  maxStopAtr: number;
  minRR: number;
  beTrigger?: number; // breakeven : déplace le SL à ~entrée quand le profit ≥ beTrigger × riskDist (gestion post-entrée, appliquée par le runner & le backtest)
  risk: RiskLimits;
}

/** Validé par backtest (15 000 bougies M5 gold réel, robuste sur 2 sous-périodes). Stratégie "scalp 1:3" : TP proche, SL large, win rate ~86%. Voir backtest/run.ts. */
export const DEFAULT_CONFIG: EngineConfig = {
  weights: {
    trend: { emaStack: 1.0, macd: 0.8, rsiPullback: 0.9, srZone: 0.6, divergence: 0.3, liquiditySweep: 0.5, roundLevel: 0.3 },
    range: { emaStack: 0.3, macd: 0.3, rsiPullback: 0.0, srZone: 1.0, divergence: 0.9, liquiditySweep: 0.9, roundLevel: 0.6 },
  },
  threshold: { soft: 0.48, normal: 0.38, turbo: 0.25, scalp: 0.25 }, // validé (était 0.8/0.72/0.65 → trop sélectif). scalp = stratégie scalp validée (voir SCALP_CONFIG).
  riskPct: { soft: 0.005, normal: 0.01, turbo: 0.0025, scalp: 0.01 },
  macroBeta: 0.15,
  slAtrMult: 1.2, // était 0.6 — le stop trop serré se faisait sortir par le bruit et tuait l'edge (LE déblocage clé)
  targetRR: 0.3, // était 1.8 — TP = 1/3 du SL ("1:3") → win rate ~86%, on scalpe le 1er mouvement
  contractSize: 100,
  lotStep: 0.01,
  minLot: 0.01,
  minStopAtr: 0.5,
  maxStopAtr: 4.2, // était 4 — laisse passer les stops un peu plus larges
  minRR: 0.24, // était 1.2 — débloque les trades à R:R < 1 (sinon ils étaient tous rejetés)
  beTrigger: 0.15, // breakeven validé : SL → entrée dès que le profit atteint 15% du risque → win rate 93% (vs 86% sans), PF 2.60
  risk: {
    maxDailyLossPct: 0.04,
    maxOpenPositions: 2,
    maxOpenRiskPct: 0.03,
    maxTradesPerDay: 60,
    maxSpread: 0.5,
    minSecondsBetweenTrades: 60,
    newsLockoutBeforeSec: 120,
    newsLockoutAfterSec: 300,
    dailyProfitTargetPct: 0.05,
  },
};

/**
 * MODE SCALP — stratégie de scalping VALIDÉE par backtest (5 601 bougies M5 gold réel, 2026-06, ~19 jours de session).
 * Profil : seuil bas (trade souvent) + TP rapide (R:R 0.4) + SL serré (1.2×ATR) + breakeven précoce.
 * Résultats (riskPct 1%/trade, robuste sur les DEUX moitiés out-of-sample — voir backtest/scalp.ts) :
 *   239 trades · ~8.4/jour · win rate 88.3% · PF 1.44 · expectancy +0.05 R · netPnl +$1257 · maxDD 4.4% · H1 +$520 / H2 +$424.
 * NB : pousser la fréquence plus haut (seuil <0.25, R:R 0.2) fait s'effondrer le PF vers ~1.05 → churn sans edge réel.
 * C'est le plafond honnête d'un VRAI edge scalp sur M5. Utilisé par le runner quand mode === 'scalp'.
 */
export const SCALP_CONFIG: EngineConfig = {
  ...DEFAULT_CONFIG,
  targetRR: 0.4, // TP = 0.4 × SL : sortie rapide, win rate élevé
  slAtrMult: 1.2,
  minRR: 0.2,
  minStopAtr: 0.35, // autorise des stops un peu plus serrés (scalp)
  maxStopAtr: 3.2,
  beTrigger: 0.15, // breakeven dès 15% du risque atteint
  risk: {
    ...DEFAULT_CONFIG.risk,
    maxTradesPerDay: 200, // scalp : on ne veut pas brider la fréquence
    minSecondsBetweenTrades: 0, // une bougie M5 = au plus un signal, donc pas de bridage temporel
    maxOpenPositions: 2,
  },
};
