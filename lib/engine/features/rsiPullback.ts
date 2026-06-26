import type { Feature, FeatureInput, FeatureScore } from '../types';
import { rsi } from '../indicators';
import { clamp01, last } from './_util';

/** Continuation pullback: only in TREND, in the direction of the bias. */
export const rsiPullback: Feature = {
  key: 'rsiPullback',
  compute({ bars, ctx }: FeatureInput): FeatureScore | null {
    if (ctx.regime !== 'trend' || ctx.emaBias === 'flat' || bars.length < 30) return null;
    const r = rsi(bars.map((b) => b.close), 14);
    const now = last(r);
    const prev = r[r.length - 2];
    if (ctx.emaBias === 'long' && now >= 38 && now <= 52 && now > prev)
      return { key: 'rsiPullback', score: 1, strength: clamp01((52 - now) / 14 + 0.4), note: 'buy pullback' };
    if (ctx.emaBias === 'short' && now >= 48 && now <= 62 && now < prev)
      return { key: 'rsiPullback', score: -1, strength: clamp01((now - 48) / 14 + 0.4), note: 'sell pullback' };
    return { key: 'rsiPullback', score: 0, strength: 0.1 };
  },
};
