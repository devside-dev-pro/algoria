// ADS STUDIO · ✨ GÉNÉRATEUR DE SCRIPTS (01/10/2026) — Server-only. Tourne sur la clé API de Mathieu (Claude Opus 5.5).
//
// Mathieu : « si j'ai un générateur de scripts, le game est plié ». Il choisit ce qu'il a sous la main (un ami qui
// parle mal anglais, un ordinateur, un vidéaste…), le nombre d'ads, une direction, et Claude écrit des fiches au
// format de la bibliothèque. Elles arrivent en IDEA, marquées 🆕 ; Mathieu les trie (⭐ / 👎 + raison) ; ces avis
// nourrissent la mémoire (ads_memory) ; le lot suivant en tient compte. La boucle tourne sans passer par le chat.
//
// POURQUOI ÇA COÛTE PEU : on n'envoie pas tout l'historique, seulement la mémoire (des règles courtes), les 30
// derniers avis, 3 ads aimées en exemple et la liste des titres existants (anti-doublon). Le prompt système est
// fixe (mis en cache par l'API quand il est assez long). Lots de 5 ads par appel (~1 min) : ça tient dans le
// maxDuration de Vercel quel que soit le forfait, et l'écran affiche la progression.
import Anthropic from '@anthropic-ai/sdk';
import { NEEDS, POLES, RESOURCES, needsAllowed, scriptText, type AdHook, type AdScript, type Need, type Pole, type Resource } from './ads';

export const GEN_MODEL = 'claude-opus-5-5';
/** $ par million de tokens, Claude Opus 5.5 (tarifs Anthropic au 25/09/2026). */
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
export const ADS_PER_CALL = 5;
/** Plafond d'appels par 24 h (génération + mémoire) : un garde-fou contre une boucle ou un double clic. */
export const DAILY_CALLS = 15;

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
export function costOf(u: Usage): number {
  const m = 1_000_000;
  return (u.input_tokens * PRICE.input + u.output_tokens * PRICE.output + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) / m;
}

