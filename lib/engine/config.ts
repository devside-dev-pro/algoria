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
  // RATCHET JOURNALIER (option) : pic du jour ≥ trigger → journée coupée si l'equity retombe au floor.
  dayLockTriggerPct?: number;
  dayLockFloorPct?: number;
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
  fixedLot?: number; // si défini (>0) : TOUT trade auto utilise ce lot FIXE (ignore le sizing par risque). Sinon lot = risque%/stop.
  lotStep: number;
  minLot: number;
  minStopAtr: number;
  maxStopAtr: number;
  // PLAFOND ABSOLU du stop, en unités de PRIX ($/once pour l'or) — étude forensique 01/08 sur les 343
  // trades scalp de juillet en base. Le classement par distance de stop est sans appel :
  //     < 2 $ : 246 trades  +$37 388  98 % de réussite
  //   4 - 6 $ :  23 trades   −$6 777  39 %
  //   6 - 9 $ :  46 trades  −$25 673  24 %
  //    ≥ 9 $ :  25 trades  −$16 462  28 %
  // Ce n'est pas seulement que la perte est plus grosse : le TAUX DE RÉUSSITE s'effondre. La raison est
  // mécanique — tout le système vit du breakeven précoce à 0,15R. Avec un stop à 1,50 $, le BE s'arme
  // après 22 centimes de mouvement favorable, presque toujours. Avec un stop à 12 $, il faut 1,80 $ : le
  // trade part au stop plein avant. Les setups à stop large ne sont pas plus risqués, ils sortent de la
  // logique du système.
  // Pourquoi en PRIX et pas en ATR : maxStopAtr 2.8 avec un ATR de 3-5 $ en séance autorise 8 à 14 $ —
  // il laisse passer exactement ce qu'il devrait bloquer. Le plafond doit être absolu pour mordre.
  // undefined = pas de plafond (comportement actuel).
  maxStopPrice?: number;
  minRR: number;
  emaGate?: 'off' | 'align' | 'notOpposed'; // filtre d'entrée sur la tendance EMA : 'align' = EMA doit soutenir le sens ; 'notOpposed' = refuse seulement si l'EMA s'oppose (plat OK). Défaut off.
  // GATE RÉGIME (décorrélation) : ne trade que dans CE régime de marché (context.regime). 'range' = rejets
  // de niveaux uniquement · 'trend' = poussées uniquement. Deux stratégies gatées sur des régimes opposés ne
  // peuvent PAS prendre le même trade — c'est la partition des familles de signaux. Défaut : off (tout régime).
  regimeGate?: 'trend' | 'range';
  beTrigger?: number; // breakeven : déplace le SL à ~entrée quand le profit ≥ beTrigger × riskDist (gestion post-entrée, appliquée par le runner & le backtest)
  // TRAILING LOCK (gestion post-entrée, au-delà du BE) : dès que le meilleur prix atteint trailActivate × riskDist,
  // le SL suit à peak − trailDist × riskDist. Convertit les « touché +0.6R puis retourné » (scratch BE ~0$) en
  // gains verrouillés (~+0.25R). Étude 2/6→20/7 S2 (mode scalp, robuste sur les DEUX moitiés, plateau 24/24
  // combinaisons act 0.45-0.7 × dist 0.3-0.45) : net +9 174→+14 957$, juillet −1 722→+1 885$, jours verts 61→63%.
  trailActivate?: number;
  trailDist?: number;
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
    maxDailyLossPct: 0.04, // −4% du solde master (~$2 800 sur 70k) → journée coupée. Client (ratio copie) ≈ −$30 à −$60, sous la barre des 100€.
    maxOpenPositions: 2,
    maxOpenRiskPct: 0.03,
    maxTradesPerDay: 60,
    maxSpread: 0.5,
    minSecondsBetweenTrades: 60,
    newsLockoutBeforeSec: 120,
    newsLockoutAfterSec: 300,
    // +4% du solde master → objectif du jour atteint, Algoria arrête de trader (latch dayDone, cf. readState).
    // Symétrique au plafond de perte : « petits gains réguliers » plutôt que rendre un gain sur des stops.
    dailyProfitTargetPct: 0.04,
  },
};

/**
 * MODE SCALP — stratégie de scalping VALIDÉE par backtest (5 601 bougies M5 gold réel, 2026-06, ~19 jours de session).
 * Profil : seuil bas (trade souvent) + on laisse courir (R:R 1.0) + SL serré (1.2×ATR) + breakeven précoce.
 * Résultats (riskPct 1%/trade, robuste sur les DEUX moitiés out-of-sample — voir backtest/scalp.ts) :
 *   239 trades · ~8.4/jour · win rate 88.3% · PF 1.44 · expectancy +0.05 R · netPnl +$1257 · maxDD 4.4% · H1 +$520 / H2 +$424.
 * NB : pousser la fréquence plus haut (seuil <0.25, R:R 0.2) fait s'effondrer le PF vers ~1.05 → churn sans edge réel.
 * C'est le plafond honnête d'un VRAI edge scalp sur M5. Utilisé par le runner quand mode === 'scalp'.
 */
export const SCALP_CONFIG: EngineConfig = {
  ...DEFAULT_CONFIG,
  // TP = 1.0 × SL : on LAISSE COURIR le gagnant. Le breakeven précoce (0.15) reste le filet — il transforme
  // les futurs perdants en trades ~0 —, mais couper les gagnants à 0.4×SL laissait trop d'argent sur la table.
  // Backtest M5 gold juin+juillet (inclut les journées rouges 10 & 14/07) : net ×4 (+153 → +609 $),
  // perte de la quinzaine rouge amortie de 85% (−395 → −60 $), win rate identique 84%, drawdown ~inchangé.
  // Desserrer le BE, à l'inverse, effondrait le win rate 86%→65% : on n'y touche pas.
  targetRR: 1.0,
  slAtrMult: 1.2,
  minRR: 0.2,
  minStopAtr: 0.35, // autorise des stops un peu plus serrés (scalp)
  maxStopAtr: 3.2,
  beTrigger: 0.15, // breakeven dès 15% du risque atteint
  risk: {
    ...DEFAULT_CONFIG.risk,
    maxTradesPerDay: 200, // scalp : on ne veut pas brider la fréquence
    minSecondsBetweenTrades: 0, // une bougie M5 = au plus un signal, donc pas de bridage temporel
    // 1 position PAR SYMBOLE à la fois (readState compte par symbole) : empêche l'empilement de positions
    // corrélées (2 longs au sommet stoppés ensemble). Backtest 30j : PF 1.26→1.32, net +$15.4k→+$16.3k, même DD.
    maxOpenPositions: 1,
  },
};
