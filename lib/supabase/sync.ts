import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import type { Database } from './database.types';
import type { Bar, EngineEvent, EngineState, MarketContext, Mode, Signal } from '../engine/types';
import { isPermanentTelegramFailure } from '../member/telegramErrors';

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
/** tg_id → date du dernier refus DÉFINITIF de Telegram (bot bloqué, compte supprimé…). Partagé par les deux
 *  files de relance : voir le commentaire « qui a fermé la porte au bot » dans fetchNudgeCandidates. */
async function fetchBlockedSince(raw: { from: (t: string) => any }): Promise<Map<number, number>> {
  const { data: failed } = await raw
    .from('member_actions').select('tg_id,detail,created_at')
    .eq('kind', 'nudge').eq('status', 'failed');
  const blockedSince = new Map<number, number>();
  for (const f of (failed ?? []) as Array<{ tg_id: number; detail: { error?: string } | null; created_at: string }>) {
    if (!isPermanentTelegramFailure(f.detail?.error)) continue;
    const t = Number(f.tg_id); const at = Date.parse(f.created_at);
    if ((blockedSince.get(t) ?? 0) < at) blockedSince.set(t, at);
  }
  return blockedSince;
}

export async function fetchNudgeCandidates(): Promise<Array<{ tg_id: number; member_no: number | null; tg_username: string | null; days: number; step: number }>> {
  const now = Date.now();
  // tables « membre » hors du schéma typé du runner (comme edge_health) → cast assumé
  const raw = db as unknown as { from: (t: string) => any };
  // FENÊTRE 21 → 60 JOURS (14/08, décision Mathieu : « certains ont besoin de 30/40 jours avant d'être
  // prêts »). Vrai dans ce métier : le frein n'est pas l'intérêt, c'est le moment où l'argent est
  // disponible. Quelqu'un qui s'inscrit en fin de mois peut n'avoir de quoi déposer que six semaines plus
  // tard, et il n'y a aucune raison de le rayer entre-temps.
  const { data: members } = await raw
    .from('members').select('tg_id,member_no,tg_username,created_at,onboarding_step')
    .eq('status', 'onboarding')
    .gte('created_at', new Date(now - 60 * 86_400_000).toISOString())
    .lte('created_at', new Date(now - 1 * 86_400_000).toISOString());
  if (!members?.length) return [];
  // CADENCE DÉGRESSIVE — indispensable dès qu'on élargit. À 3 jours d'intervalle sur 60 jours, chacun
  // recevrait une VINGTAINE de DM : ce n'est plus une relance, c'est du harcèlement, et ça se paie en
  // blocages du bot. On garde le rythme serré tant que la décision est chaude (2 semaines), puis on
  // espace : hebdomadaire jusqu'à un mois, toutes les deux semaines au-delà.
  const cooldownDays = (days: number): number => (days <= 14 ? 3 : days <= 30 ? 7 : 14);
  const { data: nudges } = await raw
    .from('member_actions').select('tg_id,created_at')
    .eq('kind', 'nudge')
    // SEULS LES ENVOIS RÉUSSIS COMPTENT. Un cooldown mesure « depuis quand cette personne n'a pas été
    // DÉRANGÉE » — un DM que Telegram a refusé n'a dérangé personne. Sans cette garde, un membre que le
    // bot n'arrive pas à joindre se ferait imposer 3 à 14 jours de silence à chaque tentative ratée,
    // c'est-à-dire exactement l'inverse de ce que la relance doit faire.
    .eq('status', 'done')
    .gte('created_at', new Date(now - 15 * 86_400_000).toISOString()); // couvre le plus long cooldown
  const lastNudge = new Map<number, number>();
  for (const n of (nudges ?? []) as Array<{ tg_id: number; created_at: string }>) {
    const t = Number(n.tg_id); const at = Date.parse(n.created_at);
    if ((lastNudge.get(t) ?? 0) < at) lastNudge.set(t, at);
  }
  // ── QUI A FERMÉ LA PORTE AU BOT ────────────────────────────────────────────────────────────────────
  // Sans ça, la relance automatique retente indéfiniment ceux qui ont bloqué le bot : chaque nuit, un
  // appel Telegram qui échoue à coup sûr, et une ligne 'failed' de plus en base. Ça ne dérange personne
  // (le message n'arrive pas) mais ça pollue le journal et ça masque les vrais problèmes d'envoi.
  //
  // La CHRONOLOGIE tranche, jamais la simple existence d'un refus passé : quelqu'un peut débloquer le bot.
  // Un envoi réussi postérieur au dernier refus rouvre donc le canal, et la personne redevient candidate.
  const blockedSince = await fetchBlockedSince(raw);
  return (members as Array<{ tg_id: number; member_no: number | null; tg_username: string | null; created_at: string; onboarding_step: number | null }>)
    .map((m) => ({ tg_id: Number(m.tg_id), member_no: m.member_no, tg_username: m.tg_username, days: Math.floor((now - Date.parse(m.created_at)) / 86_400_000), step: Number(m.onboarding_step ?? 0) }))
    .filter((m) => {
      const blocked = blockedSince.get(m.tg_id);
      if (blocked && (lastNudge.get(m.tg_id) ?? 0) < blocked) return false;
      const last = lastNudge.get(m.tg_id);
      return !last || now - last > cooldownDays(m.days) * 86_400_000;
    })
    // LES PLUS RÉCENTS D'ABORD (03/09/2026, décision Mathieu : « priorité aux nouveaux »). Sans tri, la liste
    // arrivait dans l'ordre de la base (les plus anciens en tête) et le plafond quotidien du runner servait
    // toujours les mêmes : mesuré le 03/09, sur 920 prospects dans la fenêtre, les 217 inscrits de la
    // semaine n'avaient JAMAIS reçu un message, et les 149 de plus d'un mois l'avaient tous reçu. Le J+1 est
    // le message qui compte — la décision est chaude — et c'était le seul qui ne partait jamais. À
    // ancienneté égale, celui qui a déjà franchi une étape (step 1 : broker choisi, MT5 en cours) passe avant.
    .sort((a, b) => a.days - b.days || b.step - a.step);
}

