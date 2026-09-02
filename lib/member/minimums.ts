import { inMaintenance } from './maintenance';

// Dépôt MINIMUM par stratégie (constantes client-safe, affichées partout où on parle d'argent).
// La grille raconte l'échelle de risque : un palier d'entrée accessible (le pied dans la porte),
// BALANCED la référence, TURBO réservé à ceux qui ont du coussin (plus de risque par trade).
// Un membre peut cumuler jusqu'à 3 comptes (un par stratégie, brokers différents).
//
// ── S2 ABAISSÉE DE $500 À $200 LE 21/08/2026 (décision Mathieu, dépannage) ───────────────────────────
// POURQUOI : S1 STEADY portait le palier $200 et elle est passée en maintenance le 20/08. Elle est
// sortie du sélecteur avec, sans que personne le voie, LA SEULE STRATÉGIE QU'UN DÉPÔT DE $200 DÉBLOQUE.
// Pendant 18 heures, tout membre déclarant entre $200 et $499 est arrivé à l'étape 3 sans aucun choix
// possible et un bouton mort — alors que les pubs promettent « from $200 » et que cette tranche pèse
// 28 des 59 dépôts encaissés (47 %) et $9 800 de commissions. La porte d'entrée du tunnel était murée.
//
// CE QUE ÇA COÛTE, ET IL FAUT LE SAVOIR : mesuré sur la pire journée de S2 (15/07, −4 683 $ au master),
// un compte à $200 copiant à 0.01 lot aurait encaissé −46,83 $, soit −23,4 % en une séance — contre
// −9,4 % pour un compte à $500. C'est précisément ce que le minimum à $500 protégeait. Le lot minimum
// broker étant 0.01 sur l'or, on ne peut pas réduire la taille pour compenser : un petit compte prend
// mécaniquement le même dollar de risque qu'un gros. Arbitrage assumé : rouvrir 47 % du tunnel vaut
// ce risque le temps que S1 revienne.
//
// ── S2 REMISE À $500 LE 01/09/2026 (décision Mathieu) ────────────────────────────────────────────────
// ⚠️ PAS pour la raison écrite ci-dessus. S1 est TOUJOURS en maintenance et n'a pas repris le palier $200 :
// la condition qu'on s'était fixée n'est pas remplie. C'est une décision de RISQUE, prise après le mois
// d'août, et il faut savoir laquelle.
//
// LE CHIFFRE QUI DÉCIDE : un compte à $200 copiant à 0.01 lot porte ~3,5 fois le risque RELATIF du maître.
// Ce n'est pas une estimation, c'est mesuré et déjà écrit plus haut : sur la pire journée du maître
// (−4 683 $, soit −6,7 % de son solde), un compte à $200 encaissait −23,4 % — contre −9,4 % à $500.
// La cause est mécanique et sans remède : le lot minimum broker est 0.01 sur l'or, donc un petit compte ne
// peut pas réduire sa taille pour compenser. Il prend le même dollar de risque qu'un gros, sur dix fois
// moins de capital. Août l'a payé cash : 39 membres live devenus 27 en une semaine.
//
// CE QUE ÇA COÛTE, ET C'EST ÉNORME — À REGARDER EN FACE : la tranche $200-499 pèse 41 dépôts sur 72 (57 %),
// 38 membres, et $8 550 de commission RÉELLEMENT ENCAISSÉE, soit 37 % de tout ce qu'Algoria a encaissé.
// On ferme volontairement la porte d'entrée la plus fréquentée. L'arbitrage assumé : un membre qui perd
// 23 % en une séance ne reste pas, ne parraine personne, et coûte plus cher en réputation qu'il ne rapporte.
//
// ⚠️ À FAIRE EN MÊME TEMPS, SINON ON REFAIT LA PANNE DU 20/08 : MIN_ENTRY_DEPOSIT passe mécaniquement à
// $500 (S1 masquée, S3 à $1000). Les publicités qui promettent « from $200 » envoient donc désormais les
// gens sur un mur — exactement le défaut qu'on a corrigé le 21/08, à l'envers. Les créas et les pages
// d'entrée doivent annoncer $500 le jour où cette ligne part en production.
export const STRATEGY_MIN_DEPOSIT: Record<number, number> = { 1: 200, 2: 500, 3: 1000 };

/** Le plus petit dépôt qui débloque QUELQUE CHOSE aujourd'hui — le « from $X » du marketing.
 *
 *  ⚠️ LES STRATÉGIES EN MAINTENANCE SONT EXCLUES, et ce n'est pas cosmétique. La version naïve prenait
 *  le minimum sur TOUTES les stratégies, maintenance comprise : le 20/08, S1 retirée de la circulation
 *  continuait de fixer ce chiffre à $200, et l'app annonçait à un membre ayant déclaré $200 que « $200
 *  est sous le minimum de $200 ». Un message qui se contredit lui-même, sur l'écran qui décide d'un
 *  paiement. Un minimum doit décrire ce qu'on peut RÉELLEMENT choisir, jamais un catalogue théorique.
 *
 *  Repli à $200 si jamais TOUT était en maintenance : mieux vaut un chiffre cohérent avec la promesse
 *  publicitaire qu'un `Infinity` renvoyé par Math.min sur un tableau vide. */
export const MIN_ENTRY_DEPOSIT = (() => {
  const open = Object.entries(STRATEGY_MIN_DEPOSIT)
    .filter(([id]) => !inMaintenance(Number(id)))
    .map(([, min]) => min);
  return open.length ? Math.min(...open) : 200;
})();

export const minDepositFor = (strategy: number): number => STRATEGY_MIN_DEPOSIT[strategy] ?? 500;
