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

/** Les emojis d'un texte (une séquence avec teint, ZWJ ou variante compte pour un ; 1️⃣ aussi). */
export function emojisOf(t: string): string[] {
  return plain(t).match(/(?:[0-9#*]\uFE0F?\u20E3)|(?:\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?)*)/gu) ?? [];
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
};

/** La raison du refus au regard du guide de ton, ou null si le texte passe. Le texte est celui du modèle (HTML Telegram). */
export function toneIssue(t: string, c: ToneContext = {}): string | null {
  const first = firstLine(t);
  if (DAYS.test(first.replace(/^[^\p{L}]+/u, ''))) return 'never open on the day of the week (no "Tuesday…", "Happy Friday…"): start with the actual point';
  if (!c.allowHeader && /🔵💙|\bHOW IT WORKS\b|\bYOU ASKED\b/i.test(t)) return 'no header line (no "🔵💙 HOW IT WORKS", no "YOU ASKED"): just talk';
  for (const [re, label] of BANNED_PHRASES) if (re.test(plain(t))) return `the phrase ${label} is banned, it is worn out: say it differently`;
  const bolds = (t.match(/<b>/g) ?? []).length;
  if (bolds > 1) return 'bold at most once in the whole post';
  const em = emojisOf(t);
  if (em.length > MAX_EMOJIS) return `${em.length} emojis: use ${MAX_EMOJIS} at most, zero is fine`;
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
