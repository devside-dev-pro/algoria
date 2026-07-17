import Anthropic from '@anthropic-ai/sdk';
import type { Confluence, Direction, MarketContext, Session, Signal, Zone } from '../../lib/engine/types';

// Desk ALGORIA AI — Claude ajoute UNE clause d'interprétation ; l'UI affiche déjà tous les CHIFFRES.
// Runner-only (clé jamais exposée au navigateur). Sans ANTHROPIC_API_KEY, le desk tourne quand même
// (100% structuré, sans la clause). deskMeta() construit les champs structurés lus par components/Desk.tsx.
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ALGORIA_NARRATE_MODEL ?? 'claude-opus-4-8';
const client = KEY ? new Anthropic({ apiKey: KEY }) : null;

export const narrationReady = () => client != null;

export type DeskKind = 'trade' | 'opportunity' | 'analysis' | 'recap';

// Le LLM ne réécrit PLUS les nombres (l'UI les rend) — juste la clause que les chiffres ne montrent pas.
const SYSTEM = `You are ALGORIA AI, an elite gold/Bitcoin trading desk narrating live for traders. The UI already renders — from structured fields — the direction, kind, every price/level, ADX, EMA, ATR, session, R:R, conviction and the trigger. Your ONLY job is the ONE short clause of interpretation those numbers cannot show: intent, tension, or what would change your mind.
HARD RULES: never restate a number, price, level, %, session or indicator value; no "I", no "price is", no hedging/"maybe", no markdown, no quotes, no emoji, no leading label, no ending period. Start lowercase. Sharp institutional-desk voice, concrete verbs, zero hype. If there is nothing to add beyond the numbers, say what you are WAITING for.`;

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

// Bloc de GROUNDING : le modèle raisonne sur les vrais chiffres, mais il lui est interdit de les recracher.
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
    `You just FIRED a ${s.direction.toUpperCase()} trade. In ONE clause (max 13 words), present tense, framed as already IN it, state the THESIS not the mechanics.`,
    `Confluence drivers: ${s.rationale.join('; ')}.`,
    `Grounding (do NOT restate any of this): ${marketBlock(ctx)}`,
  ].join(' ');
}

function opportunityPrompt(ctx: MarketContext, cf: Confluence, gated?: boolean): string {
  return [
    gated
      ? `A ${cf.direction.toUpperCase()} setup is building BUT your EMA trend filter BLOCKS it (trend not aligned — you will NOT chase). ONE clause (max 13 words): own the discipline — what alignment you demand before touching it.`
      : `A ${cf.direction.toUpperCase()} setup is BUILDING but has NOT triggered. ONE clause (max 13 words): the tension, or precisely what you're waiting for. Do NOT name the trigger level (the UI shows it).`,
    `Grounding (do NOT restate): ${marketBlock(ctx)}`,
  ].join(' ');
}

