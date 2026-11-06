// 🛠 HISTORIQUE EN MAINTENANCE (22/10/2026, après la nuit du 21 au 22 — voir lib/member/incident.ts).
// Mathieu : « met l'historique de l'app en maintenance stp, on va tuer tous nos prospects sinon ».
//
// Masqué aux prospects (tout ce qui n'est ni live ni en pause) et sur la page publique /track-record. Les membres
// (live, en pause) et l'admin le gardent : on leur a dit toute la vérité dans le VIP, le leur cacher maintenant
// ressemblerait à une dissimulation. Rien n'est supprimé ni filtré côté base : le drapeau ne fait que masquer.
//
// 06/11/2026 — Mathieu : « il vas falloir réactiver l'historique… maintenant qu'on a le myfxbook officiel »,
// puis « Réactive l'historique depuis le 25 octobre stp ». On repasse à false : History, /track-record et
// les posts canal qui pointaient vers l'app reviennent. Le livre visible part du 25 octobre 2026
// (lib/member/trackSince.ts) — la nuit du 21-22 n'est PAS affichée. Ce n'est PAS le livre complet non filtré.
// Le lien Myfxbook tiers (lib/member/incident.ts) reste la preuve vérifiée.
// Client-safe : lu par les écrans (History, Home, Track record) et par les routes qui servent les chiffres.
export const HISTORY_MAINTENANCE = false;

export const seesHistory = (status: string | null | undefined, admin = false): boolean =>
  !HISTORY_MAINTENANCE || admin || status === 'live' || status === 'paused';
