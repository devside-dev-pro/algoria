// LE LOT DE MESSAGES À QUI ON RÉPOND (28/10/2026, audit du support).
//
// Le lot, c'est tout ce que le client a écrit depuis la dernière vraie réponse (l'accueil, le vocal du pays, l'intro,
// la relance ne répondent à rien). Deux cas relevés :
//   · tg 8036168859, 22/10 15:10 : « Why I can't log in sir? » a reçu « Ok perfect, UK, nice ! … » : le lot remontait
//     jusqu'à « Uk », écrit la veille (21/10 11:50) et déjà couvert par le vocal du pays et l'intro ;
//   · le prompt disait « lis toutes les lignes comme UN message et réponds au tout », sans dire laquelle est la
//     dernière : le modèle commençait par la plus ancienne.
// D'où : un message écrit plus de 12 h avant le dernier passe dans l'historique (il y reste lisible), et quand le lot
// s'étale, le dernier groupe est marqué LATEST (on y répond d'abord), le reste EARLIER (contexte).
// Fonctions pures : testées par scripts/checks/support-relances.ts.

/** Au-delà, un message plus ancien que le dernier du lot n'est plus « la question » : il passe en historique. */
export const STALE_BATCH_MS = 12 * 3_600_000;
/** Les messages écrits en rafale (« how » / « are » / « you ? ») forment UN message : 5 min entre deux lignes. */
export const BURST_GAP_MS = 5 * 60_000;

type Timed = { created_at: string };

/** Sépare le lot en ce qui reste à traiter (fresh) et ce qui part en historique (stale, plus de 12 h avant le dernier). */
export function splitBatch<T extends Timed>(batch: T[]): { fresh: T[]; stale: T[] } {
  if (!batch.length) return { fresh: [], stale: [] };
  const lastAt = Date.parse(batch[batch.length - 1].created_at);
  const fresh: T[] = [];
  const stale: T[] = [];
  for (const b of batch) (lastAt - Date.parse(b.created_at) > STALE_BATCH_MS ? stale : fresh).push(b);
  return { fresh, stale };
}

/** Le texte donné au modèle. Un seul groupe (une rafale) : les lignes telles quelles, comme avant. Sinon EARLIER puis
 *  LATEST, pour qu'il réponde d'abord au dernier message. */
export function batchPromptText(lines: Array<{ created_at: string; text: string }>): string {
  const kept = lines.filter((l) => l.text);
  if (!kept.length) return '';
  let start = kept.length - 1;
  while (start > 0 && Date.parse(kept[start].created_at) - Date.parse(kept[start - 1].created_at) <= BURST_GAP_MS) start--;
  const latest = kept.slice(start).map((l) => l.text).join('\n');
  if (start === 0) return latest;
  const earlier = kept.slice(0, start).map((l) => l.text).join('\n');
  return `EARLIER (context; answer it only if it is still open and not already answered in the Recent exchange):\n${earlier}\n\nLATEST (answer this first):\n${latest}`;
}
