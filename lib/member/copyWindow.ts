// LE DÉBUT DE LA COPIE D'UN MEMBRE (29/10/2026). Un membre en copie ne voit que les trades qu'il a eus : ceux ouverts
// après le début de sa copie (#510, 19/10/2026). Une ligne « close-only » (lib/supabase/sync.ts recordTradeClose :
// clôture d'une position ouverte avant le démarrage du runner) n'a pas d'heure d'ouverture : on la juge alors sur son
// heure de CLÔTURE, comme app/api/member/account/route.ts. Avant ce correctif elle passait toujours : la membre #2813,
// en copie depuis le 28/10, voyait 8 gains du 22/10 à 02:1x sur son accueil (« 8/8 wins »), qu'elle n'a jamais eus.

/** Le trade fait-il partie de la copie qui a commencé à `copyStartMs` ? (ouverture, ou clôture si l'ouverture manque) */
export function inCopyWindow(t: { opened_at?: string | null; closed_at?: string | null }, copyStartMs: number): boolean {
  const at = Date.parse(String(t.opened_at ?? t.closed_at ?? ''));
  return Number.isFinite(at) && at >= copyStartMs;
}
