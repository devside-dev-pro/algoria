import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import type { Database } from './database.types';
import type { Bar, EngineEvent, EngineState, MarketContext, Mode, Signal } from '../engine/types';

/** Client runner — clé SERVICE (bypass RLS). À n'utiliser QUE côté serveur/runner. */
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

// ===== MULTI-RUNNERS (un runner = un master = une stratégie) =====
// STRAT_ID tague chaque trade/signal écrit en base (colonne strategy) → le feed membre filtre par SA stratégie.
// SECONDARY (stratégie ≠ 2) = runner « silencieux » : il TRADE et enregistre trades/signaux, mais n'écrit PAS
// le cockpit (events/desk/narration/candles/ticks/state) — sinon 3 runners écrivent le même flux en triple.
// Le cockpit/live reste la voix du master de référence (S2) tant qu'on n'a pas un cockpit par stratégie.
export const STRAT_ID = Number(process.env.ALGORIA_STRATEGY ?? '2') || 2;
export const SECONDARY = STRAT_ID !== 2;

// Canal Realtime "broadcast" pour le prix live (éphémère, aucune écriture DB) → alimente le firehose du cockpit.
const tickCh = db.channel('algoria-ticks');
let tickReady = false;
tickCh.subscribe((status) => {
  if (status === 'SUBSCRIBED') tickReady = true;
});

/** Diffuse un tick de prix au cockpit, TAGUÉ par symbole (le cockpit multi-symbole filtre dessus). No-op tant que le canal n'est pas prêt. */
// THROTTLE DU FIREHOSE : Supabase Realtime facture CHAQUE message × CHAQUE écran qui écoute — à 1 tick/s
// par marché (BTC 24/7), on a explosé le quota Free (4.7M msgs/mois, vécu 23/07). 1 msg/2s par symbole,
// et jamais deux fois le même prix : le HUD reste vivant, la facture retombe de ~70%.
const lastTickSent = new Map<string, { t: number; bid: number; ask: number }>();
export function broadcastTick(symbol: string, bid: number, ask: number) {
  if (SECONDARY) return; // runner secondaire : pas de firehose cockpit
  if (!tickReady) return;
  const prev = lastTickSent.get(symbol);
  const now = Date.now();
  if (prev && prev.bid === bid && prev.ask === ask) return; // prix inchangé → rien à dire (nuits calmes)
  if (prev && now - prev.t < 2000) return; // au plus un message toutes les 2 s par marché
  lastTickSent.set(symbol, { t: now, bid, ask });
  void tickCh.send({ type: 'broadcast', event: 'tick', payload: { symbol, bid, ask, t: now } });
}

export async function logEvents(events: EngineEvent[]) {
  if (SECONDARY) return; // cockpit = voix du master S2 uniquement
  if (!events.length) return;
  await db.from('events').insert(
    events.map((e) => ({ ts: new Date(e.t).toISOString(), level: e.level, msg: e.msg, data: (e.data ?? null) as never })),
  );
}

/** Commentaire desk Claude (niveau 'ai'). `meta` = { kind, direction, confidence, entry, sl, tp } → badge/couleur côté cockpit. */
export async function logNarration(text: string, t?: number, meta?: Record<string, unknown>) {
  if (SECONDARY) return;
  await db.from('events').insert({ ts: new Date(t ?? Date.now()).toISOString(), level: 'ai', msg: text, data: (meta ?? null) as never });
}

/** Commentaire du live TikTok (mode Autopilot) → le cockpit les lit en temps réel. Best-effort. */
export async function recordLiveComment(username: string, text: string) {
  if (SECONDARY) return;
  await (db as unknown as { from: (t: string) => { insert: (r: unknown) => PromiseLike<unknown> } }).from('live_comments').insert({ username, text });
}

/** Note générique → terminal (ex. breakeven sécurisé). */
export async function logNote(msg: string, level: 'scan' | 'info' | 'signal' | 'order' | 'veto' | 'ai' = 'info') {
  if (SECONDARY) return;
  await db.from('events').insert({ ts: new Date().toISOString(), level, msg, data: null as never });
}