/**
 * RELANCE DES DOSSIERS EN ATTENTE (03/09/2026). Un membre `pending_copier` a déposé et rempli le formulaire :
 * c'est le prospect le plus chaud du système, et jusqu'ici il ne recevait PLUS RIEN (fetchNudgeCandidates ne
 * regarde que `onboarding`). Or la moitié des dossiers attendent le LOT D'ACTIVATION que le membre n'a pas
 * déclaré — le seul geste qui débloque son copieur, et il ne sait pas qu'il le bloque.
 *  · lot NON déclaré → un rappel à 24 h, puis tous les 3 jours, avec les deux ordres à passer ;
 *  · lot déclaré ou broker à attendre (compte préexistant) → UN seul message rassurant à 24 h, jamais répété :
 *    répéter « rien à faire de ton côté » pendant que l'équipe tarde serait pire que le silence.
 * Les relances de cette file se reconnaissent à leur note `PENDING …` dans member_actions.
 */
export async function fetchPendingNudgeCandidates(): Promise<Array<{ tg_id: number; member_no: number | null; locale: 'en' | 'it'; days: number; claimed: boolean }>> {
  const now = Date.now();
  const raw = db as unknown as { from: (t: string) => any };
  const { data: members } = await raw.from('members').select('tg_id,member_no,locale').eq('status', 'pending_copier');
  if (!members?.length) return [];
  const ids = (members as Array<{ tg_id: number }>).map((m) => Number(m.tg_id));
  const [{ data: cards }, { data: nudges }, blockedSince] = await Promise.all([
    raw.from('member_actions').select('tg_id,created_at,detail').eq('kind', 'connect').eq('status', 'pending').in('tg_id', ids),
    raw.from('member_actions').select('tg_id,created_at').eq('kind', 'nudge').eq('status', 'done').like('detail->>note', 'PENDING%').in('tg_id', ids),
    fetchBlockedSince(raw),
  ]);
  // la carte la plus récente par membre
  const card = new Map<number, { at: number; detail: Record<string, unknown> }>();
  for (const c of (cards ?? []) as Array<{ tg_id: number; created_at: string; detail: Record<string, unknown> | null }>) {
    const t = Number(c.tg_id); const at = Date.parse(c.created_at);
    if ((card.get(t)?.at ?? 0) < at) card.set(t, { at, detail: c.detail ?? {} });
  }
  const lastNudge = new Map<number, number>();
  for (const n of (nudges ?? []) as Array<{ tg_id: number; created_at: string }>) {
    const t = Number(n.tg_id); const at = Date.parse(n.created_at);
    if ((lastNudge.get(t) ?? 0) < at) lastNudge.set(t, at);
  }
  const out: Array<{ tg_id: number; member_no: number | null; locale: 'en' | 'it'; days: number; claimed: boolean }> = [];
  for (const m of members as Array<{ tg_id: number; member_no: number | null; locale: string | null }>) {
    const t = Number(m.tg_id);
    const c = card.get(t);
    if (!c) continue; // pending sans carte en attente : rattrapage manuel, pas une relance
    const age = now - c.at;
    if (age < 86_400_000 || age > 60 * 86_400_000) continue; // jamais avant 24 h ; au-delà de 60 j c'est un dossier mort
    const blocked = blockedSince.get(t);
    const last = lastNudge.get(t);
    if (blocked && (last ?? 0) < blocked) continue;
    const d = c.detail;
    const claimed = !!d.lots_claimed_at || d.lots_ok === true || !!d.waiting_broker;
    if (claimed ? last != null : last != null && now - last < 3 * 86_400_000) continue;
    out.push({ tg_id: t, member_no: m.member_no, locale: m.locale === 'it' ? 'it' : 'en', days: Math.floor(age / 86_400_000), claimed });
  }
  return out.sort((a, b) => Number(a.claimed) - Number(b.claimed) || a.days - b.days);
}

