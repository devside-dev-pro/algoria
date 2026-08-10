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
  // GATE RÉGIME (décorrélation, étude 22/7) : la stratégie ne scalpe que SON régime de marché.
  //   S3 'trend' : net +26 313→+27 155$, juillet +1 910→+4 569$, trades partagés avec S2 168→135. ✅
  //   S1 'range' TESTÉ ET TUÉ : −10 806$ (les deux moitiés rouges) — les rejets en range seuls n'ont pas
  //   d'edge ; S1 reste non-gatée (déjà la moins corrélée : 0.31-0.37 via sessions + TP court).
  //   Constat honnête : S2×S3 restent frères (corr 0.89) tant qu'ils partagent le même générateur de
  //   signaux — la VRAIE décorrélation demandera une famille de signaux différente (labo à venir).
  regimeGate?: 'trend' | 'range';
  // DÉCORRÉLATION PHASE 2 (étude 24/7) — famille de signaux INTRADAY de la stratégie :
  //   'scalp' (défaut) = confluence sur les REJETS de niveaux · 'breakout' = cassures Donchian.
  // Le scalp et le breakout ne peuvent PAS tirer au même instant (un niveau tient→rejet OU casse→breakout) :
  // basculer S3 en 'breakout' N32 fait CHUTER sa corrélation avec S2 de 0.89→0.15 et les trades partagés de
  // ~135→25, en RESTANT robuste (deux moitiés vertes, tout le voisinage N26-44) et fréquent (8.7 trades/j → S3
  // garde son identité TURBO). Quand intraday='breakout', le scalp de confluence s'éteint et le breakout devient
  // le moteur intraday principal (au lieu de couche additive). breakoutN = fenêtre Donchian (défaut 96).
  // PLUS UTILISÉ depuis le 10/08 : aucune stratégie ne pose intraday (le breakout est coupé partout, voir le
  // bloc au-dessus de STRATEGIES). Le champ reste câblé pour pouvoir revenir sans rien recoder.
  intraday?: 'scalp' | 'breakout';
  breakoutN?: number;
  // PLAFOND DES STOPS (× ATR) — étude 22/7 : les stops « monstres » (800-1000$+) effraient les VIP. Serrer la
  // LARGEUR (slAtrMult) tue l'edge (re-confirmé : tout ≤1.0/cap 2.5 casse juillet), mais REFUSER les setups à
  // stop extrême paie : cap 3.2→2.8 sur S2 : net +19 701→+23 336$, verts 66→71%, perte moyenne −13%, pire
  // trade −2 425→−2 036$ (ligne cap 2.8 robuste sur mult 1.05-1.2). S3 : +25 910→+28 681$, verts 64→72%.
  // S1 : cap 2.8 la DÉGRADE (7 622→6 071$) — son TP court vit des setups à stop large → garde 3.2 (défaut).
  maxStopAtr?: number;
  tradeAsia: boolean; // trader la session Asie ?
  dailyProfitTargetPct: number; // objectif du jour → latch dayDone
  maxDailyLossPct: number; // plancher du jour → latch dayDone
  // RATCHET JOURNALIER : pic du jour ≥ trigger → la journée se coupe si l'equity retombe au floor (latch 'lock').
  // Le « +1 600$ à 6h qui finit à +36$ » (vécu le 22/7). Étude 2/6→20/7, split-half ✅, aucune cellule de la
  // grille (trig 1.5-3% × floor 0.5-1.5%) ne fait pire que sans : S2 +14 957→+19 701$ (jours verts 63→66%,
  // pire jour −2 554→−1 969$) · S3 +22 619→+26 313$. S1 non concernée (son objectif +1% latch avant).
  dayLockTriggerPct?: number;
  dayLockFloorPct?: number;
  swing: boolean; // couche positions de fond (H1, tenues des jours)
  breakout: boolean; // 2ᵉ stratégie intraday (cassures Donchian) — false PARTOUT depuis le 10/08 (voir le bloc au-dessus de STRATEGIES)
  // FILTRE DE SESSION scalp (étude 29/07, validé Mathieu « go tout ») : AUCUNE nouvelle entrée du scalp
  // de confluence dont l'heure UTC tombe dans [from, to). Les positions déjà ouvertes vivent leur vie
  // (les overnights restent intacts). Preuves : live 20→29/07 = scalp S2/S3 −12,7k$ sur 07-17h (Asie flat,
  // nuit verte) ; walk-forward 7 folds / 35 jours test : « sans 12-17 » +9 198$ vs PROD −405$ ; vert à
  // coûts ×2.5. Ne touche PAS au breakout (son moteur a sa propre étude) ni au swing (H1).
  blockScalpEntryUtcHours?: Array<[number, number]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAKOUT COUPÉ SUR LES TROIS STRATÉGIES (10/08/2026, décision Mathieu)