/** Persiste le signal — qu'il ait été exécuté OU rejeté. `status` distingue 'placed' (ordre parti) de 'rejected' (échec d'envoi). */
export async function logSignal(s: Signal, res: { ticket?: string; code?: string; status?: string }) {
  const { error } = await db.from('signals').insert({
    strategy: STRAT_ID as never, // colonne ajoutée par migration — types générés pas régénérés
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
  sl?: number; // SL initial (deviendra le SL COURANT — mis à jour au breakeven/trailing)
}

/** Trade ouvert → ligne dans `trades` (clôture renseignée plus tard par recordTradeClose). */
export async function recordTradeOpen(t: TradeOpen) {
  const { error } = await db.from('trades').insert({
    strategy: STRAT_ID as never,
    ticket: t.ticket,
    signal_ref: t.signalRef,
    symbol: t.symbol,
    direction: t.direction,
    entry: t.entry,
    lot: t.lot,
    opened_at: new Date(t.openedAt).toISOString(),
    ...(t.sl && t.sl > 0 ? { sl: t.sl } : {}),
  });
  if (error) console.error('[sync] recordTradeOpen échoué:', error.message);
}

/** SL COURANT d'une position ouverte (breakeven/trailing) → le cockpit redessine la zone SL en direct. */
export async function updateTradeStop(ticket: string, sl: number) {
  const { error } = await db.from('trades').update({ sl }).eq('ticket', ticket).eq('strategy' as never, STRAT_ID as never).is('closed_at', null);
  if (error) console.error('[sync] updateTradeStop échoué:', error.message);
}

export interface TradeClose {
  exit: number;
  pnl: number;
  r: number | null;
  reason: string;
  closedAt: number; // ms epoch
}

/** Clôture d'un trade : met à jour la ligne ouverte (match sur ticket). Idempotent : ignore les deals de clôture livrés en double. */
// Retourne TRUE seulement si cette clôture est NEUVE (ligne ouverte fermée à l'instant, ou insert close-only) —
// FALSE si c'était un doublon (deal MetaApi rélivré, ou 2e instance runner) ou une erreur. L'appelant s'en sert
// comme UNIQUE verrou d'idempotence pour les effets de bord (carte VIP, push win) : la base fait foi, une seule
// annonce par trade même si onDealAdded se déclenche plusieurs fois.
export async function recordTradeClose(ticket: string, symbol: string, c: TradeClose): Promise<boolean> {
  const patch = { exit: c.exit, pnl: c.pnl, r: c.r, reason: c.reason, closed_at: new Date(c.closedAt).toISOString() };
  const { data, error } = await db.from('trades').update(patch).eq('ticket', ticket).eq('strategy' as never, STRAT_ID as never).is('closed_at', null).select('id');
  if (error) {
    console.error('[sync] recordTradeClose (update) échoué:', error.message);
    return false;
  }
  if (data && data.length > 0) return true; // une ligne ouverte vient d'être clôturée → clôture NEUVE
  // aucune ligne ouverte à mettre à jour → soit ce ticket est DÉJÀ clôturé (deal livré 2×), soit position ouverte avant ce process.
  const { data: already } = await db.from('trades').select('id').eq('ticket', ticket).eq('strategy' as never, STRAT_ID as never).not('closed_at', 'is', null).limit(1);
  if (already && already.length > 0) return false; // déjà enregistrée comme clôturée → on ignore le doublon (plus de ligne en double)
  const { error: insErr } = await db.from('trades').insert({ strategy: STRAT_ID as never, ticket, symbol, ...patch }); // ligne close-only honnête
  if (insErr) { console.error('[sync] recordTradeClose (insert close-only) échoué:', insErr.message); return false; }
  return true; // clôture close-only insérée → NEUVE
}

/** Bougies stockées depuis sinceMs (ordre chronologique) — nourrit la SENTINELLE (re-validation hebdo des edges). */
export async function fetchCandles(symbol: string, timeframe: string, sinceMs: number): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('candles').select('time,open,high,low,close,volume')
      .eq('symbol', symbol).eq('timeframe', timeframe).gte('time', sinceMs)
      .order('time', { ascending: true }).range(from, from + 999);
    if (error || !data?.length) break;
    for (const c of data) out.push({ time: Number(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume ?? 0) });
    if (data.length < 1000) break;
  }
  return out;
}

/** Candidats à la RELANCE AUTO : prospects en onboarding depuis 1 à 21 jours, pas touchés (nudge) depuis 3 jours.
 *  Le vocal perso de Mathieu reste l'arme n°1 (file manuelle dans l'admin) — ceci est le FILET pour la longue
 *  traîne qu'il n'a pas le temps de toucher. Cap appliqué par l'appelant. */