/** Membres censés copier (live) ou en passe de l'être (pending_copier), avec un compte MT renseigné —
 *  le périmètre de l'audit STH quotidien (runner). 'paused' exclu : masterless EXPRÈS. */
export async function listCopierMembers(): Promise<Array<{ tg_id: number; member_no: number | null; tg_username: string | null; tg_name: string | null; status: string; strategy: number | null; lot: number | null }>> {
  const raw = db as unknown as { from: (t: string) => any };
  const { data } = await raw.from('members').select('tg_id,member_no,tg_username,tg_name,status,strategy,lot')
    .in('status', ['live', 'pending_copier']).not('mt5_login', 'is', null).limit(500);
  return (data ?? []) as Array<{ tg_id: number; member_no: number | null; tg_username: string | null; tg_name: string | null; status: string; strategy: number | null; lot: number | null }>;
}

/** Note privée sur la fiche d'un membre (timeline admin). */
export async function addMemberNote(tgId: number, memberNo: number | null, text: string, by = 'runner'): Promise<void> {
  await (db as unknown as { from: (t: string) => any }).from('member_actions').insert({ tg_id: tgId, member_no: memberNo, kind: 'note', status: 'done', done_by: by, detail: { text } });
}

/**
 * CE QUI ATTEND LE PROPRIÉTAIRE, en une requête — pour le rappel quotidien (runner) : dossiers de connexion
 * en attente (avec l'âge du plus vieux et combien ont déclaré leur lot), retraits demandés. Une carte
 * bloquée depuis cinq jours doit se distinguer d'une carte arrivée ce matin : c'est l'âge qui le dit.
 */