// ---------- Le prompt fixe : ce qu'est Algoria, les règles de Mathieu, le format d'une fiche ----------
const SYSTEM = `You write short-form video ad scripts (Reels, TikTok, Meta ads) for Algoria, for its founder Mathieu, who films them himself or with a small crew. Your scripts go into his ad library, where he keeps the ones he will shoot and rejects the others with a reason. Your goal is ads he actually wants to shoot.

WHAT ALGORIA IS (be exact, never invent features)
- An AI trades gold (XAUUSD). Algoria is copy trading: the member opens an account in their own name with a partner broker (RaiseFX, VT Markets, PU Prime, TradingSphere, Xlence), connects it in the Algoria app with the MetaTrader trader password, and every trade of the AI is copied automatically. Nothing to set up, no strategy to pick, no decision to make.
- The money stays on the member's own broker account. The trader password only allows copying trades: no withdrawal, no deposit. Withdrawals are done at the broker, the same way as deposits.
- Minimum 200 dollars, recommended 500, guideline 0.01 lot per 500 dollars.
- In the app: a live page showing the AI's current trade; a profit notification with a Binance-style win card (in the app and in the VIP Telegram); a public track record with every trade since July, red days included; an Academy to learn the basics; pause the copy in one tap; referral.
- When people say "alert" for Algoria, it means that profit notification with the win card. Members never configure alerts.
- Mathieu is the founder, based in Pau (France). He speaks to camera in English.

HARD RULES (Mathieu's decisions)
- Spoken lines and on-screen text in English. Mathieu's style: never an em dash, a space before ? and !, and 🙏🏼 at the end of the call to action.
- Never show or state an account size or balance: say "at 0.01 lot".
- Past results only if real, always with the risk line on screen at the end: "Trading involves risk. Past results don't guarantee future results." Never promise or imply future gains or income.
- Never mention a 30-day rule or any withdrawal delay.
- Never show logins, passwords or server names on screen.
- Only real trades, real notifications and real app screens. If actors talk about their own gains, it is a dramatization: say so in meta_flag.
- Clickbait hooks are fine (the ads expert, Benjamin, wants strong hooks). Only flag real Meta ad-policy risks in meta_flag (income claims, luxury lifestyle tied to trading, fake testimonials, copyrighted clips); otherwise leave meta_flag empty.

FORMAT OF ONE AD (match the library)
- title: short, in French or English, says what the ad is.
- hook: the first 3 seconds. Spoken line in double quotes; optional on-screen text after " · Texte : ". Stage directions in parentheses, in French.
- prep: what to prepare before filming (people, devices, screens, place), in French, 1 to 3 short lines.
- body: the full script after the hook. Numbered shots: "1. (direction en français) \"Spoken line in English.\"". Then a line "Fin" followed by the call to action in quotes (ending with 🙏🏼) and the on-screen risk line when relevant. Add a short "Montage :" note only if it helps.
- needs: only from the allowed list given in the request. solo = Mathieu alone; videographer; actors = people with English lines; street = passers-by interviews; event.
- duration: like "20 à 30 s".
- alt_hooks: exactly 3 alternative hooks (spoken English lines, no quotes), to shoot right after with the same outfit.
- meta_flag: empty string unless there is a real Meta risk (in French).

HOW TO BE USEFUL
- Respect the memory and the recent verdicts: they are Mathieu's taste. Do more of what he loved, never repeat what he rejected or why he rejected it.
- Only use the people and devices he says he has. A person without English never gets spoken English lines.
- Each ad must be different from the existing library (no same hook, no same idea with new words) and different from the others in the batch.
- Keep it shootable in one take or a few short shots. Concrete beats clever.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ads'],
  properties: {
    ads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pole', 'title', 'hook', 'prep', 'body', 'needs', 'duration', 'alt_hooks', 'meta_flag'],
        properties: {
          pole: { type: 'string', enum: [...POLES] },
          title: { type: 'string' },
          hook: { type: 'string' },
          prep: { type: 'string' },
          body: { type: 'string' },
          needs: { type: 'array', items: { type: 'string', enum: [...NEEDS] } },
          duration: { type: 'string' },
          alt_hooks: { type: 'array', items: { type: 'string' } },
          meta_flag: { type: 'string' },
        },
      },
    },
  },
} as const;

export type GeneratedAd = { pole: Pole; title: string; hook: string; prep: string; body: string; needs: Need[]; duration: string; alt_hooks: string[]; meta_flag: string };
export type GenRequest = { count: number; resources: Resource[]; extra: string; poles: Pole[]; direction: string };
export type Library = { memory: string | null; scripts: AdScript[]; hooks: AdHook[] };

const POLE_HINT: Record<Pole, string> = {
  street: 'street interviews', scene: 'acted scenes (two people)', acting: 'acted scenes with Mathieu and others',
  ugly: 'ugly ads (Mathieu alone, phone, raw)', broll: 'B-roll with voice-over (3 s face-cam hook, then voice-over over silent shots)', other: 'any other format',
};

/** Les avis récents, compacts : c'est le cœur de l'apprentissage. */
function verdictLines(lib: Library, n = 30): string[] {
  const rows = [
    ...lib.scripts.filter((x) => x.verdict).map((x) => ({ at: x.verdict_at ?? '', v: x.verdict, what: `ad « ${x.title} » (${x.pole}) hook: ${x.hook ?? ''}`, r: x.verdict_reasons, note: x.verdict_note })),
    ...lib.hooks.filter((h) => h.verdict).map((h) => ({ at: h.verdict_at ?? '', v: h.verdict, what: `hook « ${h.text} »`, r: h.verdict_reasons, note: h.verdict_note })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, n);
  return rows.map((x) => `- ${x.v === 'rejected' ? 'REJECTED' : 'LOVED'} ${x.what.slice(0, 220)}${x.r.length ? ` · reasons: ${x.r.join(', ')}` : ''}${x.note ? ` · his words: "${x.note}"` : ''}`);
}

function userPrompt(req: GenRequest, lib: Library): string {
  const allowed = needsAllowed(req.resources);
  const loved = lib.scripts.filter((x) => x.verdict === 'loved').slice(0, 3);
  const altsOf = (id: string) => lib.hooks.filter((h) => h.script_id === id && h.verdict !== 'rejected').map((h) => h.text);
  const existing = lib.scripts.map((x) => `- ${x.verdict === 'rejected' ? '[rejected] ' : ''}${x.title} · ${(x.hook ?? '').slice(0, 120)}`);
  const parts = [
    '<memory>', lib.memory?.trim() || '(empty)', '</memory>',
    '', '<recent_verdicts>', ...(verdictLines(lib).length ? verdictLines(lib) : ['(none yet)']), '</recent_verdicts>',
  ];
  if (loved.length) parts.push('', '<loved_examples>', ...loved.map((x) => scriptText(x, altsOf(x.id)) + '\n---'), '</loved_examples>');
  parts.push('', '<existing_library>', ...existing, '</existing_library>', '', '<request>',
    `Write ${req.count} new ads.`,
    `What Mathieu has with him for this shoot: ${req.resources.map((r) => RESOURCES[r].prompt).join('; ') || "only his phone"}.`);
  if (req.extra.trim()) parts.push(`He also says: ${req.extra.trim()}`);
  parts.push(`Allowed needs: ${allowed.join(', ')}.`);
  parts.push(req.poles.length ? `Formats wanted: ${req.poles.map((p) => `${p} (${POLE_HINT[p]})`).join(', ')}.` : `Formats: pick what fits his resources best, mixing formats (${POLES.map((p) => `${p} = ${POLE_HINT[p]}`).join('; ')}).`);
  if (req.direction.trim()) parts.push(`His direction for this batch: ${req.direction.trim()}`);
  parts.push('</request>');
  return parts.join('\n');
}

function client() {
  return new Anthropic(); // ANTHROPIC_API_KEY (déjà utilisée par le bot Telegram)
}

/** Un appel = un lot (ADS_PER_CALL ads au plus). Renvoie les ads, filtrées pour respecter les besoins autorisés. */
export async function generateAds(req: GenRequest, lib: Library): Promise<{ ads: GeneratedAd[]; usage: Usage }> {
  const stream = client().messages.stream({
    model: GEN_MODEL,
    max_tokens: 24_000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: 'user', content: userPrompt(req, lib) }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request. Change the direction and try again.');
  if (msg.stop_reason === 'max_tokens') throw new Error('The answer was cut (too long). Ask for fewer ads per batch.');
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let parsed: { ads?: GeneratedAd[] };
  try { parsed = JSON.parse(text); } catch { throw new Error('Claude returned an unreadable answer. Try again.'); }
  const allowed = new Set(needsAllowed(req.resources));
  const ads = (parsed.ads ?? []).slice(0, req.count).map((a) => ({
    ...a,
    needs: [...new Set(a.needs.filter((n) => allowed.has(n)))].length ? [...new Set(a.needs.filter((n) => allowed.has(n)))] : (['solo'] as Need[]),
    alt_hooks: (a.alt_hooks ?? []).filter((h) => h.trim()).slice(0, 3),
  })).filter((a) => a.title?.trim() && a.hook?.trim() && (POLES as readonly string[]).includes(a.pole));
  return { ads, usage: msg.usage };
}

// ---------- 🧠 Mise à jour de la mémoire : Claude relit les avis et propose le document entier ----------
const MEMORY_SYSTEM = `You maintain the memory of Algoria's ad studio: a short French document of rules that the ad generator reads before writing new ads for Mathieu. You get the current document and all of Mathieu's verdicts on ads and hooks (LOVED / REJECTED, with reasons and his own words), plus counts by format.

