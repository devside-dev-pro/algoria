import type { Bar, Feature, Regime } from '../lib/engine/types';
import type { EngineConfig } from '../lib/engine/config';
import { backtest, type SimParams } from './simulator';
import { metrics, type Metrics } from './metrics';

/** Objectif : expectancy pénalisée par le drawdown. <30 trades = rejet (pas significatif). */
const objective = (m: Metrics) => (m.trades < 30 ? -Infinity : m.expectancyR - 1.5 * m.maxDrawdownPct);
const KEYS = ['emaStack', 'macd', 'rsiPullback', 'srZone', 'divergence', 'liquiditySweep', 'roundLevel'];

function perturb(cfg: EngineConfig, amount: number, seed: number): EngineConfig {
  const w = JSON.parse(JSON.stringify(cfg.weights)) as EngineConfig['weights'];
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280); // PRNG déterministe
  for (const r of ['trend', 'range'] as Regime[]) for (const k of KEYS) w[r][k] = Math.max(0, (w[r][k] ?? 0) + (rnd() - 0.5) * amount);
  return { ...cfg, weights: w };
}

export interface TuneResult {
  best: EngineConfig;
  train: Metrics;
  test: Metrics;
}

/** Recherche aléatoire sur le TRAIN, vérité mesurée sur le TEST out-of-sample (jamais optimisé). */
export function tune(bars: Bar[], features: Feature[], base: EngineConfig, p: SimParams, iters = 200): TuneResult {
  const split = Math.floor(bars.length * 0.7);
  const train = bars.slice(0, split);
  const test = bars.slice(split);
  let best = base;
  let bestScore = objective(metrics(backtest(train, features, base, p), p.startBalance));
  for (let i = 0; i < iters; i++) {
    const cand = perturb(base, 0.6, i + 1);
    const score = objective(metrics(backtest(train, features, cand, p), p.startBalance));
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return {
    best,
    train: metrics(backtest(train, features, best, p), p.startBalance),
    test: metrics(backtest(test, features, best, p), p.startBalance), // ← LA vérité
  };
}