export async function fetchOwnerDigest(): Promise<{ pending: number; oldestHours: number; lotsClaimed: number; payouts: number; payoutsUsd: number }> {
  const raw = db as unknown as { from: (t: string) => any };
  const [{ data: cards }, { data: payouts }] = await Promise.all([
    raw.from('member_actions').select('created_at,detail').eq('kind', 'connect').eq('status', 'pending'),
    raw.from('referral_payouts').select('amount').eq('status', 'requested'),
  ]);
  const now = Date.now();
  const rows = (cards ?? []) as Array<{ created_at: string; detail: Record<string, unknown> | null }>;
  const oldest = rows.reduce((m, r) => Math.max(m, now - Date.parse(r.created_at)), 0);
  return {
    pending: rows.length,
    oldestHours: Math.round(oldest / 3_600_000),
    lotsClaimed: rows.filter((r) => r.detail?.lots_claimed_at || r.detail?.lots_ok).length,
    payouts: (payouts ?? []).length,
    payoutsUsd: ((payouts ?? []) as Array<{ amount: number }>).reduce((s, p) => s + Number(p.amount), 0),
  };
}

/** Trace une relance (auto ou manuelle) → kind='nudge', status='done' (jamais dans la file support). */
export async function recordNudge(tgId: number, memberNo: number | null, via: 'auto' | 'manual', note: string, text?: string, error?: string | null) {
  // text = le DM EXACT envoyé par le bot — tracé pour le panneau BOT ACTIVITY de l'admin (« je veux voir
  // ce que le bot raconte à mes prospects » — Mathieu, 27/07)
  //
  // `error` → status='failed' : un DM que Telegram a REFUSÉ n'est pas un contact, et l'écrire 'done' était
  // le défaut à l'origine de la file de relances bouchée (25/08). Ces lignes-là comptaient comme « touché »
  // — donc la personne disparaissait 3 jours puis revenait, indéfiniment, sans avoir jamais rien reçu.
  // Le statut 'failed' la sort des cooldowns ET la rend reconnaissable par le filtre « a bloqué le bot ».
  await (db as unknown as { from: (t: string) => any }).from('member_actions').insert({
    tg_id: tgId, member_no: memberNo, kind: 'nudge', status: error ? 'failed' : 'done', done_by: via,
    detail: { via, note, ...(text ? { text } : {}), ...(error ? { error } : {}) },
  });
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
/**
 * Le formulaire de connexion de compte refuse-t-il tout le monde ? Renvoie les tentatives des `hours`
 * dernières heures : total, acceptées, et le motif dominant des refus.
 *
 * NÉ D'UNE PANNE DE 24 H (16/08/2026) — une vérification ajoutée la veille refusait TOUTES les
 * soumissions, découverte seulement parce que des membres ont écrit au support.
 * On ne surveille PAS le volume : sur 31 jours, 6 sont naturellement à zéro inscription. Une alarme de
 * volume sonnerait un jour sur cinq et serait ignorée. Le taux de refus, lui, ne dépend pas du trafic.
 */
export async function funnelHealth(hours = 6): Promise<{ total: number; ok: number; members: number; topReason: string | null }> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await (db as unknown as { from: (t: string) => any })
    .from('funnel_attempts').select('ok,reason,tg_id').gte('at', since) as { data: Array<{ ok: boolean; reason: string | null; tg_id: number | null }> | null };
  const rows = data ?? [];
  const counts = new Map<string, number>();
  for (const r of rows) if (!r.ok && r.reason) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const topReason = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // members : nombre de PERSONNES distinctes, pas de tentatives. C'est ce qui sépare une panne d'un
  // membre qui s'acharne — voir le seuil dans le runner.
  const members = new Set(rows.filter((r) => r.tg_id != null).map((r) => r.tg_id)).size;
  return { total: rows.length, ok: rows.filter((r) => r.ok).length, members, topReason };
}

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
export async function listRipeJoinRequests(minAgeMin: number, limit = 25, excludeChatIds: number[] = []): Promise<Array<{ id: number; chat_id: number; user_id: number; username: string | null }>> {
  const cutoff = new Date(Date.now() - minAgeMin * 60_000).toISOString();
  // L'EXCLUSION SE FAIT ICI, EN SQL, ET C'EST VOLONTAIRE. Filtrer côté appelant après coup paraîtrait
  // équivalent — ça ne l'est pas : le tri est « les plus anciennes d'abord » et la limite s'applique AVANT
  // le filtre. Des demandes exclues qui restent en attente (le VIP, que Mathieu valide à la main) sont donc
  // les plus vieilles de la file : au bout de 25 accumulées, elles rempliraient la page à elles seules et
  // plus AUCUNE adhésion du canal public ne serait approuvée. Une file d'attente volontaire ne doit jamais
  // affamer le reste du système.
  let q = (db as any).from('telegram_joins')
    .select('id,chat_id,user_id,username')
    .eq('status', 'waiting').is('approved_at', null)
    .not('chat_id', 'is', null).not('user_id', 'is', null)
    .lt('joined_at', cutoff);
  const excl = excludeChatIds.filter((id) => Number.isFinite(id) && id !== 0);
  if (excl.length) q = q.not('chat_id', 'in', `(${excl.join(',')})`);
  const { data } = await q.order('joined_at', { ascending: true }).limit(limit) as { data: Array<{ id: number; chat_id: number; user_id: number; username: string | null }> | null };
  return data ?? [];
}

