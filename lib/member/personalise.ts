// PRÉNOM EN TÊTE DE RELANCE — extrait de app/admin/_shared.tsx le 17/09/2026.
//
// Il vivait dans un fichier `'use client'`, donc inutilisable côté serveur. Tant que chaque relance partait
// d'un clic sur une ligne, ça suffisait : le navigateur personnalisait avant d'envoyer. L'envoi groupé, lui,
// choisit ses destinataires sur le serveur — il doit donc personnaliser là aussi, et recopier ces trois
// lignes aurait créé deux règles qui divergeraient au premier ajustement.
//
// La garde est volontairement stricte. Un « prénom » qui est en fait un pseudo à rallonge, un emoji ou une
// chaîne vide produirait « Hey ⚡️🔥Crypto King⚡️! » en tête d'un message censé passer pour un message
// personnel. Quand le doute existe, on laisse « Hey! » : neutre vaut mieux que ridicule.

/** « Hey! … » → « Hey Marco! … » quand le prénom est exploitable ; texte inchangé sinon. */
export const personalise = (text: string, name?: string | null): string => {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return /^[\p{L}][\p{L}'-]{1,20}$/u.test(first) ? text.replace(/^Hey!/, `Hey ${first}!`) : text;
};
