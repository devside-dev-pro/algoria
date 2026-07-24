// Dépôt MINIMUM par stratégie (constantes client-safe, affichées partout où on parle d'argent).
// La grille raconte l'échelle de risque : STEADY accessible ($200, le pied dans la porte), BALANCED
// la référence ($500), TURBO réservé à ceux qui ont du coussin ($1,000 — plus de risque par trade).
// Un membre peut cumuler jusqu'à 3 comptes (un par stratégie, brokers différents).
export const STRATEGY_MIN_DEPOSIT: Record<number, number> = { 1: 200, 2: 500, 3: 1000 };
export const MIN_ENTRY_DEPOSIT = Math.min(...Object.values(STRATEGY_MIN_DEPOSIT)); // le « from $200 » du marketing
export const minDepositFor = (strategy: number): number => STRATEGY_MIN_DEPOSIT[strategy] ?? 500;
