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

// GARDE-FOU DE SORTIE (11/08/2026 — incident réel). Le modèle a pris un post pour une demande qui lui
// était adressée et a répondu « I appreciate your message, but I think there might be a small
// misunderstanding! I'm ready to translate Telegram posts... Do you have a trading post you'd like me to
// translate? ». Ce texte est parti TEL QUEL sur le canal italien de 2 175 abonnés, en anglais, révélant
// au passage que le canal est traduit par une IA. La ligne channel_translations était en `sent` : le
// système a cru avoir réussi.
//
// La cause n'est pas le prompt (qui dit déjà « Output ONLY the translated post ») : c'est qu'AUCUNE
// relecture n'existait entre le modèle et la publication. Un modèle qui bavarde est une éventualité
// permanente, pas un bug à corriger une fois. On vérifie donc la SORTIE, pas la consigne.
//
// Deux filets, volontairement grossiers — ils doivent attraper le bavardage sans jamais recaler une
// vraie traduction :
//   · marqueurs de première personne d'assistant, en anglais (une traduction italienne n'en contient
//     jamais ; et le texte incriminé en aligne cinq) ;
//   · rapport de longueur — une traduction italienne fait entre 0,5× et 2,5× la source. La réponse
//     conversationnelle faisait plusieurs fois la taille d'un post court.
// En cas de doute on ne poste pas : un trou côté italien se rattrape à la main, un message cassé
// devant 2 175 personnes ne se rattrape pas.
const BAVARDAGE = [
  /\bi (?:appreciate|understand|apologi[sz]e|think there|see that|can help|would be happy)\b/i,
  /\bi'?m (?:ready|happy|here) to\b/i,
  /\b(?:my role|as an ai|language model|i cannot|i can't help)\b/i,
  /\b(?:you'?d like me to|would you like me to|do you have a|just share it|let me know)\b/i,
  /\bmisunderstanding\b/i,
  // même défaut, en italien : le modèle traduit bien mais préfixe sa réponse. Ces tournures
  // n'apparaissent jamais dans un post de trading, le risque de faux positif est nul.
  /\becco (?:la traduzione|il (?:post|testo) tradott)/i,
  /\bcome (?:assistente|modello) /i,
];

/** true = la sortie ressemble à une réponse d'assistant, pas à une traduction. Ne rien publier. */
export function looksLikeAssistantReply(src: string, out: string): boolean {
  if (BAVARDAGE.some((re) => re.test(out))) return true;
  const a = src.replace(/<[^>]+>/g, '').trim().length;
  const b = out.replace(/<[^>]+>/g, '').trim().length;
  if (a >= 40 && (b > a * 2.5 || b < a * 0.4)) return true; // sous 40 caractères le ratio ne veut rien dire
  return false;
}

/**
 * Traduit un post (HTML Telegram) vers l'italien. Renvoie null si la traduction échoue, revient vide,
 * ou ne ressemble pas à une traduction (voir looksLikeAssistantReply) — l'appelant NE POSTE RIEN dans
 * ce cas : mieux vaut un post manquant côté italien qu'un message cassé.
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
    if (!out) return null;
    if (looksLikeAssistantReply(src, out)) {
      console.error('[translate] sortie refusée (ressemble à une réponse d’assistant):', out.slice(0, 200));
      return null;
    }
    return out;
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
