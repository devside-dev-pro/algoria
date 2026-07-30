// TAILLES DE COPIE proposées au membre (le « lot » du copieur). SOURCE UNIQUE : importée par la page
// profil ET par le verrou serveur (api/member/me) — la liste était dupliquée en dur des deux côtés, et
// un client s'est retrouvé bloqué le 30/07 parce qu'il voulait 0.04 (absent de la grille 0.01/0.02/0.03/
// 0.05/0.10). Grille complète au pas de 0.01 jusqu'à 0.10 : plus aucun palier manquant dans cette plage.
// Au-delà de 0.10, c'est du cas par cas avec le support (risque non trivial) → volontairement hors liste.
export const LOT_CHOICES: number[] = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1];

/** Le lot demandé est-il proposé ? (comparaison en centièmes : 0.07 en flottant ne vaut pas 0.07) */
export const isLotAllowed = (lot: number): boolean =>
  Number.isFinite(lot) && LOT_CHOICES.some((c) => Math.round(c * 100) === Math.round(lot * 100));
