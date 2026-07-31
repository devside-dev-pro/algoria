// TRADUCTION DES POSTS DE CANAL (01/08 — pont EN → IT). Server-only.
//
// Modèle : Haiku par défaut. Deux raisons, dans cet ordre :
//   1. LA VITESSE. Telegram retente un webhook qui traîne, et un retry = un doublon posté devant toute
//      l'audience italienne. Haiku répond en ~1 s là où un gros modèle prend 3 s.
//   2. le coût — quelques posts par jour, mais autant ne pas payer 10× pour une traduction.
// ALGORIA_TRANSLATE_MODEL permet de basculer sans redéploiement si la qualité ne suit pas.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ALGORIA_TRANSLATE_MODEL ?? 'claude-haiku-4-5-20251001';

// Le jargon reste en anglais : un trader italien lit « stop-loss », pas « ordine di arresto della
// perdita ». Traduire ces termes ferait immédiatement amateur auprès de l'audience visée.
const SYSTEM = `You translate Telegram channel posts for Algoria, an AI copy-trading service on gold (XAU/USD), from English to Italian.

RULES
- Translate into natural, native Italian as a trading brand would write it — not literal, not stiff.
- KEEP IN ENGLISH (traders read these in English): stop-loss, take-profit, breakout, swing, scalp, drawdown, lot, spread, broker, trailing, copy trading, live, AI.
- Keep ALL of these EXACTLY as they are: numbers, prices, percentages, URLs, @handles, promo codes (e.g. ALGORIA100), emojis and their position.
- Keep the HTML tags intact and valid: <b>, <i>, <u>, <s>, <code>, <a href="...">. Never invent new tags, never drop one.
- Keep the same line breaks and overall shape. Same energy, same length.
- Never add a comment, a preface, or quotes. Output ONLY the translated post.`;

/**
 * Traduit un post (HTML Telegram) vers l'italien. Renvoie null si la traduction échoue ou revient vide —
 * l'appelant NE POSTE RIEN dans ce cas : mieux vaut un post manquant côté italien qu'un message cassé.
 */
export async function translateToItalian(html: string): Promise<string | null> {
  const src = html.trim();
  if (!src) return null;
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: src.slice(0, 6000) }],
    });
    const out = res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')
      .trim();
    return out || null;
  } catch (e) {
    console.error('[translate] échec:', (e as { message?: string })?.message ?? e);
    return null;
  }
}

/**
 * Texte Telegram + entities → HTML. Sans ça, un post traduit perdrait gras, italique et surtout les
 * liens masqués (text_link) — Telegram ne fournit jamais le HTML, seulement des offsets.
 * ⚠️ Les offsets sont en UNITÉS UTF-16 : on travaille sur un tableau de code units, sinon tout emoji
 * placé avant un lien décale les bornes et coupe le texte au mauvais endroit.
 */
export function entitiesToHtml(text: string, entities?: Array<{ type: string; offset: number; length: number; url?: string }>): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!entities?.length) return esc(text);
  const units = Array.from({ length: text.length }, (_, i) => text[i]); // UTF-16 code units
  const open: Record<number, string[]> = {};
  const close: Record<number, string[]> = {};
  const TAG: Record<string, [string, string]> = {
    bold: ['<b>', '</b>'], italic: ['<i>', '</i>'], underline: ['<u>', '</u>'],
    strikethrough: ['<s>', '</s>'], code: ['<code>', '</code>'], pre: ['<pre>', '</pre>'],
  };
  for (const e of entities) {
    const pair = e.type === 'text_link' && e.url ? [`<a href="${esc(e.url)}">`, '</a>'] as [string, string] : TAG[e.type];
    if (!pair) continue; // mention, hashtag, url brute… : rien à baliser, le texte suffit
    const end = e.offset + e.length;
    if (e.offset < 0 || end > units.length) continue;
    (open[e.offset] ??= []).push(pair[0]);
    (close[end] ??= []).unshift(pair[1]); // fermeture en ordre inverse : imbrication valide
  }
  let out = '';
  for (let i = 0; i <= units.length; i++) {
    if (close[i]) out += close[i].join('');
    if (open[i]) out += open[i].join('');
    if (i < units.length) out += esc(units[i]);
  }
  return out;
}