export async function fetchNudgeCandidates(): Promise<Array<{ tg_id: number; member_no: number | null; tg_username: string | null; days: number; step: number }>> {
  const now = Date.now();
  // tables « membre » hors du schéma typé du runner (comme edge_health) → cast assumé
  const raw = db as unknown as { from: (t: string) => any };
  const { data: members } = await raw
    .from('members').select('tg_id,member_no,tg_username,created_at,onboarding_step')
    .eq('status', 'onboarding')
    .gte('created_at', new Date(now - 21 * 86_400_000).toISOString())
    .lte('created_at', new Date(now - 1 * 86_400_000).toISOString());
  if (!members?.length) return [];
  const { data: nudges } = await raw
    .from('member_actions').select('tg_id')
    .eq('kind', 'nudge')
    .gte('created_at', new Date(now - 3 * 86_400_000).toISOString());
  const touched = new Set(((nudges ?? []) as Array<{ tg_id: number }>).map((n) => Number(n.tg_id)));
  return (members as Array<{ tg_id: number; member_no: number | null; tg_username: string | null; created_at: string; onboarding_step: number | null }>)
    .filter((m) => !touched.has(Number(m.tg_id)))
    .map((m) => ({ tg_id: Number(m.tg_id), member_no: m.member_no, tg_username: m.tg_username, days: Math.floor((now - Date.parse(m.created_at)) / 86_400_000), step: Number(m.onboarding_step ?? 0) }));
}

/** Trace une relance (auto ou manuelle) → kind='nudge', status='done' (jamais dans la file support). */
export async function recordNudge(tgId: number, memberNo: number | null, via: 'auto' | 'manual', note: string, text?: string) {
  // text = le DM EXACT envoyé par le bot — tracé pour le panneau BOT ACTIVITY de l'admin (« je veux voir
  // ce que le bot raconte à mes prospects » — Mathieu, 27/07)
  await (db as unknown as { from: (t: string) => any }).from('member_actions').insert({ tg_id: tgId, member_no: memberNo, kind: 'nudge', status: 'done', done_by: via, detail: { via, note, ...(text ? { text } : {}) } });
}

// ===== ÉTAT JOURNALIER PERSISTANT (table runner_day) — le latch « journée terminée » et le pic du jour
// survivent aux redémarrages. Chaque runner écrit SA stratégie (pas gaté SECONDARY : c'est un état de
// trading, pas du contenu cockpit). Vécu le 22/07 : un redeploy a fait re-trader S1 après son objectif.
export interface DayAnchor { day: string; dayStartBalance: number; dayPeak: number | null; dayDone: boolean; reason: string | null }

/** Ancre du JOUR COURANT (UTC) pour ce runner — null si première lecture du jour. */
export async function fetchDayAnchor(): Promise<DayAnchor | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await (db as any).from('runner_day').select('day,day_start_balance,day_peak,day_done,reason').eq('strategy', STRAT_ID).eq('day', today).limit(1);
  if (!data?.length) return null;
  const r = data[0];
  return { day: String(r.day), dayStartBalance: Number(r.day_start_balance), dayPeak: r.day_peak != null ? Number(r.day_peak) : null, dayDone: Boolean(r.day_done), reason: r.reason ?? null };
}

/** Upsert de l'ancre du jour (appelé à chaque changement notable : rollover, latch, pic qui monte). */
export async function saveDayAnchor(a: DayAnchor) {
  const { error } = await (db as any).from('runner_day').upsert({
    strategy: STRAT_ID, day: a.day, day_start_balance: a.dayStartBalance, day_peak: a.dayPeak,
    day_done: a.dayDone, reason: a.reason, updated_at: new Date().toISOString(),
  });
  if (error) console.error('[sync] saveDayAnchor échoué:', error.message);
}

/** SCOREBOARD du jour : P&L par stratégie (toutes) + drapeaux runner_day — le wrap VIP montre LA FLOTTE,
 *  pas une seule stratégie (un client S2 rouge voit S1/S3 vertes → « c'est le portefeuille qui compte »). */
