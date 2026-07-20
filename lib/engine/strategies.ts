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
  tradeAsia: boolean; // trader la session Asie ?
  dailyProfitTargetPct: number; // objectif du jour → latch dayDone
  maxDailyLossPct: number; // plancher du jour → latch dayDone
  swing: boolean; // couche positions de fond (H1, tenues des jours)
  breakout: boolean; // 2ᵉ stratégie intraday (cassures Donchian)
}

export const STRATEGIES: Record<string, StrategyProfile> = {
  '1': { id: 1, key: 'steady', label: 'S1 STEADY — small daily target, tight caps', thresholdScalp: 0.25, targetRR: 0.4, minRR: 0.2, tradeAsia: false, dailyProfitTargetPct: 0.01, maxDailyLossPct: 0.03, swing: false, breakout: false },
  '2': { id: 2, key: 'balanced', label: 'S2 BALANCED — the reference engine', thresholdScalp: 0.25, targetRR: 1.0, minRR: 0.75, tradeAsia: true, dailyProfitTargetPct: 0.04, maxDailyLossPct: 0.04, swing: true, breakout: true },
  '3': { id: 3, key: 'turbo', label: 'S3 TURBO — more trades, more variance (validate before selling)', thresholdScalp: 0.2, targetRR: 1.0, minRR: 0.2, tradeAsia: true, dailyProfitTargetPct: 0.08, maxDailyLossPct: 0.06, swing: true, breakout: true },
};

/** Stratégie du runner courant (env ALGORIA_STRATEGY, défaut 2 = comportement actuel). */
export const ACTIVE_STRATEGY: StrategyProfile = STRATEGIES[process.env.ALGORIA_STRATEGY ?? '2'] ?? STRATEGIES['2'];
