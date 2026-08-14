// AFFILIATION 2.0 — la grille des récompenses, UN SEUL endroit (client + serveur l'importent).
//
// COMMISSION PROPORTIONNELLE AU DÉPÔT (14/08/2026, décision Mathieu). Elle était FORFAITAIRE à 50$,
// fixée quand le dépôt minimum était de 500$. Depuis, le minimum est descendu à 200$ — et la tranche
// 200-499$ pèse déjà 40% des dépôts (21 sur 52, moyenne 210$). Le même forfait récompensait donc
// identiquement un filleul à 200$ et un filleul à 1000$ : 14% de notre commission broker dans un cas,
// 7% dans l'autre. Constaté sur le tout premier parrainage réel, le 14/08.
//
// ⚠️ POURQUOI UN PLAFOND, et pourquoi il ne faut jamais l'enlever : notre revenu ne suit PAS le dépôt.
// C'est un forfait par compte financé (voir commissions.ts), par palier, qui s'APLATIT — ~345$ à 200$,
// ~690$ à 500$, ~930$ à 1000$, et 1800$ au maximum quel que soit le montant au-delà de 4000$. Un
// pourcentage nu serait donc non borné face à un revenu borné : au-delà de ~18 000$ déposés, 10% nous
// coûterait plus que ce que le broker nous verse. Le plafond est ce qui rend la règle sûre.
//
// Grille : 10% du dépôt VALIDÉ, plafonné à 200$ · 15% plafonné à 300$ à partir du palier 10 (la raison
// de continuer, pas seulement d'atteindre) · palier 5 → bonus +150$ · palier 10 → 500$ OU un iPhone.
export const COMMISSION_RATE = 0.1;
export const COMMISSION_CAP_USD = 200;
export const COMMISSION_RATE_AFTER_10 = 0.15;
export const COMMISSION_CAP_AFTER_10_USD = 300;
// SEUIL DE RETRAIT abaissé 50$ → 20$ : à 10%, un filleul à 200$ rapporte 20$. Laisser le seuil à 50$
// aurait créé un cul-de-sac — « parraine un ami et gagne » suivi d'un solde bloqué jusqu'au troisième.
// Un virement USDT TRC20 coûte ~1$, payer 20$ reste largement rentable.
export const MIN_PAYOUT_USD = 20;

export interface Milestone {
  at: number; // nombre de filleuls ACTIVÉS (commissions confirmées)
  bonus: number; // crédité automatiquement en commission 'milestone'
  label: string; // badge affiché
  perk?: string; // avantage annexe affiché au membre
}

export const MILESTONES: Milestone[] = [
  { at: 5, bonus: 150, label: 'CLOSER' },
  { at: 10, bonus: 500, label: 'PARTNER', perk: 'your rate rises to 15% per referral (up to $300 each) — or swap the $500 for an iPhone (message support)' },
];

/** Taux et plafond applicables au parrain, selon son nombre d'activations DÉJÀ confirmées. */
export const commissionTermsFor = (nBefore: number): { rate: number; cap: number } =>
  nBefore >= 10
    ? { rate: COMMISSION_RATE_AFTER_10, cap: COMMISSION_CAP_AFTER_10_USD }
    : { rate: COMMISSION_RATE, cap: COMMISSION_CAP_USD };

/**
 * Commission pour une activation : % du dépôt du filleul, plafonnée, arrondie au dollar.
 * @param depositUsd dépôt VALIDÉ du filleul (registre DEPOSITS) — à défaut, le montant déclaré au wizard.
 * @param nBefore    activations confirmées du parrain AVANT celle-ci (fait passer au palier 10).
 *
 * Un dépôt inconnu ou nul renvoie 0 : mieux vaut une commission à 0 qu'on corrige en voyant la ligne
 * qu'un montant inventé qu'on paierait sans le vouloir. Le registre des dépôts la recalcule dès qu'il
 * connaît le vrai montant (voir addDeposit/updateDeposit), tant qu'elle est encore `pending`.
 */
export function commissionForActivation(nBefore: number, depositUsd: number): number {
  if (!Number.isFinite(depositUsd) || depositUsd <= 0) return 0;
  const { rate, cap } = commissionTermsFor(nBefore);
  return Math.min(Math.round(depositUsd * rate), cap);
}

/** Prochain palier à atteindre (null si tous atteints). */
export const nextMilestone = (activated: number): Milestone | null =>
  MILESTONES.find((m) => activated < m.at) ?? null;

/** Adresse USDT TRC20 : T + 33 caractères base58 (pas de 0, O, I, l). */
export const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