/**
 * Demandes d'adhésion au canal VIP dont le LOT D'ACTIVATION EST VALIDÉ — les seules que le bot approuve.
 *
 * ── POURQUOI CE CHEMIN SÉPARÉ (01/09/2026, décision Mathieu) ────────────────────────────────────────
 * Le VIP a fait l'aller-retour complet. Auto-approuvé jusqu'au 21/08, il laissait entrer quiconque
 * recevait un lien transféré. Passé en manuel, il est retombé sur le problème d'avant : « je n'ai même
 * pas le temps de les voir » — donc personne n'entrait, ou tout le monde, selon la semaine de Mathieu.
 *
 * Le volume tradé tranche à sa place, et c'est ce qui rend l'automatisation défendable cette fois : le
 * bot n'accorde plus l'accès à qui a un lien, il l'accorde à qui a REMPLI SA PART. Celui qui a validé
 * entre en 3 minutes sans déranger personne ; celui qui n'a rien tradé reste en attente et a désormais
 * une raison très concrète de s'exécuter — l'accès VIP devient la contrepartie visible du lot.
 *
 * `lots_ok` est écrit par un humain qui a pointé le dashboard partenaire (voir lib/member/activation.ts) :
 * un membre ne peut donc pas s'ouvrir le VIP en cochant une case dans l'app. La déclaration ne suffit pas.
 * Un forçage motivé (`lots_override`) ouvre aussi — c'est la même porte de secours que pour le copieur,
 * et elle reste tracée.
 */
