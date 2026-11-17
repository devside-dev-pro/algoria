// 🛠 HISTORIQUE EN MAINTENANCE (22/10/2026, après la nuit du 21 au 22 — voir lib/member/incident.ts).
// Mathieu : « met l'historique de l'app en maintenance stp, on va tuer tous nos prospects sinon ».
//
// Masqué aux prospects (tout ce qui n'est ni live ni en pause) et sur la page publique /track-record. Les membres
// (live, en pause) et l'admin le gardent : on leur a dit toute la vérité dans le VIP, le leur cacher maintenant
// ressemblerait à une dissimulation. Rien n'est supprimé ni filtré côté base : le drapeau ne fait que masquer.
//
// 06/11/2026 — réactivation aux prospects depuis le 25 octobre (PR #578). Le départ visible du livre, pour ceux
// qui le voient, reste le 25 octobre 2026 (lib/member/trackSince.ts) : la nuit du 21-22 n'est PAS affichée.
// Ce n'est PAS le livre complet non filtré.
//
// 17/11/2026 — Mathieu (via Charlie) : remettre l'historique en accès VIP seulement, comme avant le 06/11.
// Les prospects voient de nouveau l'écran « TRADE HISTORY · MAINTENANCE ». La réactivation du 06/11 (#578)
// faisait chuter les dépôts : les prospects voyaient la dernière semaine rouge. Le bouton Myfxbook officiel
// (#579) reste visible pour les prospects (components/HistoryMaintenance.tsx).
// Client-safe : lu par les écrans (History, Home, Track record) et par les routes qui servent les chiffres.
export const HISTORY_MAINTENANCE = true;

export const seesHistory = (status: string | null | undefined, admin = false): boolean =>
  !HISTORY_MAINTENANCE || admin || status === 'live' || status === 'paused';
