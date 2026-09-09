// DÉPART DU TRACK RECORD VISIBLE (09/09/2026, décision Mathieu, bloc A « arrêter l'hémorragie visible »).
//
// Le moteur or a perdu tous les jours depuis juillet ; le master est passé de 80 k$ à 50 k$. Un membre qui
// dépose et tombe sur cet historique retire dans l'heure. Mathieu reprend le trading à la main et tout
// l'automatique est coupé : ce que l'app montre doit repartir d'une page blanche, datée et assumée, pas
// d'une semaine rouge.
//
// Rien n'est effacé en base. Cette date borne UNIQUEMENT ce que l'app membre (historique, cockpit) et la
// landing (preuve sociale) affichent. Elle se déplace par ALGORIA_TRACK_SINCE sur Vercel, sans déploiement.
export const TRACK_SINCE: string = process.env.ALGORIA_TRACK_SINCE ?? '2026-09-09T00:00:00Z';
export const TRACK_SINCE_MS: number = Date.parse(TRACK_SINCE) || 0;
