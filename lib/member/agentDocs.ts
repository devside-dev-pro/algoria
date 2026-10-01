// LE CERVEAU D'ALGORIA AI — lecture des documents de l'agent (table agent_docs, migration 0009). Server-only.
// `knowledge` = ce qu'il sait, écrit par Mathieu dans l'admin (onglet TOOLS).
// `memory`    = ce qu'il a APPRIS : une ligne par correction de Mathieu (réponse à une proposition dans Telegram),
//               ajoutée automatiquement, relisible et modifiable dans l'admin comme le knowledge.
// `ads_memory` = ADS STUDIO (01/10/2026) : ce que Claude a appris des avis de Mathieu sur les ads (⭐ / 👎 + raisons).
//               Lu par Claude AVANT d'écrire de nouvelles ads ; modifiable dans l'onglet ADS STUDIO → 🧠 Memory.
//               Le bot Telegram ne le lit pas.
// Cache 60 s : une modification est prise en compte en une minute, sans redéploiement, et le bot ne relit pas la
// base à chaque message.
import { sdb } from './server';

export const AGENT_DOC_KEYS = ['knowledge', 'memory', 'ads_memory'] as const;
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

const MEMORY_HEADER = '# Algoria AI — mémoire\nLeçons tirées des corrections de Mathieu, une par ligne. En cas de contradiction, la plus récente gagne.\n';

/** Ajoute une leçon à la mémoire. Au-delà du plafond, les plus anciennes leçons tombent (l'en-tête et les lignes
 *  écrites à la main hors puces restent). Pas de version archivée par leçon : seules les sauvegardes de l'admin
 *  en créent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function appendAgentMemory(db: any, lesson: string, by: string): Promise<boolean> {
  try {
    const { data } = await db.from('agent_docs').select('content').eq('key', 'memory').limit(1);
    const current = String(data?.[0]?.content ?? '').trim() || MEMORY_HEADER.trim();
    const lines = `${current}\n- ${lesson.replace(/\s+/g, ' ').trim()}`.split('\n');
    while (lines.join('\n').length > AGENT_DOC_MAX) {
      const i = lines.findIndex((l) => l.startsWith('- '));
      if (i < 0 || i === lines.length - 1) break;
      lines.splice(i, 1);
    }
    const { error } = await db.from('agent_docs').upsert({ key: 'memory', content: lines.join('\n'), updated_at: new Date().toISOString(), updated_by: by });
    if (error) throw error;
    cache.delete('memory');
    return true;
  } catch (e) {
    console.error('[agentDocs] memory append failed:', (e as { message?: string })?.message ?? e);
    return false;
  }
}
