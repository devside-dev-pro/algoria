// LE CERVEAU D'ALGORIA AI — lecture des documents de l'agent (table agent_docs, migration 0009). Server-only.
// `knowledge` = ce qu'il sait, écrit par Mathieu dans l'admin (onglet TOOLS). Cache 60 s : une modification
// est prise en compte en une minute, sans redéploiement, et le bot ne relit pas la base à chaque message.
import { sdb } from './server';

export const AGENT_DOC_KEYS = ['knowledge'] as const;
export type AgentDocKey = (typeof AGENT_DOC_KEYS)[number];
/** Plafond d'un document : au-delà, le prompt s'alourdit (coût, lenteur) et l'agent s'y perd. */
export const AGENT_DOC_MAX = 20_000;

const cache = new Map<AgentDocKey, { at: number; text: string | null }>();

/** Le document, ou null s'il est vide / illisible — l'appelant retombe alors sur ses faits intégrés. */
export async function getAgentDoc(key: AgentDocKey): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.text;
  try {
    const { data, error } = await sdb().from('agent_docs').select('content').eq('key', key).limit(1);
    if (error) throw error;
    const text = String((data?.[0] as { content?: string } | undefined)?.content ?? '').trim() || null;
    cache.set(key, { at: Date.now(), text });
    return text;
  } catch {
    return hit?.text ?? null; // base indisponible : la dernière version connue plutôt que rien
  }
}
