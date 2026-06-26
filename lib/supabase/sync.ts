import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { EngineEvent, EngineState, MarketContext, Mode, Signal } from '../engine/types';

/** Client runner — clé SERVICE (bypass RLS). À n'utiliser QUE côté serveur/runner. */
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { persistSession: false },
});

export async function logEvents(events: EngineEvent[]) {
  if (!events.length) return;
  await db.from('events').insert(
    events.map((e) => ({ ts: new Date(e.t).toISOString(), level: e.level, msg: e.msg, data: (e.data ?? null) as never })),
  );
}

export async function logSignal(s: Signal, res: { ticket?: string; code?: string }) {
  await db.from('signals').insert({
    ref: s.id,
    symbol: s.symbol,
    direction: s.direction,
    mode: s.mode,
    confidence: s.confidence,
    entry: s.entry,
    stop_loss: s.stopLoss,
    take_profits: s.takeProfits,
    risk_reward: s.riskReward,
    lot: s.lot,
    rationale: s.rationale as never,
    confluence: s.confluence as never,
    ticket: res.ticket ?? null,
    result_code: res.code ?? null,
  });
}

export async function pushState(ctx: MarketContext, state: EngineState, mode: Mode = 'normal') {
  await db.from('state_snapshots').insert({
    session: ctx.session,
    regime: ctx.regime,
    balance: state.balance,
    equity: state.equity,
    day_pnl: state.dayPnL,
    open_positions: state.openPositions,
    open_risk_pct: state.openRiskPct,
    atr: ctx.atr,
    atr_percentile: ctx.atrPercentile,
    adx: ctx.adx,
    spread: state.spread,
    tradable: ctx.tradable,
    mode,
    killed: state.killed,
  });
}

/** Le runner écoute les commandes du cockpit (mode, kill, flatten…). */
export function watchCommands(onCommand: (cmd: { type: string; payload: unknown }) => void) {
  return db
    .channel('cmd')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commands' }, (p) => onCommand(p.new as never))
    .subscribe();
}
