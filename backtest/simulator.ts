import type { Bar, EngineState, Feature, Mode, Signal } from '../lib/engine/types';
import type { EngineConfig } from '../lib/engine/config';
import { runTick } from '../lib/engine/pipeline';

export interface SimParams {
  symbol: string;
  mode: Mode;
  startBalance: number;
  spread: number; // en prix ($/once)
  slippage: number;
  commissionPerLot: number;
  contractSize: number;
  warmup: number; // bougies avant de commencer (≥210)
}

export interface SimTrade {
  dir: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  reason: 'tp' | 'sl' | 'eod';
  lot: number;
  pnl: number;
  r: number;
  confidence: number;
}
export interface EquityPoint {
  time: number;
  equity: number;
}
export interface BacktestRun {
  trades: SimTrade[];
  equity: EquityPoint[];
  finalBalance: number;
}

interface OpenPos {
  signal: Signal;
  entryPrice: number;
  entryTime: number;
  risk: number;
}
const dayOf = (t: number) => Math.floor(t / 86_400_000);

export function backtest(bars: Bar[], features: Feature[], cfg: EngineConfig, p: SimParams): BacktestRun {
  let balance = p.startBalance;
  let dayStart = balance;
  let dayKilled = false;
  let tradesToday = 0;
  let lastTradeTime: number | undefined;
  let lastDay = dayOf(bars[p.warmup].time);
  const open: OpenPos[] = [];
  const trades: SimTrade[] = [];
  const equity: EquityPoint[] = [];

  const close = (pos: OpenPos, px: number, time: number, reason: SimTrade['reason']) => {
    const dir = pos.signal.direction === 'long' ? 1 : -1;
    const pnl = (px - pos.entryPrice) * dir * pos.signal.lot * p.contractSize - p.commissionPerLot * pos.signal.lot;
    balance += pnl;
    trades.push({
      dir: pos.signal.direction,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime: time,
      exitPrice: px,
      reason,
      lot: pos.signal.lot,
      pnl,
      r: pos.risk ? pnl / pos.risk : 0,
      confidence: pos.signal.confidence,
    });
  };

  for (let i = p.warmup; i < bars.length - 1; i++) {
    const bar = bars[i];

    // 1) exits sur la bougie i — pessimiste : SL avant TP si les deux sont dans le range
    for (let k = open.length - 1; k >= 0; k--) {
      const s = open[k].signal;
      const long = s.direction === 'long';
      const sl = s.stopLoss;
      const tp = s.takeProfits[0];
      let ex: { px: number; reason: SimTrade['reason'] } | null = null;
      if (long) ex = bar.low <= sl ? { px: sl, reason: 'sl' } : bar.high >= tp ? { px: tp, reason: 'tp' } : null;
      else ex = bar.high >= sl ? { px: sl, reason: 'sl' } : bar.low <= tp ? { px: tp, reason: 'tp' } : null;
      if (ex) {
        close(open[k], ex.px, bar.time, ex.reason);
        open.splice(k, 1);
      }
    }

    // 2) frontière de jour → reset (kill switch, compteurs)
    const d = dayOf(bar.time);
    if (d !== lastDay) {
      lastDay = d;
      dayStart = balance;
      dayKilled = false;
      tradesToday = 0;
    }

    // 3) equity mark-to-market + kill switch journalier
    const floating = open.reduce(
      (sum, o) => sum + (bar.close - o.entryPrice) * (o.signal.direction === 'long' ? 1 : -1) * o.signal.lot * p.contractSize,
      0,
    );
    const eq = balance + floating;
    equity.push({ time: bar.time, equity: eq });
    if ((dayStart - eq) / dayStart >= cfg.risk.maxDailyLossPct) dayKilled = true;

    // 4) moteur sur clôture de i (fenêtre causale : rien après i)
    const state: EngineState = {
      balance,
      equity: eq,
      dayStartBalance: dayStart,
      dayPnL: eq - dayStart,
      openPositions: open.length,
      openRiskPct: open.reduce((s, o) => s + o.risk, 0) / balance,
      tradesToday,
      lastTradeTime,
      spread: p.spread,
      newsWindows: [],
      killed: dayKilled,
    };
    const { signal } = runTick({ symbol: p.symbol, bars: bars.slice(0, i + 1), mode: p.mode, state, ctxOpts: { spread: p.spread } }, features, cfg);

    // 5) entrée à l'OUVERTURE de i+1 (jamais sur la bougie qu'on vient de lire → pas de lookahead)
    if (signal) {
      const next = bars[i + 1];
      const dir = signal.direction === 'long' ? 1 : -1;
      const entryPrice = next.open + dir * (p.spread / 2 + p.slippage);
      open.push({ signal, entryPrice, entryTime: next.time, risk: Math.abs(entryPrice - signal.stopLoss) * signal.lot * p.contractSize });
      tradesToday++;
      lastTradeTime = signal.time;
    }
  }

  const lastBar = bars[bars.length - 1];
  for (const pos of open) close(pos, lastBar.close, lastBar.time, 'eod');
  return { trades, equity, finalBalance: balance };
}
