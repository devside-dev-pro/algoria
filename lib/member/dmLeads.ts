// LES PROSPECTS QUI N'ÉCRIVENT QU'À L'HUMAIN (17/09/2026, demande Mathieu)
//
// LE PROBLÈME, DANS SES MOTS : « j'ai plus de 50 messages par jour, seul 10 vont créer un compte, donc on
// en perd 40 si je les relance pas ». Le bot ne travaille aujourd'hui que sur les gens qui ont un compte
// sur l'app. Les quarante autres ont parlé à un humain, pas à un produit : ils n'existent NULLE PART dans
// le système. Il les relançait de tête, 48 h après un message lu sans réponse, et il ne suit plus.
//
// CE QU'ON NE FAIT PAS, ET POURQUOI : écrire à leur place. L'envoi automatisé depuis un compte personnel
// est interdit par Telegram et c'est un des motifs qu'ils sanctionnent le plus vite. Or @mathieu_algoria
// n'est pas un canal d'envoi, c'est l'identité commerciale — il est écrit dans l'app, dans les messages du
// bot, sur la landing, dans chaque refus, et sur le bouton de paiement de secours de l'accès direct. Le
// perdre coûterait infiniment plus que les 40 prospects.
//
// CE QU'ON FAIT À LA PLACE : la MÉMOIRE. Le système retient qui relancer et quand ; l'envoi reste à la
// main, depuis son vrai compte. Ça ne supprime pas le geste, ça supprime l'oubli — et l'oubli est le
// problème qu'il a décrit, pas le geste.
//
// COMMENT UNE LIGNE NAÎT : il TRANSFÈRE le message de la personne au bot Algoria. Un transfert porte
// l'identité de l'expéditeur : un geste, zéro saisie. À 50 messages par jour, toute capture qui demande de
// taper un pseudo est morte d'avance — c'est le seul geste qui tienne à cette cadence.

/** Délai avant relance, en heures. 48 h = la cadence que Mathieu appliquait déjà de tête. */
export const RELANCE_AFTER_H = 48;

export type DmLead = {
  id: string;
  tg_id: number | null;
  handle: string | null;
  display_name: string | null;
  locale: string | null;
  first_message: string | null;
  status: 'waiting' | 'relanced' | 'converted' | 'dropped';
  relance_count: number;
  next_relance_at: string | null;
  created_at: string;
};

/** Instant de la prochaine relance, au format ISO. */
export const relanceDue = (from: number = Date.now()): string =>
  new Date(from + RELANCE_AFTER_H * 3_600_000).toISOString();

/** Comment nommer quelqu'un dont on n'a parfois que le prénom affiché. Jamais « undefined ». */
export const leadName = (l: Pick<DmLead, 'handle' | 'display_name' | 'tg_id'>): string =>
  l.handle ? `@${l.handle}` : (l.display_name?.trim() || (l.tg_id ? `id ${l.tg_id}` : 'contact'));