export async function listRipeVipRequests(minAgeMin: number, vipChatId: number, limit = 25): Promise<Array<{ id: number; chat_id: number; user_id: number; username: string | null }>> {
  if (!Number.isFinite(vipChatId) || vipChatId === 0) return [];
  const cutoff = new Date(Date.now() - minAgeMin * 60_000).toISOString();
  const raw = db as unknown as { from: (t: string) => any };
  const { data: waiting } = await raw.from('telegram_joins')
    .select('id,chat_id,user_id,username')
    .eq('status', 'waiting').is('approved_at', null)
    .eq('chat_id', vipChatId).not('user_id', 'is', null)
    .lt('joined_at', cutoff)
    .order('joined_at', { ascending: true }).limit(limit) as { data: Array<{ id: number; chat_id: number; user_id: number; username: string | null }> | null };
  if (!waiting?.length) return [];
  // Une seule requête pour tout le lot : on ne veut pas N appels quand la file remonte d'un coup.
  const ids = [...new Set(waiting.map((w) => Number(w.user_id)))];
  const { data: cards } = await raw.from('member_actions')
    .select('tg_id,detail').eq('kind', 'connect').in('tg_id', ids) as { data: Array<{ tg_id: number; detail: Record<string, unknown> | null }> | null };
  const cleared = new Set<number>();
  for (const c of cards ?? []) {
    const d = c.detail ?? {};
    // même règle que le verrou du copieur : validation humaine OU forçage motivé
    if (d.lots_ok === true || (typeof d.lots_override === 'string' && d.lots_override.trim())) cleared.add(Number(c.tg_id));
  }
  return waiting.filter((w) => cleared.has(Number(w.user_id)));
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

/** Positions de TENDANCE (D1) ouvertes sur ce symbole — slot séparé du swing (signal_ref *-trend-*), relu en
 *  base à chaque décision journalière : l'état survit aux redémarrages, jamais en mémoire seule. */
export async function listOpenTrendTrades(symbol: string): Promise<Array<{ ticket: string; direction: 'long' | 'short'; entry: number }>> {
  const { data } = await db.from('trades').select('ticket,direction,entry').eq('symbol', symbol).eq('strategy' as never, STRAT_ID as never).is('closed_at', null).ilike('signal_ref', '%-trend-%');
  return (data ?? []).map((r: Record<string, unknown>) => ({ ticket: String(r.ticket), direction: r.direction === 'short' ? 'short' : 'long', entry: Number(r.entry) }));
}

/** Positions de ZONE (cassure de la veille + retest) ouvertes sur ce symbole — slot séparé (signal_ref *-zone-*),
 *  relu en base à chaque retest : une position de zone à la fois, l'état survit aux redémarrages. */
export async function listOpenZoneTrades(symbol: string): Promise<Array<{ ticket: string; direction: 'long' | 'short'; entry: number }>> {
  const { data } = await db.from('trades').select('ticket,direction,entry').eq('symbol', symbol).eq('strategy' as never, STRAT_ID as never).is('closed_at', null).ilike('signal_ref', '%-zone-%');
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
  // Toutes stratégies confondues, puis on PRÉFÈRE la ligne de ce runner. Repli volontaire : jusqu'au 04/08
  // un index unique sur `ref` seul faisait perdre leur ligne à deux runners sur trois (le premier qui
  // écrivait gagnait), donc d'anciennes positions n'ont aucune ligne à leur propre stratégie. Se rabattre
  // sur celle d'un autre runner est exact ici : le stop d'un signal ne dépend pas de la stratégie — il vaut
  // `entrée − slAtr × ATR`, calculé par l'instrument. Ce que la stratégie change, c'est QUELS signaux sont
  // pris et ce qu'il advient du stop ENSUITE, pas sa distance à l'entrée.
  // `strategy` : colonne ajoutée par migration, absente des types générés — même cast que partout ailleurs ici
  const { data: sigs } = await (db as any).from('signals').select('ref,entry,stop_loss,strategy').in('ref', refs) as { data: Array<Record<string, unknown>> | null };
  const byRef = new Map<string, Record<string, unknown>>();
  for (const s of sigs ?? []) {
    const key = String(s.ref);
    if (!byRef.has(key) || Number(s.strategy) === STRAT_ID) byRef.set(key, s);
  }
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

/**
 * DISCIPLINE DU JOUR — la matière factuelle d'un bilan de journée ROUGE.
 *
 * Un jour rouge, le membre n'a pas besoin qu'on lui promette demain : il a besoin de voir qu'un système
 * a tourné. Ces trois chiffres le prouvent sans rien affirmer — combien de signaux ont été REFUSÉS par
 * les filtres, combien de positions ont été remontées à un stop protégé, et quelle a été la pire perte
 * de la journée en R (c'est-à-dire : le risque a-t-il tenu dans ce qui était prévu à l'entrée).
 * Le 17/08, la machine a refusé 21 signaux pour 3 pris — c'est ça, la preuve qu'il y a une méthode.
 */
export async function fetchDayDiscipline(): Promise<{ vetoed: number; secured: number; worstR: number | null }> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const iso = dayStart.toISOString();
  const [ev, tr] = await Promise.all([
    (db as any).from('events').select('level,msg').gte('ts', iso) as Promise<{ data: Array<{ level: string; msg: string }> | null }>,
    db.from('trades').select('r').gte('closed_at', iso).not('r', 'is', null),
  ]);
  const rows = ev.data ?? [];
  const worst = (tr.data ?? []).map((t) => Number(t.r)).filter((r) => Number.isFinite(r));
  return {
    vetoed: rows.filter((e) => e.level === 'veto').length,
    secured: rows.filter((e) => e.level === 'order' && e.msg.includes('stop secured')).length,
    worstR: worst.length ? Math.min(...worst) : null,
  };
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
