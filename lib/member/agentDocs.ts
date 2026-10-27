// LE CERVEAU D'ALGORIA AI — lecture des documents de l'agent (table agent_docs, migration 0009). Server-only.
// `knowledge` = ce qu'il sait, écrit par Mathieu dans l'admin (onglet TOOLS).
// `memory`    = ce qu'il a APPRIS : une ligne par correction de Mathieu (réponse à une proposition dans Telegram),
//               ajoutée automatiquement, relisible et modifiable dans l'admin comme le knowledge.
// `cm_memory` = LE CM DU CANAL PUBLIC (15/10/2026) : ce que le rédacteur des posts du canal a appris des corrections de
//               Mathieu (réponses au message du matin). Lu par lib/channel/writer.ts ; le bot de support ne le lit pas.
// `live_welcome` = LE MESSAGE DE PASSAGE EN LIVE (16/10/2026) : envoyé au membre quand Mathieu le passe live
//               (lib/member/liveWelcome.ts) : les 30 jours, le lien du VIP. Messages séparés par une ligne « --- ».
// `support_welcome` / `support_intro` = LE SUPPORT AUTOMATIQUE (19/10/2026, lib/member/supportAuto.ts) : le texte sous
//               la bulle d'accueil ({name}), et le message qui suit le vocal du pays. Vides = textes par défaut du code.
// `support_followup` = LA RELANCE (20/10/2026) : trois textes séparés par « --- » (après l'accueil, après l'intro ou le
//               lien de l'app, après autre chose), envoyés ~23 h après le dernier message d'un client resté sans réponse.
// `ads_memory` = ADS STUDIO (01/10/2026) : ce que Claude a appris des avis de Mathieu sur les ads (⭐ / 👎 + raisons).
//               Lu par Claude AVANT d'écrire de nouvelles ads ; modifiable dans l'onglet ADS STUDIO → 🧠 Memory.
//               Le bot Telegram ne le lit pas.
// Cache 60 s : une modification est prise en compte en une minute, sans redéploiement, et le bot ne relit pas la
// base à chaque message.
import { createHash } from 'node:crypto';
import { sdb } from './server';

export const AGENT_DOC_KEYS = ['knowledge', 'memory', 'ads_memory', 'cm_memory', 'live_welcome', 'support_welcome', 'support_intro', 'support_followup'] as const;
export type AgentDocKey = (typeof AGENT_DOC_KEYS)[number];
/** Plafond d'un document : au-delà, le prompt s'alourdit (coût, lenteur) et l'agent s'y perd. */
export const AGENT_DOC_MAX = 20_000;

// 27/10/2026 : une mauvaise réponse du support ne se comprend qu'avec la VERSION du cerveau qui était dans le prompt.
// `updated_at` est l'horodatage de la ligne (une sauvegarde admin crée une version au même instant ; une leçon
// ajoutée à la mémoire, elle, met à jour le document SANS nouvelle ligne dans agent_doc_versions). Le hash (12 hex
// de sha256) est l'empreinte du texte exact injecté : on retrouve la version même si le document a bougé depuis.
type Cached = { at: number; text: string | null; updatedAt: string | null; hash: string | null };
const cache = new Map<AgentDocKey, Cached>();
const docHash = (text: string | null) => (text ? createHash('sha256').update(text).digest('hex').slice(0, 12) : null);

export interface AgentDocMeta { text: string | null; updatedAt: string | null; hash: string | null }

/** Le document et son empreinte, ou un texte vide si la ligne est vide. En panne de base : la dernière version en cache. */
export async function getAgentDocMeta(key: AgentDocKey): Promise<AgentDocMeta> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return { text: hit.text, updatedAt: hit.updatedAt, hash: hit.hash };
  try {
    const { data, error } = await sdb().from('agent_docs').select('content,updated_at').eq('key', key).limit(1);
    if (error) throw error;
    const row = (data?.[0] ?? null) as { content?: string; updated_at?: string } | null;
    const text = String(row?.content ?? '').trim() || null;
    const updatedAt = row?.updated_at ? String(row.updated_at) : null;
    const hash = docHash(text);
    cache.set(key, { at: Date.now(), text, updatedAt, hash });
    return { text, updatedAt, hash };
  } catch {
    return { text: hit?.text ?? null, updatedAt: hit?.updatedAt ?? null, hash: hit?.hash ?? null };
  }
}

/** Le document, ou null s'il est vide / illisible — l'appelant retombe alors sur ses faits intégrés. */
export async function getAgentDoc(key: AgentDocKey): Promise<string | null> {
  return (await getAgentDocMeta(key)).text;
}

const MEMORY_HEADER = '# Algoria AI — mémoire\nLeçons tirées des corrections de Mathieu, une par ligne. En cas de contradiction, la plus récente gagne.\n';
const HEADERS: Partial<Record<AgentDocKey, string>> = {
  memory: MEMORY_HEADER,
  cm_memory: '# CM du canal public, mémoire\nLeçons tirées des corrections de Mathieu sur les posts du canal, une par ligne. En cas de contradiction, la plus récente gagne.\n',
};

/** Ajoute une leçon à la mémoire. Au-delà du plafond, les plus anciennes leçons tombent (l'en-tête et les lignes
 *  écrites à la main hors puces restent). Pas de version archivée par leçon : seules les sauvegardes de l'admin
 *  en créent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function appendAgentMemory(db: any, lesson: string, by: string, key: AgentDocKey = 'memory'): Promise<boolean> {
  try {
    const { data } = await db.from('agent_docs').select('content').eq('key', key).limit(1);
    const current = String(data?.[0]?.content ?? '').trim() || (HEADERS[key] ?? MEMORY_HEADER).trim();
    const lines = `${current}\n- ${lesson.replace(/\s+/g, ' ').trim()}`.split('\n');
    while (lines.join('\n').length > AGENT_DOC_MAX) {
      const i = lines.findIndex((l) => l.startsWith('- '));
      if (i < 0 || i === lines.length - 1) break;
      lines.splice(i, 1);
    }
    const { error } = await db.from('agent_docs').upsert({ key, content: lines.join('\n'), updated_at: new Date().toISOString(), updated_by: by });
    if (error) throw error;
    cache.delete(key);
    return true;
  } catch (e) {
    console.error('[agentDocs] memory append failed:', (e as { message?: string })?.message ?? e);
    return false;
  }
}
