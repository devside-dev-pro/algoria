// CŒUR DU SIM BREAKOUT — extrait de backtest/breakout.ts le 01/08 pour être partagé avec le
// walk-forward. Rejoue la VRAIE fonction breakoutSignal() (pas une réécriture) sur des bougies M5, avec
// la gestion BE/trailing du live et les frais mesurés. Une seule implémentation = un seul tribunal.
//
// Différences ASSUMÉES avec le live (notées, pas cachées) : pas de cap de perte journalier ni de dayLock
// (partagés entre couches en live — les simuler sur la couche seule fausserait dans les 2 sens), pas de
// news-lockout, pas de priorité scalp (le scalp prend la bougie avant le breakout en live).
import { breakoutSignal, type BreakoutConfig } from '../lib/engine/breakout';
import { regimeMask, type RegimeFilter } from '../lib/engine/regime';
import { SCALP_CONFIG } from '../lib/engine/config';
import type { Bar } from '../lib/engine/types';
import type { BacktestRun, SimTrade } from './simulator';

export interface Costs { spread: number; slippage: number; commissionPerLot: number; contractSize: number }
export const BK_COSTS: Costs = { spread: 0.2, slippage: 0.05, commissionPerLot: 7, contractSize: 100 }; // frais RaiseFX mesurés (= SIM_BASE)
export const BK_START = 70_000;
export const BK_WINDOW = 600; // le runner ne voit qu'une fenêtre glissante de bougies — même discipline ici

export interface BkOpts { noEntryFriFrom?: number; regime?: RegimeFilter; intrabarManage?: boolean }

interface Pos { dir: 1 | -1; direction: 'long' | 'short'; entryPrice: number; entryTime: number; riskDist: number; risk: number; stop: number; tp: number; peak: number; lot: number; confidence: number }

// Sim breakout : mêmes règles causales que simulator.ts (stop avant TP, entrée à l'open de i+1,
// stop figé par les bougies précédentes), 1 position à la fois (checkRisk live = 1 pos/symbole).
export function simBreakout(bars: Bar[], cfg: BreakoutConfig, c: Costs = BK_COSTS, opts?: BkOpts): BacktestRun {
  let balance = BK_START;
  // FILTRE DE RÉGIME (01/08) : le breakout est la couche la plus exposée au marché latéral — un canal
  // Donchian percé sans tendance derrière, c'est un faux départ qui paie le spread puis le stop.
  // Le filtre de régime vit maintenant DANS breakoutSignal (cfg.regime) : live et sim exécutent le même
  // code. opts.regime reste disponible pour explorer une valeur SANS toucher à la config de prod.
  const regimeOk = opts?.regime ? regimeMask(bars, opts.regime) : null;
  let pos: Pos | null = null;
  const trades: SimTrade[] = [];
  const equity: { time: number; equity: number }[] = [];
  const close = (px: number, time: number, reason: SimTrade['reason']) => {
    if (!pos) return;
    const pnl = (px - pos.entryPrice) * pos.dir * pos.lot * c.contractSize - c.commissionPerLot * pos.lot;
    balance += pnl;
    trades.push({ dir: pos.direction, entryTime: pos.entryTime, entryPrice: pos.entryPrice, exitTime: time, exitPrice: px, reason, lot: pos.lot, pnl, r: pos.risk ? pnl / pos.risk : 0, confidence: pos.confidence });
    pos = null;
  };
  for (let i = cfg.N + 20; i < bars.length - 1; i++) {
    const bar = bars[i];
    if (pos) {
      const long = pos.dir === 1;
      const hitStop = long ? bar.low <= pos.stop : bar.high >= pos.stop;
      const hitTp = long ? bar.high >= pos.tp : bar.low <= pos.tp;
      if (hitStop) {
        const above = pos.dir * (pos.stop - pos.entryPrice);
        close(pos.stop, bar.time, above > 0.1 * pos.riskDist ? 'trail' : above >= -1e-9 ? 'be' : 'sl');
      } else if (hitTp) close(pos.tp, bar.time, 'tp');
      else {
        pos.peak = long ? Math.max(pos.peak, bar.high) : Math.min(pos.peak, bar.low);
        const fav = pos.dir * (pos.peak - pos.entryPrice);
        if (cfg.beTrigger && fav >= cfg.beTrigger * pos.riskDist) {
          const be = pos.entryPrice + pos.dir * 0.05 * pos.riskDist; // BE+ couvre les coûts (= manage.ts)
          pos.stop = long ? Math.max(pos.stop, be) : Math.min(pos.stop, be);
        }
        if (cfg.trailActivate && cfg.trailDist && fav >= cfg.trailActivate * pos.riskDist) {
          const trail = pos.peak - pos.dir * cfg.trailDist * pos.riskDist;
          pos.stop = long ? Math.max(pos.stop, trail) : Math.min(pos.stop, trail);
        }
        // GESTION INTRA-BOUGIE : le live remonte le stop à la seconde (manage.ts sur le tick), le sim ne le
        // faisait qu'en fin de bougie et ne le testait qu'à la suivante. Ce sursis d'une bougie EST l'écart
        // de parité de juillet : 41 % de sorties 'trail' simulées contre 7 % réelles.
        if (opts?.intrabarManage && (long ? bar.low <= pos.stop : bar.high >= pos.stop)) {
          const above = pos.dir * (pos.stop - pos.entryPrice);
          close(pos.stop, bar.time, above > 0.1 * pos.riskDist ? 'trail' : above >= -1e-9 ? 'be' : 'sl');
        }
      }
    }
    equity.push({ time: bar.time, equity: balance + (pos ? (bar.close - pos.entryPrice) * pos.dir * pos.lot * c.contractSize : 0) });
    if (!pos && !(regimeOk && !regimeOk[i])) {
      const lo = Math.max(0, i + 1 - BK_WINDOW);
      const sig = breakoutSignal('XAUUSD', bars.slice(lo, i + 1), cfg, 'scalp');
      if (sig) {
        const next = bars[i + 1];
        if (opts?.noEntryFriFrom != null) { const d = new Date(next.time); if (d.getUTCDay() === 5 && d.getUTCHours() >= opts.noEntryFriFrom) continue; }
        const dir = sig.direction === 'long' ? 1 : -1;
        const entryPrice = next.open + dir * (c.spread / 2 + c.slippage);
        const riskDist = Math.abs(entryPrice - sig.stopLoss);
        if (riskDist <= 0) continue;
        // GARDE LIVE maxOpenRiskPct (risk.ts:21) : les gaps de week-end gonflent l'ATR → SL à 50-160$ de
        // distance = 7-23% du solde risqués. Le live REFUSE ces entrées (expo max 3%) — sans cette garde,
        // le sim affichait +$89k/mois portés par 5 trades-monstres jamais pris en réel (bug attrapé le 29/07).
        if ((riskDist * sig.lot * c.contractSize) / balance > SCALP_CONFIG.risk.maxOpenRiskPct) continue;
        pos = { dir: dir as 1 | -1, direction: sig.direction, entryPrice, entryTime: next.time, riskDist, risk: riskDist * sig.lot * c.contractSize, stop: sig.stopLoss, tp: sig.takeProfits[0], peak: entryPrice, lot: sig.lot, confidence: sig.confidence };
      }
    }
  }
  if (pos !== null) close(bars[bars.length - 1].close, bars[bars.length - 1].time, 'eod');
  return { trades, equity, finalBalance: balance };
}

