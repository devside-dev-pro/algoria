// ✍️ LE RÉDACTEUR DU CANAL PUBLIC (15/10/2026, décision Mathieu : « un CM intelligent, qui comprend et qui s'adapte,
// pas des copier-coller des mêmes messages chaque jour », et « c'est le côté naturel, la proximité avec moi, qui close
// les gens »). Claude écrit chaque post du jour à partir de ce qui se passe vraiment :
//   · le calendrier économique, mais SEULEMENT les annonces majeures (NFP, décision de taux de la Fed) : 90 % de
//     l'audience ne trade pas, une annonce de plus ne l'informe pas, elle l'inquiète (décision Mathieu du 15/10) ;
//   · la veille et la semaine, en chiffres réels, SEULEMENT si elles sont vertes (pas de négativité dans le canal) ;
//   · les derniers posts du canal, pour ne jamais se répéter ;
//   · les questions reçues en support cette semaine, pour parler des vrais blocages ;
//   · le knowledge de Mathieu (les faits) et la mémoire du CM (ses corrections, agent_docs « cm_memory »).
//
// LES CHIFFRES NE PASSENT JAMAIS PAR LE MODÈLE. Il écrit des jetons ({{AMOUNTS}}, {{YESTERDAY}}) que le code remplace
// par les montants calculés (mêmes trades que le récap et l'app). Un texte qui contient un montant inventé, une
// promesse, une balise inconnue ou un tiret long ne part pas : on retombe sur le texte de la banque (lib/channel/cm.ts),
// ou sur rien pour le bonjour du matin. Et rien ne part sans le clic de Mathieu.
import Anthropic from '@anthropic-ai/sdk';
import { AGENT_DOC_MAX, getAgentDoc } from '@/lib/member/agentDocs';
import { humanize } from '@/lib/member/replyDraft';
import { atRef } from '@/lib/display/scale';
import { tradingDayOf, tradingTimeMs } from '@/lib/display/tradingDay';
import { liveTrades } from './recap';
import { HISTORY_MAINTENANCE } from '@/lib/member/historyMaintenance';
import { safeSlice, stripAppLines, wellFormed } from './text';
import { firstLine, rationedIn, toneIssue, type ToneContext } from './tone';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const CM_MODEL = () => process.env.ALGORIA_CM_MODEL ?? 'claude-opus-5-5';
const RISK = "Trading involves risk. Past results don't guarantee future results.";

