import type { EngineState } from '../../lib/engine/types';

/** Mappe le terminalState MetaApi (compte + positions + prix) vers EngineState. */
export function readState(terminal: any, symbol: string, prev: Partial<EngineState> = {}): EngineState {
  const info = terminal.accountInformation ?? {};
  const positions = (terminal.positions ?? []).filter((p: any) => p.symbol === symbol);
  const px = terminal.price(symbol) ?? {};
  const spread = px.ask && px.bid ? px.ask - px.bid : 0;
  const openRisk = positions.reduce(
    (s: number, p: any) => s + (p.stopLoss ? Math.abs(p.openPrice - p.stopLoss) * p.volume * 100 : 0),
    0,
  );

  return {
    balance: info.balance ?? 0,
    equity: info.equity ?? info.balance ?? 0,
    dayStartBalance: prev.dayStartBalance ?? info.balance ?? 0,
    dayPnL: (info.equity ?? 0) - (prev.dayStartBalance ?? info.balance ?? 0),
    openPositions: positions.length,
    openRiskPct: info.balance ? openRisk / info.balance : 0,
    tradesToday: prev.tradesToday ?? 0,
    lastTradeTime: prev.lastTradeTime,
    spread,
    newsWindows: prev.newsWindows ?? [],
    killed: prev.killed ?? false,
  };
}
