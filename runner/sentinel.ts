// SENTINELLE DES EDGES — le meilleur algo au monde est d'abord celui qui SAIT quand il a tort.
// Chaque semaine (dimanche 12h UTC, rattrapé au boot si manqué), chaque stratégie LIVE repasse au tribunal
// du labo sur les données FRAÎCHES de la base : mêmes règles causales, mêmes coûts. Le bulletin est archivé
// (edge_health) + résumé au mission control ; si un edge dégrade, alerte push aux ADMINS uniquement.
//
// Statuts : ok (PF ≥ 1.1) · watch (1.0–1.1) · alert (PF < 1.0 ou net < 0) · low_sample (pas assez de trades).
import { backtest } from '../backtest/simulator';
import { metrics } from '../backtest/metrics';
import { computeIndicators, labBacktest, SPECS, START, type StrategyDef } from '../backtest/labcore';
import { FEATURES } from '../lib/engine/features';
import { breakoutSignal } from '../lib/engine/breakout';
import { swingSignal, swingMinBars } from '../lib/engine/swing';
import { activeInstruments } from '../lib/engine/instruments';
import { fetchCandles, recordEdgeHealth, logNote } from '../lib/supabase/sync';
import { pushToAdmins } from '../lib/push/send';
import { adminLink } from '../lib/member/notifyOwner';
import type { Bar } from '../lib/engine/types';

const DAY = 86_400_000;
const INTRADAY_WINDOW_D = 30; // scalp/breakout : 30 j de M5
const SWING_WINDOW_D = 180; // swing : 180 j de H1 (peu de trades — fenêtre large)

interface Verdict { strategy: string; windowDays: number; trades: number; winRate: number | null; profitFactor: number | null; net: number; status: string }

const statusOf = (pf: number, net: number, trades: number, minTrades: number): string => {
  if (trades < minTrades) return 'low_sample';
  if (pf < 1.0 || net < 0) return 'alert';
  if (pf < 1.1) return 'watch';
  return 'ok';
};

/** Adaptateur : fonction de signal LIVE → StrategyDef du labo (fenêtre glissante limitée pour rester O(n)). */
const adapt = (name: string, minBars: number, exits: StrategyDef['exits'], win: number, fn: (bars: Bar[]) => { direction: 'long' | 'short'; stopLoss: number; takeProfits: number[] } | null): StrategyDef => ({
  family: name, params: 'live', minBars, exits,
  onClose(i, ind) {
    const lo = Math.max(0, i + 1 - win);
    const s = fn(ind.bars.slice(lo, i + 1));
    return s ? { direction: s.direction, stopLoss: s.stopLoss, takeProfit: s.takeProfits[0] } : null;
  },
});

export async function runSentinel(): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  const alerts: string[] = [];

  for (const inst of activeInstruments()) {
    const spec = SPECS[inst.display];
    if (!spec) continue;

    // ── 1) SCALP confluence (instruments non watch-only) — moteur réel sur 30 j de M5
    if (!inst.watchOnly) {
      const m5 = await fetchCandles(inst.display, 'M5', Date.now() - INTRADAY_WINDOW_D * DAY);
      if (m5.length > 1500) {
        const m = metrics(
          backtest(m5, FEATURES, inst.config, {
            symbol: inst.display, mode: 'scalp', startBalance: START, spread: spec.spread, slippage: spec.spread * 0.25,
            commissionPerLot: spec.commissionPerLot, contractSize: inst.config.contractSize, warmup: 210, window: 600,
            ctxOpts: { spread: spec.spread, ...inst.ctx },
          }),
          START,
        );
        verdicts.push({ strategy: `scalp ${inst.display}`, windowDays: INTRADAY_WINDOW_D, trades: m.trades, winRate: m.winRate, profitFactor: m.profitFactor, net: m.netPnl, status: statusOf(m.profitFactor, m.netPnl, m.trades, 40) });
      }

      // ── 2) BREAKOUT intraday (l'or) — fonction de signal LIVE rejouée sur les mêmes 30 j
      if (inst.breakout && m5.length > 1500) {
        const bk = inst.breakout;
        const def = adapt('breakout', bk.N + 20, { be: bk.beTrigger, trailActivate: bk.trailActivate, trailDist: bk.trailDist }, bk.N + 20,
          (bars) => breakoutSignal(inst.display, bars, bk, 'scalp', inst.config.priceStep ?? 0.01));
        const m = metrics(labBacktest(computeIndicators(m5), def, spec), START);
        verdicts.push({ strategy: `breakout ${inst.display}`, windowDays: INTRADAY_WINDOW_D, trades: m.trades, winRate: m.winRate, profitFactor: m.profitFactor, net: m.netPnl, status: statusOf(m.profitFactor, m.netPnl, m.trades, 25) });
      }
    }

    // ── 3) SWING (H1) — fonction de signal LIVE rejouée sur 180 j de H1
    if (inst.swing) {
      const sw = inst.swing;
      const h1 = await fetchCandles(inst.display, 'H1', Date.now() - SWING_WINDOW_D * DAY);
      if (h1.length > swingMinBars(sw) + 100) {
        const win = swingMinBars(sw) + 40;
        const def = adapt('swing', swingMinBars(sw), { be: sw.beTrigger, trailActivate: sw.trailActivate, trailDist: sw.trailDist }, win,
          (bars) => swingSignal(inst.display, bars, sw, 'scalp', inst.config.priceStep ?? 0.01));
        const m = metrics(labBacktest(computeIndicators(h1), def, spec), START);
        verdicts.push({ strategy: `swing ${inst.display}`, windowDays: SWING_WINDOW_D, trades: m.trades, winRate: m.winRate, profitFactor: m.profitFactor, net: m.netPnl, status: statusOf(m.profitFactor, m.netPnl, m.trades, 8) });
      }
    }
  }

  // ── Archivage + rapport + alerte
  for (const v of verdicts) {
    await recordEdgeHealth(v);
    if (v.status === 'alert') alerts.push(`${v.strategy}: PF ${v.profitFactor?.toFixed(2)} · net $${v.net.toFixed(0)} (${v.trades} trades/${v.windowDays}j)`);
  }
  const line = verdicts.map((v) => `${v.status === 'ok' ? '✓' : v.status === 'watch' ? '~' : v.status === 'alert' ? '✗' : '·'} ${v.strategy} PF ${v.profitFactor?.toFixed(2) ?? '—'}`).join(' · ');
  await logNote(`EDGE SENTINEL · weekly re-validation on fresh data → ${line || 'no data'}`, 'info');
  if (alerts.length) {
    await pushToAdmins({ title: `⚠ EDGE ALERT — ${alerts.length} strategy(ies) degrading`, body: alerts.join(' | ').slice(0, 240), url: adminLink('/'), tag: 'edge-alert' }).catch(() => {});
    await logNote(`⚠ EDGE ALERT: ${alerts.join(' · ')}`, 'veto');
  }
  console.log(`[algoria] sentinelle : ${verdicts.length} stratégies re-validées · ${alerts.length} alerte(s)`);
  return verdicts;
}