const usd = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(2)}`;
export const amountsLine = (net10: number) => `${usd(net10 / 10)} at 0.01 lot · ${usd(net10)} at 0.10 lot`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const longDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const parisHHMM = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

// ── LE CONTEXTE DU JOUR ───────────────────────────────────────────────────────────────────────────────

export type DayContext = {
  day: string;
  dateLabel: string;
  weekend: boolean;
  /** les annonces majeures du jour (NFP, décision de la Fed), heure de Paris, en mots simples */
  news: Array<{ at: string; title: string }>;
  /** la dernière séance (vendredi pour un lundi), seulement si elle est verte */
  lastSession: { day: string; trades: number; net10: number } | null;
  /** la semaine en cours jusqu'à hier, seulement si elle est verte */
  week: { trades: number; net10: number } | null;
  recent: string[];
  /** les premières lignes ENTIÈRES des posts publiés ces 14 derniers jours (anti-répétition, 10/11/2026) */
  openings: string[];
  /** 🙏 / 🙌 déjà publiés ces 7 derniers jours : une fois par semaine au plus */
  rationedUsed: Set<'pray' | 'raise'>;
  questions: string[];
  /** 🎤 le webinaire de ce soir ou de demain (posé par lib/channel/cm.ts, planDay) */
  webinar?: string;
};

// LES SEULES ANNONCES QUI MÉRITENT UNE LIGNE (Mathieu, 15/10 : « à part un NFP day ou un truc hyper important, je vois
// pas l'intérêt de leur faire peur »). Nommées en mots simples : l'audience ne sait pas ce qu'est un « NFP ».
const MAJOR: Array<[RegExp, string]> = [
  [/^Non-Farm Employment Change$/i, 'the big monthly US jobs report (NFP)'],
  [/^Federal Funds Rate$/i, "the US central bank's interest rate decision (the Fed)"],
];

async function ecoNews(day: string): Promise<Array<{ at: string; title: string }>> {
  try {
    const r = await fetch(process.env.ECO_CALENDAR_URL ?? 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'application/json' },
    });
    if (!r.ok) return [];
    const raw = (await r.json()) as Array<Record<string, unknown>>;
    return raw
      .map((e) => ({ t: Date.parse(String(e.date ?? '')), title: String(e.title ?? '').trim(), country: String(e.country ?? ''), impact: String(e.impact ?? '') }))
      .filter((e) => Number.isFinite(e.t) && e.country === 'USD' && tradingDayOf(e.t) === day && MAJOR.some(([re]) => re.test(e.title)))
      .sort((a, b) => a.t - b.t).slice(0, 2)
      .map((e) => ({ at: parisHHMM(e.t), title: MAJOR.find(([re]) => re.test(e.title))?.[1] ?? e.title }));
  } catch { return []; }
}

/** Tout ce que le rédacteur sait du jour `day` (Paris). Chaque morceau est facultatif : une source en panne n'empêche rien. */
export async function dayContext(db: Db, day: string): Promise<DayContext> {
  const wd = weekday(day);
  // la dernière séance : la veille, ou le vendredi pour un samedi, un dimanche ou un lundi
  const last = wd === 1 ? addDays(day, -3) : wd === 0 ? addDays(day, -2) : addDays(day, -1);
  const monday = addDays(day, -((wd + 6) % 7));
  const from = last < monday ? last : monday;
  const [news, trades, recentRows, recaps, qs] = await Promise.all([
    ecoNews(day),
    liveTrades(db, new Date(Date.parse(`${from}T00:00:00Z`) - 3 * 3_600_000).toISOString()).catch(() => []),
    // 14 JOURS (10/11/2026) : avant, les 12 derniers posts coupés à 300 caractères. Les 12 plus récents servent encore
    // d'exemples de structure ; les premières lignes entières des 14 jours servent au contrôle de répétition (tone.ts).
    db.from('channel_posts').select('text,scheduled_at').eq('status', 'published').not('text', 'is', null)
      .gte('scheduled_at', new Date(Date.now() - 14 * 86_400_000).toISOString()).order('scheduled_at', { ascending: false }).limit(120)
      .then((r: { data: unknown }) => r.data ?? []).catch(() => []),
    db.from('channel_recaps').select('text,day').eq('status', 'published').order('day', { ascending: false }).limit(10).then((r: { data: unknown }) => r.data ?? []).catch(() => []),
    db.from('member_actions').select('detail').eq('kind', 'biz_msg').gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(200)
      .then((r: { data: unknown }) => r.data ?? []).catch(() => []),
  ]);
  const sum = (pred: (d: string) => boolean) => {
    const t = (trades as Array<{ pnl: number; lot: number | null; closed_at: string }>).filter((x) => pred(tradingDayOf(x.closed_at)));
    return { trades: t.length, net10: t.reduce((s, x) => s + atRef(x.pnl, x.lot), 0) };
  };
  const ls = sum((d) => d === last);
  const wk = wd >= 2 && wd <= 5 ? sum((d) => d >= monday && d < day) : wd === 6 || wd === 0 ? sum((d) => d >= addDays(monday, 0) && d <= addDays(monday, 4)) : { trades: 0, net10: 0 };
  const questions = (qs as Array<{ detail: { from?: string; text?: string } | null }>)
    .map((r) => (r.detail?.from === 'client' ? String(r.detail?.text ?? '') : '')).filter((t) => t.length > 8 && !t.startsWith('[')).slice(0, 40).map((t) => safeSlice(t, 160).replace(/\s+/g, ' '));
  // LE PLAN PART À 18h (23/10/2026) : la séance de la veille n'est pas finie quand on écrit le bonjour du lendemain. Un
  // chiffre partiel ne se cite pas (la soirée peut tout changer) : résultat de la veille et de la semaine seulement
  // si la séance est close (l'or ferme à 23h, Paris).
  const closed = Date.now() >= tradingTimeMs(last, '23:00');
  return {
    day, dateLabel: longDate(day), weekend: wd === 0 || wd === 6, news,
    lastSession: closed && ls.trades && ls.net10 > 0 ? { day: last, ...ls } : null,
    week: closed && wk.trades && wk.net10 > 0 ? wk : null,
    recent: [...(recentRows as Array<{ text: string | null }>).slice(0, 12), ...(recaps as Array<{ text: string | null }>).slice(0, 3)].map((r) => safeSlice(String(r.text ?? ''), 300)).filter(Boolean),
    openings: [...new Set([...(recentRows as Array<{ text: string | null }>), ...(recaps as Array<{ text: string | null }>)].map((r) => firstLine(String(r.text ?? ''))).filter(Boolean))],
    rationedUsed: new Set((recentRows as Array<{ text: string | null; scheduled_at?: string }>)
      .filter((r) => Date.parse(String(r.scheduled_at ?? '')) >= Date.now() - 7 * 86_400_000).flatMap((r) => rationedIn(String(r.text ?? '')))),
    questions,
  };
}

// ── LES RÈGLES ────────────────────────────────────────────────────────────────────────────────────────

// 27/10/2026 : le knowledge dépasse déjà 12 000 caractères, la fin n'arrivait donc jamais au CM. Le plafond de
// l'admin est AGENT_DOC_MAX (20 000) : tout ce que Mathieu peut enregistrer est lu, et on ne va pas au-delà.
// La mémoire du CM reste à 6 000. Le Myfxbook du support n'est pas injecté ici.
async function systemPrompt(): Promise<string> {
  const [rawKnowledge, memory] = await Promise.all([getAgentDoc('knowledge'), getAgentDoc('cm_memory')]);
  // 28/10/2026 : la migration 0038 ajoute le Myfxbook au knowledge (pour le support). Décision #554 : le CM ne le
  // reçoit pas (canal public, pas de pertes ni de track record) → on retire la ligne qui le porte avant de lui donner.
  const knowledge = rawKnowledge ? rawKnowledge.split('\n').filter((l) => !/myfxbook/i.test(l)).join('\n') : rawKnowledge;
  return `You write the posts of Algoria's public Telegram channel. Algoria is an AI that trades gold; members copy it automatically on their own broker account (MetaTrader 5), at their own size. Mathieu built it and runs the community.

VOICE (10/11/2026, Mathieu: the channel must sound like HIM posting, not like a bot): you ARE Mathieu, the founder. Always the first person ("I", "my", "me"). Casual, like a text to friends who follow what you build. Short sentences. Plain words. Never corporate, never hype, never a slogan. The AI is "Algoria" or "the AI". Algoria is an ecosystem (the AI that trades gold, the app, the copy on your own account, the community, Mathieu), never "an algorithm for MetaTrader 5" or "a bot you install".

