import type { Feature, FeatureInput, FeatureScore } from '../types';
import { ema } from '../indicators';
import { clamp01, last } from './_util';

/** Tendance : alignement EMA(9/21/50) + pente. +1 stack haussier, -1 baissier. */
export const emaStack: Feature = {
  key: 'emaStack',
  compute({ bars }: FeatureInput): FeatureScore | null {
    if (bars.length < 60) return null;
    const close = bars.map((b) => b.close);
    const e9 = ema(close, 9);
    const e21 = ema(close, 21);
    const e50 = ema(close, 50);
    const a = last(e9);
    const b = last(e21);
    const c = last(e50);

    const bullish = a > b && b > c;
    const bearish = a < b && b < c;
    if (!bullish && !bearish) return { key: 'emaStack', score: 0, strength: 0.2, note: 'EMA entrelacées' };

    const slope = (a - e9[e9.length - 4]) / Math.max(1e-9, Math.abs(a - c));
    const strength = clamp01(Math.min(1, Math.abs(slope)) * 0.6 + 0.4);
    return { key: 'emaStack', score: bullish ? 1 : -1, strength, note: bullish ? 'stack haussier' : 'stack baissier' };
  },
};
