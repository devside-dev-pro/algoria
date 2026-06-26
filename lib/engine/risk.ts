import type { EngineState, RiskVerdict, Signal } from './types';
import type { EngineConfig } from './config';

/** Étage 5 — le gardien du compte. Indépendant de la qualité du signal, peut tout bloquer. */
export function checkRisk(signal: Signal, state: EngineState, cfg: EngineConfig): RiskVerdict {
  const r = cfg.risk;
  const reasons: string[] = [];

  if (state.killed) reasons.push('kill switch actif');

  const lossPct = (state.dayStartBalance - state.equity) / state.dayStartBalance;
  if (lossPct >= r.maxDailyLossPct) reasons.push(`perte jour ${(lossPct * 100).toFixed(1)}% ≥ ${r.maxDailyLossPct * 100}% → kill switch`);

  if (state.openPositions >= r.maxOpenPositions) reasons.push(`${state.openPositions}/${r.maxOpenPositions} positions ouvertes`);

  const tradeRiskPct = (signal.lot * cfg.contractSize * Math.abs(signal.entry - signal.stopLoss)) / state.balance;
  if (state.openRiskPct + tradeRiskPct > r.maxOpenRiskPct)
    reasons.push(`expo ${(100 * (state.openRiskPct + tradeRiskPct)).toFixed(1)}% > ${r.maxOpenRiskPct * 100}%`);

  if (state.tradesToday >= r.maxTradesPerDay) reasons.push('max trades/jour atteint');
  if (state.spread > r.maxSpread) reasons.push(`spread ${state.spread.toFixed(2)} > ${r.maxSpread}`);
  if (state.lastTradeTime && (signal.time - state.lastTradeTime) / 1000 < r.minSecondsBetweenTrades)
    reasons.push('trades trop rapprochés');

  for (const w of state.newsWindows)
    if (signal.time >= w.start - r.newsLockoutBeforeSec * 1000 && signal.time <= w.end + r.newsLockoutAfterSec * 1000)
      reasons.push(`news lockout · ${w.label}`);

  if (r.dailyProfitTargetPct && (state.equity - state.dayStartBalance) / state.dayStartBalance >= r.dailyProfitTargetPct)
    reasons.push('objectif jour atteint — sécurisation');

  return { ok: reasons.length === 0, reasons };
}
