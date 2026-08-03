// TAILLES DE COPIE proposées au membre (le « lot » du copieur). SOURCE UNIQUE : importée par la page
// profil ET par le verrou serveur (api/member/me) — la liste était dupliquée en dur des deux côtés, et
// un client s'est retrouvé bloqué le 30/07 parce qu'il voulait 0.04 (absent de la grille 0.01/0.02/0.03/
// 0.05/0.10). Grille complète au pas de 0.01 jusqu'à 0.10 : plus aucun palier manquant dans cette plage.
// La grille reste la voie RAPIDE (elle couvre la quasi-totalité des comptes), mais elle n'est plus un
// plafond : voir LOT_MAX et la saisie libre juste en dessous.
export const LOT_CHOICES: number[] = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1];

// SAISIE LIBRE au-delà de la grille (03/08) — un membre à plusieurs milliers d'euros était bridé à 0.10,
// soit ~10 fois moins que ce que son solde supporte. Le plafond n'était pas un garde-fou de risque, juste
// la fin d'une liste. Le vrai garde-fou, c'est LOT_MAX : il n'existe pas pour rationner (personne n'a
// besoin de plus de 2 lots ici — le master lui-même trade 1 lot sur le scalp, donc 2 revient déjà à copier
// le double du maître) mais pour arrêter la FAUTE DE FRAPPE : un « 20 » saisi à la place de « 2 » souffle
// un compte au premier stop, et le copieur l'appliquerait sans broncher. Au-delà, c'est le support.
export const LOT_MAX = 2;
/** Pas du copieur : les lots sont des centièmes, 0.015 n'existe pas côté broker. */
export const LOT_STEP = 0.01;

/**
 * Le lot demandé est-il applicable ? Multiple de 0.01, entre 0.01 et LOT_MAX.
 * Comparaison en CENTIÈMES : 0.07 en flottant ne vaut pas 0.07, un `=== 0.07` échouerait.
 */
export const isLotAllowed = (lot: number): boolean => {
  if (!Number.isFinite(lot)) return false;
  const c = Math.round(lot * 100);
  return c >= 1 && c <= Math.round(LOT_MAX * 100) && Math.abs(lot * 100 - c) < 1e-6;
};
