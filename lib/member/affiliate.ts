// AFFILIATION 2.0 — la grille des récompenses, UN SEUL endroit (client + serveur l'importent).
// Philosophie : un client activé rapporte ~650$ de commission broker → on reverse ≤ ~25% en pire cas,
// et la commission par filleul AUGMENTE après le palier 10 (raison de continuer, pas juste d'atteindre).
// Grille (validée) : base 50$/filleul · palier 5 → bonus +150$ · palier 10 → 500$ OU un iPhone (au choix,
// traité manuellement par le support) et la com passe à 75$/filleul pour tous les suivants.

export const COMMISSION_BASE_USD = 50;
export const COMMISSION_AFTER_10_USD = 75;
export const MIN_PAYOUT_USD = 50;

export interface Milestone {
  at: number; // nombre de filleuls ACTIVÉS (commissions confirmées)
  bonus: number; // crédité automatiquement en commission 'milestone'
  label: string; // badge affiché
  perk?: string; // avantage annexe affiché au membre
}

export const MILESTONES: Milestone[] = [
  { at: 5, bonus: 150, label: 'CLOSER' },
  { at: 10, bonus: 500, label: 'PARTNER', perk: 'commission rises to $75 per referral — or swap the $500 for an iPhone (message support)' },
];

/** Montant de la commission pour la N-ième activation (n = activations confirmées AVANT celle-ci). */
export const commissionForActivation = (nBefore: number): number =>
  nBefore >= 10 ? COMMISSION_AFTER_10_USD : COMMISSION_BASE_USD;

/** Prochain palier à atteindre (null si tous atteints). */
export const nextMilestone = (activated: number): Milestone | null =>
  MILESTONES.find((m) => activated < m.at) ?? null;

/** Adresse USDT TRC20 : T + 33 caractères base58 (pas de 0, O, I, l). */
export const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
