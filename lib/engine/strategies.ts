// PROFILS DE STRATÉGIE — un runner = un master = UNE stratégie, choisie par l'env ALGORIA_STRATEGY (1|2|3).
// Défaut '2' = le comportement live actuel à l'identique (zéro changement tant que la variable n'est pas posée).
// Le lot copieur est FIXE (0.01 côté client) : le levier de risque du membre, c'est le CHOIX de stratégie.
//
// Étude 2/6→14/7 (M5 gold réel, 8 258 bougies, jours rouges inclus, master $70k lot 1, par JOURNÉE) :
//   S1 (thr .25 · RR 0.4 · sans Asie · +1%/−3%) : 67% de jours verts · série rouge max 3 j · rouge moyen −$990 · net +$7 807
//     → le profil qui MAXIMISE le taux de jours verts : TP court (86% de réussite/trade) pour banker vite,
//       session Asie coupée (c'est la nuit que les journées commencent mal), objectif +1% puis stop.
//       Sans swing ni breakout : la promesse « journée bouclée » est incompatible avec une position tenue des jours.
//   S2 (live actuel : thr .25 · RR 1.0 · +4%/−4%) : 53% verts · net +$7 045 — la référence.
//   S3 (thr .20 · RR 1.0 · +8%/−6%) : 58% verts · net +$24 496 sur la fenêtre — MAIS seuil bas = sur-trading
//     historiquement fragile hors échantillon → à re-valider sur une fenêtre longue avant tout client réel.
export interface StrategyProfile {
  id: 1 | 2 | 3;
  key: 'steady' | 'balanced' | 'turbo';
  label: string;
  thresholdScalp: number; // seuil de confiance scalp (plus haut = plus sélectif)
  targetRR: number; // TP en multiple du SL
  // R:R MINIMUM accepté après le clamp structure (TP posé sur le premier mur S/R). Étude 2/6→20/7 (robuste
  // sur les DEUX moitiés) : à 0.2, les trades « +197$ pour risquer 800$ » saignent les mois difficiles
  // (juillet −8 814$) ; à 0.75, juillet passe POSITIF (+2 621$) et le net total ×4.5 (+1 999→+9 174$).
  // S1 garde 0.2 : son design EST le petit TP rapide (targetRR 0.4 validé tel quel). S3 : étude à part.
  minRR: number;
  // TRAILING LOCK scalp (au-delà du BE 0.15) : SL suit à peak − trailDist×R dès peak ≥ trailActivate×R.
  // LE correctif de la géométrie « gains minuscules / pertes pleines » : avec TP à 1R, la plupart des trades
  // touchent +0.15R (BE) puis se font sortir à ~0$ — le trailing convertit ces scratchs en +0.2-0.3R verrouillés.
  // Étude 2/6→20/7 (plateau 24/24 combinaisons robustes sur les deux moitiés) :
  //   S2 : net +9 174→+14 957$ · juillet −1 722→+1 885$ · jours verts 61→63% · gain moyen réel ~+305$
  //   S3 (avec minRR 0.75) : net +22 619$ · juin +20 708/juil +1 910 ✅ (sa config minRR 0.2 : juil −8 929 ❌)
  // S1 non concernée : son TP à 0.4R est atteint avant tout déclenchement à 0.6R.
  trailActivate?: number;
  trailDist?: number;
  tradeAsia: boolean; // trader la session Asie ?
  dailyProfitTargetPct: number; // objectif du jour → latch dayDone
  maxDailyLossPct: number; // plancher du jour → latch dayDone
  swing: boolean; // couche positions de fond (H1, tenues des jours)
  breakout: boolean; // 2ᵉ stratégie intraday (cassures Donchian)
}

export const STRATEGIES: Record<string, StrategyProfile> = {
  '1': { id: 1, key: 'steady', label: 'S1 STEADY — small daily target, tight caps', thresholdScalp: 0.25, targetRR: 0.4, minRR: 0.2, tradeAsia: false, dailyProfitTargetPct: 0.01, maxDailyLossPct: 0.03, swing: false, breakout: false },
  '2': { id: 2, key: 'balanced', label: 'S2 BALANCED — the reference engine', thresholdScalp: 0.25, targetRR: 1.0, minRR: 0.75, trailActivate: 0.6, trailDist: 0.35, tradeAsia: true, dailyProfitTargetPct: 0.04, maxDailyLossPct: 0.04, swing: true, breakout: true },
  // S3 : étude dédiée faite (20-21/7) — minRR 0.2 saignait juillet (−8 929$ au backtest) ; 0.75 + trailing
  // rendent les deux moitiés positives. Reste TURBO par son seuil bas (0.20 → ~2× plus de trades que S2) et ses caps larges.
  '3': { id: 3, key: 'turbo', label: 'S3 TURBO — more trades, more variance', thresholdScalp: 0.2, targetRR: 1.0, minRR: 0.75, trailActivate: 0.6, trailDist: 0.35, tradeAsia: true, dailyProfitTargetPct: 0.08, maxDailyLossPct: 0.06, swing: true, breakout: true },
};

/** Stratégie du runner courant (env ALGORIA_STRATEGY, défaut 2 = comportement actuel). */
export const ACTIVE_STRATEGY: StrategyProfile = STRATEGIES[process.env.ALGORIA_STRATEGY ?? '2'] ?? STRATEGIES['2'];
