// 🗣 LE GUIDE DE TON DU CANAL, CONTRÔLÉ PAR LE CODE (10/11/2026, refonte du CM).
//
// Le constat de Mathieu (audit du 10/11, /workspace/cm-audit-cm/posts.txt) : le canal sonne répétitif et robotique.
// Les mêmes ouvertures tous les jours (« Tuesday, quick one… », « Algoria AI is already on gold, working for you
// while you live your day »), la même fin (« tap below 👇 »), 🙏🏼 / 🙌🏻 partout, un gras par ligne, l'en-tête
// « 🔵💙 HOW IT WORKS ». Le prompt dit désormais comment écrire ; ce fichier REFUSE ce qui ne le respecte pas. Un
// texte refusé repart au modèle avec la raison (un 2e essai), puis le post saute : plutôt rien qu'un post robotique.
// Aucune règle plus ancienne n'est retirée (writer.ts, check : promesses, argent à mettre, négatif, liens, chiffres).

/** Les tournures usées jusqu'à la corde (Mathieu, 10/11). S'ajoutent aux interdits déjà en place, sans en retirer. */
export const BANNED_PHRASES: Array<[RegExp, string]> = [
  [/\bquick one\b/i, '"quick one"'],
  [/\bno (?:sales )?pitch\b/i, '"no pitch"'],
  [/\bi (?:reply|answer) (?:to you )?myself\b/i, '"I reply myself"'],
  [/\b(?:is |are |'s )?already on gold\b/i, '"already on gold"'],
  [/\bwhile you (?:live|are living|were living|get on with|start) your day\b/i, '"while you live your day"'],
  [/\bstuck halfway\b/i, '"stuck halfway"'],
  [/\btap (?:right )?below\b/i, '"tap below"'],
  [/\bnothing hidden\b/i, '"nothing hidden"'],
];
const DAYS = /^(?:happy\s+|this\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
/** 🙏 et 🙌, tous teints confondus : une fois par semaine au plus, sur tout le canal. */
export const RATIONED: Array<{ key: 'pray' | 'raise'; re: RegExp; label: string }> = [
  { key: 'pray', re: /🙏[\u{1F3FB}-\u{1F3FF}]?/gu, label: '🙏🏼' },
  { key: 'raise', re: /🙌[\u{1F3FB}-\u{1F3FF}]?/gu, label: '🙌🏻' },
];
export const MAX_EMOJIS = 2;

const plain = (t: string) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** La première ligne non vide, sans balises. */
export const firstLine = (t: string) => plain(t).split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/** Une séquence emoji (teint, ZWJ, variante, puce 1️⃣). Nouvelle expression à chaque appel : un /g partagé garde lastIndex. */
const emojiRe = () => /(?:[0-9#*]\uFE0F?\u20E3)|(?:\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?)*)/gu;

/** Les emojis d'un texte (une séquence avec teint, ZWJ ou variante compte pour un ; 1️⃣ aussi). */
export function emojisOf(t: string): string[] {
  return plain(t).match(emojiRe()) ?? [];
}

const SHAPE_LEAD = 'shape: the first line must start with one emoji, then a short bold hook, like 🌍 <b>Which broker? It depends on your country</b>';
const SHAPE_BOLD = 'shape: bold the hook once, on the first line, and nowhere else';
const SHAPE_LONG = 'shape: the bold hook must be one short line, under 90 characters';
const SHAPE_BODY = 'shape: put 1 to 3 natural emojis in the paragraphs under the hook (👌🏻 🔒 💬), not zero and not a pile';
const BODY_EMOJI = '👌🏻';

/** La première ligne n'est pas au format validé le 25/11/2026 (emoji, puis accroche <b>courte</b>, 1 à 3 emojis dans le corps). */
export function hookIssue(t: string): string | null {
  const lines = t.split('\n');
  const idx = lines.findIndex((l) => l.trim());
  if (idx < 0) return SHAPE_LEAD;
  const line = lines[idx].trim();
  const em = emojisOf(line);
  const boldAt = line.indexOf('<b>');
  const emojiAt = em.length ? line.indexOf(em[0]) : -1;
  const lead = emojiAt >= 0 && line.slice(0, emojiAt).trim() === '' && boldAt >= 0 && emojiAt < boldAt;
  if (!lead) return SHAPE_LEAD;
  if ((t.match(/<b>/g) ?? []).length !== 1) return SHAPE_BOLD;
  const tag = /<b>([\s\S]*?)<\/b>/.exec(line);
  const hook = plain(tag?.[1] ?? '').trim();
  if (!tag || !hook || !/\p{L}/u.test(hook) || hook.length > 90) return SHAPE_LONG;
  const outside = line.slice(0, boldAt).replace(em[0], '').trim();
  const after = line.slice(boldAt + tag[0].length).trim();
  if (outside || after) return SHAPE_LEAD;
  const body = emojisOf(lines.slice(idx + 1).join('\n'));
  if (body.length < 1 || body.length > 3) return SHAPE_BODY;
  return null;
}

/** Un refus de forme (emoji en tête, accroche en gras, emojis du corps), pas un garde-fou de fond. */
export const isShapeIssue = (why: string) => why.startsWith('shape:');

/**
 * Dernier recours après un essai refusé pour la forme : emoji en tête, accroche en gras, un emoji de corps
 * s'il en manque. N'invente pas de phrase. null si le texte n'a pas d'accroche récupérable, ou plus de 3 emojis
 * dans le corps (on n'en retire pas : ce serait changer le sens).
 */
export function shapeFallback(text: string, lead = '💬'): string | null {
  const trimmed = text.replace(/\r/g, '').trim();
  if (!trimmed) return null;
  if (hookIssue(trimmed) === null) return trimmed;
  const lines = trimmed.split('\n');
  const idx = lines.findIndex((l) => l.trim());
  if (idx < 0) return null;
  const first = lines[idx].trim();
  const em = emojisOf(first);
  const boldAt = first.indexOf('<b>');
  const emojiAt = em.length ? first.indexOf(em[0]) : -1;
  const hasLead = emojiAt >= 0 && first.slice(0, emojiAt).trim() === '' && (boldAt < 0 || emojiAt < boldAt);
  const emoji = hasLead ? em[0] : lead;
  let hook = plain(first);
  if (hasLead) hook = hook.replace(em[0], '');
  hook = hook.replace(emojiRe(), ' ').replace(/\s+/g, ' ').trim();
  if (!hook || !/\p{L}/u.test(hook)) return null;
  let bodyLines = lines.slice(idx + 1);
  if (hook.length > 90) {
    const cut = /^(.{8,90}?[.!?])\s+(\S[\s\S]*)$/.exec(hook);
    if (!cut) return null;
    hook = cut[1];
    const extra = cut[2].trim();
    if (extra) bodyLines = [extra, ...bodyLines];
  }
  const body = bodyLines.join('\n').replace(/<\/?b>/gi, '');
  const parts = `${emoji} <b>${hook}</b>\n\n${body}`.replace(/\n{3,}/g, '\n\n').trim().split('\n');
  const head = parts.findIndex((l) => l.trim());
  if (emojisOf(parts.slice(head + 1).join('\n')).length > 3) return null;
  if (emojisOf(parts.slice(head + 1).join('\n')).length === 0) {
    let last = -1;
    for (let k = parts.length - 1; k > head; k--) {
      const l = parts[k].trim();
      if (!l || /^\{\{[A-Z0-9_]+\}\}$/.test(l)) continue;
      last = k;
      break;
    }
    if (last < 0) return null;
    parts[last] = `${parts[last].trimEnd()} ${BODY_EMOJI}`;
  }
  const out = parts.join('\n').trim();
  return hookIssue(out) === null ? out : null;
}

/** Normalisation pour comparer deux ouvertures : minuscules, sans emoji, sans ponctuation, espaces simples. */
export const normLine = (l: string) => plain(l).toLowerCase().replace(/[’']/g, "'")
  .replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (l: string) => normLine(l).split(' ').filter((w) => w.length > 2);
/** Ressemblance de deux ouvertures (Jaccard sur les mots de 3 lettres et plus), de 0 à 1. */
export function similarity(a: string, b: string): number {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return normLine(a) === normLine(b) ? 1 : 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
export const SIMILAR = 0.6;

export type ToneContext = {
  /** les premières lignes ENTIÈRES des posts publiés ces 14 derniers jours (et des posts du plan déjà écrits) */
  openings?: string[];
  /** 🙏 / 🙌 déjà utilisés sur les 7 derniers jours (une fois par semaine au plus) */
  rationedUsed?: Set<'pray' | 'raise'>;
  /** le post a un bouton (CTA) : il peut y renvoyer, sans finir par 👇 */
  hasButton?: boolean;
  /** le récap du soir garde son en-tête 🔵💙 (hors de cette refonte) */
  allowHeader?: boolean;
  /** 25/11/2026 : emoji en tête, accroche <b>courte</b>, 1 à 3 emojis dans le corps. Le récap et les sondages ne l'ont pas. */
  requireHook?: boolean;
};

/** La raison du refus au regard du guide de ton, ou null si le texte passe. Le texte est celui du modèle (HTML Telegram). */
export function toneIssue(t: string, c: ToneContext = {}): string | null {
  const first = firstLine(t);
  if (DAYS.test(first.replace(/^[^\p{L}]+/u, ''))) return 'never open on the day of the week (no "Tuesday…", "Happy Friday…"): start with the actual point';
  if (!c.allowHeader && /🔵💙|\bHOW IT WORKS\b|\bYOU ASKED\b/i.test(t)) return 'no header line (no "🔵💙 HOW IT WORKS", no "YOU ASKED"): just talk';
  for (const [re, label] of BANNED_PHRASES) if (re.test(plain(t))) return `the phrase ${label} is banned, it is worn out: say it differently`;
  if (c.requireHook) {
    const shape = hookIssue(t);
    if (shape) return shape;
  } else {
    const bolds = (t.match(/<b>/g) ?? []).length;
    if (bolds > 1) return 'bold at most once in the whole post';
    const em = emojisOf(t);
    if (em.length > MAX_EMOJIS) return `${em.length} emojis: use ${MAX_EMOJIS} at most, zero is fine`;
  }
  for (const r of RATIONED) {
    const n = (plain(t).match(r.re) ?? []).length;
    if (n > 1 || (n && c.rationedUsed?.has(r.key))) return `${r.label} was already used this week: do not use it`;
  }
  if (/👇\s*$/u.test(plain(t).trim())) return 'never end with 👇';
  if (!c.hasButton && /👇/u.test(t)) return 'there is no button under this post: never point below';
  for (const o of c.openings ?? []) {
    if (o && (normLine(o) === normLine(first) || similarity(o, first) >= SIMILAR)) return `the first line is too close to a recent post ("${o.slice(0, 80)}"): open differently`;
  }
  return null;
}

/** Quels emojis rationnés un texte utilise. */
export const rationedIn = (t: string): Array<'pray' | 'raise'> => RATIONED.filter((r) => (plain(t).match(r.re) ?? []).length > 0).map((r) => r.key);
