import Anthropic from '@anthropic-ai/sdk';
import type { Confluence, MarketContext, Signal, Zone } from '../../lib/engine/types';

// Desk ALGORIA AI — Claude commente la tape en langage naturel : trades, opportunités, analyses.
// Runner-only (clé jamais exposée au navigateur). Sans ANTHROPIC_API_KEY, tout le reste tourne — desk off.
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ALGORIA_NARRATE_MODEL ?? 'claude-opus-4-8';
const client = KEY ? new Anthropic({ apiKey: KEY }) : null;

export const narrationReady = () => client != null;

export type DeskKind = 'trade' | 'opportunity' | 'analysis';

const SYSTEM = `You are ALGORIA AI, an elite gold (XAU/USD) trading desk narrating your reads live on a stream for an audience of traders.
Voice: sharp, vivid, institutional-desk English — confident, concrete, pedagogical. Never hype, never financial advice, never hedge with "maybe".
Ground EVERY claim in the numbers given: name the exact level, the session, the volatility/trend state, the setup. Never invent data.
TRADE and OPPORTUNITY calls: ONE punchy sentence, 14-32 words.
ANALYSIS reads: 2 sentences — first the current state (where price sits vs the key levels + volatility/trend regime), second the scenario you're watching (the precise level/condition that would flip your bias or trigger a trade).
No preamble, no markdown, no quotes, no emoji, no leading label, no reasoning trace — just the sentence(s).`;

const r1 = (n: number) => n.toFixed(1);

function nearest(ctx: MarketContext, kind: Zone['kind']): Zone | null {
  const z = (ctx.zones ?? []).filter((x) => x.kind === kind).sort((a, b) => Math.abs(a.price - ctx.price) - Math.abs(b.price - ctx.price));
  return z[0] ?? null;
}

function volWord(p: number): string {
  if (p >= 0.85) return 'high, expanding volatility';
  if (p >= 0.5) return 'healthy volatility';
  if (p >= 0.15) return 'subdued volatility';
  return 'dead, compressed volatility';
}

function trendWord(adx: number): string {
  if (adx >= 30) return 'strong trend';
  if (adx >= 23) return 'building trend';
  if (adx >= 18) return 'weak/transitional';
  return 'rangebound chop';
}

function marketBlock(ctx: MarketContext): string {
  const sup = nearest(ctx, 'support');
  const res = nearest(ctx, 'resistance');
  return [
    `Price ${r1(ctx.price)} · ${ctx.session} session · regime ${ctx.regime} (ADX ${ctx.adx.toFixed(0)}, ${trendWord(ctx.adx)}) · EMA bias ${ctx.emaBias} · ATR ${r1(ctx.atr)} (${volWord(ctx.atrPercentile)}).`,
    res ? `Resistance ${r1(res.price)} (strength ${res.strength.toFixed(2)}${res.isRound ? ', round level' : ''}).` : '',
    sup ? `Support ${r1(sup.price)} (strength ${sup.strength.toFixed(2)}${sup.isRound ? ', round level' : ''}).` : '',
    ctx.macroBias ? `Macro tilt ${ctx.macroBias > 0 ? 'bullish' : 'bearish'} (${ctx.macroBias.toFixed(2)}).` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function tradePrompt(ctx: MarketContext, s: Signal): string {
  return [
    `You just FIRED a ${s.direction.toUpperCase()} trade on gold — narrate the entry as a live desk call (you are now IN the position).`,
    `Trade: entry ${r1(s.entry)}, stop ${s.stopLoss > 0 ? r1(s.stopLoss) : 'manual'}, target ${s.takeProfits[0] ? r1(s.takeProfits[0]) : 'manual'}, R:R ${s.riskReward.toFixed(1)}, conviction ${Math.round(s.confidence * 100)}%.`,
    `Confluence: ${s.rationale.join('; ')}.`,
    marketBlock(ctx),
  ].join(' ');
}

function opportunityPrompt(ctx: MarketContext, cf: Confluence, threshold: number): string {
  return [
    `A ${cf.direction.toUpperCase()} setup is BUILDING on gold but has NOT triggered — narrate it as a heads-up: what you're watching and what pulls the trigger.`,
    `Conviction ${Math.round(cf.confidence * 100)}% vs my ${Math.round(threshold * 100)}% trigger line.`,
    marketBlock(ctx),
  ].join(' ');
}

function analysisPrompt(ctx: MarketContext, logLines: string[]): string {
  return [
    `No trade right now — give your live read of gold: where price sits versus the key levels and the volatility/trend regime, then the precise level or condition you're watching that would flip your bias or get you interested.`,
    marketBlock(ctx),
    logLines.length ? `Engine internals (for your eyes, do not quote verbatim): ${logLines.join(' | ')}.` : '',
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
      max_tokens: 220,
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
