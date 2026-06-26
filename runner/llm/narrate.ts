import Anthropic from '@anthropic-ai/sdk';
import type { Confluence, MarketContext, Signal } from '../../lib/engine/types';

// Desk ALGORIA AI — Claude commente la tape en langage naturel : trades, opportunités en formation, analyses.
// Runner-only (clé jamais exposée au navigateur). Sans ANTHROPIC_API_KEY, tout le reste tourne — desk off.
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ALGORIA_NARRATE_MODEL ?? 'claude-opus-4-8';
const client = KEY ? new Anthropic({ apiKey: KEY }) : null;

export const narrationReady = () => client != null;

export type DeskKind = 'trade' | 'opportunity' | 'analysis';

const SYSTEM = `You are ALGORIA AI, an elite gold (XAU/USD) trading desk narrating your reads live on a stream for an audience.
Voice: sharp, vivid, institutional-desk English — confident, concrete, never hype, never financial advice.
Output ONE sentence, 14-34 words. Present tense. No preamble, no markdown, no quotes, no emoji, no leading label, no reasoning — just the sentence.
Ground every claim in the numbers you are given (name the level, the session, the setup). Never invent data.`;

const r1 = (n: number) => n.toFixed(1);

function nearestZone(ctx: MarketContext) {
  if (!ctx.zones?.length) return null;
  return [...ctx.zones].sort((a, b) => Math.abs(a.price - ctx.price) - Math.abs(b.price - ctx.price))[0];
}

function tradePrompt(ctx: MarketContext, s: Signal): string {
  return [
    `You just FIRED a ${s.direction.toUpperCase()} trade on gold — narrate the entry as a live desk call (you are now IN the position).`,
    `Market: price ${r1(ctx.price)}, ${ctx.session} session, ${ctx.regime} regime, EMA bias ${ctx.emaBias}.`,
    `Trade: entry ${r1(s.entry)}, stop ${r1(s.stopLoss)}, target ${r1(s.takeProfits[0])}, R:R ${s.riskReward.toFixed(1)}, conviction ${Math.round(s.confidence * 100)}%.`,
    `Confluence behind it: ${s.rationale.join('; ')}.`,
  ].join(' ');
}

function opportunityPrompt(ctx: MarketContext, cf: Confluence, threshold: number): string {
  const z = nearestZone(ctx);
  return [
    `A ${cf.direction.toUpperCase()} setup is BUILDING on gold but has NOT triggered yet — narrate it as a heads-up: what you are watching and what would pull the trigger.`,
    `Market: price ${r1(ctx.price)}, ${ctx.session} session, ${ctx.regime} regime, EMA bias ${ctx.emaBias}, ADX ${ctx.adx.toFixed(0)}.`,
    `Conviction ${Math.round(cf.confidence * 100)}% vs my ${Math.round(threshold * 100)}% trigger line.`,
    z ? `Key level: ${z.kind} at ${r1(z.price)}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function analysisPrompt(ctx: MarketContext, logLines: string[]): string {
  const z = nearestZone(ctx);
  return [
    `No trade right now — give a one-line read of what gold is doing and where you would get interested.`,
    `Market: price ${r1(ctx.price)}, ${ctx.session} session, ${ctx.regime} regime, EMA bias ${ctx.emaBias}, ADX ${ctx.adx.toFixed(0)}.`,
    z ? `Nearest structure: ${z.kind} at ${r1(z.price)}.` : '',
    logLines.length ? `Engine internals: ${logLines.join(' | ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface NarrateInput {
  kind: DeskKind;
  ctx: MarketContext;
  signal?: Signal | null;
  confluence?: Confluence | null;
  threshold?: number;
  logLines?: string[];
}

/** Produit une ligne de desk. Renvoie null si désactivé ou en cas d'échec. */
export async function narrate(input: NarrateInput): Promise<string | null> {
  if (!client) return null;
  const prompt =
    input.kind === 'trade' && input.signal
      ? tradePrompt(input.ctx, input.signal)
      : input.kind === 'opportunity' && input.confluence
        ? opportunityPrompt(input.ctx, input.confluence, input.threshold ?? 0.72)
        : analysisPrompt(input.ctx, input.logLines ?? []);
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 160,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return text || null;
  } catch (e) {
    console.error('[algoria] narration failed:', (e as { message?: string })?.message ?? e);
    return null;
  }
}
