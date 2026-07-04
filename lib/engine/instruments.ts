// Registre des INSTRUMENTS tradés par Algoria — un edge scalp VALIDÉ par backtest par symbole.
// Fondation du mode multi-instruments : le runner multi-symboles et le risque portefeuille consomment ceci.
// Chaque instrument a sa PROPRE config (l'or et le Nasdaq n'ont pas le même profil : R:R, SL, seuil, maxSpread…).
import { SCALP_CONFIG, type EngineConfig } from './config';
import { GOLD_BREAKOUT, type BreakoutConfig } from './breakout';
import { BTC_SWING, GOLD_SWING, NAS_SWING, type SwingConfig } from './swing';
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

// Options de contexte communes au profil SCALP : session asia tradable + gate de volatilité élargi
// (validé sur l'or : ~2× la fréquence, edge conservé). Le spread réel est injecté par la couche data.
const SCALP_CTX: Partial<ContextOptions> = { tradeAsia: true, volMinPct: 0.05, volMaxPct: 0.995 };

// OR — config scalp. fixedLot 1 (le copieur redimensionne par compte). emaGate 'notOpposed' : on refuse
// UNIQUEMENT les trades contre-tendance (la cause des gros perdants — acheter un top contre l'EMA), mais on
// autorise les setups en EMA plate → ~11 trades/j au lieu de 7 pour le MÊME net (~$13.4k/30j), robuste.
// Backtest 30.5j : align 7/j PF 1.43 DD 7.4% · notOpposed 10.9/j PF 1.27 DD 10.3% · off 11.5/j PF 1.24.
// Choix produit : fréquence pour le live, au prix d'un DD un peu plus haut — l'edge reste solide.
const XAUUSD_SCALP: EngineConfig = { ...SCALP_CONFIG, fixedLot: 1, emaGate: 'notOpposed' };

// NAS100 — l'indice laisse courir les gagnants → R:R plus élevé (0.8 vs 0.4), SL serré (0.6×ATR), seuil 0.28.
// maxSpread relevé (spread indice en POINTS ; 0.95 est petit vs un range M5 ~40 pts).
// Backtest M5 réel (26 j, harness backtest/validate.ts) : ~15 trades/j, 84% win, PF 1.44, DD 5.8%,
// robuste (H1 +$1844 / H2 +$1297). SL 0.6×ATR bat 0.9×ATR (PF 1.44 vs 1.30) — sortie plus rapide, moins de bruit encaissé.
const NAS100_SCALP: EngineConfig = {
  ...SCALP_CONFIG,
  targetRR: 0.8,
  slAtrMult: 0.6,
  minRR: 0.2,
  minStopAtr: 0.3,
  maxStopAtr: 3,
  beTrigger: 0.15,
  fixedLot: 10, // 10 lots fixes par trade auto (choix produit — le risque $ varie avec le stop)
  contractSize: 1, // CFD indice : 1 pt = 1$/lot. SANS cette surcharge, l'héritage or (100) gonflait l'exposition 100× → veto risk sur TOUS les trades NAS.
  priceStep: 0.1, // tick de prix indice
  threshold: { soft: 0.28, normal: 0.28, turbo: 0.28, scalp: 0.28 },
  risk: { ...SCALP_CONFIG.risk, maxSpread: 5 },
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
    breakout: GOLD_BREAKOUT,
    // 3ᵉ couche : SWING de fond H1 (labo 1.75 an : PF 2.21, +88%, tenue moy 3.5 j, en position 67% du temps).
    swing: GOLD_SWING,
  },
  {
    display: 'NAS100',
    broker: process.env.NAS100_SYMBOL ?? 'NAS100',
    config: NAS100_SCALP,
    ctx: { ...SCALP_CTX, roundStep: 100 }, // niveaux ronds du Nasdaq ~100 pts (pas les $10 de l'or)
    enabled: process.env.TRADE_NAS100 === '1', // opt-in tant que le runner multi-symboles n'est pas en place
    // Couche SWING de fond H1 (labo 2.2 ans : cassure 72h, PF 1.94, +$3086, DD 6.9%, tiers ✅✅✅).
    swing: NAS_SWING,
  },
  {
    // BTC — seul marché 24/7 (les lives du week-end). AUCUN edge auto validé (scalp ET labo ont échoué —
    // backtest/validate.ts + backtest/lab.ts, 17.4 j) → watchOnly : desk/chart/bougies vivent, l'auto ne tire
    // JAMAIS, le manuel reste possible depuis le cockpit. Les bougies s'accumulent → re-validation dans 1 mois.
    display: 'BTCUSD',
    broker: process.env.BTCUSD_SYMBOL ?? 'BTCUSD',
    config: BTCUSD_WATCH,
    ctx: { ...SCALP_CTX, roundStep: 1000 }, // niveaux psychologiques BTC ~1000$
    enabled: process.env.WATCH_BTCUSD !== '0', // ON par défaut (désactivable sans redeploy de code)
    watchOnly: true, // pas de scalp intraday (aucun edge validé) — mais la couche SWING ci-dessous tourne
    // SWING de fond 24/7 (labo 2.7 ans : PF 2.02, +39% à 1% de risque, week-end PF 2.7) — le compte vit le week-end.
    swing: BTC_SWING,
  },
];

/** Instruments effectivement tradés (activés). */
export const activeInstruments = (): InstrumentSpec[] => INSTRUMENTS.filter((i) => i.enabled);
