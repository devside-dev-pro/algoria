import type { Feature, FeatureInput, FeatureScore } from '../types';
import { ema } from '../indicators';
import { clamp01, clampUnit, last } from './_util';

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);

/** MACD momentum (12,26,9): histogram direction + slope + fresh cross. */
export const macd: Feature = {
  key: 'macd',
  compute({ bars, ctx }: FeatureInput): FeatureScore | null {
    if (bars.length < 60) return null;
    const close = bars.map((b) => b.close);
    const macdLine = sub(ema(close, 12), ema(close, 26));
    const hist = sub(macdLine, ema(macdLine, 9));
    const h = last(hist);
    const hPrev = hist[hist.length - 2];
    if (h === 0) return { key: 'macd', score: 0, strength: 0.1 };
    const aligned = h > hPrev === h > 0;
    const fresh = Math.sign(h) !== Math.sign(hPrev);
    const strength = clamp01((Math.abs(h) / (ctx.atr || 1)) * 4 + (fresh ? 0.2 : 0));
    return { key: 'macd', score: clampUnit(Math.sign(h) * (aligned ? 1 : 0.5)), strength, note: h > 0 ? 'bullish momentum' : 'bearish momentum' };
  },
};
