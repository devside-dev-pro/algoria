import type { Bar, Confluence, EngineEvent, EngineState, Feature, FeatureInput, MarketContext, Mode, Signal } from './types';
import type { EngineConfig } from './config';
import { scoreConfluence } from './score';
import { buildContext, type ContextOptions } from './context';
import { constructTrade } from './trade';
import { checkRisk } from './risk';

export interface TickInput {
  symbol: string;
  bars: Bar[]; // entry-TF bars, most recent last
  htfBars?: Bar[];
  mode: Mode;
  state: EngineState;
  ctxOpts?: ContextOptions;
}

export interface TickResult {
  context: MarketContext;
  signal: Signal | null;
  events: EngineEvent[];
  confluence: Confluence | null; // état de confluence (même sans trade) → desk "opportunité"
  threshold: number;
  blocked?: Signal | null; // setup CONSTRUIT mais refusé par le risk (ex. journée finie) → publiable au canal VIP
  blockedReasons?: string[]; // raisons du veto (permet de ne publier que les blocages « day closed »)
}

/** One pass of the engine. Returns a signal (or null) + the terminal event stream. */
export function runTick(input: TickInput, features: Feature[], cfg: EngineConfig): TickResult {
  const events: EngineEvent[] = [];
  const now = input.bars[input.bars.length - 1].time;
  const emit = (level: EngineEvent['level'], msg: string, data?: Record<string, unknown>) => events.push({ t: now, level, msg, data });
  const threshold = cfg.threshold[input.mode];
  let confluence: Confluence | null = null;

  // Stage 1 — context / regime
  const ctx = buildContext(input.symbol, input.bars, input.htfBars, input.ctxOpts);
  emit('scan', `tick ${input.symbol} · ${ctx.session} · ${ctx.regime} · atr=${ctx.atr.toFixed(2)}`);
  if (!ctx.tradable) {
    emit('info', `out of session (${ctx.session}) — idle`);
    return { context: ctx, signal: null, events, confluence, threshold };
  }

  // Stage 2 — features
  const fi: FeatureInput = { bars: input.bars, htfBars: input.htfBars, ctx };
  const scores = features.map((f) => f.compute(fi)).filter((s): s is NonNullable<typeof s> => s !== null);
  for (const s of scores) emit('scan', `${s.key}=${s.score.toFixed(2)} (×${s.strength.toFixed(2)})${s.note ? ' · ' + s.note : ''}`);

  // Stage 3 — score & confidence
  const cf = scoreConfluence(scores, ctx, cfg);
  confluence = cf;
  emit('info', `score=${cf.rawScore.toFixed(2)} align=${cf.alignment.toFixed(2)} → conf=${cf.confidence.toFixed(2)} / threshold ${threshold}`);
  if (cf.direction === 'flat' || cf.confidence < threshold) {
    emit('info', `no entry (conf ${cf.confidence.toFixed(2)} < ${threshold})`);
    return { context: ctx, signal: null, events, confluence, threshold };
  }

  // Stage 3a-bis — GATE RÉGIME (décorrélation) : cette stratégie ne joue que SA famille de marché.
  if (cfg.regimeGate && ctx.regime !== cfg.regimeGate) {
    emit('veto', `regime gate: ${ctx.regime} ≠ ${cfg.regimeGate}`);
    return { context: ctx, signal: null, events, confluence, threshold };
  }

  // Stage 3b — filtre tendance EMA (optionnel) : ne pas chasser une poussée quand l'EMA ne soutient pas le sens.
  const gate = cfg.emaGate ?? 'off';
  if (gate !== 'off') {
    const aligned = ctx.emaBias === cf.direction;
    const opposed = (cf.direction === 'long' && ctx.emaBias === 'short') || (cf.direction === 'short' && ctx.emaBias === 'long');
    if ((gate === 'align' && !aligned) || (gate === 'notOpposed' && opposed)) {
      emit('veto', `ema gate (${gate}): ${cf.direction} vs EMA ${ctx.emaBias}`);
      return { context: ctx, signal: null, events, confluence, threshold };
    }
  }

  // Stage 4 — trade construction
  const draft = constructTrade(cf, ctx, input.mode, input.state.balance, cfg);
  if (!draft) {
    emit('info', 'setup rejected (no usable structure)');
    return { context: ctx, signal: null, events, confluence, threshold };
  }
  emit('signal', `${draft.direction.toUpperCase()} ${draft.symbol} conf ${(draft.confidence * 100) | 0}% · entry ${draft.entry} sl ${draft.stopLoss} tp ${draft.takeProfits[0]} · ${draft.lot} lot`);

  // Stage 5 — risk / veto
  const verdict = checkRisk(draft, input.state, cfg);
  if (!verdict.ok) {
    emit('veto', `blocked: ${verdict.reasons.join(', ')}`);
    return { context: ctx, signal: null, blocked: draft, blockedReasons: verdict.reasons, events, confluence, threshold };
  }

  emit('order', `order.send(master) → ${draft.symbol} ${draft.direction} ${draft.lot} lot`);
  return { context: ctx, signal: draft, events, confluence, threshold };
}
