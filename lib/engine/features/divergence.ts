import type { Feature, FeatureInput, FeatureScore } from '../types';
import { rsi, swings } from '../indicators';
import { clamp01 } from './_util';

/** Divergence RSI : prix et momentum désaccordés → retournement. */
export const divergence: Feature = {
  key: 'divergence',
  compute({ bars }: FeatureInput): FeatureScore | null {
    if (bars.length < 40) return null;
    const r = rsi(bars.map((b) => b.close), 14);
    const sw = swings(bars, 3, 3);
    const lows = sw.filter((s) => s.kind === 'low').slice(-2);
    const highs = sw.filter((s) => s.kind === 'high').slice(-2);
    if (lows.length === 2 && lows[1].price < lows[0].price && r[lows[1].index] > r[lows[0].index])
      return { key: 'divergence', score: 1, strength: clamp01((r[lows[1].index] - r[lows[0].index]) / 15 + 0.4), note: 'divergence haussière' };
    if (highs.length === 2 && highs[1].price > highs[0].price && r[highs[1].index] < r[highs[0].index])
      return { key: 'divergence', score: -1, strength: clamp01((r[highs[0].index] - r[highs[1].index]) / 15 + 0.4), note: 'divergence baissière' };
    return { key: 'divergence', score: 0, strength: 0.1 };
  },
};