STYLE GUIDE (a post that breaks one is thrown away):
- Start with the actual point. Never open on the day of the week ("Tuesday…", "Happy Friday…"), never "Good morning family".
- No header line, no title in capitals (never "🔵💙 HOW IT WORKS", never "YOU ASKED").
- 0 to 2 emojis in the whole post (zero is often best). 🙏🏼 and 🙌🏻 at most once a week across the channel: assume they are already used.
- Bold at most once in the whole post, or not at all.
- Worn-out phrases, never: "quick one", "No pitch", "I reply myself", "already on gold", "while you live your day", "stuck halfway", "tap below", "nothing hidden".
- Never end with 👇. A post without a button never points below.
- Every post must feel different from the RECENT POSTS and from the OPENINGS USED IN THE LAST 14 DAYS: another first line, another structure, another rhythm.

AUDIENCE: beginners, mostly in South Africa and the UK. Many arrived from an ad and have not created their account yet. 90% of them are not traders and never will be: they want the AI to do it for them. So no charts, no jargon, nothing that could worry them; say BUY and SELL (never long or short). The only market event you may ever mention is one the task explicitly gives you.

HARD RULES (a post that breaks one is thrown away):
- English only. Telegram HTML only: <b>bold</b> and <i>italic</i>, nothing else. No markdown, no hashtags, no links in the text (when a post has a button, the system adds it).
- Never an em dash or an en dash. Put a space before "?" and "!" (that's how Mathieu writes).
- LAYOUT, AIR FIRST (Mathieu: a block of text with no space, nobody reads it). Telegram puts no space between two lines: the only air is an EMPTY line (\\n\\n). So:
  · the first line is the hook, then an EMPTY line;
  · then short blocks of 1 or 2 lines, one idea each, with an EMPTY line between every block; NEVER 3 lines of text in a row;
  · a list stays in one block, with its intro line if it has one;
  · a token ({{AMOUNTS}}, {{YESTERDAY}}, {{RESULT}}) is a block of its own.
- Never write the risk sentence yourself: when a post shows a result figure, the system adds it, in one italic line.
- Short: the whole post fits on one phone screen, read in 5 seconds. Say less, not more.
- Never write a number about results, profits or percentages yourself. Use the tokens you are given ({{AMOUNTS}}, {{YESTERDAY}}, {{RESULT}}) exactly as written; the system replaces them with the real figures. Never invent a figure, a trade, a date, a person or an event.
- No promises and no projections: never say people will earn, make money, double, get rich, or that today will be green. Past results only. Never a forecast on gold (no "gold will", no target, no level).
- Nothing negative in this public channel: no losses, red days, drawdowns, maintenance, pauses, bugs. Do not bring up red days, weeks or months yourself; but never lie: never say there were none, never deny a past loss (October included) and never claim results that were not real.
- Never claim that every trade has a stop loss, that losses are always cut or that trades are never averaged down: it is not guaranteed today.
- NEVER TALK ABOUT MONEY PEOPLE WOULD PUT IN: no deposit, no minimum, no recommended amount, no "fund your account", no balance, no dollar figure of any kind except the result tokens. It scares people. Say "create your trading account" and "connect your trading account to Algoria".
- Never mention an account size, the 30-day rule, withdrawal delays, testimonials, member quotes or screenshots of members.
- Only use facts given to you (the card, the context, the knowledge below). If you are not sure a fact is true, leave it out.

OUTPUT: only a JSON object {"text": "..."} with the post (use \\n for line breaks). No comment before or after.
${knowledge ? `\nMATHIEU'S KNOWLEDGE (written in French by Mathieu, the source of truth for facts):\n${safeSlice(knowledge, AGENT_DOC_MAX)}` : ''}${memory ? `\n\nLESSONS FROM MATHIEU'S CORRECTIONS ON CHANNEL POSTS (in French; they win over everything except the hard rules; the later one wins):\n${safeSlice(memory, 6000)}` : ''}`;
}

function contextBlock(c: DayContext): string {
  const lines = [`TODAY: ${c.dateLabel} (Paris time).${c.weekend ? ' Weekend: the gold market is closed (it closes Friday 23:00 and reopens Monday 00:00, Paris time). Algoria does not trade.' : ''}`];
  if (c.news.length) lines.push(`MAJOR EVENT TODAY (Paris time): ${c.news.map((n) => `${n.at}, ${n.title}`).join(' · ')}. Only the morning post may mention it, in one calm line, in plain words, never as a warning: Algoria simply stands aside around it, members have nothing to do.`);
  lines.push(c.lastSession ? `LAST SESSION (${longDate(c.lastSession.day)}): green, ${c.lastSession.trades} trades. Token {{YESTERDAY}} = its result.` : 'LAST SESSION: do not mention its result.');
  if (c.week) lines.push(`THIS WEEK SO FAR: green, ${c.week.trades} trades. Token {{WEEK}} = its result.`);
  if (c.webinar) lines.push(`LIVE WEBINAR: ${c.webinar}`);
  if (c.questions.length) lines.push(`QUESTIONS PEOPLE ASKED MATHIEU THIS WEEK (do not quote them, use them to know what worries people):\n- ${c.questions.slice(0, 25).join('\n- ')}`);
  if (c.recent.length) lines.push(`RECENT POSTS (never repeat their openings or structure):\n---\n${c.recent.join('\n---\n')}`);
  if (c.openings.length) lines.push(`OPENINGS USED IN THE LAST 14 DAYS (your first line must not look like any of them):\n- ${c.openings.slice(0, 60).map((o) => safeSlice(o, 160)).join('\n- ')}`);
  return lines.join('\n\n');
}

// ── LES GARDE-FOUS ────────────────────────────────────────────────────────────────────────────────────

const PROMISE = /guarantee|risk[- ]?free|passive income|get rich|easy money|financial freedom|you(?:'ll| will) (?:earn|make|profit)|double your|no risk|life[- ]changing|millionaire/i;
// l'argent à mettre (Mathieu, 15/10) : aucun de ces mots dans un post public, quel que soit le contexte
const MONEY_IN = /\b(deposit(?:s|ed|ing)?|fund(?:s|ed|ing)?\b(?! manager)|minimum|balance|top[- ]?up|invest(?:ed|ing|ment)?)\b|\bfund it\b|\bhow much\b/i;
const NEGATIVE = /\b(loss|losses|losing|lost|red day|drawdown|maintenance|paused?|bug|outage|down day)\b/i;

// L'AIR (26/10/2026, Mathieu, sur un How it works de 8 lignes collées : « aucune mise en page… on dirait un gros pavé
// de texte, ça donne pas envie de lire du tout »). Telegram ne met aucun espace entre deux lignes : l'air ne vient que
// des lignes VIDES. Un bloc = des lignes sans ligne vide entre elles. Une ligne « de texte » commence par une lettre, un
// chiffre, un guillemet ou une balise ; une puce (1️⃣, ✅, 📏…), l'en-tête (🔵💙) ou un jeton n'en est pas une.
const MAX_PROSE = 2; // lignes de texte par bloc (1 pour le bloc d'en-tête : l'en-tête et son accroche)
const MAX_BLOCK = 5; // lignes par bloc, puces comprises : une liste tient avec sa phrase d'intro
const isProse = (l: string) => !/^\s*[A-Z0-9#*]\uFE0F?\u20E3/.test(l) && /^\s*(?:<[bi]>)*["“'«A-Za-z0-9]/.test(l);
const blocksOf = (t: string) => t.split(/\n[ \t]*\n/).map((b) => b.split('\n').filter((l) => l.trim())).filter((b) => b.length);
const proseCap = (b: string[], first: boolean) => (first && !isProse(b[0]) ? 1 : MAX_PROSE);

function wallIssue(t: string): string | null {
  return blocksOf(t).some((b, i) => b.filter(isProse).length > proseCap(b, i === 0) || b.length > MAX_BLOCK)
    ? 'it is a wall of text: put an EMPTY line between the blocks, never more than 2 lines of text in a row, and an empty line right after the header and its hook'
    : null;
}

/** Le dernier recours, si le 2e essai est encore un pavé : on coupe les blocs trop longs, dans l'ordre des lignes. */
function airify(t: string): string {
  const out: string[][] = [];
  for (const b of blocksOf(t)) {
    let g: string[] = [];
    let prose = 0;
    for (const l of b) {
      const cap = out.length === 0 && g.length ? proseCap(g, true) : MAX_PROSE;
      // la phrase de risque et une ligne en italique ont toujours leur propre bloc
      const alone = l.includes(RISK) || /^\s*<i>/.test(l);
      if (g.length && (alone || (isProse(l) && prose + 1 > cap) || g.length >= MAX_BLOCK)) { out.push(g); g = []; prose = 0; }
      g.push(l);
      if (isProse(l)) prose++;
    }
    if (g.length) out.push(g);
  }
  return out.map((g) => g.join('\n')).join('\n\n');
}

type GuardOpts = { tokens: Record<string, string>; required?: string[]; allowNegative?: boolean; noButton?: boolean; allowedUsd?: number[]; allowedNumbers?: number[]; maxChars?: number; fixLayout?: boolean;
  /** le guide de ton (tone.ts) : refus des ouvertures sur le jour, des tournures usées, de plus de 2 emojis… (10/11/2026) */
  tone?: ToneContext;
  /** la phrase de risque gérée par le code : retirée si le modèle l'écrit, ajoutée en UNE ligne en italique seulement si
   *  le post montre un chiffre de résultat (un jeton de montant) (10/11/2026) */
  autoRisk?: boolean };

/** Les jetons qui portent un chiffre de résultat : leur présence appelle la phrase de risque. */
export const FIGURE_TOKENS = ['YESTERDAY', 'WEEK', 'RESULT', 'AMOUNTS'];
const RISK_ANY = /(?:<i>\s*)?Trading involves risk\.(?:\s*Past results don't guarantee future results\.)?(?:\s*<\/i>)?/gi;
/** Retire la phrase de risque d'un texte (le code la remet, une fois, s'il y a un chiffre). */
export const stripRisk = (t: string) => t.replace(RISK_ANY, '').replace(/\n{3,}/g, '\n\n').trim();
/** Le texte, plus la phrase de risque en une ligne en italique, seulement s'il montre un chiffre de résultat. */
export const withRisk = (t: string, hasFigure: boolean) => (hasFigure ? `${stripRisk(t)}\n\n<i>${RISK}</i>` : stripRisk(t));

/** Nettoie et contrôle un texte du modèle : le texte prêt, ou la raison du refus (renvoyée au modèle pour un 2e essai). */
export function check(raw: string, o: GuardOpts): { ok: true; text: string } | { ok: false; why: string } {
  // humanize : tiret long → virgule, gras markdown retiré ; puis l'espace de Mathieu avant ? et !, même collés à du gras
  let t = humanize(raw.replace(/\r/g, ''), true).replace(/([^\s?!])([?!]+)(?=<\/[bi]>)/g, '$1 $2');
  if (o.fixLayout) t = airify(t);
  if (/<(?!\/?(?:b|i)>)[^>]*>/i.test(t)) return { ok: false, why: 'only <b> and <i> tags are allowed' };
  if (o.autoRisk) t = stripRisk(t);
  const wall = wallIssue(t);
  if (wall) return { ok: false, why: wall };
  if (o.tone) { const why = toneIssue(t, o.tone); if (why) return { ok: false, why }; }
  if (/https?:\/\/|t\.me\/|\.tech\b|www\./i.test(t)) return { ok: false, why: 'no links in the text' };
  if (o.noButton && /👇|\b(?:tap|click|press)\s+(?:the\s+)?(?:button|below|here|link)\b|\bbutton below\b/i.test(t)) return { ok: false, why: 'there is no button under this post: never point below (no 👇, no "tap the button")' };
  if (PROMISE.test(t.replace(RISK, ''))) return { ok: false, why: 'it sounds like a promise of gains' };
  if (!o.allowNegative && NEGATIVE.test(t.replace(/stop[- ]?loss(?:es)?/gi, ''))) return { ok: false, why: 'negative words are not allowed in this public channel' };
  if (MONEY_IN.test(t)) return { ok: false, why: 'never talk about money to put in (deposit, fund, minimum, balance, invest): say create / connect your trading account' };
  for (const k of o.required ?? []) if (!t.includes(`{{${k}}}`)) return { ok: false, why: `the token {{${k}}} is missing` };
  // aucun montant écrit par le modèle, sauf les faits autorisés (200 $, 500 $…) ; aucun pourcentage
  const allowed = new Set((o.allowedUsd ?? []).map(String));
  for (const m of t.matchAll(/\$\s?([\d][\d,.]*)/g)) if (!allowed.has(m[1].replace(/,/g, ''))) return { ok: false, why: `you wrote the amount $${m[1]} yourself: use the tokens` };
  if (/\d\s?%/.test(t.replace(/\b100\s?%/g, ''))) return { ok: false, why: 'no percentages' };
  // LES NOMBRES : dans le bonjour et le récap, seulement ceux qu'on a donnés (nombre de trades, date). Les heures,
  // les numéros de membre, les tailles de lot et les puces 1️⃣ ne comptent pas.
  if (o.allowedNumbers) {
    const okN = new Set(o.allowedNumbers.map(String));
    const scrub = t.replace(/\{\{\w+\}\}/g, '').replace(/\b\d{1,2}[:h]\d{2}\b/g, '').replace(/#\d+/g, '').replace(/\b0\.(?:01|10|1)\b/g, '').replace(/\d\uFE0F?\u20E3/g, '').replace(/\b100\s?%/g, '');
    for (const m of scrub.matchAll(/\d+(?:[.,]\d+)?/g)) if (!okN.has(m[0])) return { ok: false, why: `the number ${m[0]} is not one of the figures you were given` };
  }
  const unknown = [...t.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((k) => !(k in o.tokens));
  if (unknown.length) return { ok: false, why: `unknown token {{${unknown[0]}}}` };
  const hasFigure = FIGURE_TOKENS.some((k) => k in o.tokens && o.tokens[k] !== `{{${k}}}` && t.includes(`{{${k}}}`));
  for (const [k, v] of Object.entries(o.tokens)) t = t.split(`{{${k}}}`).join(v);
  t = t.replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;');
  if (o.autoRisk) t = withRisk(t, hasFigure);
  // les lignes vides ne comptent pas : c'est l'air qu'on demande
  if (t.length > (o.maxChars ?? 700) || t.split('\n').filter((l) => l.trim()).length > 12) return { ok: false, why: 'too long' };
  return { ok: true, text: t.trim() };
}
export const guard = (raw: string, o: GuardOpts): string | null => { const r = check(raw, o); return r.ok ? r.text : null; };

// ── L'APPEL ───────────────────────────────────────────────────────────────────────────────────────────

async function ask(system: string, user: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await new Anthropic().messages.create({ model: CM_MODEL(), max_tokens: 1200, system: wellFormed(system), messages: [{ role: 'user', content: wellFormed(user) }] }, { timeout: 30_000, maxRetries: 0 });
    const out = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim();
    const j = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
    const text = (JSON.parse(j) as { text?: unknown }).text;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch (e) {
    console.error('[cm writer] échec:', (e as { message?: string })?.message ?? e);
    return null;
  }
}

/** Comme ask, mais renvoie l'objet JSON entier (le sondage). */
async function askJson(system: string, user: string): Promise<Record<string, unknown> | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await new Anthropic().messages.create({ model: CM_MODEL(), max_tokens: 600, system: wellFormed(system), messages: [{ role: 'user', content: wellFormed(user) }] }, { timeout: 30_000, maxRetries: 0 });
    const out = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim();
    return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as Record<string, unknown>;
  } catch (e) {
    console.error('[cm writer] échec:', (e as { message?: string })?.message ?? e);
    return null;
  }
}

export type TradeFacts = { direction: 'BUY' | 'SELL' | null; entry: string | null; exit: string | null; how: string; closedAt: string };

export type Brief =
  | { kind: 'backstage'; photo: boolean }
  | { kind: 'gold' }
  | { kind: 'qa' }
  | { kind: 'story' }
  | { kind: 'lesson'; card: string }
  // times : le bloc des heures du webinaire (6 fuseaux, lib/member/webinar.ts), écrit par le code à la place de {{TIMES}}
  | { kind: 'cta'; goal: string; reference: string; button: string; times?: string }
  | { kind: 'trade'; facts: TradeFacts }
  | { kind: 'recap'; recapKind: 'win' | 'record' | 'week' | 'quiet' | 'red'; trades: number; wins: number; liveMembers: number[]; weekLabel?: string }
  // anciens noms (plans d'avant le 10/11/2026, encore corrigeables par une réponse au message du plan)
  | { kind: 'morning' }
  | { kind: 'howto'; card: string };

const NO_BUTTON = 'There is NO button under this post: never point below, never say "tap", "click" or "link below".';
const BRIEFS: Record<Brief['kind'], (b: Brief) => string> = {
  // LES COULISSES (le matin, avec une vraie photo de Mathieu quand il y en a une)
  backstage: (b) => `Write a short BEHIND-THE-SCENES post from Mathieu's day, the first post of the day. 2 or 3 short blocks (4 lines of text at most).
${(b as Extract<Brief, { kind: 'backstage' }>).photo ? 'It goes out with a real photo of Mathieu that you cannot see: never describe the photo, never say "this photo" or "this picture".' : 'There is no photo: text only.'}
One small true thing about building and running Algoria (the app, the AI, the community, answering people's messages), or a light human line about the day ahead. Only what the knowledge or the context gives you: never invent a place, a person, a meeting or an event. If the LAST SESSION result is given you may mention it once with the token {{YESTERDAY}}, but it is not required. If a MAJOR EVENT is given, you may add one calm line about it.
${NO_BUTTON} No promise about today's results.`,
  // AVIS SUR L'OR, SANS PRÉVISION (écrit la veille : rien qui serait faux le lendemain)
  gold: () => `Write a short post with Mathieu's personal take on GOLD as a market, in plain words for people who are not traders. 2 or 3 short blocks (4 lines of text at most).
It is written the day before it is posted: say nothing about today's or tomorrow's price. NO forecast: never where gold will go, no target, no level, no "should", no "expect". Pick ONE angle that the knowledge supports (why Algoria trades gold, why it stands aside around big news, why some days have no trade, why gold moves a lot during the day), vary from the recent posts.
${NO_BUTTON}`,
  // UNE VRAIE QUESTION DE MEMBRE
  qa: () => `Write a post that answers ONE question people really asked Mathieu this week (QUESTIONS PEOPLE ASKED MATHIEU THIS WEEK): how Algoria works, the app, the broker, the trading account, the setup, the copy. Never a question about results, profits, the last days, a loss, a complaint or one person's own account. If none fits, take a classic beginner question that the knowledge answers.
Say naturally that someone asked it (vary how), rewrite the question in your own words (never a name, never their exact message), then answer it in 2 or 3 short blocks (5 lines of text at most), using ONLY facts from Mathieu's knowledge, like answering a friend.
${NO_BUTTON} It informs, it does not sell.`,
  // UNE HISTOIRE PERSO
  story: () => `Write a short PERSONAL post from Mathieu: a moment or a reason behind Algoria (why he built it, what he learned building it, what he cares about with the community). 3 short blocks at most (5 lines of text at most).
ONLY from what MATHIEU'S KNOWLEDGE or LESSONS say about him and Algoria. Never invent a date, a place, a person, a number or an event. If the knowledge does not give a story, write a simple true reflection instead.
${NO_BUTTON} It does not sell.`,
  // LA PÉDAGOGIE REFORMULÉE (les anciennes fiches « How it works », sans leur en-tête)
  lesson: (b) => `Explain ONE thing about how Algoria works, in Mathieu's words, as if a friend asked him. No header. Rewrite this fact card completely (new first line, new order), keep exactly its facts, add no other fact. 2 or 3 short blocks (5 lines of text at most).
${NO_BUTTON} It informs, it does not sell.
FACT CARD:
${stripRisk((b as Extract<Brief, { kind: 'lesson' }>).card)}`,
  cta: (b) => {
    const x = b as Extract<Brief, { kind: 'cta' }>;
    // la version de référence porte le jeton à la place des heures : le modèle le recopie au lieu de réécrire les heures
    const reference = x.times ? x.reference.split(x.times).join('{{TIMES}}') : x.reference;
    return `Write a short post that invites people to act. 2 or 3 short blocks (4 lines of text at most${x.times ? ', not counting the {{TIMES}} block' : ''}). Goal: ${x.goal}
The button "${x.button}" is added under the post by the system. You may refer to it once, naturally, in your own words, but never "tap below" and never end with 👇. It must read like Mathieu, not like an ad.${x.times ? '\nPut the token {{TIMES}} exactly once, alone in its own block (an empty line before and after): the system replaces it with the time in 6 time zones. Never write an hour, a weekday for another country or a time zone yourself.' : ''}
Facts you may use are in this reference version (do not copy its wording, its opening or its emojis):
${stripRisk(reference)}`;
  },
  // LE TRADE COMMENTÉ (écrit à l'heure de la publication, sur un vrai trade clos)
  trade: (b) => {
    const f = (b as Extract<Brief, { kind: 'trade' }>).facts;
    return `Write a short first-person comment by Mathieu on a REAL trade that Algoria just closed and that was copied automatically on members' accounts. 2 or 3 short blocks (4 lines of text at most).
FACTS (the only ones you may use): gold ${f.direction ?? ''}${f.entry && f.exit ? `, from ${f.entry} to ${f.exit}` : ''}, ${f.how}, closed at ${f.closedAt} Paris time.
Put the token {{RESULT}} (its result at 0.10 and 0.01 lot) on its own line, exactly once; never write an amount yourself. Write it freely, the way Mathieu would comment it to friends (what the AI did, that nobody had to touch anything); never "Closed by Algoria AI", never a template.
${NO_BUTTON}`;
  },
  recap: (b) => {
    const x = b as Extract<Brief, { kind: 'recap' }>;
    const live = x.liveMembers.length ? `New members who went live today (you may welcome them, exactly as written): ${x.liveMembers.slice(0, 3).map((n) => `Member #${n}`).join(', ')}.` : 'No new member went live today: do not mention it.';
    const head: Record<string, string> = {
      win: `First line: 🔵💙 DAY RECAP. Algoria closed ${x.trades} trade${x.trades > 1 ? 's' : ''} on gold today (${x.wins} won). Put the token {{AMOUNTS}} on its own line, exactly once.`,
      record: `First line: 🔵💙 WHAT A DAY 🥇. Best day of the month so far, ${x.trades} trades. Put the token {{AMOUNTS}} on its own line, exactly once.`,
      week: `First line: 🔵💙 WEEK RECAP${x.weekLabel ? ` · ${x.weekLabel}` : ''}. The week is green, ${x.trades} trades this week. Put the token {{AMOUNTS}} on its own line, exactly once (it is the week's result). Wish a good weekend: the AI is back Monday.`,
      quiet: 'First line: 🔵💙 DAY RECAP. No clean setup on gold today, so no trade: that is the plan, Algoria never forces a trade. No amount, no token.',
      // historique en maintenance pour les prospects : pas de « tout est dans l'app » (lib/member/historyMaintenance.ts)
      red: `First line: 🔵💙 DAY RECAP. Today is not a day to show figures: say Algoria managed today's gold session, ${x.trades} trades${HISTORY_MAINTENANCE ? '. Never say that the trades or the history can be seen in the app or on a track record' : ', and that every trade is in the app, trade by trade, the real copied account'}. No amount, no token, no word like loss or red.`,
    };
    return `Write tonight's RECAP post, shorter and more human than usual: 3 or 4 short blocks (5 lines of text at most), Mathieu's voice.
${head[x.recapKind]}
${live}
Do not write the app link nor the risk sentence: the system adds them.`;
  },
  morning: () => BRIEFS.backstage({ kind: 'backstage', photo: true }),
  howto: (b) => BRIEFS.lesson({ kind: 'lesson', card: (b as Extract<Brief, { kind: 'howto' }>).card }),
};

/** Remplace le jeton {{TIMES}} (une seule fois, garanti par `required`) par le bloc des 6 fuseaux, comme un bloc à part. */
export const withTimes = (text: string, times: string): string =>
  text.replace(/[ \t]*\{\{TIMES\}\}[ \t]*/, `\n${times}\n`).replace(/\n{3,}/g, '\n\n').trim();

/** Les options du garde-fou pour un brief, avec le guide de ton du jour. */
function optsFor(c: DayContext, b: Brief, tokens: Record<string, string>, extraOpenings: string[] = []): GuardOpts {
  const dateNums = [Number(c.day.slice(8, 10)), Number(c.day.slice(0, 4))];
  if (b.kind === 'recap') {
    return { tokens: { AMOUNTS: '{{AMOUNTS}}' }, required: ['win', 'record', 'week'].includes(b.recapKind) ? ['AMOUNTS'] : [], allowedNumbers: [b.trades, b.wins, ...dateNums], maxChars: 700,
      // le récap garde son en-tête 🔵💙 (hors refonte) ; les tournures usées et les emojis comptent quand même
      tone: { allowHeader: true, rationedUsed: c.rationedUsed, hasButton: false } };
  }
  const isCta = b.kind === 'cta';
  return {
    tokens,
    required: b.kind === 'trade' ? ['RESULT'] : [],
    allowNegative: b.kind === 'lesson' || b.kind === 'howto',
    noButton: !isCta,
    allowedUsd: [],
    autoRisk: true,
    tone: { openings: [...c.openings, ...extraOpenings], rationedUsed: c.rationedUsed, hasButton: isCta },
    // les chiffres du webinaire (sa date, ses heures, ses 45 minutes) sont des chiffres donnés : le bonjour qui l'annonce
    // ne doit pas être refusé pour « 28 » ou « 45 » (27/10/2026, veille du premier webinaire)
    ...(b.kind === 'backstage' || b.kind === 'morning' || b.kind === 'gold' || b.kind === 'story'
      ? { allowedNumbers: [c.lastSession?.trades ?? -1, c.week?.trades ?? -1, ...dateNums, ...(c.webinar?.match(/\d+/g) ?? []).map(Number)], maxChars: 560 }
      : { maxChars: 760 }),
  };
}

/** Écrit un post. Renvoie null si le modèle est absent ou si le texte ne passe pas les garde-fous après deux essais :
 *  l'appelant SAUTE alors le post (10/11/2026 : plus de texte de banque en secours, il sonnait robot), sauf les annonces
 *  du webinaire qui gardent leur texte. `openings` = premières lignes des posts du plan déjà écrits ce jour-là. */
export async function writePost(c: DayContext, b: Brief, extra?: { instruction?: string; previous?: string; openings?: string[]; result?: string }): Promise<string | null> {
  const tokens: Record<string, string> = {};
  if (c.lastSession) tokens.YESTERDAY = amountsLine(c.lastSession.net10);
  if (c.week) tokens.WEEK = amountsLine(c.week.net10);
  if (extra?.result) tokens.RESULT = extra.result;
  // 🌍 les heures du webinaire (6 fuseaux) : jeton {{TIMES}} obligatoire, remplacé par le code APRÈS les garde-fous
  // (comme {{AMOUNTS}} dans le récap) ; le bloc vient d'Intl, il ne compte donc pas dans la longueur écrite par le modèle
  const times = b.kind === 'cta' && b.times ? b.times : null;
  const previous = extra?.previous && times ? extra.previous.split(times).join('{{TIMES}}') : extra?.previous;
  const user = `${contextBlock(c)}\n\nTASK:\n${BRIEFS[b.kind](b)}${previous ? `\n\nTHE CURRENT VERSION OF THIS POST:\n${previous}` : ''}${extra?.instruction ? `\n\nMATHIEU ASKS (in French) FOR THIS CHANGE, apply it while keeping the rules:\n${extra.instruction}` : ''}`;
  // une correction de Mathieu réécrit SON post : sa propre ouverture ne compte pas comme une répétition
  const own = extra?.previous ? firstLine(extra.previous) : '';
  const opts = optsFor(c, b, tokens, extra?.openings ?? []);
  if (times) { opts.tokens = { ...opts.tokens, TIMES: '{{TIMES}}' }; opts.required = [...(opts.required ?? []), 'TIMES']; }
  if (own && opts.tone?.openings) opts.tone.openings = opts.tone.openings.filter((o) => o !== own);
  const sys = await systemPrompt();
  // deux essais : un texte refusé par les garde-fous repart au modèle avec la raison du refus
  let prompt = user;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask(sys, prompt);
    if (!raw) return null;
    // au 2e essai, un texte encore en pavé est aéré par le code plutôt que perdu (airify)
    // le récap : la ligne « 👉 app… » est remise par le code (recap.ts, withAppLine), on retire celle du modèle
    const r = check(b.kind === 'recap' ? stripAppLines(raw) : raw, { ...opts, fixLayout: attempt === 1 });
    if (r.ok) return times ? withTimes(r.text, times) : r.text;
    console.error(`[cm writer] ${b.kind} refusé (${r.why})`);
    prompt = `${user}\n\nYOUR PREVIOUS DRAFT WAS REJECTED BECAUSE ${r.why.toUpperCase()}. Write it again and fix that.\nPrevious draft:\n${raw}`;
  }
  return null;
}

