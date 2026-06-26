import type { BacktestRun } from './simulator';

export interface Metrics {
  trades: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  avgWinR: number;
  avgLossR: number;
  netPnl: number;
}

export function metrics(run: BacktestRun, startBalance: number): Metrics {
  const t = run.trades;
  const n = t.length;
  const wins = t.filter((x) => x.pnl > 0);
  const losses = t.filter((x) => x.pnl <= 0);
  const gW = wins.reduce((s, x) => s + x.pnl, 0);
  const gL = Math.abs(losses.reduce((s, x) => s + x.pnl, 0));
  let peak = -Infinity;
  let maxDD = 0;
  for (const p of run.equity) {
    peak = Math.max(peak, p.equity);
    maxDD = Math.max(maxDD, (peak - p.equity) / peak);
  }
  return {
    trades: n,
    winRate: n ? wins.length / n : 0,
    expectancyR: n ? t.reduce((s, x) => s + x.r, 0) / n : 0,
    profitFactor: gL ? gW / gL : gW > 0 ? Infinity : 0,
    maxDrawdownPct: maxDD,
    totalReturnPct: (run.finalBalance - startBalance) / startBalance,
    avgWinR: wins.length ? wins.reduce((s, x) => s + x.r, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.reduce((s, x) => s + x.r, 0) / losses.length : 0,
    netPnl: run.finalBalance - startBalance,
  };
}
