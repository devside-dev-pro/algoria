import type { Confluence, MarketContext, Mode, Signal, Zone } from './types';
import type { EngineConfig } from './config';

const LABELS: Record<string, string> = {
  emaStack: 'tendance EMA',
  macd: 'momentum MACD',
  rsiPullback: 'pullback RSI',
  srZone: 'zone S/R',
  divergence: 'divergence',
  liquiditySweep: 'liquidity sweep',
  roundLevel: 'niveau rond',
};
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Étage 4 — transforme un score en trade dimensionné. null si pas exploitable. */
export function constructTrade(cf: Confluence, ctx: MarketContext, mode: Mode, balance: number, cfg: EngineConfig): Signal | null {
  if (cf.direction === 'flat') return null;
  const long = cf.direction === 'long';
  const dir = long ? 1 : -1;
  const entry = ctx.price;
  const atr = ctx.atr;

  // Structure défendue = base du stop (zones déjà triées par proximité)
  const supports = ctx.zones.filter((z) => z.kind === 'support');
  const resistances = ctx.zones.filter((z) => z.kind === 'resistance');
  const defend: Zone | undefined = long ? supports[0] : resistances[0];

  const structural = defend ? (long ? defend.lower : defend.upper) : entry - dir * 1.2 * atr;
  const stopLoss = structural - dir * cfg.slAtrMult * atr; // buffer au-delà de la structure
  const riskDist = Math.abs(entry - stopLoss);
  if (riskDist < cfg.minStopAtr * atr || riskDist > cfg.maxStopAtr * atr) return null;

  // TP : R:R cible, collé à la prochaine structure opposée (jamais à travers un mur)
  const wall: Zone | undefined = long ? resistances[0] : supports[0];
  const tpByRR = entry + dir * cfg.targetRR * riskDist;
  let tp1 = tpByRR;
  if (wall) {
    const edge = long ? wall.lower : wall.upper;
    tp1 = long ? Math.min(tpByRR, edge - 0.1 * atr) : Math.max(tpByRR, edge + 0.1 * atr);
  }
  const riskReward = Math.abs(tp1 - entry) / riskDist;
  if (riskReward < cfg.minRR) return null; // pas assez de place → on jette
  const tp2 = entry + dir * Math.max(cfg.targetRR * 1.6, riskReward + 0.8) * riskDist;

  // Sizing : risque fixe en €, dérivé du stop
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
    takeProfits: [round2(tp1), round2(tp2)],
    riskReward: round2(riskReward),
    lot: +lot.toFixed(2),
    rationale: buildRationale(cf, ctx, defend),
    confluence: cf,
  };
}

function buildRationale(cf: Confluence, ctx: MarketContext, defend?: Zone): string[] {
  const top = [...cf.contributions].sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted)).slice(0, 3);
  const out = top.map(
    (c) => `${LABELS[c.key] ?? c.key} ${c.score > 0 ? 'haussier' : 'baissier'} (${c.weighted >= 0 ? '+' : ''}${c.weighted.toFixed(2)})`,
  );
  if (defend) out.push(`${defend.kind === 'support' ? 'Support' : 'Résistance'} ${round2(defend.price)} défendu (force ${defend.strength.toFixed(2)})`);
  out.push(`Session ${ctx.session} · ${ctx.regime} · confiance ${(cf.confidence * 100) | 0}%`);
  return out;
}