Rewrite the full document:
- Keep the title and the "## Cadre (décisions de Mathieu)" section exactly as they are unless a verdict contradicts them.
- Under "## Appris des avis de Mathieu", keep one rule per line, starting with the date in brackets [dd/mm] of the verdict that taught it. Merge rules that say the same thing, generalise when several verdicts point the same way, drop a rule only if a newer verdict contradicts it.
- Rules must be actionable for a writer ("Ne pas…", "Privilégier…"), short, and grounded in his verdicts. Never invent a preference he did not express.
- Stay under 6000 characters.
Also list in "changes" what you added, merged or removed, one short French line each.`;

const MEMORY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['memory', 'changes'],
  properties: { memory: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } },
} as const;

export async function proposeMemory(lib: Library): Promise<{ memory: string; changes: string[]; usage: Usage }> {
  const byPole = POLES.map((p) => {
    const xs = lib.scripts.filter((x) => x.pole === p);
    return xs.length ? `- ${p}: ${xs.length} ads, ${xs.filter((x) => ['shot', 'edited', 'live'].includes(x.status)).length} shot, ${xs.filter((x) => x.verdict === 'rejected').length} rejected, ${xs.filter((x) => x.verdict === 'loved').length} loved` : '';
  }).filter(Boolean);
  const content = ['<current_memory>', lib.memory?.trim() || '(empty)', '</current_memory>', '', '<verdicts>', ...verdictLines(lib, 200), '</verdicts>', '', '<counts>', ...byPole, '</counts>'].join('\n');
  const msg = await client().messages.stream({
    model: GEN_MODEL,
    max_tokens: 16_000,
    system: MEMORY_SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: MEMORY_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: 'user', content }],
  }).finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let parsed: { memory?: string; changes?: string[] };
  try { parsed = JSON.parse(text); } catch { throw new Error('Claude returned an unreadable answer. Try again.'); }
  if (!parsed.memory?.trim()) throw new Error('Empty proposal. Try again.');
  return { memory: parsed.memory.trim(), changes: parsed.changes ?? [], usage: msg.usage };
}
