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
  lotStep: number;
  minLot: number;
  minStopAtr: number;
  maxStopAtr: number;
  minRR: number;
  risk: RiskLimits;
}

/** Validé par backtest (15 000 bougies M5 gold réel, robuste sur 2 sous-périodes). Stratégie "scalp 1:3" : TP proche, SL large, win rate ~86%. Voir backtest/run.ts. */
export const DEFAULT_CONFIG: EngineConfig = {
  weights: {
    trend: { emaStack: 1.0, macd: 0.8, rsiPullback: 0.9, srZone: 0.6, divergence: 0.3, liquiditySweep: 0.5, roundLevel: 0.3 },
    range: { emaStack: 0.3, macd: 0.3, rsiPullback: 0.0, srZone: 1.0, divergence: 0.9, liquiditySweep: 0.9, roundLevel: 0.6 },
  },
  threshold: { soft: 0.62, normal: 0.55, turbo: 0.5 }, // validé (était 0.8/0.72/0.65 → 2 trades en 2,5 mois, trop sélectif)
  riskPct: { soft: 0.005, normal: 0.01, turbo: 0.0025 },
  macroBeta: 0.15,
  slAtrMult: 1.2, // était 0.6 — le stop trop serré se faisait sortir par le bruit et tuait l'edge (LE déblocage clé)
  targetRR: 0.3, // était 1.8 — TP = 1/3 du SL ("1:3") → win rate ~86%, on scalpe le 1er mouvement
  contractSize: 100,
  lotStep: 0.01,
  minLot: 0.01,
  minStopAtr: 0.5,
  maxStopAtr: 4.2, // était 4 — laisse passer les stops un peu plus larges
  minRR: 0.24, // était 1.2 — débloque les trades à R:R < 1 (sinon ils étaient tous rejetés)
  risk: {
    maxDailyLossPct: 0.04,
    maxOpenPositions: 2,
    maxOpenRiskPct: 0.03,
    maxTradesPerDay: 12,
    maxSpread: 0.5,
    minSecondsBetweenTrades: 60,
    newsLockoutBeforeSec: 120,
    newsLockoutAfterSec: 300,
    dailyProfitTargetPct: 0.05,
  },
};
