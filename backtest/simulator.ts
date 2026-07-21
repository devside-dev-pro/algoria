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
  window?: number; // si défini, le moteur ne voit que les N dernières bougies (= comportement live après un restart). 0/undefined = tout l'historique.
  // Gestion de trade dynamique (optionnelle) :
  beTrigger?: number; // déplace le SL à ~breakeven quand le profit ≥ beTrigger × riskDist
  beOffset?: number; // niveau du SL breakeven en × riskDist AU-DESSUS de l'entrée (défaut 0.05 = BE+ couvre les coûts)
  trailActivate?: number; // active le trailing quand le profit ≥ trailActivate × riskDist
  trailDist?: number; // distance du trailing en × riskDist (le SL suit à peak − trailDist)
  ignoreTp?: boolean; // ignore le TP fixe → on ne sort que sur le stop (trailing) ou en fin de données
  ctxOpts?: Partial<import('../lib/engine/context').ContextOptions>; // options de contexte (session/vol) pour l'exploration
}

export interface SimTrade {
  dir: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  reason: 'tp' | 'sl' | 'eod' | 'be' | 'trail';
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
  risk: number; // risque $ (riskDist × lot × contractSize)
  riskDist: number; // distance prix entrée→SL initial
  stop: number; // SL COURANT (dynamique : breakeven puis trailing)
  peak: number; // meilleur prix atteint (high pour long, low pour short)
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
  const beTrig = p.beTrigger ?? cfg.beTrigger ?? 0; // breakeven piloté par la config moteur (override possible via SimParams)
  const trailAct = p.trailActivate ?? cfg.trailActivate; // trailing lock piloté par la config moteur (même logique)
  const trailD = p.trailDist ?? cfg.trailDist;

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

    // 1) gestion + sorties sur la bougie i — stop dynamique (breakeven → trailing), pessimiste : stop avant TP.
    // Le stop testé sur la bougie i a été figé par les bougies ≤ i-1 (mis à jour en fin de boucle) → aucun lookahead.
    for (let k = open.length - 1; k >= 0; k--) {
      const pos = open[k];
      const long = pos.signal.direction === 'long';
      const dir = long ? 1 : -1;
      const tp = pos.signal.takeProfits[0];

      const hitStop = long ? bar.low <= pos.stop : bar.high >= pos.stop;
      const hitTp = !p.ignoreTp && (long ? bar.high >= tp : bar.low <= tp);
      let ex: { px: number; reason: SimTrade['reason'] } | null = null;
      if (hitStop) {
        const above = dir * (pos.stop - pos.entryPrice); // >0 = stop déjà en profit
        ex = { px: pos.stop, reason: above > 0.1 * pos.riskDist ? 'trail' : above >= -1e-9 ? 'be' : 'sl' };
      } else if (hitTp) {
        ex = { px: tp, reason: 'tp' };
      }
      if (ex) {
        close(pos, ex.px, bar.time, ex.reason);
        open.splice(k, 1);
        continue;
      }

      // sinon : on remonte le stop pour la PROCHAINE bougie (jamais dans le mauvais sens)
      pos.peak = long ? Math.max(pos.peak, bar.high) : Math.min(pos.peak, bar.low);
      const fav = dir * (pos.peak - pos.entryPrice); // distance favorable max atteinte
      if (beTrig && fav >= beTrig * pos.riskDist) {
        const be = pos.entryPrice + dir * (p.beOffset ?? 0.05) * pos.riskDist; // BE+ : couvre les coûts
        pos.stop = long ? Math.max(pos.stop, be) : Math.min(pos.stop, be);
      }
      if (trailAct && trailD && fav >= trailAct * pos.riskDist) {
        const trail = pos.peak - dir * trailD * pos.riskDist;
        pos.stop = long ? Math.max(pos.stop, trail) : Math.min(pos.stop, trail);
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
    const lo = p.window && p.window > 0 ? Math.max(0, i + 1 - p.window) : 0;
    const { signal } = runTick({ symbol: p.symbol, bars: bars.slice(lo, i + 1), mode: p.mode, state, ctxOpts: { spread: p.spread, ...(p.ctxOpts ?? {}) } }, features, cfg);

    // 5) entrée à l'OUVERTURE de i+1 (jamais sur la bougie qu'on vient de lire → pas de lookahead)
    if (signal) {
      const next = bars[i + 1];
      const dir = signal.direction === 'long' ? 1 : -1;
      const entryPrice = next.open + dir * (p.spread / 2 + p.slippage);
      const riskDist = Math.abs(entryPrice - signal.stopLoss);
      open.push({ signal, entryPrice, entryTime: next.time, risk: riskDist * signal.lot * p.contractSize, riskDist, stop: signal.stopLoss, peak: entryPrice });
      tradesToday++;
      lastTradeTime = signal.time;
    }
  }

  const lastBar = bars[bars.length - 1];
  for (const pos of open) close(pos, lastBar.close, lastBar.time, 'eod');
  return { trades, equity, finalBalance: balance };
}