// ── LE SONDAGE TELEGRAM NATIF (10/11/2026) ────────────────────────────────────────────────────────────

export type Poll = { question: string; options: string[] };

/** Contrôle un sondage : la question et 2 à 4 réponses courtes, mêmes interdits que les posts. */
export function checkPoll(p: unknown, tone: ToneContext = {}): { ok: true; poll: Poll } | { ok: false; why: string } {
  const x = p as { question?: unknown; options?: unknown };
  const question = humanize(String(x?.question ?? '').replace(/<[^>]+>/g, ''), true).trim();
  const options = Array.isArray(x?.options) ? x.options.map((o) => humanize(String(o ?? '').replace(/<[^>]+>/g, ''), true).trim()).filter(Boolean) : [];
  if (!question || question.length > 255) return { ok: false, why: 'the question must be 1 to 255 characters' };
  if (options.length < 2 || options.length > 4) return { ok: false, why: 'give 2 to 4 options' };
  if (options.some((o) => o.length > 80)) return { ok: false, why: 'each option must be under 80 characters' };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { ok: false, why: 'two options are the same' };
  const all = [question, ...options].join('\n');
  if (/https?:\/\/|t\.me\/|www\./i.test(all)) return { ok: false, why: 'no links' };
  if (PROMISE.test(all)) return { ok: false, why: 'it sounds like a promise of gains' };
  if (NEGATIVE.test(all)) return { ok: false, why: 'negative words are not allowed in this public channel' };
  if (MONEY_IN.test(all)) return { ok: false, why: 'never talk about money to put in' };
  if (/\$|\d\s?%/.test(all)) return { ok: false, why: 'no amounts, no percentages' };
  const why = toneIssue(question, { ...tone, hasButton: false });
  if (why) return { ok: false, why };
  return { ok: true, poll: { question, options } };
}