//
// Le live, mesuré en base :
//   • cumul depuis le 05/07 : 151 trades · −12 551$ · 64% de réussite (le taux de réussite est bon, la
//     géométrie ne l'est pas — les pertes sont plus grosses que les gains) ;
//   • semaine 27/07→02/08 : 49 trades · −3 752$ · 67% ;
//   • semaine 03/08→09/08 : 29 trades · −5 711$ · 45%.
//   Sur ces deux semaines, breakout + swing = −9 906$ pendant que le scalp fait +3 833$.
//
// Le hors-échantillon, mesuré le 10/08 sur 719 signaux XAUUSD RÉELS (juin→août) dont le chemin a été rejoué
// bougie à bougie en M5, en ne changeant QUE la sortie (mêmes entrées, mêmes stops) :
//   RR testés   0.3    0.5    0.75   1.0    1.5    2.0    3.0   (espérance en R par trade)
//   breakout  −0.211 −0.150 −0.090 −0.067 +0.017 +0.060 +0.120
//   scalp     −0.123 −0.075 −0.063 −0.029 −0.005 −0.013 +0.167
//   swing     +0.066 +0.096 +0.062 −0.011 −0.017 +0.180 +0.124
//   Le breakout est la pire des trois couches sur tout le bas de la grille, et il n'y a AUCUN réglage de
//   sortie qui le sauve dans la zone où il tradait réellement. On ne coupe donc pas sur une mauvaise
//   semaine : on coupe sur une couche dont l'espérance est négative quelle que soit la sortie choisie.
//
// Ce que ça change concrètement : `breakout: false` partout → INSTRUMENTS ne construit plus la couche
// (instruments.ts) et le bloc breakout du runner ne tire plus (runner/index.ts). S3 perdait du même coup son
// SEUL moteur intraday : on lui rend le scalp de confluence en retirant intraday/breakoutN (voir S3).
// GOLD_BREAKOUT et breakoutSignal restent en place, inutilisés — remettre `breakout: true` suffit à revenir.
// Les positions breakout déjà ouvertes au moment du déploiement continuent d'être gérées normalement
// (ensureManagement les réadopte par leur ref `-bk-`) : on coupe les ENTRÉES, pas la gestion des sorties.
// ─────────────────────────────────────────────────────────────────────────────
export const STRATEGIES: Record<string, StrategyProfile> = {
  '1': { id: 1, key: 'steady', label: 'S1 STEADY — small daily target, tight caps', thresholdScalp: 0.25, targetRR: 0.4, minRR: 0.2, tradeAsia: false, dailyProfitTargetPct: 0.01, maxDailyLossPct: 0.03, swing: false, breakout: false },
  '2': { id: 2, key: 'balanced', label: 'S2 BALANCED — the reference engine', thresholdScalp: 0.25, targetRR: 1.0, minRR: 0.75, trailActivate: 0.6, trailDist: 0.35, maxStopAtr: 2.8, tradeAsia: true, dailyProfitTargetPct: 0.04, maxDailyLossPct: 0.04, dayLockTriggerPct: 0.02, dayLockFloorPct: 0.015, swing: true, breakout: false, blockScalpEntryUtcHours: [[12, 17]] },
  // S3 : étude dédiée faite (20-21/7) — minRR 0.2 saignait juillet (−8 929$ au backtest) ; 0.75 + trailing
  // rendent les deux moitiés positives. Reste TURBO par son seuil bas (0.20 → ~2× plus de trades que S2) et ses caps larges.
  // RETOUR AU MOTEUR SCALP (10/08, décision Mathieu — voir le bloc BREAKOUT COUPÉ ci-dessous). Le passage en
  // intraday='breakout' du 24/07 avait un bon motif (décorrélation S2/S3 : corr 0.89→0.15) mais le moteur retenu
  // perd de l'argent, et un moteur décorrélé qui saigne ne décorrèle rien d'utile. En retirant intraday/breakoutN,
  // le scalp de confluence se rallume et S3 retrouve EXACTEMENT la config étudiée les 20-21/07 (seuil 0.20 ·
  // minRR 0.75 · trailing 0.6/0.35 · cap stop 2.8), dont les deux moitiés d'échantillon étaient positives.
  // Ce n'est donc pas une config neuve : c'est celle d'avant la phase 2. Reste TURBO par sa fréquence (seuil 0.20
  // = ~2× les trades de S2) et ses caps larges (±8/−6). Swing de fond conservé.
  // Contrepartie ASSUMÉE et connue : S2 et S3 repartagent le même générateur de signaux (corr ~0.89). La vraie
  // décorrélation demande une AUTRE famille de signaux — chantier ouvert, pas résolu ici.
  '3': { id: 3, key: 'turbo', label: 'S3 TURBO — high-frequency scalp, wide caps', thresholdScalp: 0.2, targetRR: 1.0, minRR: 0.75, trailActivate: 0.6, trailDist: 0.35, maxStopAtr: 2.8, tradeAsia: true, dailyProfitTargetPct: 0.08, maxDailyLossPct: 0.06, dayLockTriggerPct: 0.02, dayLockFloorPct: 0.01, swing: true, breakout: false, blockScalpEntryUtcHours: [[12, 17]] },
};

/** Stratégie du runner courant (env ALGORIA_STRATEGY, défaut 2 = comportement actuel). */
export const ACTIVE_STRATEGY: StrategyProfile = STRATEGIES[process.env.ALGORIA_STRATEGY ?? '2'] ?? STRATEGIES['2'];
