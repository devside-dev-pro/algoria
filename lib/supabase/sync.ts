import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import type { Database } from './database.types';
import type { Bar, EngineEvent, EngineState, MarketContext, Mode, Signal } from '../engine/types';

/** Client runner — clé SERVICE (bypass RLS). À n'utiliser QUE côté serveur/runner. */
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

// Canal Realtime "broadcast" pour le prix live (éphémère, aucune écriture DB) → alimente le firehose du cockpit.
const tickCh = db.channel('algoria-ticks');
let tickReady = false;
tickCh.subscribe((status) => {
  if (status === 'SUBSCRIBED') tickReady = true;
});

/** Diffuse un tick de prix au cockpit (mission control). No-op tant que le canal n'est pas prêt. */
export function broadcastTick(bid: number, ask: number) {
  if (!tickReady) return;
  void tickCh.send({ type: 'broadcast', event: 'tick', payload: { bid, ask, t: Date.now() } });
}

export async function logEvents(events: EngineEvent[]) {
  if (!events.length) return;
  await db.from('events').insert(
    events.map((e) => ({ ts: new Date(e.t).toISOString(), level: e.level, msg: e.msg, data: (e.data ?? null) as never })),
  );
}

/** Commentaire desk Claude (niveau 'ai'). `meta` = { kind, direction, confidence, entry, sl, tp } → badge/couleur côté cockpit. */
export async function logNarration(text: string, t?: number, meta?: Record<string, unknown>) {
  await db.from('events').insert({ ts: new Date(t ?? Date.now()).toISOString(), level: 'ai', msg: text, data: (meta ?? null) as never });
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

/** Persiste une bougie (upsert sur symbol+timeframe+time) → alimente le chart. */
export async function logCandle(symbol: string, bar: Bar, timeframe = 'M5') {
  await db.from('candles').upsert(
    { symbol, timeframe, time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
    { onConflict: 'symbol,timeframe,time' },
  );
}

/** Upsert en masse (backfill d'historique). */
export async function logCandles(symbol: string, bars: Bar[], timeframe = 'M5') {
  if (!bars.length) return;
  await db.from('candles').upsert(
    bars.map((bar) => ({ symbol, timeframe, time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })),
    { onConflict: 'symbol,timeframe,time' },
  );
}

/** Le runner écoute les commandes du cockpit (mode, kill, flatten…). */
export function watchCommands(onCommand: (cmd: { type: string; payload: unknown }) => void) {
  return db
    .channel('cmd')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commands' }, (p) => onCommand(p.new as never))
    .subscribe();
}
