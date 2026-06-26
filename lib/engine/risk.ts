import type { EngineState, RiskVerdict, Signal } from './types';
import type { EngineConfig } from './config';

/** Stage 5 — the account guardian. Independent of signal quality, can block anything. */
export function checkRisk(signal: Signal, state: EngineState, cfg: EngineConfig): RiskVerdict {
  const r = cfg.risk;
  const reasons: string[] = [];

  if (state.killed) reasons.push('kill switch active');

  const lossPct = (state.dayStartBalance - state.equity) / state.dayStartBalance;
  if (lossPct >= r.maxDailyLossPct) reasons.push(`daily loss ${(lossPct * 100).toFixed(1)}% ≥ ${r.maxDailyLossPct * 100}% → kill switch`);

  if (state.openPositions >= r.maxOpenPositions) reasons.push(`${state.openPositions}/${r.maxOpenPositions} open positions`);

  const tradeRiskPct = (signal.lot * cfg.contractSize * Math.abs(signal.entry - signal.stopLoss)) / state.balance;
  if (state.openRiskPct + tradeRiskPct > r.maxOpenRiskPct)
    reasons.push(`exposure ${(100 * (state.openRiskPct + tradeRiskPct)).toFixed(1)}% > ${r.maxOpenRiskPct * 100}%`);

  if (state.tradesToday >= r.maxTradesPerDay) reasons.push('max trades/day reached');
  if (state.spread > r.maxSpread) reasons.push(`spread ${state.spread.toFixed(2)} > ${r.maxSpread}`);
  if (state.lastTradeTime && (signal.time - state.lastTradeTime) / 1000 < r.minSecondsBetweenTrades)
    reasons.push('trades too close together');

  for (const w of state.newsWindows)
    if (signal.time >= w.start - r.newsLockoutBeforeSec * 1000 && signal.time <= w.end + r.newsLockoutAfterSec * 1000)
      reasons.push(`news lockout · ${w.label}`);

  if (r.dailyProfitTargetPct && (state.equity - state.dayStartBalance) / state.dayStartBalance >= r.dailyProfitTargetPct)
    reasons.push('daily target hit — securing');

  return { ok: reasons.length === 0, reasons };
}
