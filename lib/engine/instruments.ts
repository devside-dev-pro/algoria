// Registre des INSTRUMENTS tradés par Algoria — un edge scalp VALIDÉ par backtest par symbole.
// Fondation du mode multi-instruments : le runner multi-symboles et le risque portefeuille consomment ceci.
// Chaque instrument a sa PROPRE config (l'or et le Nasdaq n'ont pas le même profil : R:R, SL, seuil, maxSpread…).
import { SCALP_CONFIG, type EngineConfig } from './config';
import type { ContextOptions } from './context';

export interface InstrumentSpec {
  display: string; // label stocké/affiché dans le cockpit (ex. 'XAUUSD', 'NAS100')
  broker: string; // nom EXACT du symbole chez le broker (ex. 'Gold', 'NAS100')
  config: EngineConfig; // config scalp validée pour CET instrument
  ctx: Partial<ContextOptions>; // options de contexte (roundStep, tradeAsia, gate vol) — le spread est injecté au runtime
  enabled: boolean; // trader cet instrument ?
}

// Options de contexte communes au profil SCALP : session asia tradable + gate de volatilité élargi
// (validé sur l'or : ~2× la fréquence, edge conservé). Le spread réel est injecté par la couche data.
const SCALP_CTX: Partial<ContextOptions> = { tradeAsia: true, volMinPct: 0.05, volMaxPct: 0.995 };

// OR — config scalp actuelle (backtest M5 réel : ~17 trades/j, PF 1.21, robuste sur 2 moitiés).
const XAUUSD_SCALP: EngineConfig = SCALP_CONFIG;

// NAS100 — l'indice laisse courir les gagnants → R:R plus élevé (0.8 vs 0.4), SL plus serré (0.9×ATR), seuil 0.28.
// maxSpread relevé (spread indice en POINTS ; 0.95 est petit vs un range M5 ~40 pts).
// Backtest M5 réel (26 j) : ~12 trades/j, 86% win, PF 1.40, robuste (H1 1.36 / H2 1.42), tient à spread 1.5.
const NAS100_SCALP: EngineConfig = {
  ...SCALP_CONFIG,
  targetRR: 0.8,
  slAtrMult: 0.9,
  minRR: 0.2,
  minStopAtr: 0.3,
  maxStopAtr: 3,
  beTrigger: 0.15,
  threshold: { soft: 0.28, normal: 0.28, turbo: 0.28, scalp: 0.28 },
  risk: { ...SCALP_CONFIG.risk, maxSpread: 5 },
};

export const INSTRUMENTS: InstrumentSpec[] = [
  {
    display: 'XAUUSD',
    broker: process.env.ALGORIA_SYMBOL ?? 'XAUUSD',
    config: XAUUSD_SCALP,
    ctx: SCALP_CTX,
    enabled: true, // toujours actif (comportement live actuel)
  },
  {
    display: 'NAS100',
    broker: process.env.NAS100_SYMBOL ?? 'NAS100',
    config: NAS100_SCALP,
    ctx: { ...SCALP_CTX, roundStep: 100 }, // niveaux ronds du Nasdaq ~100 pts (pas les $10 de l'or)
    enabled: process.env.TRADE_NAS100 === '1', // opt-in tant que le runner multi-symboles n'est pas en place
  },
];

/** Instruments effectivement tradés (activés). */
export const activeInstruments = (): InstrumentSpec[] => INSTRUMENTS.filter((i) => i.enabled);