export async function fetchDayScoreboard(): Promise<Array<{ strategy: number; net: number; trades: number; done: boolean; reason: string | null }>> {
  const today = new Date().toISOString().slice(0, 10);
  const raw = db as unknown as { from: (t: string) => any };
  const { data: rows } = await raw.from('trades').select('strategy,pnl').gte('closed_at', today).not('pnl', 'is', null);
  const { data: anchors } = await raw.from('runner_day').select('strategy,day_done,reason').eq('day', today);
  const by = new Map<number, { net: number; trades: number }>();
  for (const r of (rows ?? []) as Array<{ strategy: number | null; pnl: number }>) {
    const s = Number(r.strategy ?? 2);
    const cur = by.get(s) ?? { net: 0, trades: 0 };
    cur.net += Number(r.pnl);
    cur.trades++;
    by.set(s, cur);
  }
  const flags = new Map<number, { done: boolean; reason: string | null }>();
  for (const a of (anchors ?? []) as Array<{ strategy: number; day_done: boolean; reason: string | null }>) flags.set(Number(a.strategy), { done: Boolean(a.day_done), reason: a.reason ?? null });
  return [1, 2, 3].map((s) => ({ strategy: s, net: by.get(s)?.net ?? 0, trades: by.get(s)?.trades ?? 0, done: flags.get(s)?.done ?? false, reason: flags.get(s)?.reason ?? null }));
}

/** MEILLEUR trade gagnant depuis `sinceIso` (toutes stratégies) — pour « Trade du jour / de la semaine ». */
export async function fetchTopTrade(sinceIso: string): Promise<{ symbol: string; pnl: number; strategy: number } | null> {
  const { data } = await db.from('trades').select('symbol,pnl,strategy' as never).gte('closed_at', sinceIso).not('pnl', 'is', null).order('pnl', { ascending: false }).limit(1);
  const t = data?.[0] as { symbol?: string; pnl?: number; strategy?: number } | undefined;
  if (!t || Number(t.pnl) <= 0) return null;
  return { symbol: String(t.symbol ?? 'XAUUSD'), pnl: Number(t.pnl), strategy: Number(t.strategy ?? 2) };
}

/** Net FLOTTE (toutes stratégies) par jour UTC sur N jours — pour séries de jours verts + records. */
export async function fetchFleetDailyNets(days = 14): Promise<Array<{ day: string; net: number }>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db.from('trades').select('closed_at,pnl').gte('closed_at', since).not('pnl', 'is', null).not('closed_at', 'is', null);
  const by = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ closed_at: string; pnl: number }>) {
    const day = new Date(r.closed_at).toISOString().slice(0, 10);
    by.set(day, (by.get(day) ?? 0) + Number(r.pnl));
  }
  return [...by.entries()].map(([day, net]) => ({ day, net })).sort((a, b) => a.day.localeCompare(b.day));
}

/** Dernier contexte marché (régime/vol/force) + prix or — pour le briefing du matin. */
export async function fetchLatestContext(): Promise<{ regime: string; adx: number; atrPct: number; price: number } | null> {
  const { data: s } = await db.from('state_snapshots').select('regime,adx,atr_percentile').order('ts', { ascending: false }).limit(1);
  const { data: c } = await db.from('candles').select('close').eq('symbol', 'XAUUSD').eq('timeframe', 'M5').order('time', { ascending: false }).limit(1);
  if (!s?.[0]) return null;
  const row = s[0] as { regime?: string; adx?: number; atr_percentile?: number };
  return { regime: String(row.regime ?? 'range'), adx: Number(row.adx ?? 0), atrPct: Number(row.atr_percentile ?? 0), price: Number((c?.[0] as { close?: number } | undefined)?.close ?? 0) };
}

/** Bulletin de santé d'un edge (sentinelle hebdo) → table edge_health. */
export async function recordEdgeHealth(row: { strategy: string; windowDays: number; trades: number; winRate: number | null; profitFactor: number | null; net: number; status: string }) {
  const { error } = await (db as any).from('edge_health').insert({
    strategy: row.strategy, window_days: row.windowDays, trades: row.trades,
    win_rate: row.winRate, profit_factor: row.profitFactor, net: row.net, status: row.status,
  });
  if (error) console.error('[sync] recordEdgeHealth échoué:', error.message);
}

/** Date du dernier passage de la sentinelle (null si jamais) — pour rattraper un check manqué au boot. */
export async function lastEdgeHealthCheck(): Promise<number | null> {
  const { data } = await (db as any).from('edge_health').select('checked_at').order('checked_at', { ascending: false }).limit(1);
  return data?.[0]?.checked_at ? Date.parse(data[0].checked_at as string) : null;
}

/** Une position SWING est-elle déjà ouverte sur ce symbole ? (slot swing = 1 position de fond max, survit aux reboots). */
export async function hasOpenSwingTrade(symbol: string): Promise<boolean> {
  const { data } = await db.from('trades').select('id').eq('symbol', symbol).eq('strategy' as never, STRAT_ID as never).is('closed_at', null).ilike('signal_ref', '%-swing-%').limit(1);
  return !!data?.length;
}

