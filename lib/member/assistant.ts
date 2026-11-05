// L'ASSISTANT DE L'APP — l'onglet central qui RÉPOND (02/11/2026). Server-only.
//
// Mathieu (02/11) : « un vrai assistant IA, à qui on puisse parler, le ChatGPT du trading directement sur l'app ».
// Décisions du même jour :
//   · modèle ALGORIA_ASSISTANT_MODEL, claude-sonnet-5-5 par défaut — JAMAIS de `temperature` (sonnet-5-5 la refuse) ;
//   · seuls les membres LIVE écrivent (10 messages/jour, compteur en base, remise à zéro 00:00 UTC, crédit rendu si
//     le modèle échoue ou si un garde-fou bloque) ; les autres gardent les questions prêtes (leçons de l'Academy) ;
//   · les admins sans limite ; tout le service derrière ALGORIA_ASSISTANT_OPEN (admins | live, admins par défaut) ;
//   · un plafond GLOBAL par jour (ALGORIA_ASSISTANT_DAILY_CAP, 1500 par défaut) : la facture ne peut pas déraper ;
//   · le contexte = knowledge + track record + webinaire, PAS la `memory` (elle cite des membres) ;
//   · l'incident d'octobre n'est jamais amené par l'assistant, seulement reconnu si on lui en parle, sans chiffre.
//
// LES GARDE-FOUS : exactement ceux du support (replyTextIssue, extraits d'assessModelOutput sans en relâcher un),
// plus un refus propre au chat : parler de l'incident ou d'une perte alors que le membre n'en a rien dit. Réponse
// complète → contrôle → 2e essai avec l'indice → texte de secours. Rien de non contrôlé n'atteint l'écran : l'effet
// « machine à écrire » est fait côté client, sur le texte validé. Le modèle n'a AUCUN outil.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { buildAssistantSystem, fixOldDomain, humanize, replyTextIssue, systemParam, withPastDisclaimer } from './replyDraft';
import { INCIDENT_TALK } from './incident';
import { getAgentDocMeta } from './agentDocs';
import { trackFacts } from './trackFacts';
import { webinarFacts } from './webinar';

export const ASSISTANT_MODEL = () => process.env.ALGORIA_ASSISTANT_MODEL ?? 'claude-sonnet-5-5';
export const DAILY_LIMIT = 10;
export const GLOBAL_DAILY_CAP = () => {
  const n = Number(process.env.ALGORIA_ASSISTANT_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1500;
};
/** Qui peut écrire : 'admins' (phase 1, défaut) ou 'live' (tous les membres live + admins). */
export const OPEN_TO = (): 'admins' | 'live' => (process.env.ALGORIA_ASSISTANT_OPEN === 'live' ? 'live' : 'admins');
export const MAX_QUESTION = 1000;
export const HISTORY_TURNS = 8;

export type Access = { canChat: boolean; unlimited: boolean; reason: 'admin' | 'live' | 'not_live' | 'closed' };
export function accessFor(o: { admin: boolean; status: string | null | undefined; openTo?: 'admins' | 'live' }): Access {
  if (o.admin) return { canChat: true, unlimited: true, reason: 'admin' };
  const open = o.openTo ?? OPEN_TO();
  if (open === 'admins') return { canChat: false, unlimited: false, reason: 'closed' };
  return o.status === 'live' ? { canChat: true, unlimited: false, reason: 'live' } : { canChat: false, unlimited: false, reason: 'not_live' };
}

/** Le texte de secours : quand les deux essais sont refusés, rien d'inventé, la porte vers Mathieu. */
export const FALLBACK = "I'd rather not give you a half-right answer on this one. Mathieu answers personally on Telegram: @mathieu_algoria.";

// ── LE REFUS PROPRE AU CHAT : l'incident amené sans qu'on le demande (02/11/2026, Mathieu : « si on lui en parle pas
// il en parle pas, ça sert à rien de faire peur au nouveau client »).
const LOSS_OUT = /\b(?:incident|21-22 october|losses?|lost|drawdown|what happened|previous engine|rebuilt|safeguards?)\b/i;
const LOSS_ASKED = /\b(?:loss|losses|lost|lose|losing|drawdown|october|incident|happened|safe|risk|risky|scam|trust|results?|performance|track ?record|perdu|perte)\b/i;
export function proactiveLossIssue(out: string, userText: string): string | null {
  if (!LOSS_OUT.test(out) && !INCIDENT_TALK.test(out)) return null;
  return INCIDENT_TALK.test(userText) || LOSS_ASKED.test(userText) ? null : "parle de l'incident sans qu'on le demande";
}

/** Le contrôle complet d'une réponse de l'assistant : nettoyage, puis les garde-fous du support, puis ceux du chat. */
export function assessAssistantText(raw: string, o: { sys: string; userText: string; holdResults: boolean; knowledge: string | null; knownPct: string[]; sentBefore: string[]; stopReason?: string | null; now?: number }): { text: string | null; issue: string | null } {
  if (o.stopReason === 'refusal') return { text: null, issue: 'modèle a refusé' };
  if (o.stopReason === 'max_tokens') return { text: null, issue: 'réponse coupée (max_tokens)' };
  const out = withPastDisclaimer(fixOldDomain(humanize(raw.trim().replace(/^["“«]\s*|\s*["”»]$/g, ''), false)));
  const issue = replyTextIssue(out, { biz: false, sys: o.sys, userText: o.userText, holdResults: o.holdResults, knowledge: o.knowledge, knownPct: o.knownPct, sentBefore: o.sentBefore, now: o.now })
    ?? proactiveLossIssue(out, o.userText);
  return issue ? { text: null, issue } : { text: out, issue: null };
}

export interface AssistantTurn { role: 'user' | 'assistant'; content: string }
export interface AssistantResult {
  text: string;
  ok: boolean; // false = texte de secours (le crédit est rendu)
  issue: string | null;
  retried: boolean;
  model: string;
  promptHash: string;
  knowledgeHash: string | null;
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number };
}