function analysisPrompt(ctx: MarketContext, logLines: string[], priceAction?: string): string {
  return [
    `No trade right now. ONE clause (max 16 words): the standoff, or the exact bias-flip you're watching, in plain trader language. No level names. React to the RECENT bars, not generic waiting.`,
    priceAction ? `Recent tape: ${priceAction}.` : '',
    `Grounding (do NOT restate): ${marketBlock(ctx)}`,
    logLines.length ? `Engine internals (for your eyes, never quote): ${logLines.join(' | ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// Filet de sécurité : borne dure la longueur + nettoie label/ponctuation même si le modèle déborde.
// La coupe est INTELLIGENTE (retour live : « waiting for a » coupé net en plein élan fait amateur) :
// on recule à la dernière frontière naturelle (virgule/tiret) puis on épluche les mots-outils pendouillants.
function clampClause(raw: string, maxWords: number): string {
  let t = raw.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s*[.]+\s*$/, '');
  t = t.replace(/^[A-Z][A-Z /]{2,}:\s*/, ''); // retire un label capitalisé en tête ("WATCH: ")
  const w = t.split(/\s+/).filter(Boolean);
  if (w.length > maxWords) {
    t = w.slice(0, maxWords).join(' ');
    // recule à la dernière virgule/point-virgule/tiret si ça préserve au moins la moitié de la clause
    const cut = Math.max(t.lastIndexOf(','), t.lastIndexOf(';'), t.lastIndexOf(' — '), t.lastIndexOf(' – '));
    if (cut > 0 && t.slice(0, cut).split(/\s+/).length >= Math.ceil(maxWords / 2)) t = t.slice(0, cut);
    // épluche les mots-outils en fin de clause ("waiting for a" → coupe propre)
    const dangling = /^(a|an|the|to|for|of|at|on|in|with|into|under|over|and|or|but|as|before|after|from|by|that|this|its|their|toward|towards|near|still|just|while|when|if|waiting)$/i;
    const parts = t.split(/\s+/);
    while (parts.length > 3 && dangling.test(parts[parts.length - 1])) parts.pop();
    t = parts.join(' ').replace(/[,;:—–-]+$/, '');
  }
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : '';
}

export interface NarrateInput {
  kind: DeskKind;
  ctx: MarketContext;
  signal?: Signal | null;
  confluence?: Confluence | null;
  threshold?: number;
  logLines?: string[];
  gated?: boolean; // setup présent mais bloqué par le filtre de tendance EMA → la clause assume la discipline
  priceAction?: string; // micro-résumé des dernières bougies → clauses qui réagissent à la tape, pas génériques
}

/** Produit UNE clause de desk (≤13-16 mots). Renvoie null si désactivé ou en cas d'échec. */
export async function narrate(input: NarrateInput): Promise<string | null> {
  if (!client) return null;
  const prompt =
    input.kind === 'trade' && input.signal
      ? tradePrompt(input.ctx, input.signal)
      : input.kind === 'opportunity' && input.confluence
        ? opportunityPrompt(input.ctx, input.confluence, input.gated)
        : analysisPrompt(input.ctx, input.logLines ?? [], input.priceAction);
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 60,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return clampClause(text, input.kind === 'analysis' ? 16 : 13) || null;
  } catch (e) {
    console.error('[algoria] narration failed:', (e as { message?: string })?.message ?? e);
    return null;
  }
}

/** Clause du RECAP horaire (stats du jour). L'UI affiche les chiffres — la clause donne l'ambiance de la session. */
export async function narrateRecap(s: { trades: number; wins: number; net: number }): Promise<string | null> {
  if (!client) return null;
  const prompt = `Hourly stream recap. Today so far: ${s.trades} trades, ${s.wins} wins, net ${s.net >= 0 ? '+' : ''}${Math.round(s.net)}$. ONE clause (max 14 words) capturing the session's vibe for the audience — do NOT restate any number (the UI shows them), desk voice, no hype.`;
  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 60, system: SYSTEM, messages: [{ role: 'user', content: prompt }] });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
    return clampClause(text, 14) || null;
  } catch (e) {
    console.error('[algoria] recap narration failed:', (e as { message?: string })?.message ?? e);
    return null;
  }
}

/** Note de PERTE rassurante pour le canal VIP (anglais), quand le cap de perte du jour a coupé la séance.
 *  Voix = chef de desk calme et en contrôle. Honnête (jamais de promesse de reprise), pédagogique, humain. */
export async function narrateLossReview(s: { trades: number; wins: number; net: number; regime?: string; adx?: number; atrPct?: number }): Promise<string | null> {
  if (!client) return null;
  const prompt = `You are the calm, in-control head of the ALGORIA AI trading desk, writing a SHORT note (English) to VIP members after a losing day where the daily safety cap stopped trading. Context: ${s.trades} trades, ${s.wins} wins, market regime "${s.regime ?? 'unclear'}"${s.adx != null ? `, ADX ${Math.round(s.adx)}` : ''}${s.atrPct != null ? `, volatility ${Math.round(s.atrPct * 100)}th percentile` : ''}.
Write 1-2 short sentences that (a) explain WHY today was hard in market terms (choppy/whipsaw range vs a sharp reversal, volatility), and (b) reassure by showing DISCIPLINE and CONTROL — the loss is bounded by the cap, it's within the strategy's normal drawdown, we don't force trades. Be honest: NEVER promise recovery or guarantee anything. Human, composed, no hype, no markdown, no emoji, do not restate specific numbers.`;
  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 180, messages: [{ role: 'user', content: prompt }] });
    return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim() || null;
  } catch (e) {
    console.error('[algoria] loss review narration failed:', (e as { message?: string })?.message ?? e);
    return null;
  }
}

// ===== Champs STRUCTURÉS du desk (lus par components/Desk.tsx). Tout dérivé de ctx/signal/confluence — 0 calcul moteur. =====
const CHIP_LABEL: Record<string, string> = {
  emaStack: 'EMA stack', macd: 'MACD', rsiPullback: 'RSI pull', srZone: 'S/R zone', divergence: 'divergence', liquiditySweep: 'liq sweep', roundLevel: 'round lvl',
};
const SESS: Record<Session, string> = { asia: 'ASIA', london: 'LDN', overlap: 'OVERLAP', newyork: 'NY', closed: 'CLOSED' };
const shortSym = (s: string) => (s === 'XAUUSD' ? 'XAU' : s === 'NAS100' ? 'NAS' : s === 'BTCUSD' ? 'BTC' : s.slice(0, 3).toUpperCase());
const tone = (score: number): 'bull' | 'bear' | 'neutral' => (score > 0.05 ? 'bull' : score < -0.05 ? 'bear' : 'neutral');

