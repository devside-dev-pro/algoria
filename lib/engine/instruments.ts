// Registre des INSTRUMENTS tradés par Algoria — un edge scalp VALIDÉ par backtest par symbole.
// Fondation du mode multi-instruments : le runner multi-symboles et le risque portefeuille consomment ceci.
// Chaque instrument a sa PROPRE config (l'or et le Nasdaq n'ont pas le même profil : R:R, SL, seuil, maxSpread…).
import { SCALP_CONFIG, type EngineConfig } from './config';
import { GOLD_BREAKOUT, type BreakoutConfig } from './breakout';
import { BTC_SWING, GOLD_SWING, type SwingConfig } from './swing';
import { ACTIVE_STRATEGY as STRAT } from './strategies';
import type { ContextOptions } from './context';

export interface InstrumentSpec {
  display: string; // label stocké/affiché dans le cockpit (ex. 'XAUUSD', 'NAS100')
  broker: string; // nom EXACT du symbole chez le broker (ex. 'Gold', 'NAS100')
  config: EngineConfig; // config scalp validée pour CET instrument
  ctx: Partial<ContextOptions>; // options de contexte (roundStep, tradeAsia, gate vol) — le spread est injecté au runtime
  enabled: boolean; // trader cet instrument ?
  breakout?: BreakoutConfig; // 2ᵉ stratégie (cassures Donchian) EN PLUS du scalp — uniquement si validée par le labo
  // COUCHE SWING (H1) : position de FOND tenue des jours, slot séparé du scalp, lot dédié — validée au labo.
  // S'exécute même sur un instrument watchOnly (le watch-only ne bloque que l'intraday, sans edge validé).
  swing?: SwingConfig;
  // WATCH-ONLY : chart + desk + bougies + trades MANUELS, mais JAMAIS d'exécution auto INTRADAY (aucun edge validé).
  // Cas d'usage : BTC — le scalp y est interdit, mais la couche swing validée tourne.
  watchOnly?: boolean;
}

// Options de contexte communes au profil SCALP : gate de volatilité élargi (validé sur l'or : ~2× la
// fréquence, edge conservé). tradeAsia vient de la STRATÉGIE (S1 coupe la nuit — c'est là que les journées
// commencent mal : sans Asie, 67% de jours verts vs 59%). Le spread réel est injecté par la couche data.
const SCALP_CTX: Partial<ContextOptions> = { tradeAsia: STRAT.tradeAsia, volMinPct: 0.05, volMaxPct: 0.995 };

// OR — config scalp. fixedLot 1 (le copieur redimensionne par compte). emaGate 'notOpposed' : on refuse
// UNIQUEMENT les trades contre-tendance (la cause des gros perdants — acheter un top contre l'EMA), mais on
// autorise les setups en EMA plate → ~11 trades/j au lieu de 7 pour le MÊME net (~$13.4k/30j), robuste.
// Backtest 30.5j : align 7/j PF 1.43 DD 7.4% · notOpposed 10.9/j PF 1.27 DD 10.3% · off 11.5/j PF 1.24.
// Choix produit : fréquence pour le live, au prix d'un DD un peu plus haut — l'edge reste solide.
// Le PROFIL DE STRATÉGIE (env ALGORIA_STRATEGY) surcharge seuil/TP/caps — défaut S2 = valeurs actuelles.
const XAUUSD_SCALP: EngineConfig = {
  ...SCALP_CONFIG,
  fixedLot: 1,
  emaGate: 'notOpposed',
  targetRR: STRAT.targetRR,
  minRR: STRAT.minRR, // S2/S3 0.75 : refuse les TP clampés trop proches (l'hémorragie des mois difficiles)
  trailActivate: STRAT.trailActivate, // trailing lock scalp (S2/S3) — voir strategies.ts
  trailDist: STRAT.trailDist,
  regimeGate: STRAT.regimeGate, // S3 'trend' : décorrélation + juillet ×2.4 — voir strategies.ts
  threshold: { ...SCALP_CONFIG.threshold, scalp: STRAT.thresholdScalp },
  risk: { ...SCALP_CONFIG.risk, dailyProfitTargetPct: STRAT.dailyProfitTargetPct, maxDailyLossPct: STRAT.maxDailyLossPct, dayLockTriggerPct: STRAT.dayLockTriggerPct, dayLockFloorPct: STRAT.dayLockFloorPct },
};

// BTC — config de LECTURE seulement (seuils du desk, spread max) : l'auto ne tire jamais (watchOnly).
const BTCUSD_WATCH: EngineConfig = {
  ...SCALP_CONFIG,
  contractSize: 1, // CFD crypto : 1 lot = 1 BTC
  priceStep: 0.01,
  risk: { ...SCALP_CONFIG.risk, maxSpread: 40 }, // spread réel mesuré ~10$ — marge pour les heures creuses
};

export const INSTRUMENTS: InstrumentSpec[] = [
  {
    display: 'XAUUSD',
    broker: process.env.ALGORIA_SYMBOL ?? 'XAUUSD',
    config: XAUUSD_SCALP,
    ctx: SCALP_CTX,
    enabled: true, // toujours actif (comportement live actuel)
    // 2ᵉ cerveau : cassures Donchian 8h — EN PLUS du scalp (labo 30.5j : PF 1.50, +$2248, ~3.6 setups/j,
    // tiers ✅✅✅). Le scalp joue les rejets, le breakout joue les cassures. Cap 1 position/symbole partagé.
    // S1 les coupe : une position tenue des heures/jours casse la promesse « objectif du jour puis stop ».
    breakout: STRAT.breakout ? GOLD_BREAKOUT : undefined,
    // 3ᵉ couche : SWING de fond H1 (labo 1.75 an : PF 2.21, +88%, tenue moy 3.5 j, en position 67% du temps).
    swing: STRAT.swing ? GOLD_SWING : undefined,
  },
  // NAS100 RETIRÉ (produit) : Social Trade Hub ne copie pas l'indice et son sizing en lots est piégeux —
  // les pertes NAS n'apparaissaient QUE sur le compte maître, jamais chez les clients. Focus GOLD + BITCOIN.
  // (Les configs/backtests NAS restent dans backtest/ et swing.ts si on le réactive un jour.)
  {
    // BTC — seul marché 24/7 (les lives du week-end). AUCUN edge auto validé (scalp ET labo ont échoué —
    // backtest/validate.ts + backtest/lab.ts, 17.4 j) → watchOnly : desk/chart/bougies vivent, l'auto ne tire
    // JAMAIS, le manuel reste possible depuis le cockpit. Les bougies s'accumulent → re-validation dans 1 mois.
    display: 'BTCUSD',
    broker: process.env.BTCUSD_SYMBOL ?? 'BTCUSD',
    config: BTCUSD_WATCH,
    ctx: { ...SCALP_CTX, roundStep: 1000, h24: true }, // niveaux psychologiques BTC ~1000$ · 24/7 : jamais de session 'closed'
    enabled: process.env.WATCH_BTCUSD !== '0', // ON par défaut (désactivable sans redeploy de code)
    watchOnly: true, // pas de scalp intraday (aucun edge validé) — mais la couche SWING ci-dessous tourne
    // SWING de fond 24/7 (labo 2.7 ans : PF 2.02, +39% à 1% de risque, week-end PF 2.7) — le compte vit le week-end.
    // Coupé sur S1 (aucune position multi-jours sur le profil « journée bouclée »).
    swing: STRAT.swing ? BTC_SWING : undefined,
  },
];

/** Instruments effectivement tradés (activés). */
export const activeInstruments = (): InstrumentSpec[] => INSTRUMENTS.filter((i) => i.enabled);