/** Écrit le sondage du jour (une vraie question à l'audience, pas un quiz sur les gains). null → le post saute. */
export async function writePoll(c: DayContext, extraOpenings: string[] = []): Promise<Poll | null> {
  const task = `Write ONE native Telegram poll for the channel, from Mathieu. A genuine, light question to the audience about THEM (where they are in their setup, what they want to understand first, how they follow the channel, what they would like Mathieu to explain in a video), never about results, gains, losses, money or amounts, never a forecast on gold.
OUTPUT: only a JSON object {"question": "...", "options": ["...", "..."]} with 2 to 4 short options (under 80 characters each, at most one emoji in the whole poll). No HTML.`;
  const tone: ToneContext = { openings: [...c.openings, ...extraOpenings], rationedUsed: c.rationedUsed };
  const sys = await systemPrompt();
  let prompt = `${contextBlock(c)}\n\nTASK:\n${task}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askJson(sys, prompt);
    if (!raw) return null;
    const r = checkPoll(raw, tone);
    if (r.ok) return r.poll;
    console.error(`[cm writer] poll refusé (${r.why})`);
    prompt = `${contextBlock(c)}\n\nTASK:\n${task}\n\nYOUR PREVIOUS POLL WAS REJECTED BECAUSE ${r.why.toUpperCase()}. Write it again and fix that.`;
  }
  return null;
}

export { RISK as CM_RISK };
export { stripAppLines };
