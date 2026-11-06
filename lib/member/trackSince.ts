// DÉPART DU TRACK RECORD VISIBLE (09/09/2026, décision Mathieu, bloc A « arrêter l'hémorragie visible »).
//
// Le moteur or a perdu tous les jours depuis juillet ; le master est passé de 80 k$ à 50 k$. Un membre qui
// dépose et tombe sur cet historique retire dans l'heure. Mathieu reprend le trading à la main et tout
// l'automatique est coupé : ce que l'app montre doit repartir d'une page blanche, datée et assumée, pas
// d'une semaine rouge.
//
// 06/11/2026 — Mathieu : « Réactive l'historique depuis le 25 octobre stp ». On rouvre l'historique aux
// prospects (HISTORY_MAINTENANCE = false), mais le départ visible passe au 25 octobre 2026 00:00 UTC :
// après la nuit du 21-22 octobre, pas avant. La nuit n'est PAS affichée sur History, /track-record ni la
// preuve landing. Rien n'est effacé en base — cette date borne UNIQUEMENT l'affichage.
//
// Elle se déplace par ALGORIA_TRACK_SINCE sur Vercel, sans déploiement. En Production, si la variable est
// encore à l'ancienne date (ex. 2026-09-09), elle gagne sur ce défaut : au merge, la mettre à
// 2026-10-25T00:00:00Z (ou la retirer pour que ce défaut s'applique).
export const TRACK_SINCE: string = process.env.ALGORIA_TRACK_SINCE ?? '2026-10-25T00:00:00Z';
export const TRACK_SINCE_MS: number = Date.parse(TRACK_SINCE) || 0;
