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

/** Diffuse un tick de prix au cockpit, TAGUÉ par symbole (le cockpit multi-symbole filtre dessus). No-op tant que le canal n'est pas prêt. */
export function broadcastTick(symbol: string, bid: number, ask: number) {
  if (!tickReady) return;
  void tickCh.send({ type: 'broadcast', event: 'tick', payload: { symbol, bid, ask, t: Date.now() } });
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

/** Note générique → terminal (ex. breakeven sécurisé). */
export async function logNote(msg: string, level: 'scan' | 'info' | 'signal' | 'order' | 'veto' | 'ai' = 'info') {
  await db.from('events').insert({ ts: new Date().toISOString(), level, msg, data: null as never });
}

/** Persiste le signal — qu'il ait été exécuté OU rejeté. `status` distingue 'placed' (ordre parti) de 'rejected' (échec d'envoi). */
export async function logSignal(s: Signal, res: { ticket?: string; code?: string; status?: string }) {
  const { error } = await db.from('signals').insert({
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
    ...(res.status ? { status: res.status } : {}),
  });
  if (error) console.error('[sync] logSignal échoué:', error.message);
}

export interface TradeOpen {
  ticket: string;
  signalRef: string;
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  lot: number;
  openedAt: number; // ms epoch
}

/** Trade ouvert → ligne dans `trades` (clôture renseignée plus tard par recordTradeClose). */
export async function recordTradeOpen(t: TradeOpen) {
  const { error } = await db.from('trades').insert({
    ticket: t.ticket,
    signal_ref: t.signalRef,
    symbol: t.symbol,
    direction: t.direction,
    entry: t.entry,
    lot: t.lot,
    opened_at: new Date(t.openedAt).toISOString(),
  });
  if (error) console.error('[sync] recordTradeOpen échoué:', error.message);
}

export interface TradeClose {
  exit: number;
  pnl: number;
  r: number | null;
  reason: string;
  closedAt: number; // ms epoch
}

/** Clôture d'un trade : met à jour la ligne ouverte (match sur ticket). Idempotent : ignore les deals de clôture livrés en double. */
export async function recordTradeClose(ticket: string, symbol: string, c: TradeClose) {
  const patch = { exit: c.exit, pnl: c.pnl, r: c.r, reason: c.reason, closed_at: new Date(c.closedAt).toISOString() };
  const { data, error } = await db.from('trades').update(patch).eq('ticket', ticket).is('closed_at', null).select('id');
  if (error) {
    console.error('[sync] recordTradeClose (update) échoué:', error.message);
    return;
  }
  if (!data || data.length === 0) {
    // aucune ligne ouverte à mettre à jour → soit ce ticket est DÉJÀ clôturé (deal livré 2×), soit position ouverte avant ce process.
    const { data: already } = await db.from('trades').select('id').eq('ticket', ticket).not('closed_at', 'is', null).limit(1);
    if (already && already.length > 0) return; // déjà enregistrée comme clôturée → on ignore le doublon (plus de ligne en double)
    const { error: insErr } = await db.from('trades').insert({ ticket, symbol, ...patch }); // ligne close-only honnête
    if (insErr) console.error('[sync] recordTradeClose (insert close-only) échoué:', insErr.message);
  }
}

/**
 * Réconciliation anti-fantômes : ferme en base les trades marqués OUVERTS qui n'existent plus chez le broker
 * (fermés à la main sur MT5, ou clôture ratée par le DealRecorder, ou runner redémarré). reason='reconcile', P&L inconnu.
 * Garde-fou : ne touche QUE les trades ouverts depuis > graceMs → jamais une position fraîche pas encore synchronisée.
 * Retourne le nombre de fantômes nettoyés.
 */
export async function reconcileOpenTrades(symbol: string, liveTickets: string[], graceMs = 120_000): Promise<number> {
  const { data, error } = await db.from('trades').select('ticket,opened_at').eq('symbol', symbol).is('closed_at', null);
  if (error || !data?.length) return 0;
  const live = new Set(liveTickets.map(String));
  const cutoff = Date.now() - graceMs;
  const ghosts = data.filter((t) => !live.has(String(t.ticket)) && new Date(t.opened_at as string).getTime() < cutoff).map((t) => String(t.ticket));
  if (!ghosts.length) return 0;
  const { error: upErr } = await db.from('trades').update({ closed_at: new Date().toISOString(), reason: 'reconcile' }).in('ticket', ghosts).is('closed_at', null);
  if (upErr) {
    console.error('[sync] reconcileOpenTrades échoué:', upErr.message);
    return 0;
  }
  return ghosts.length;
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

/** Upsert en masse (backfill d'historique). Découpé en lots pour encaisser un gros backfill (ex. 20k bougies M1). */
export async function logCandles(symbol: string, bars: Bar[], timeframe = 'M5') {
  if (!bars.length) return;
  const CHUNK = 2000;
  for (let i = 0; i < bars.length; i += CHUNK) {
    await db.from('candles').upsert(
      bars.slice(i, i + CHUNK).map((bar) => ({ symbol, timeframe, time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })),
      { onConflict: 'symbol,timeframe,time' },
    );
  }
}

/** Le runner écoute les commandes du cockpit (mode, kill, flatten…). */
export function watchCommands(onCommand: (cmd: { type: string; payload: unknown }) => void) {
  return db
    .channel('cmd')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commands' }, (p) => onCommand(p.new as never))
    .subscribe();
}
