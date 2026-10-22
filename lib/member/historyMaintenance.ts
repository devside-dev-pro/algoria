// 🛠 HISTORIQUE EN MAINTENANCE (22/10/2026, après la nuit du 21 au 22 — voir lib/member/incident.ts).
// Mathieu : « met l'historique de l'app en maintenance stp, on va tuer tous nos prospects sinon ».
//
// Masqué aux prospects (tout ce qui n'est ni live ni en pause) et sur la page publique /track-record. Les membres
// (live, en pause) et l'admin le gardent : on leur a dit toute la vérité dans le VIP, le leur cacher maintenant
// ressemblerait à une dissimulation. Rien n'est supprimé ni filtré : repasser à false et tout revient, nuit comprise.
// Client-safe : lu par les écrans (History, Home, Track record) et par les routes qui servent les chiffres.
export const HISTORY_MAINTENANCE = true;

export const seesHistory = (status: string | null | undefined, admin = false): boolean =>
  !HISTORY_MAINTENANCE || admin || status === 'live' || status === 'paused';
