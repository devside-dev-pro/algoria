import type { Feature, FeatureInput, FeatureScore } from '../types';
import { clamp01, last } from './_util';

/** Interaction prix ↔ zone S/R : test + réaction. Le cœur des entrées. */
export const srZone: Feature = {
  key: 'srZone',
  compute({ bars, ctx }: FeatureInput): FeatureScore | null {
    if (!ctx.zones.length) return null;
    const bar = last(bars);
    const atr = ctx.atr || 1;
    const z = ctx.zones.find((zone) => bar.low <= zone.upper && bar.high >= zone.lower); // zone touchée
    if (!z) return { key: 'srZone', score: 0, strength: 0.1 };
    const bull = bar.close > bar.open;
    const prox = clamp01(1 - Math.abs(bar.close - z.price) / (2 * atr));

    if (z.kind === 'support') {
      const wick = (Math.min(bar.open, bar.close) - bar.low) / atr; // mèche de rejet basse
      return {
        key: 'srZone',
        score: bull || wick > 0.3 ? 1 : -0.3,
        strength: clamp01(0.5 * z.strength + 0.3 * prox + 0.2 * Math.min(1, wick)),
        note: `test support ${z.price.toFixed(1)}`,
      };
    }
    const wick = (bar.high - Math.max(bar.open, bar.close)) / atr;
    return {
      key: 'srZone',
      score: !bull || wick > 0.3 ? -1 : 0.3,
      strength: clamp01(0.5 * z.strength + 0.3 * prox + 0.2 * Math.min(1, wick)),
      note: `test résistance ${z.price.toFixed(1)}`,
    };
  },
};
