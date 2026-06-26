import type { Feature, FeatureInput, FeatureScore } from '../types';
import { swings } from '../indicators';
import { clamp01, last } from './_util';

/** Stop hunt : mèche qui perce un swing puis reclôture au-dessus/dessous → retournement. La signature de l'or. */
export const liquiditySweep: Feature = {
  key: 'liquiditySweep',
  compute({ bars, ctx }: FeatureInput): FeatureScore | null {
    if (bars.length < 20) return null;
    const atr = ctx.atr || 1;
    const bar = last(bars);
    const sw = swings(bars.slice(0, -1), 2, 2); // swings AVANT la bougie courante
    const lo = sw.filter((s) => s.kind === 'low').slice(-1)[0];
    const hi = sw.filter((s) => s.kind === 'high').slice(-1)[0];
    if (lo && bar.low < lo.price - 0.1 * atr && bar.close > lo.price)
      return { key: 'liquiditySweep', score: 1, strength: clamp01(0.4 + Math.min(1, (lo.price - bar.low) / atr)), note: 'sweep liquidité bas' };
    if (hi && bar.high > hi.price + 0.1 * atr && bar.close < hi.price)
      return { key: 'liquiditySweep', score: -1, strength: clamp01(0.4 + Math.min(1, (bar.high - hi.price) / atr)), note: 'sweep liquidité haut' };
    return null; // pas de sweep → ne vote pas
  },
};
