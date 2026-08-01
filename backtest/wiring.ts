// CÂBLAGE partagé des harnais (rules / parity / walkforward / stress) : reconstruit la config moteur
// d'une stratégie EXACTEMENT comme lib/engine/instruments.ts (sans dépendre de l'env ALGORIA_STRATEGY),
// + les paramètres de simulation du compte maître ($70k, lot fixe 1, frais réels RaiseFX mesurés).
import { SCALP_CONFIG, type EngineConfig } from '../lib/engine/config';
import type { StrategyProfile } from '../lib/engine/strategies';
import type { Mode } from '../lib/engine/types';

export function cfgFor(p: StrategyProfile): EngineConfig {
  return {
    ...SCALP_CONFIG,
    fixedLot: 1,
    emaGate: 'notOpposed',
    targetRR: p.targetRR,
    minRR: p.minRR,
    trailActivate: p.trailActivate,
    trailDist: p.trailDist,
    regimeGate: p.regimeGate,
    maxStopAtr: p.maxStopAtr ?? SCALP_CONFIG.maxStopAtr,
    threshold: { ...SCALP_CONFIG.threshold, scalp: p.thresholdScalp },
    risk: { ...SCALP_CONFIG.risk, dailyProfitTargetPct: p.dailyProfitTargetPct, maxDailyLossPct: p.maxDailyLossPct, dayLockTriggerPct: p.dayLockTriggerPct, dayLockFloorPct: p.dayLockFloorPct },
  };
}

// intrabarManage (01/08) : le live remonte le stop TOUTES LES SECONDES (runner/metaapi/manage.ts sur le
// tick), le sim ne le faisait qu'en fin de bougie M5 et ne le testait qu'à la suivante. Ce sursis de
// 5 minutes est ce qui transformait des breakevens réels en sorties 'trail' simulées — mesuré sur la
// couche breakout de juillet : 41 % de 'trail' en sim contre 7 % en live. Le scalp subit la même
// mécanique (BE précoce à 0,15R), donc tous les harnais tournent avec.
export const SIM_BASE = { symbol: 'XAUUSD', mode: 'scalp' as Mode, startBalance: 70_000, spread: 0.2, slippage: 0.05, commissionPerLot: 7, contractSize: 100, warmup: 210, window: 600, intrabarManage: true };

export const ctxFor = (p: StrategyProfile) => ({ tradeAsia: p.tradeAsia, volMinPct: 0.05, volMaxPct: 0.995 });

/**
 * Paramètres de SIMULATION du profil — la partie du live qui ne vit pas dans EngineConfig (01/08).
 * Trou trouvé en enquêtant sur la parité : blockScalpEntryUtcHours est en live depuis le 29/07 (S2 et S3
 * ne prennent plus d'entrée scalp entre 12h et 17h UTC) et n'était câblé NULLE PART dans les harnais.
 * Le « PROD S2 » du walk-forward et de la parité n'était donc pas la S2 réelle — on comparait la prod à
 * une prod qui n'existe plus. Tout ce qui définit le comportement live doit passer par ici, sinon le
 * tribunal juge un accusé qui n'est pas celui qu'on lui présente.
 */
export const simFor = (p: StrategyProfile) => ({
  ...SIM_BASE,
  ...(p.blockScalpEntryUtcHours ? { blockEntryHours: p.blockScalpEntryUtcHours } : {}),
  ctxOpts: ctxFor(p),
});
