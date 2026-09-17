// ACCÈS DIRECT — LA SECONDE PORTE D'ENTRÉE (17/09/2026, décision Mathieu).
//
// Jusqu'ici Algoria n'avait qu'un seul chemin : ouvrir un compte chez un broker partenaire via notre lien.
// La commission que le broker nous verse EST le prix de l'accès — le membre ne paie rien. Ce chemin ne
// marche pas pour tout le monde : les résidents américains, ceux qui ont déjà un compte ailleurs qu'ils ne
// veulent pas quitter, et tous ceux dont le broker n'est pas partenaire.
//
// Ces gens-là étaient traités comme une anomalie. Le tunnel leur opposait un panneau rouge « refusé à
// l'examen », et pour passer quand même il fallait cocher « j'ai ouvert ce compte via le lien Algoria » —
// c'est-à-dire signer un faux (constaté sur le dossier #1469). Le support les connectait ensuite à la main.
//
// C'est maintenant une OFFRE, pas un contournement : 400 $ une fois, à vie, et il garde son broker.
// Deux chemins également légitimes, présentés côte à côte, et le membre choisit.
//
// ── POURQUOI ON NE VÉRIFIE PAS LE PAIEMENT DANS LE CODE ────────────────────────────────────────────────
// Parce que les deux chemins aboutissent à la MÊME file d'attente, où un humain contrôle le dossier avant
// de brancher le copieur. Quelqu'un qui cocherait « j'ai payé » sans avoir payé ne gagne rien : sa carte
// arrive dans la file comme les autres et le paiement se vérifie là. Le garde-fou existe déjà — en
// rajouter un dans le formulaire n'ajouterait aucune sécurité et coûterait un pas à ceux qui sont honnêtes.

/** Prix de l'accès direct, en dollars. Paiement UNIQUE : pas d'échéance, pas de relance, pas de coupure. */
export const DIRECT_ACCESS_PRICE_USD = 400;

/** Page de paiement (Stripe, crypto…). Réglable sans redeploy — et si elle est vide, le tunnel bascule sur
 *  « écris à Mathieu » plutôt que d'offrir un bouton mort : un lien absent ne doit jamais bloquer personne. */
export const DIRECT_ACCESS_URL = process.env.NEXT_PUBLIC_DIRECT_ACCESS_URL ?? '';

/** Ce dossier est-il un accès direct payant ? Lu sur `member_actions.detail` de la carte CONNECT. */
export const isDirectAccess = (detail: Record<string, unknown> | null | undefined): boolean =>
  (detail ?? {}).direct_access === true;