/**
 * Demandes d'adhésion MÛRES à approuver (auto-approbation, 31/07) : en attente depuis plus de
 * `minAgeMin` minutes, jamais tentées, et dont on connaît le chat_id (les demandes d'avant le
 * déploiement n'en ont pas → elles restent manuelles). Le délai laisse au DM d'onboarding le temps
 * d'être lu et évite l'effet « robot qui accepte à la milliseconde ».
 */
export async function listRipeJoinRequests(minAgeMin: number, limit = 25): Promise<Array<{ id: number; chat_id: number; user_id: number; username: string | null }>> {
  const cutoff = new Date(Date.now() - minAgeMin * 60_000).toISOString();
  const { data } = await (db as any).from('telegram_joins')
    .select('id,chat_id,user_id,username')
    .eq('status', 'waiting').is('approved_at', null)
    .not('chat_id', 'is', null).not('user_id', 'is', null)
    .lt('joined_at', cutoff)
    .order('joined_at', { ascending: true }).limit(limit) as { data: Array<{ id: number; chat_id: number; user_id: number; username: string | null }> | null };
  return data ?? [];
}

/** Trace la tentative d'approbation (succès : erreur nulle). Le passage en 'accepted' vient du webhook
 *  chat_member — ici on ne pose que le garde anti-boucle. */
export async function markJoinApproved(id: number, error: string | null): Promise<void> {
  await (db as any).from('telegram_joins').update({ approved_at: new Date().toISOString(), approve_error: error }).eq('id', id);
}

/** Positions SWING ouvertes (ticket + direction + entrée) — pour l'assurance week-end : fermer les
 *  PERDANTES le vendredi soir (étude 28-29/07 : les 2 stops de −1 850$ du dim. 26 étaient des swings
 *  portés sur le week-end Trump ; les gagnantes, protégées par leur trailing, continuent de courir). */
export async function listOpenSwingTrades(symbol: string): Promise<Array<{ ticket: string; direction: 'long' | 'short'; entry: number }>> {
  const { data } = await db.from('trades').select('ticket,direction,entry').eq('symbol', symbol).eq('strategy' as never, STRAT_ID as never).is('closed_at', null).ilike('signal_ref', '%-swing-%');
  return (data ?? []).map((r: Record<string, unknown>) => ({ ticket: String(r.ticket), direction: r.direction === 'short' ? 'short' : 'long', entry: Number(r.entry) }));
}

/**
 * Positions ENCORE OUVERTES en base, avec le stop D'ORIGINE du signal qui les a créées.
 *
 * Sert à RESTAURER la gestion post-entrée après un redémarrage du runner (voir runner/index.ts). La gestion
 * custom — breakeven tardif, paliers, trailing — ne vivait qu'en mémoire du process ; or le runner redémarre
 * à chaque déploiement, et un swing tient des JOURS. On lit donc `signals.stop_loss`, le stop INITIAL, jamais
 * `trades.sl` qui est le stop COURANT : après un breakeven il vaut ~l'entrée, et le risque recalculé dessus
 * serait quasi nul — tous les seuils en R exploseraient.
 */
export async function listOpenTradesWithInitialStop(symbol: string): Promise<Array<{ ticket: string; ref: string; entry: number; stopLoss: number }>> {
  const { data } = await db.from('trades').select('ticket,signal_ref,entry').eq('symbol', symbol).eq('strategy' as never, STRAT_ID as never).is('closed_at', null);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return [];
  const refs = rows.map((r) => String(r.signal_ref));
  const { data: sigs } = await db.from('signals').select('ref,entry,stop_loss').in('ref', refs).eq('strategy' as never, STRAT_ID as never);
  const byRef = new Map((sigs ?? []).map((s: Record<string, unknown>) => [String(s.ref), s]));
  const out: Array<{ ticket: string; ref: string; entry: number; stopLoss: number }> = [];
  for (const r of rows) {
    const s = byRef.get(String(r.signal_ref));
    const stopLoss = Number(s?.stop_loss ?? 0);
    if (!stopLoss) continue; // ordre nu (sans SL) → rien à gérer, c'est voulu
    out.push({ ticket: String(r.ticket), ref: String(r.signal_ref), entry: Number(s?.entry ?? r.entry), stopLoss });
  }
  return out;
}

/** Timestamp (ms) de la dernière bougie stockée pour symbol/timeframe — null si aucune. Sert au warm boot du runner. */
export async function latestCandleTime(symbol: string, timeframe = 'M5'): Promise<number | null> {
  const { data } = await db.from('candles').select('time').eq('symbol', symbol).eq('timeframe', timeframe).order('time', { ascending: false }).limit(1);
  return data?.[0]?.time != null ? Number(data[0].time) : null;
}

