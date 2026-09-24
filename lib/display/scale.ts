// ÉCHELLE D'AFFICHAGE DES PROFITS — 0.10 LOT (décision Mathieu, 24/09/2026).
//
// ── POURQUOI ─────────────────────────────────────────────────────────────────────────────────────────
// Jusqu'ici tout ce qu'Algoria disait de ses profits — cartes VIP, push, daily wrap, site, cartes de gain —
// était au lot du maître, 1 lot. Or sur 48 membres live le 24/09 : 32 à 0.01, 10 à 0.02, un seul à 0.1,
// PERSONNE à 1. Un membre sur deux lisait donc 100 fois ce qu'il gagnait réellement. Deux dégâts :
//   · la confiance — « +2 000 $ » annoncé, « +20 $ » sur son compte ;
//   · la surcharge — les gros chiffres poussent à monter le lot pour « avoir les mêmes ». Vécu : #1474 s'est
//     mis à 1 lot 35 minutes après sa connexion, compte de 500 $ vidé en deux jours.
//
// ── POURQUOI 0.10 ET PAS 0.01 ────────────────────────────────────────────────────────────────────────
// 0.01 est le lot de la majorité, mais des gains à 20 $ ne se lisent plus. 0.10 garde des chiffres
// lisibles, se ramène à la taille de chacun d'une virgule, et c'est EXACTEMENT le lot recommandé pour un
// compte de 5 000 $ (règle 0.01 lot par 500 $) : on peut dire « compte de 5 000 $ », que tout le monde
// comprend, au lieu d'une taille de lot que la plupart ne savent pas lire.
//
// ── LA RÈGLE DE CALCUL : PAR TRADE, JAMAIS « ÷ 10 » ─────────────────────────────────────────────────
// Le maître n'a pas toujours tradé 1 lot : ~250 trades sur ~1 580 sont à 0.05, 0.25, 0.5, 0.75 ou 10
// (NAS100). Le copieur, lui, applique une taille FIXE au membre quel que soit le lot du maître. Le bon
// montant « à 0.10 lot » est donc pnl × 0.10 ÷ lot du trade — ce qui revient à ÷ 10 pour un trade à 1 lot,
// et reste juste pour les autres. Un TOTAL se calcule en convertissant chaque trade PUIS en sommant ;
// jamais en divisant une somme brute.
//
// Lot absent (27 trades anciens, synchro incomplète) : on retient 1 lot, la taille de 1 300 trades sur
// 1 580, et les montants de ces trades ont bien l'ordre de grandeur d'un lot entier.
//
// La BASE garde le chiffre réel du maître : cette conversion n'existe qu'à l'affichage.

/** Taille de référence de toute la communication d'Algoria. */
export const REF_LOT = 0.1;
/** Le compte pour lequel REF_LOT est la taille recommandée (0.01 lot par 500 $). */
export const REF_ACCOUNT_USD = 5_000;

/** Libellés à coller à côté d'un montant — sans eux, on recrée le malentendu, juste 10 fois plus petit. */
export const REF_LABEL = '0.10 lot';
export const REF_ACCOUNT_LABEL = '$5k account';
export const REF_TAG = `${REF_LABEL} · ${REF_ACCOUNT_LABEL}`;

const lotOf = (lot: unknown): number => (Number(lot) > 0 ? Number(lot) : 1);

/** P&L d'un trade du maître ramené à 0.10 lot. */
export const atRef = (pnl: unknown, lot: unknown): number => (Number(pnl) || 0) * REF_LOT / lotOf(lot);

/** P&L ramené à 1 lot — pour comparer aux seuils historiques (exprimés à 1 lot) sans en changer le sens. */
export const atOneLot = (pnl: unknown, lot: unknown): number => (Number(pnl) || 0) / lotOf(lot);

/** Somme de trades à 0.10 lot — chaque trade converti avec SON lot, puis sommé. */
export const sumAtRef = (rows: ReadonlyArray<{ pnl?: unknown; lot?: unknown }>): number =>
  rows.reduce((a, t) => a + atRef(t.pnl, t.lot), 0);
