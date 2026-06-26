import type { Bar, EngineEvent, EngineState, Feature, FeatureInput, MarketContext, Mode, Signal } from './types';
import type { EngineConfig } from './config';
import { scoreConfluence } from './score';
import { buildContext, type ContextOptions } from './context';
import { constructTrade } from './trade';
import { checkRisk } from './risk';

export interface TickInput {
  symbol: string;
  bars: Bar[]; // bougies de l'entry-TF, la plus récente en dernier
  htfBars?: Bar[];
  mode: Mode;
  state: EngineState;
  ctxOpts?: ContextOptions;
}

export interface TickResult {
  context: MarketContext;
  signal: Signal | null;
  events: EngineEvent[];
}

/** Une passe du moteur. Renvoie un signal (ou null) + le flux d'events du terminal. */
export function runTick(input: TickInput, features: Feature[], cfg: EngineConfig): TickResult {
  const events: EngineEvent[] = [];
  const now = input.bars[input.bars.length - 1].time;
  const emit = (level: EngineEvent['level'], msg: string, data?: Record<string, unknown>) => events.push({ t: now, level, msg, data });

  // Étage 1 — contexte / régime
  const ctx = buildContext(input.symbol, input.bars, input.htfBars, input.ctxOpts);
  emit('scan', `tick ${input.symbol} · ${ctx.session} · ${ctx.regime} · atr=${ctx.atr.toFixed(2)}`);
  if (!ctx.tradable) {
    emit('info', `hors fenêtre (${ctx.session}) — veille`);
    return { context: ctx, signal: null, events };
  }

  // Étage 2 — features
  const fi: FeatureInput = { bars: input.bars, htfBars: input.htfBars, ctx };
  const scores = features.map((f) => f.compute(fi)).filter((s): s is NonNullable<typeof s> => s !== null);
  for (const s of scores) emit('scan', `${s.key}=${s.score.toFixed(2)} (×${s.strength.toFixed(2)})${s.note ? ' · ' + s.note : ''}`);

  // Étage 3 — score & confiance
  const cf = scoreConfluence(scores, ctx, cfg);
  const threshold = cfg.threshold[input.mode];
  emit('info', `score=${cf.rawScore.toFixed(2)} align=${cf.alignment.toFixed(2)} → conf=${cf.confidence.toFixed(2)} / seuil ${threshold}`);
  if (cf.direction === 'flat' || cf.confidence < threshold) {
    emit('info', `pas d'entrée (conf ${cf.confidence.toFixed(2)} < ${threshold})`);
    return { context: ctx, signal: null, events };
  }

  // Étage 4 — construction
  const draft = constructTrade(cf, ctx, input.mode, input.state.balance, cfg);
  if (!draft) {
    emit('info', 'setup rejeté (pas de structure exploitable)');
    return { context: ctx, signal: null, events };
  }
  emit('signal', `${draft.direction.toUpperCase()} ${draft.symbol} conf ${(draft.confidence * 100) | 0}% · entrée ${draft.entry} sl ${draft.stopLoss} tp ${draft.takeProfits[0]} · ${draft.lot} lot`);

  // Étage 5 — risk / véto
  const verdict = checkRisk(draft, input.state, cfg);
  if (!verdict.ok) {
    emit('veto', `bloqué: ${verdict.reasons.join(', ')}`);
    return { context: ctx, signal: null, events };
  }

  emit('order', `order.send(master) → ${draft.symbol} ${draft.direction} ${draft.lot} lot`);
  return { context: ctx, signal: draft, events };
}