/** Tickets des trades OUVERTS en base depuis > graceMs qui n'existent plus chez le broker (candidats fantômes). */
export async function listGhostOpenTrades(symbol: string, liveTickets: string[], graceMs = 120_000): Promise<string[]> {
  // SCOPE STRATÉGIE : sans ce filtre, chaque runner voyait les trades ouverts des AUTRES stratégies,
  // ne trouvait pas leurs tickets chez SON broker → les fermait en « reconcile » (P&L perdu). Bug constaté 20/07.
  const { data, error } = await db.from('trades').select('ticket,opened_at').eq('symbol', symbol).eq('strategy' as never, STRAT_ID as never).is('closed_at', null);
  if (error || !data?.length) return [];
  const live = new Set(liveTickets.map(String));
  const cutoff = Date.now() - graceMs;
  return data.filter((t) => !live.has(String(t.ticket)) && new Date(t.opened_at as string).getTime() < cutoff).map((t) => String(t.ticket));
}

/** Fallback : ferme des fantômes SANS données de clôture (reason='reconcile', P&L inconnu). */
export async function closeGhostTrades(tickets: string[]): Promise<number> {
  if (!tickets.length) return 0;
  const { error } = await db.from('trades').update({ closed_at: new Date().toISOString(), reason: 'reconcile' }).in('ticket', tickets).eq('strategy' as never, STRAT_ID as never).is('closed_at', null);
  if (error) {
    console.error('[sync] closeGhostTrades échoué:', error.message);
    return 0;
  }
  return tickets.length;
}

/**
 * Réconciliation anti-fantômes : ferme en base les trades marqués OUVERTS qui n'existent plus chez le broker
 * (fermés à la main sur MT5, ou clôture ratée par le DealRecorder, ou runner redémarré). reason='reconcile', P&L inconnu.
 * Garde-fou : ne touche QUE les trades ouverts depuis > graceMs → jamais une position fraîche pas encore synchronisée.
 * Retourne le nombre de fantômes nettoyés.
 */
export async function reconcileOpenTrades(symbol: string, liveTickets: string[], graceMs = 120_000): Promise<number> {
  // SCOPE STRATÉGIE : sans ce filtre, chaque runner voyait les trades ouverts des AUTRES stratégies,
  // ne trouvait pas leurs tickets chez SON broker → les fermait en « reconcile » (P&L perdu). Bug constaté 20/07.
  const { data, error } = await db.from('trades').select('ticket,opened_at').eq('symbol', symbol).eq('strategy' as never, STRAT_ID as never).is('closed_at', null);
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

/** Stats des trades CLÔTURÉS aujourd'hui (UTC), hors micro-scalps RAFALE (spam show) — pour le RECAP horaire du desk. */
export async function fetchDayTradeStats(): Promise<{ trades: number; wins: number; net: number } | null> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const iso = dayStart.toISOString();
  const [tr, sg] = await Promise.all([
    db.from('trades').select('ticket,pnl').gte('closed_at', iso).not('pnl', 'is', null).eq('strategy' as never, STRAT_ID as never),
    db.from('signals').select('ticket,rationale').gte('created_at', iso),
  ]);
  if (tr.error || !tr.data) return null;
  const rafale = new Set((sg.data ?? []).filter((s) => JSON.stringify(s.rationale ?? '').includes('RAFALE')).map((s) => String(s.ticket)));
  const rows = tr.data.filter((t) => !rafale.has(String(t.ticket)));
  const wins = rows.filter((t) => Number(t.pnl) > 0).length;
  const net = rows.reduce((a, t) => a + Number(t.pnl), 0);
  return { trades: rows.length, wins, net };
}

export async function pushState(ctx: MarketContext, state: EngineState, mode: Mode = 'normal') {
  if (SECONDARY) return; // le cockpit affiche l'état du master S2 uniquement
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
  if (SECONDARY) return; // S2 écrit déjà les mêmes bougies (même broker) — pas de doublons
  await db.from('candles').upsert(
    { symbol, timeframe, time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
    { onConflict: 'symbol,timeframe,time' },
  );
}

/** Upsert en masse (backfill d'historique). Découpé en lots pour encaisser un gros backfill (ex. 20k bougies M1). */
export async function logCandles(symbol: string, bars: Bar[], timeframe = 'M5') {
  if (SECONDARY) return;
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
