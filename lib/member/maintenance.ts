// STRATÉGIES EN MAINTENANCE — source de vérité UNIQUE, partagée par l'app membre, l'API et le runner.
// Client-safe : aucune dépendance serveur, aucun secret.
//
// Une stratégie en maintenance est une stratégie qu'on a RETIRÉE DE LA CIRCULATION le temps de corriger un
// défaut. Concrètement, et c'est volontairement radical :
//   · elle disparaît du sélecteur de l'app (personne ne peut plus la choisir) ;
//   · son runner n'ouvre plus AUCUNE position — les positions déjà ouvertes restent gérées jusqu'à leur
//     sortie normale, on ne liquide rien dans le dos des membres ;
//   · ses trades passés n'apparaissent plus dans le flux membre. Ils ne sont PAS supprimés — c'est un
//     filtrage d'affichage, réversible en retirant l'id de cette liste. Décision Mathieu du 20/08 :
//     « masquer, pas supprimer ». Les données restent en base, donc les statistiques, le suivi de
//     performance et l'analyse qui a permis de trouver le défaut restent intacts.
//
// ⚠️ METTRE UNE STRATÉGIE ICI NE DÉPLACE PAS SES MEMBRES. Le mouvement des receveurs vers une autre
// stratégie se fait côté STH, membre par membre, depuis l'admin — c'est une opération sur des comptes
// réels et elle reste manuelle et traçable. La maintenance ne fait qu'empêcher de NOUVEAUX arrivants.
//
// ── S1 STEADY, mise en maintenance le 20/08/2026 (décision Mathieu) ──────────────────────────────────
// Elle perd, et pas par malchance : sa configuration lui interdit structurellement de gagner.
//   1. targetRR 0.4 — elle risque 1 pour gagner 0.4. Il lui faut plus de 71% de réussite juste pour
//      rentrer dans ses frais, avant les coûts. Elle en fait 82%, ce qui suffirait — sauf que son
//      beTrigger à 0.10 coupe la plupart des gagnants bien avant les 0.4R (gain moyen réel +0.17R).
//   2. CAPS JOURNALIERS ASYMÉTRIQUES, et c'est le défaut décisif : objectif +1%, perte maximale −3%.
//      Elle arrête une bonne journée à +1% mais laisse une mauvaise courir jusqu'à −3%. Même avec autant
//      de jours verts que rouges, cette structure perd. S1 est la SEULE des trois dans ce cas : S2 est
//      symétrique (4%/4%), S3 est favorable (8%/6%).
// Mesuré sur 6 semaines : 143 trades, 82% de réussite, −3.40R. Elle n'a ni paliers, ni trailing, ni
// couche swing — c'est du scalp pur avec un objectif à 0.4R.
export const STRATEGIES_IN_MAINTENANCE: number[] = [1];

/** true si cette stratégie est retirée de la circulation (pas de nouvelle entrée, pas d'affichage). */
export const inMaintenance = (id: number | null | undefined): boolean =>
  id != null && STRATEGIES_IN_MAINTENANCE.includes(Number(id));