export async function askAssistant(i: { question: string; history: AssistantTurn[]; status: string | null; locale?: string | null }): Promise<AssistantResult> {
  const model = ASSISTANT_MODEL();
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const [kMeta, trackNow, webinar] = await Promise.all([
    getAgentDocMeta('knowledge'),
    trackFacts().catch(() => null),
    (async () => { const { sdb } = await import('./server'); return webinarFacts(sdb()).catch(() => null); })(),
  ]);
  const built = buildAssistantSystem({ locale: i.locale, knowledge: kMeta.text, trackNow, webinar, status: i.status });
  const promptHash = createHash('sha256').update(built.system).digest('hex').slice(0, 12);
  const base = { model, promptHash, knowledgeHash: kMeta.hash, usage };
  if (!process.env.ANTHROPIC_API_KEY) return { ...base, text: FALLBACK, ok: false, issue: 'clé du modèle absente', retried: false };
  const client = new Anthropic({ timeout: 25_000, maxRetries: 0 });
  const history = i.history.slice(-HISTORY_TURNS * 2).map((t) => ({ role: t.role, content: t.content.slice(0, 1500) }));
  // l'API veut un premier tour « user » et une alternance stricte
  while (history.length && history[0].role !== 'user') history.shift();
  const sentBefore = history.filter((t) => t.role === 'assistant').map((t) => t.content);
  let lastIssue: string | null = null;
  for (let n = 0; n < 2; n++) {
    const hint = lastIssue ? `\n\n(Your previous draft was rejected by a safety check: ${lastIssue}. Write a new answer that avoids it.)` : '';
    try {
      // PAS de `temperature` : claude-sonnet-5-5 la refuse (400), voir le hotfix du 27/10 dans replyDraft.ts.
      const res = await client.messages.create({
        model,
        max_tokens: 900,
        system: systemParam(built.blocks), // socle en cache 1 h, track record et webinaire après (05/11/2026)
        messages: [...history, { role: 'user', content: `${i.question}${hint}` }],
      });
      const u = res.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
      usage.input += u.input_tokens ?? 0;
      usage.output += u.output_tokens ?? 0;
      usage.cacheRead += u.cache_read_input_tokens ?? 0;
      usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
      const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
      const judged = assessAssistantText(raw, { sys: built.system, userText: i.question, holdResults: built.policy !== 'open', knowledge: built.knowledge, knownPct: built.knownPct, sentBefore, stopReason: res.stop_reason });
      if (judged.text) return { ...base, text: judged.text, ok: true, issue: null, retried: n > 0 };
      lastIssue = judged.issue;
    } catch (e) {
      lastIssue = `modèle indisponible (${String((e as { message?: string })?.message ?? e).slice(0, 80)})`;
    }
  }
  return { ...base, text: FALLBACK, ok: false, issue: lastIssue, retried: true };
}
