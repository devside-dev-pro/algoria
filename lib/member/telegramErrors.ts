// ÉCHECS D'ENVOI TELEGRAM — lesquels sont DÉFINITIFS, lesquels valent la peine d'être retentés.
// Client-safe : aucune dépendance serveur, aucun secret.
//
// ── POURQUOI (25/08/2026) ──────────────────────────────────────────────────────────────────────────────
// Le bouton BOT de la file de relances renvoyait « Telegram: Forbidden: bot was blocked by the user », et
// la personne RESTAIT dans la file. Rien ne distinguait un blocage définitif d'un raté réseau, donc rien
// ne pouvait la retirer. À force, la file se remplissait de gens injoignables : Mathieu cliquait, prenait
// l'erreur, recommençait le lendemain. Une file de travail qui ne se vide pas cesse d'être une file.
//
// ── LA DISTINCTION EST LE CŒUR DU SUJET ────────────────────────────────────────────────────────────────
// « Définitif » ne veut PAS dire « perdu pour toujours » : quelqu'un qui a bloqué le bot peut très bien
// répondre à un DM personnel s'il a un @pseudo. Ça veut dire « ce CANAL-LÀ est mort » — le bot ne le
// joindra plus jamais tant qu'il n'aura pas débloqué, et réessayer est du temps perdu à coup sûr.
//
// Prudence volontaire : tout ce qui n'est pas explicitement reconnu ci-dessous est traité comme
// TEMPORAIRE. Se tromper dans ce sens coûte un clic inutile ; se tromper dans l'autre raye discrètement
// un prospect joignable de la seule liste où il apparaissait. Les deux erreurs ne se valent pas.
const PERMANENT = [
  'bot was blocked by the user',      // il a bloqué le bot — le cas de loin le plus fréquent
  'user is deactivated',              // compte Telegram supprimé
  'chat not found',                   // chat inexistant / jamais ouvert
  "bot can't initiate conversation",  // il n'a jamais tapé START : le bot n'a pas le droit d'écrire en premier
  'user is restricted',
  'peer_id_invalid',
];

/** true si réessayer cet envoi échouera à coup sûr tant que la personne n'agit pas de son côté. */
export function isPermanentTelegramFailure(error: string | null | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return PERMANENT.some((p) => e.includes(p));
}

/** Étiquette courte pour l'admin. Renvoie null si l'échec n'est pas définitif — l'appelant ne doit alors
 *  RIEN afficher de spécial : un raté réseau ne mérite pas un badge qui ressemble à un verdict. */
export function permanentFailureLabel(error: string | null | undefined): string | null {
  if (!isPermanentTelegramFailure(error)) return null;
  const e = (error ?? '').toLowerCase();
  if (e.includes('blocked by the user')) return '🚫 a bloqué le bot';
  if (e.includes('deactivated')) return '🚫 compte supprimé';
  if (e.includes("can't initiate")) return '🚫 n’a jamais tapé START';
  return '🚫 injoignable par le bot';
}
