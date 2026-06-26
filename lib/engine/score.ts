import type { Confluence, FeatureScore, MarketContext } from './types';
import type { EngineConfig } from './config';

/**
 * Étage 3 — confluence. Combine les scores pondérés en une direction + une confiance.
 * Transparent par choix : chaque contribution est renvoyée pour que le terminal
 * et le LLM puissent EXPLIQUER la décision.
 */
export function scoreConfluence(features: FeatureScore[], ctx: MarketContext, cfg: EngineConfig): Confluence {
  const w = cfg.weights[ctx.regime];

  const contributions = features.map((f) => {
    const weight = (w[f.key] ?? 0) * f.strength; // la force module le poids
    return { key: f.key, weight, score: f.score, weighted: weight * f.score };
  });

  const sumAbsW = contributions.reduce((s, c) => s + Math.abs(c.weight), 0);
  if (sumAbsW === 0) return FLAT;

  const rawScore = contributions.reduce((s, c) => s + c.weighted, 0) / sumAbsW;
  const dirSign = Math.sign(rawScore);
  const direction = rawScore > 0 ? 'long' : rawScore < 0 ? 'short' : 'flat';

  const alignment =
    contributions.reduce((s, c) => s + (Math.sign(c.score) === dirSign ? Math.abs(c.weight) : 0), 0) / sumAbsW;

  const adxQ = clamp01((ctx.adx - 15) / 25); // ~0 à ADX15, ~1 à ADX40
  const volQ = bell(ctx.atrPercentile, 0.5, 0.28); // optimal en vol moyenne
  const quality = clamp01(0.5 * adxQ + 0.5 * volQ);

  const macro = 1 + cfg.macroBeta * ctx.macroBias * dirSign;

  const confidence = clamp01(Math.abs(rawScore) * alignment * quality * macro);
  return { direction, rawScore, alignment, quality, macro, confidence, contributions };
}

const FLAT: Confluence = {
  direction: 'flat',
  rawScore: 0,
  alignment: 0,
  quality: 0,
  macro: 1,
  confidence: 0,
  contributions: [],
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const bell = (x: number, mid: number, sd: number) => Math.exp(-((x - mid) ** 2) / (2 * sd * sd));
