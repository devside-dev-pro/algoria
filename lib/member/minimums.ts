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
// À REMETTRE À $500 dès que S1 est réparée et sort de maintenance — elle reprend alors le palier $200,
// pour lequel ses caps serrés sont faits. Ne pas laisser cette ligne se figer par oubli.
export const STRATEGY_MIN_DEPOSIT: Record<number, number> = { 1: 200, 2: 200, 3: 1000 };

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
