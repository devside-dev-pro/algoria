import type { Confluence, MarketContext, Mode, Signal, Zone } from './types';
import type { EngineConfig } from './config';

const LABELS: Record<string, string> = {
  emaStack: 'EMA trend',
  macd: 'MACD momentum',
  rsiPullback: 'RSI pullback',
  srZone: 'S/R zone',
  divergence: 'divergence',
  liquiditySweep: 'liquidity sweep',
  roundLevel: 'round level',
};
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Stage 4 — turn a score into a sized trade. null if not exploitable. */
export function constructTrade(cf: Confluence, ctx: MarketContext, mode: Mode, balance: number, cfg: EngineConfig): Signal | null {
  if (cf.direction === 'flat') return null;
  const long = cf.direction === 'long';
  const dir = long ? 1 : -1;
  // Arrondi des PRIX au pas du broker. Défaut 0.01 (or) ; DOIT être plus fin pour le Forex (EURUSD 0.00001)
  // sinon entry et SL s'écrasent sur la même valeur → riskDist ≈ 0 → tout est rejeté (bug qui bloquait le Forex).
  const step = cfg.priceStep && cfg.priceStep > 0 ? cfg.priceStep : 0.01;
  const roundP = (x: number) => Math.round(x / step) * step;
  const entry = roundP(ctx.price);
  const atr = ctx.atr;

  // Defended structure = stop basis (zones already sorted by proximity)
  const supports = ctx.zones.filter((z) => z.kind === 'support');
  const resistances = ctx.zones.filter((z) => z.kind === 'resistance');
  const defend: Zone | undefined = long ? supports[0] : resistances[0];

  const structural = defend ? (long ? defend.lower : defend.upper) : entry - dir * 1.2 * atr;
  const stopLoss = roundP(structural - dir * cfg.slAtrMult * atr); // buffer beyond structure — arrondi au pas de prix (sinon le broker rejette l'ordre)
  const riskDist = Math.abs(entry - stopLoss);
  if (riskDist < cfg.minStopAtr * atr || riskDist > cfg.maxStopAtr * atr) return null;

  // TP: target R:R, clamped to the next opposing structure (never through a wall)
  const wall: Zone | undefined = long ? resistances[0] : supports[0];
  const tpByRR = entry + dir * cfg.targetRR * riskDist;
  let tp1 = tpByRR;
  if (wall) {
    const edge = long ? wall.lower : wall.upper;
    tp1 = long ? Math.min(tpByRR, edge - 0.1 * atr) : Math.max(tpByRR, edge + 0.1 * atr);
  }
  const riskReward = Math.abs(tp1 - entry) / riskDist;
  if (riskReward < cfg.minRR) return null; // not enough room → discard
  const tp2 = entry + dir * Math.max(cfg.targetRR * 1.6, riskReward + 0.8) * riskDist;

  // Sizing: fixed risk amount, derived from the stop
  const riskAmount = balance * cfg.riskPct[mode];
  const perLot = riskDist * cfg.contractSize;
  const lot = Math.floor(riskAmount / perLot / cfg.lotStep) * cfg.lotStep;
  if (lot < cfg.minLot) return null;

  return {
    id: `${ctx.symbol}-${ctx.time}-${cf.direction}`,
    symbol: ctx.symbol,
    time: ctx.time,
    direction: cf.direction,
    mode,
    confidence: cf.confidence,
    entry,
    stopLoss,
    takeProfits: [roundP(tp1), roundP(tp2)],
    riskReward: round2(riskReward),
    lot: +lot.toFixed(2),
    rationale: buildRationale(cf, ctx, defend),
    confluence: cf,
  };
}

function buildRationale(cf: Confluence, ctx: MarketContext, defend?: Zone): string[] {
  const top = [...cf.contributions].sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted)).slice(0, 3);
  const out = top.map(
    (c) => `${LABELS[c.key] ?? c.key} ${c.score > 0 ? 'bullish' : 'bearish'} (${c.weighted >= 0 ? '+' : ''}${c.weighted.toFixed(2)})`,
  );
  if (defend) out.push(`${defend.kind === 'support' ? 'Support' : 'Resistance'} ${round2(defend.price)} defended (strength ${defend.strength.toFixed(2)})`);
  out.push(`Session ${ctx.session} · ${ctx.regime} · conf ${(cf.confidence * 100) | 0}%`);
  return out;
}
