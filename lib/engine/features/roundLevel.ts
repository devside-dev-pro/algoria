import type { Feature, FeatureInput, FeatureScore } from '../types';
import { clamp01, last } from './_util';

/** Niveaux psychologiques de l'or (tous les $10, plus forts tous les $50). */
export const roundLevel: Feature = {
  key: 'roundLevel',
  compute({ bars, ctx }: FeatureInput): FeatureScore | null {
    const bar = last(bars);
    const atr = ctx.atr || 1;
    const step = 10;
    const nearest = Math.round(bar.close / step) * step;
    const dist = Math.abs(bar.close - nearest);
    if (dist > 0.5 * atr) return { key: 'roundLevel', score: 0, strength: 0.1 };
    const bull = bar.close > bar.open;
    const fromBelow = bar.close < nearest;
    const strong = nearest % 50 === 0;
    return {
      key: 'roundLevel',
      score: fromBelow ? (bull ? 0.6 : -0.4) : !bull ? -0.6 : 0.4,
      strength: clamp01((strong ? 0.5 : 0.3) + (1 - dist / (0.5 * atr)) * 0.3),
      note: `niveau ${nearest}`,
    };
  },
};