export interface DeskMeta {
  kind: DeskKind;
  symbol: string; // symbole d'affichage complet (ex. 'XAUUSD', 'NAS100') — clé de filtrage du cockpit multi-symbole
  direction: Direction;
  state: 'in_long' | 'in_short' | 'stalking_long' | 'stalking_short' | 'aside';
  confidence: number | null;
  threshold: number;
  instrument: string; // symbole court affiché dans le hero (ex. 'XAU', 'NAS')
  level: number;
  levelKind: 'entry' | 'trigger' | 'support' | 'resistance' | 'price';
  gated?: boolean; // setup vu mais bloqué par le filtre de tendance (le widget affiche "⛔ trend gate")
  trigger?: { level: number; cond: string; op: string };
  entry?: number;
  sl?: number;
  tp?: number | null;
  rr?: number;
  drivers: Array<{ label: string; tone: 'bull' | 'bear' | 'neutral' }>;
  adx: number;
  regime: string;
  emaBias: Direction;
  atr: number;
  atrPct: number;
  session: string;
  price: number;
  anchorLabel: 'ENTRY' | 'TRIGGER' | 'PRICE';
  anchorPrice: number;
}

/** Construit le meta structuré émis dans events.data pour le desk. */
export function deskMeta(kind: DeskKind, ctx: MarketContext, opts: { signal?: Signal | null; confluence?: Confluence | null; threshold?: number; gated?: boolean }): DeskMeta {
  const { signal, confluence } = opts;
  const threshold = opts.threshold ?? 0.72;
  const direction: Direction = signal ? signal.direction : confluence?.direction ?? 'flat';
  const confidence = signal ? signal.confidence : confluence?.confidence ?? null;

  let state: DeskMeta['state'];
  if (signal) state = direction === 'short' ? 'in_short' : 'in_long';
  else if (confluence && confluence.direction !== 'flat' && confidence != null && confidence >= threshold * 0.7)
    state = confluence.direction === 'short' ? 'stalking_short' : 'stalking_long';
  else state = 'aside';

  const sup = nearest(ctx, 'support');
  const res = nearest(ctx, 'resistance');
  let level = ctx.price;
  let levelKind: DeskMeta['levelKind'] = 'price';
  let trigger: DeskMeta['trigger'];
  if (kind === 'trade' && signal) {
    level = signal.entry;
    levelKind = 'entry';
  } else if (kind === 'opportunity' && confluence && confluence.direction !== 'flat') {
    if (confluence.direction === 'short' && sup) {
      level = sup.price; levelKind = 'trigger'; trigger = { level: sup.price, cond: 'break & hold', op: '<' };
    } else if (confluence.direction === 'long' && res) {
      level = res.price; levelKind = 'trigger'; trigger = { level: res.price, cond: 'reclaim', op: '>' };
    }
  } else {
    const z = [sup, res].filter((x): x is Zone => !!x).sort((a, b) => Math.abs(a.price - ctx.price) - Math.abs(b.price - ctx.price))[0];
    if (z) { level = z.price; levelKind = z.kind; }
  }

  const drivers = (confluence?.contributions ?? [])
    .slice()
    .sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted))
    .slice(0, 2)
    .map((c) => ({ label: CHIP_LABEL[c.key] ?? c.key, tone: tone(c.score) }));

  const anchor = kind === 'trade' && signal ? { label: 'ENTRY' as const, price: signal.entry } : trigger ? { label: 'TRIGGER' as const, price: trigger.level } : { label: 'PRICE' as const, price: ctx.price };

  return {
    kind,
    symbol: ctx.symbol,
    direction,
    state,
    confidence,
    threshold,
    instrument: shortSym(ctx.symbol),
    level,
    levelKind,
    ...(opts.gated ? { gated: true } : {}),
    ...(trigger ? { trigger } : {}),
    ...(signal ? { entry: signal.entry, sl: signal.stopLoss, tp: signal.takeProfits[0] ?? null, rr: signal.riskReward } : {}),
    drivers,
    adx: Math.round(ctx.adx),
    regime: ctx.regime,
    emaBias: ctx.emaBias,
    atr: +ctx.atr.toFixed(1),
    atrPct: +ctx.atrPercentile.toFixed(2),
    session: SESS[ctx.session],
    price: ctx.price,
    anchorLabel: anchor.label,
    anchorPrice: anchor.price,
  };
}
