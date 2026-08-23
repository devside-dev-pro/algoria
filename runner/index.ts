import 'dotenv/config';
import './env-check'; // valide les variables d'env et arrête net avec un message clair si une manque
import { connectMaster } from './metaapi/client';
import { loadHistory, makeAggregator, backfill } from './metaapi/candles';
import { readState } from './metaapi/state';
import { postVip, vipReady, VIP_TAG, usd, VIP_RULE } from './telegram';
import { SECONDARY } from '../lib/supabase/sync';
import { placeSignal, closeAll, closePosition } from './metaapi/execution';
import { manageBreakeven, rememberManagement, hasManagement } from './metaapi/manage';
import { DealRecorder } from './metaapi/trades';
import { narrate, narrateRecap, narrateLossReview, narrationReady, deskMeta, type DeskKind } from './llm/narrate';
import { runTick } from '../lib/engine/pipeline';
import { checkRisk } from '../lib/engine/risk';
import { breakoutSignal } from '../lib/engine/breakout';
import { swingSignal, swingMinBars } from '../lib/engine/swing';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { activeInstruments, type InstrumentSpec } from '../lib/engine/instruments';
import { ACTIVE_STRATEGY } from '../lib/engine/strategies';
import { portfolioVeto, PORTFOLIO } from '../lib/engine/portfolio';
import { FEATURES } from '../lib/engine/features';
import { refreshCalendar, newsWindows, dueAnnouncements, calendarFresh, imminentHighImpact } from './news';

// Horizon de la protection avant publication : à T−5 min d'une annonce USD fort impact, les positions en
// profit sont verrouillées au breakeven+. Aligné sur le rappel desk « T−5 » — on prévient et on protège
// au même moment, plutôt que d'annoncer un risque qu'on ne couvre pas.
const NEWS_GUARD_MIN = 5;
import { pushToAdmins } from '../lib/push/send';
import { startTikTok, stopTikTok } from './tiktok';
import { runSentinel } from './sentinel';
import { lastEdgeHealthCheck } from '../lib/supabase/sync';
import { logEvents, logSignal, pushState, logCandle, logCandles, logNarration, logNote, recordTradeOpen, recordTradeClose, listGhostOpenTrades, closeGhostTrades, latestCandleTime, broadcastTick, watchCommands, fetchDayTradeStats, hasOpenSwingTrade, listOpenSwingTrades, listOpenTradesWithInitialStop, listRipeJoinRequests, markJoinApproved, recordLiveComment, fetchNudgeCandidates, recordNudge, fetchDayAnchor, saveDayAnchor, fetchDayScoreboard, fetchTopTrade, fetchFleetDailyNets, fetchLatestContext, funnelHealth, fetchDayDiscipline } from '../lib/supabase/sync';
import type { Bar, Confluence, EngineState, MarketContext, Mode, Signal } from '../lib/engine/types';

const TF = '5m';
const ACTION_MS = 20_000; // mode Action : un trade toutes les ~20s
const ACTION_HOLD_MS = 9_000; // mode Action : on ferme la position auto après ~9s (open/close → écran vivant)
const MANUAL_LOT = 0.1; // lot par défaut d'un trade manuel (pilotable via le payload)
const ACTION_LOT = 0.05; // lot du mode Action (petit, juste pour l'animation)
const RAFALE_LOT = 0.05; // lot de la RAFALE (petit — c'est du SHOW, pas un edge ; brûle des frais)
const RAFALE_MIN_MS = 9_000; // cadence RAFALE : entre ~9 et ~21 s (variable → 3-5 trades/min, pas robotique)
const RAFALE_JITTER_MS = 12_000;
const RAFALE_MAX_OPEN = 4; // cap d'empilement (jamais de hedge — voir rafaleTick)
const BACKFILL_PAGES: Record<string, number> = { M1: 20, M5: 5, M15: 5, H1: 5, D1: 5 };
const r2 = (x: number) => Math.round(x * 100) / 100;

// Un MOTEUR par instrument : encapsule état, agrégateur, boucle onClosed, exécution, réconciliation.
// Le runner en lance un par instrument actif du registre. L'or (primaire) porte en plus le cockpit
// mono-symbole (pushState/broadcastTick/events/narration) + les modes show (Action/Rafale/manuel).
interface Engine {
  inst: InstrumentSpec;
  isPrimary: boolean;
  // ASYNCHRONE depuis le 12/08 : le tick attend ensureManagement avant de lancer la gestion des stops,
  // sinon une position orpheline est gérée au défaut scalp (voir le bloc dans `tick`). L'appelant DOIT
  // donc rattraper le rejet — un try/catch synchrone ne suffit plus.
  tick: () => Promise<void>; // appelé chaque seconde par la boucle partagée
  reconcile: () => void; // appelé chaque 60 s par la boucle partagée
  pushAccount: () => Promise<void>; // snapshot compte (balance/equity/day P&L) — 60 s, primaire uniquement
  executeSignal: (signal: Signal) => Promise<string | undefined>;
  buildManualSignal: (direction: 'long' | 'short', opts?: ManualOpts) => Signal | null;
  setAction: (on: boolean) => void;
  setRafale: (on: boolean) => void;
}

type ManualOpts = { lot?: number; sl?: number; tp?: number; tight?: boolean; ultraTight?: boolean };

/** Courte lecture marché (anglais) pour l'analyse de perte VIP — dérivée du régime + de la volatilité. */
function marketRead(ctx: import('../lib/engine/types').MarketContext): string {
  const vol = ctx.atrPercentile >= 0.7 ? 'a very volatile' : ctx.atrPercentile <= 0.3 ? 'a slow, tricky' : 'a';
  return ctx.regime === 'range'
    ? `${vol} choppy market with no clean direction — the toughest backdrop for a momentum system`
    : `${vol} session that kept reversing — the trend flipped right after entries`;
}

async function main() {
  console.log('[algoria] runner démarre…');
  const { account, stream, terminal } = await connectMaster();

  const instruments = activeInstruments();
  if (!instruments.length) throw new Error('[algoria] aucun instrument actif dans le registre (lib/engine/instruments.ts)');
  console.log(`[algoria] instruments actifs : ${instruments.map((i) => `${i.display}(${i.broker})`).join(', ')} · TF ${TF}`);
  console.log(`[algoria] narration ${narrationReady() ? 'ON (Claude)' : 'OFF — ajoute ANTHROPIC_API_KEY dans .env'}`);
  console.log(`[algoria] risque portefeuille · max ${PORTFOLIO.maxOpenPositions} positions (total) · ${PORTFOLIO.maxPositionsPerInstrument} par instrument`);

  // ===== État PARTAGÉ à tous les instruments =====
  // mode + kill switch sont globaux (un seul cockpit les pilote). Chaque instrument a en revanche son
  // propre EngineState (spread, tradesToday, balance…) et sa propre boucle moteur.
  let mode: Mode = 'scalp'; // défaut SCALP = edge validé « trade souvent » ; survit aux redémarrages Railway.
  let killed = false; // kill switch global : coupe l'auto + les modes show sur TOUS les instruments.
  const startedAt = Date.now();

  // ===== Backfill optionnel de symboles SUPPLÉMENTAIRES (pour backtester un instrument pas encore au registre) =====
  // Piloté par env, one-shot au démarrage. Accepte une LISTE (séparée par virgule/espace) → un seul redeploy suffit
  // pour préparer plusieurs paires. Ex: BACKFILL_EXTRA=EURUSD,GBPUSD,USDJPY,DJ30 → ~2 semaines de M1/M5 chacun.
  const extras = (process.env.BACKFILL_EXTRA ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !instruments.some((i) => i.broker === s)); // ceux déjà au registre sont déjà backfillés
  for (const sym of extras) {
    try {
      await stream.subscribeToMarketData(sym);
      for (const tf of ['M1', 'M5', 'M15', 'H1', 'D1']) {
        const hist = await backfill(account, sym, tf, BACKFILL_PAGES[tf] ?? 5);
        if (hist.length) await logCandles(sym, hist, tf);
        console.log(`[algoria] backfill EXTRA ${sym} ${tf}: ${hist.length} bougies`);
      }
    } catch (e) {
      console.error(`[algoria] backfill EXTRA ${sym} échoué (symbole introuvable chez le broker ?):`, e);
    }
  }

  // ===== Fabrique d'un moteur pour UN instrument =====
  const setupInstrument = async (inst: InstrumentSpec, isPrimary: boolean): Promise<Engine> => {
    const BROKER = inst.broker; // nom EXACT du symbole chez le broker (ex. "Gold", "NAS100")
    const DISPLAY = inst.display; // label stocké/affiché dans le cockpit (ex. "XAUUSD")

    await stream.subscribeToMarketData(BROKER);

    // Enregistre la CLÔTURE des trades (deals de sortie) de CET instrument dans Supabase → perf honnête.
    const dealRecorder = new DealRecorder(BROKER, DISPLAY);
    stream.addSynchronizationListener(dealRecorder);

    // WARM BOOT : si les données M5 en base sont fraîches (< 15 min), on SAUTE le backfill profond —
    // un redémarrage (redeploy) reprend le live en secondes au lieu de ~3 min par instrument. Sans ça,
    // le prix restait figé au boot ET le DealRecorder du 2ᵉ instrument s'attachait trop tard pour
    // rattraper les clôtures survenues pendant la coupure (fenêtre de replay 5 min dépassée).
    const lastM5 = await latestCandleTime(DISPLAY, 'M5');
    const freshMin = lastM5 != null ? (Date.now() - lastM5) / 60_000 : Infinity;
    if (freshMin < 15) {
      console.log(`[algoria] warm boot ${DISPLAY} — données fraîches (M5 il y a ${freshMin.toFixed(0)} min), backfill sauté`);
    } else {
      // Backfill d'historique profond (chart + backtest), tous les timeframes, pour CET instrument.
      for (const tf of ['M1', 'M5', 'M15', 'H1', 'D1']) {
        try {
          const hist = await backfill(account, BROKER, tf, BACKFILL_PAGES[tf] ?? 5);
          await logCandles(DISPLAY, hist, tf);
          console.log(`[algoria] backfill ${DISPLAY} ${tf}: ${hist.length} bougies`);
        } catch (e) {
          console.error(`[algoria] backfill ${DISPLAY} ${tf} échoué (getHistoricalCandles non supporté ?):`, e);
        }
      }
    }

    const seed = await loadHistory(account, BROKER, TF, 300);
    let state: EngineState = readState(terminal, BROKER, { dayStartBalance: terminal.accountInformation?.balance });
    // RESTAURATION du jour : le latch « journée terminée » + le pic du jour survivent aux redémarrages.
    // Sans ça, un redeploy re-anchore dayStartBalance sur le solde courant → S1 re-trade après son objectif
    // (vécu 22/07 10:00 UTC) et le ratchet oublie le pic du matin.
    try {
      const anchor = await fetchDayAnchor();
      if (anchor && anchor.day === state.dayStamp) {
        state = { ...state, dayStartBalance: anchor.dayStartBalance, dayPnL: state.equity - anchor.dayStartBalance, dayPeak: anchor.dayPeak ?? state.dayPeak, dayDone: anchor.dayDone || state.dayDone, dayDoneReason: (anchor.reason as EngineState['dayDoneReason']) ?? state.dayDoneReason };
        console.log(`[algoria] ancre du jour restaurée — dayStart=${anchor.dayStartBalance} done=${anchor.dayDone}${anchor.reason ? ` (${anchor.reason})` : ''}`);
      }
    } catch (e) {
      console.error('[algoria] restauration ancre du jour échouée:', e);
    }
    // dernière ancre écrite (dédup) — persistée par le moteur PRIMAIRE uniquement (état compte global)
    let savedAnchor = '';
    let hardClosedDay = ''; // CAP DUR : jour où on a déjà fermé les positions au cap de perte (une seule fois/jour)

    // Canal VIP : mémoire locale pour ne pas spammer — dernière direction de setup publiée + annonce "journée finie".
    // Un dayDone RESTAURÉ depuis l'ancre est déjà annoncé (vécu 23/07 00h : S1 a ré-annoncé « daily target hit »
    // d'HIER après un restart — vrai fait, mauvais moment) → on arme le drapeau si le latch vient de la base.
    let lastVipSetup = { dir: '', at: 0 };
    let vipDayDoneAnnounced = Boolean(state.dayDone);

    /** Chemin d'exécution PARTAGÉ (auto + manuel + action) pour CET instrument. Retourne le ticket, ou undefined si échec. */
    const executeSignal = async (signal: Signal): Promise<string | undefined> => {
      try {
        const res = await placeSignal(stream, signal, BROKER);
        state.tradesToday++;
        state.lastTradeTime = signal.time;
        await logSignal(signal, { ...res, status: 'placed' });
        if (res.ticket) {
          if (signal.stopLoss > 0) dealRecorder.remember(res.ticket, signal); // R calculable seulement si SL connu
          await recordTradeOpen({
            ticket: res.ticket,
            signalRef: signal.id,
            symbol: DISPLAY,
            direction: signal.direction,
            entry: signal.entry,
            lot: signal.lot,
            openedAt: signal.time,
            sl: signal.stopLoss > 0 ? signal.stopLoss : undefined, // SL initial → suivi live (BE/trailing)
          });
        }
        console.log('[algoria] ORDRE', signal.direction, BROKER, signal.lot, '→', res.ticket);
        return res.ticket;
      } catch (e) {
        const err = e as { message?: string; stringCode?: string; numericCode?: number; details?: unknown };
        const detail = [err.stringCode ? `code=${err.stringCode}` : '', err.numericCode != null ? `num=${err.numericCode}` : '', err.details ? `details=${JSON.stringify(err.details)}` : ''].filter(Boolean).join(' / ');
        const reason = `${err.message ?? String(e)}${detail ? ' / ' + detail : ''}`;
        await logNote(`order failed · ${signal.direction} ${BROKER} ${signal.lot} lot · ${reason}`, 'veto');
        await logSignal(signal, { code: reason.slice(0, 250), status: 'rejected' });
        console.error('[algoria] échec ordre:', e);
        return undefined;
      }
    };

    /** Trade au PRIX COURANT. SL/TP optionnels (fournis par le cockpit) ; sinon « nu » → l'utilisateur gère la sortie. */
    const buildManualSignal = (direction: 'long' | 'short', opts: ManualOpts = {}): Signal | null => {
      const p = terminal.price(BROKER);
      if (!p?.bid || !p?.ask) return null;
      const price = r2((p.bid + p.ask) / 2);
      const auto = opts.tight || opts.ultraTight; // SL/TP auto serrés → c'est le BROKER qui clôture (clôture propre)
      const lot = opts.lot && opts.lot > 0 ? opts.lot : auto ? ACTION_LOT : MANUAL_LOT;
      const dir = direction === 'long' ? 1 : -1;
      let stopLoss = typeof opts.sl === 'number' && opts.sl > 0 ? r2(opts.sl) : 0;
      let takeProfits = typeof opts.tp === 'number' && opts.tp > 0 ? [r2(opts.tp)] : [];
      if (auto && !stopLoss && !takeProfits.length) {
        // RAFALE (ultraTight) : TP/SL très serrés → ouverture/clôture rapides (1-5/min). ACTION : un peu plus large.
        const d = opts.ultraTight ? Math.max(price * 0.0003, 0.3) : Math.max(price * 0.0008, 0.5);
        stopLoss = r2(price - dir * d);
        takeProfits = [r2(price + dir * d)];
      }
      const custom = stopLoss > 0 || takeProfits.length > 0;
      const confluence: Confluence = { direction, rawScore: 0, alignment: 0, quality: 0, macro: 0, confidence: 1, contributions: [] };
      return {
        id: `${DISPLAY}-${Date.now()}-${direction}`,
        symbol: DISPLAY,
        time: Date.now(),
        direction,
        mode,
        confidence: 1,
        entry: price,
        stopLoss,
        takeProfits,
        riskReward: 0,
        lot,
        rationale: [opts.ultraTight ? 'RAFALE — micro-scalp' : opts.tight ? 'ACTION mode — auto trade' : `MANUAL ${direction.toUpperCase()} trade${custom ? ' (custom SL/TP)' : ' at market'}`],
        confluence,
      };
    };

    // ===== Mode ACTION (SHOW, primaire) : ouvre des positions nues et les ferme après ~9s → écran toujours vivant =====
    let actionTimer: ReturnType<typeof setInterval> | null = null;
    let actionPrev = 0;
    const actionTick = async () => {
      if (killed) return; // le kill switch coupe aussi le mode action
      const p = terminal.price(BROKER);
      if (!p?.bid || !p?.ask) return;
      const mid = (p.bid + p.ask) / 2;
      const positions = ((terminal.positions ?? []) as any[]).filter((x) => x.symbol === BROKER);
      const longs = positions.filter((x) => x.type === 'POSITION_TYPE_BUY').length;
      const shorts = positions.length - longs;
      let dir: 'long' | 'short';
      if (positions.length === 0) {
        dir = mid >= actionPrev ? 'long' : 'short'; // a plat -> on suit le micro-momentum
      } else {
        // EN POSITION : jamais le sens oppose (pas de hedge). On REMPILE seulement dans le sens existant ET si en drawdown.
        if (positions.length >= 3) { actionPrev = mid; return; } // cap d'empilement (max 3)
        const unrealized = positions.reduce((acc, x) => acc + Number(x.profit ?? x.unrealizedProfit ?? 0), 0);
        if (unrealized >= 0) { actionPrev = mid; return; } // en profit -> on laisse courir
        dir = longs >= shorts ? 'long' : 'short'; // en drawdown -> on renforce le sens existant
      }
      actionPrev = mid;
      const sig = buildManualSignal(dir, { tight: true });
      if (sig) await executeSignal(sig);
    };
    const setAction = (on: boolean) => {
      if (on && !actionTimer) {
        actionTimer = setInterval(() => void actionTick(), ACTION_MS);
        void logNote('● ACTION mode ON — Algoria sends trades continuously', 'order');
      } else if (!on && actionTimer) {
        clearInterval(actionTimer);
        actionTimer = null;
        void logNote('ACTION mode OFF', 'info');
      }
    };

    // ===== RAFALE (SHOW, primaire) : micro-scalps ultra-serrés (fermés par le broker) à 3-5/min, cadence variable.
    let rafaleOn = false;
    let rafaleTimer: ReturnType<typeof setTimeout> | null = null;
    let rafalePrev = 0;
    const scheduleRafale = () => {
      if (!rafaleOn) return;
      rafaleTimer = setTimeout(() => void rafaleTick(), RAFALE_MIN_MS + Math.floor(Math.random() * RAFALE_JITTER_MS));
    };
    const rafaleTick = async () => {
      try {
        if (killed) return; // le kill switch coupe aussi la rafale
        const p = terminal.price(BROKER);
        if (!p?.bid || !p?.ask) return;
        const mid = (p.bid + p.ask) / 2;
        const positions = ((terminal.positions ?? []) as any[]).filter((x) => x.symbol === BROKER);
        if (positions.length >= RAFALE_MAX_OPEN) {
          rafalePrev = mid;
          return; // cap d'empilement atteint → on attend que ça se ferme
        }
        const longs = positions.filter((x) => x.type === 'POSITION_TYPE_BUY').length;
        const shorts = positions.length - longs;
        // direction : micro-momentum si à plat, sinon on RENFORCE le sens existant (jamais l'opposé → pas de hedge)
        const dir: 'long' | 'short' = positions.length === 0 ? (mid >= rafalePrev ? 'long' : 'short') : longs >= shorts ? 'long' : 'short';
        rafalePrev = mid;
        const sig = buildManualSignal(dir, { lot: RAFALE_LOT, ultraTight: true });
        if (sig) await executeSignal(sig);
      } finally {
        scheduleRafale(); // se replanifie toujours tant que la rafale est ON
      }
    };
    const setRafale = (on: boolean) => {
      if (on && !rafaleOn) {
        rafaleOn = true;
        void logNote('⚡ RAFALE ON — continuous micro-scalps (show, not an edge — small lot, burns fees)', 'order');
        scheduleRafale();
      } else if (!on && rafaleOn) {
        rafaleOn = false;
        if (rafaleTimer) clearTimeout(rafaleTimer);
        rafaleTimer = null;
        void logNote('RAFALE OFF', 'info');
      }
    };

    // Dernier contexte marché vu (pour les snapshots compte 60 s entre deux clôtures M5)
    let lastCtx: import('../lib/engine/types').MarketContext | null = null;

    // ===== Boucle MOTEUR : à chaque bougie M5 clôturée, on fait tourner la confluence sur CET instrument =====
    const onClosed = async (bars: Bar[]) => {
      try {
        state = readState(terminal, BROKER, state, { targetPct: inst.config.risk.dailyProfitTargetPct, lossPct: inst.config.risk.maxDailyLossPct, lockTriggerPct: inst.config.risk.dayLockTriggerPct, lockFloorPct: inst.config.risk.dayLockFloorPct });
        // PERSISTANCE de l'ancre du jour (primaire = état compte global) : rollover, latch, ou pic qui monte (pas de 0.1%).
        if (isPrimary && state.dayStamp) {
          const peakBucket = state.dayPeak != null && state.dayStartBalance ? Math.floor(((state.dayPeak - state.dayStartBalance) / state.dayStartBalance) * 1000) : 0;
          const key = `${state.dayStamp}|${Math.round(state.dayStartBalance)}|${state.dayDone}|${state.dayDoneReason ?? ''}|${peakBucket}`;
          if (key !== savedAnchor) {
            savedAnchor = key;
            void saveDayAnchor({ day: state.dayStamp, dayStartBalance: state.dayStartBalance, dayPeak: state.dayPeak ?? null, dayDone: state.dayDone ?? false, reason: state.dayDoneReason ?? null });
          }
        }
        state.killed = killed; // le kill switch global gèle l'auto sur tous les instruments
        // CAP DUR : à l'instant où la journée latche sur le CAP DE PERTE, on FERME les positions ouvertes de cet
        // instrument (au lieu de les laisser courir jusqu'à leur stop, au-delà du cap). Filet live contre le
        // « la journée saigne bien au-delà de −4% » (vécu le 15/07). Une seule fois par jour. Sur objectif/ratchet
        // (target/lock) on NE ferme PAS — les gagnants sont déjà protégés par leur trailing, et le swing peut courir.
        if (state.dayDone && state.dayDoneReason === 'loss' && hardClosedDay !== state.dayStamp) {
          hardClosedDay = state.dayStamp ?? '';
          const openHere = ((terminal.positions ?? []) as any[]).filter((p) => p.symbol === BROKER);
          if (openHere.length) {
            try { await closeAll(stream, BROKER); await logNote(`🛑 daily loss cap hit — closed ${openHere.length} open position(s) to bound the day`, 'veto'); }
            catch (e) { console.error('[algoria] hard-cap close échec:', e); }
          }
        }
        state.newsWindows = newsWindows(); // annonces éco USD fort impact → checkRisk refuse les entrées autour
        // mode scalp = config scalp VALIDÉE de l'instrument (l'or et le Nasdaq n'ont pas la même). NORMAL → DEFAULT strict.
        const cfg = mode === 'scalp' ? inst.config : DEFAULT_CONFIG;
        // SCALP : on injecte le contexte propre à l'instrument (session asia, gate vol élargi, roundStep) + le spread live.
        const ctxOpts = mode === 'scalp' ? { spread: state.spread, ...inst.ctx } : { spread: state.spread };
        const { signal, events, context, confluence, threshold, blocked, blockedReasons } = runTick({ symbol: DISPLAY, bars, mode, state, ctxOpts }, FEATURES, cfg);
        lastCtx = context;
        await logCandle(DISPLAY, bars[bars.length - 1], 'M5');
        // WATCH-ONLY (ex. BTC) : le desk lit et raconte le marché, mais l'auto ne tire JAMAIS — aucun edge
        // validé. Le signal éventuel devient une simple « opportunity » à l'écran (le manuel reste possible).
        // S3 (intraday='breakout') : le scalp de confluence est ÉTEINT → le breakout devient le moteur principal
        // (le bloc breakout ci-dessous tire dès que autoSignal est null). Décorrélation phase 2 — voir strategies.ts.
        let autoSignal = inst.watchOnly || ACTIVE_STRATEGY.intraday === 'breakout' ? null : signal;
        // FILTRE DE SESSION scalp (étude 29/07, validé « go tout ») : pas de nouvelle entrée confluence
        // sur les heures où le live saigne (S2/S3 : 12-17h UTC — walk-forward +9 198$ vs prod −405$ OOS).
        // Les positions ouvertes et les autres couches (breakout, swing) ne sont PAS concernées.
        if (autoSignal && ACTIVE_STRATEGY.blockScalpEntryUtcHours?.some(([from, to]) => { const h = new Date().getUTCHours(); return h >= from && h < to; })) {
          await logSignal(autoSignal, { code: 'session filter: no new scalp entries 12-17h UTC (étude 29/07)', status: 'rejected' });
          autoSignal = null;
        }
        if (autoSignal) {
          // Garde-fou PORTEFEUILLE (global) au-dessus des limites par-symbole : on ne laisse pas l'or + le Nasdaq
          // (+ Forex à venir) empiler des positions corrélées. N'affecte que l'auto (manuel/show restent libres).
          const veto = portfolioVeto({ positions: (terminal.positions ?? []) as any[], symbol: BROKER });
          if (veto) {
            await logSignal(autoSignal, { code: `portfolio: ${veto}`.slice(0, 250), status: 'rejected' });
            if (isPrimary) await logNote(`${DISPLAY}: trade bloqué — ${veto}`, 'veto');
          } else {
            const ticket = await executeSignal(autoSignal);
            // GESTION CUSTOM scalp (BE propre à la stratégie + paliers + trailing), avec riskDist FIGÉ à
            // l'entrée (après un BE, |open−SL| ne mesure plus le risque initial — même raison que le breakout).
            // ⚠️ La condition portait AUTREFOIS sur le seul trailing. Conséquence silencieuse : S1, qui n'a pas
            // de trailing, ne recevait AUCUNE gestion custom — donc manage.ts:63 retombait sur
            // DEFAULT_CONFIG.beTrigger (0.15) et ignorait purement et simplement le beTrigger 0.10 posé sur S1
            // le 10/08. Le réglage était en base de code et sans effet en production. On teste donc désormais
            // la présence de N'IMPORTE QUELLE gestion custom, pas du seul trailing.
            const hasCustomMgmt = cfg.beTrigger != null || cfg.ladder != null || (cfg.trailActivate != null && cfg.trailDist != null);
            if (ticket && hasCustomMgmt && autoSignal.stopLoss > 0)
              rememberManagement(ticket, {
                beTrigger: cfg.beTrigger ?? 0,
                ladder: cfg.ladder,
                trailActivate: cfg.trailActivate,
                trailDist: cfg.trailDist,
                riskDist: Math.abs(autoSignal.entry - autoSignal.stopLoss),
              });
          }
        }

        // ===== CANAL VIP : une fois la journée d'une stratégie bouclée (dayDone : objectif / cap / ratchet),
        // CHAQUE runner annonce SA fin de journée (étiquetée) — le canal montre la vie des 3 stratégies.
        // Les setups manuels restent S2 uniquement (sinon 3× le même spam).
        if (isPrimary && !inst.watchOnly && vipReady()) {
          if (!state.dayDone) vipDayDoneAnnounced = false; // ré-armé au reset quotidien
          else if (!vipDayDoneAnnounced) {
            vipDayDoneAnnounced = true;
            if (state.dayDoneReason === 'loss') {
              // ANALYSE DE PERTE — rassurer les VIP : pourquoi c'était dur (marché) + discipline/contrôle.
              const why = marketRead(context);
              const stats = await fetchDayTradeStats().catch(() => null);
              const clause = narrationReady()
                ? await narrateLossReview({ trades: stats?.trades ?? 0, wins: stats?.wins ?? 0, net: stats?.net ?? 0, regime: context.regime, adx: context.adx, atrPct: context.atrPercentile })
                : null;
              void postVip(
                `🛡️ <b>${VIP_TAG} — day closed, downside protected</b>\n\n${why} — a cluster of stops, not a drift. The daily cap did its job: your loss is bounded for the day.${clause ? `\n\n<i>${clause}</i>` : ''}\n\nWe never force trades. Fresh start tomorrow. 🔁`,
              );
            } else if (state.dayDoneReason === 'lock') {
              // RATCHET : journée verrouillée EN PROFIT après un pic — message positif (on protège les gains).
              void postVip(`🔒 <b>${VIP_TAG} — gains locked, wrapped for the day</b>\n\nThe day peaked, gave a little back, and the safety ratchet closed the book <b>while still green</b>. Profit protected — no give-back spiral.`);
            } else {
              void postVip(`✅ <b>${VIP_TAG} — daily target hit</b>\n\nWrapped up for the day. Small consistent days — that's the plan working. 👊`);
            }
          }
          const blockedForDay = !SECONDARY && state.dayDone && blocked && (blockedReasons?.some((r) => r.includes('day closed')) ?? false);
          if (blockedForDay && blocked) {
            const now = Date.now();
            // anti-spam : un post seulement si la direction change OU 30 min se sont écoulées depuis le dernier
            if (blocked.direction !== lastVipSetup.dir || now - lastVipSetup.at > 30 * 60_000) {
              lastVipSetup = { dir: blocked.direction, at: now };
              const arrow = blocked.direction === 'long' ? '🔼 LONG' : '🔽 SHORT';
              void postVip(
                `🎯 <b>MANUAL SETUP</b> · ${DISPLAY}\n${VIP_RULE}\n${arrow}  ·  conviction <b>${(blocked.confidence * 100) | 0}%</b>\nEntry  <code>~ ${blocked.entry}</code>\n🛑 SL  <code>${blocked.stopLoss}</code>\n🎯 TP  <code>${blocked.takeProfits[0]}</code>\n${VIP_RULE}\n<i>${VIP_TAG} is done for the day (other strategies may still be running) — this one's over to you. Indicative levels, your risk, your call.</i>`,
              );
            }
          }
        }

        // ===== 2ᵉ STRATÉGIE : BREAKOUT Donchian (instruments qui l'ont validée au labo — l'or). ADDITIVE :
        // le scalp garde la priorité sur la bougie ; le breakout ne tire que si le scalp n'a rien pris ET que
        // TOUS les garde-fous passent (risque par-symbole via checkRisk — 1 pos/symbole, spread, kill,
        // news lockout — puis veto portefeuille). Gestion post-entrée SPÉCIFIQUE : BE tardif + trailing.
        let bkSignal: Signal | null = null;
        if (!autoSignal && inst.breakout && !inst.watchOnly && mode === 'scalp' && !state.killed) {
          bkSignal = breakoutSignal(DISPLAY, bars, inst.breakout, mode, cfg.priceStep ?? 0.01);
          if (bkSignal) {
            const risk = checkRisk(bkSignal, state, cfg);
            const veto = risk.ok ? portfolioVeto({ positions: (terminal.positions ?? []) as any[], symbol: BROKER }) : null;
            if (!risk.ok) {
              await logSignal(bkSignal, { code: `risk: ${risk.reasons.join(' · ')}`.slice(0, 250), status: 'rejected' });
              bkSignal = null;
            } else if (veto) {
              await logSignal(bkSignal, { code: `portfolio: ${veto}`.slice(0, 250), status: 'rejected' });
              bkSignal = null;
            } else {
              const ticket = await executeSignal(bkSignal);
              if (ticket) {
                rememberManagement(ticket, {
                  beTrigger: inst.breakout.beTrigger,
                  trailActivate: inst.breakout.trailActivate,
                  trailDist: inst.breakout.trailDist,
                  riskDist: Math.abs(bkSignal.entry - bkSignal.stopLoss),
                });
              } else bkSignal = null; // échec d'envoi → le desk ne le raconte pas comme un trade
            }
          }
        }
        const executed = autoSignal ?? bkSignal; // ce que le desk raconte comme TRADE (scalp ou breakout)

        // Feed d'events + état COMPTE (balance/equity global) → PRIMAIRE uniquement (canaux mono-symbole partagés).
        if (isPrimary) {
          await logEvents(events);
          await pushState(context, state, mode);
        }

        // Desk : émis PAR instrument, tagué symbole (meta.instrument). Le cockpit multi-symbole filtre dessus →
        // chaque marché a son propre hero/état/narration. On émet TOUJOURS le meta structuré (hero vivant même sans LLM).
        const kind: DeskKind = executed ? 'trade' : confluence && confluence.direction !== 'flat' && confluence.confidence >= threshold * 0.7 ? 'opportunity' : 'analysis';
        // Setup vu mais BLOQUÉ par le filtre de tendance EMA → le desk l'assume ("discipline") au lieu de
        // promettre des setups jamais exécutés (l'incohérence visible en live).
        const emaGate = cfg.emaGate ?? 'off';
        const gated = !!confluence && confluence.direction !== 'flat' && (
          (emaGate === 'align' && context.emaBias !== confluence.direction) ||
          (emaGate === 'notOpposed' && ((confluence.direction === 'long' && context.emaBias === 'short') || (confluence.direction === 'short' && context.emaBias === 'long')))
        );
        // Micro-résumé de la tape (3 dernières bougies) → clauses qui réagissent au marché, pas génériques.
        const last3 = bars.slice(-3);
        const rng3 = last3.length ? Math.max(...last3.map((b) => b.high)) - Math.min(...last3.map((b) => b.low)) : 0;
        const priceAction = `last 3 bars ${last3.map((b) => (b.close >= b.open ? 'green' : 'red')).join(',')} · 3-bar range ${(rng3 / (context.atr || 1)).toFixed(1)}×ATR · close ${bars[bars.length - 1].close >= last3[0].open ? 'above' : 'below'} 15m open`;
        // Trade breakout → la confluence du desk est celle DU SIGNAL (barre "breakout"), pas celle du scalp.
        const deskConf = bkSignal ? bkSignal.confluence : confluence;
        const meta = deskMeta(kind, context, { signal: executed, confluence: deskConf, threshold, gated });
        let clause: string | null = null;
        if (narrationReady()) {
          clause = await narrate(
            kind === 'trade'
              ? { kind, ctx: context, signal: executed, confluence: deskConf, threshold }
              : kind === 'opportunity'
                ? { kind, ctx: context, confluence, threshold, gated }
                : { kind, ctx: context, logLines: events.map((e) => e.msg), priceAction },
          );
        }
        await logNarration(clause ?? '', executed ? executed.time : context.time, meta as unknown as Record<string, unknown>);
      } catch (e) {
        console.error(`[algoria] onClosed ${DISPLAY} échoué:`, e);
      }
    };

    const agg = makeAggregator(TF, seed, onClosed);

    // ===== COUCHE SWING (H1) — la stratégie de FOND : slot séparé du scalp, lot dédié, tenue de plusieurs
    // jours avec breakeven (seuil propre au marché) puis trailing par paliers (manage.ts). Le slot survit aux reboots : l'état
    // "swing ouvert ?" est relu en base (signal_ref *-swing-*), jamais en mémoire seule.
    let swingAgg: ((bid: number, ask: number, t: number) => void) | null = null;
    if (inst.swing) {
      const SW = inst.swing;
      const onH1Closed = async (h1bars: Bar[]) => {
        try {
          await logCandle(DISPLAY, h1bars[h1bars.length - 1], 'H1'); // H1 frais en base (chart + futurs backtests)
          if (killed) return;
          if (h1bars.length < swingMinBars(SW)) return;
          if (await hasOpenSwingTrade(DISPLAY)) return; // 1 position de fond max par marché
          const sig = swingSignal(DISPLAY, h1bars, SW, mode, inst.config.priceStep ?? 0.01);
          if (!sig) return;
          // ASSURANCE WEEK-END 1/2 (étude 28-29/07, validé « go tout ») : pas de NOUVELLE position de fond
          // le vendredi ≥ 12h UTC — un swing ouvert vendredi après-midi n'a pas le temps de se protéger (BE à
          // 1R) avant le gap du dimanche (vécu le 26/07 : 2 shorts de ven. 19h → −1 850$ chacun au ré-open).
          // Backtest 21 mois : coût quasi nul ($26 663 vs $28 862) pour supprimer ce risque. Overnights intacts.
          { const now = new Date(); if (now.getUTCDay() === 5 && now.getUTCHours() >= 12) { await logSignal(sig, { code: 'week-end insurance: no new swing entries Friday ≥ 12h UTC', status: 'rejected' }); return; } }
          // garde-fous : spread + lockout news (fenêtres du calendrier éco) + veto portefeuille global
          st2: {
            const freshState = readState(terminal, BROKER, state);
            if (freshState.spread > inst.config.risk.maxSpread) { await logSignal(sig, { code: `risk: spread ${freshState.spread.toFixed(2)}`, status: 'rejected' }); break st2; }
            const inNews = newsWindows().some((w) => sig.time >= w.start - inst.config.risk.newsLockoutBeforeSec * 1000 && sig.time <= w.end + inst.config.risk.newsLockoutAfterSec * 1000);
            if (inNews) { await logSignal(sig, { code: 'risk: news lockout', status: 'rejected' }); break st2; }
            const veto = portfolioVeto({ positions: (terminal.positions ?? []) as any[], symbol: BROKER });
            if (veto) { await logSignal(sig, { code: `portfolio: ${veto}`.slice(0, 250), status: 'rejected' }); break st2; }
            const ticket = await executeSignal(sig);
            if (ticket) {
              rememberManagement(ticket, { beTrigger: SW.beTrigger, trailActivate: SW.trailActivate, trailDist: SW.trailDist, ladder: SW.ladder, riskDist: Math.abs(sig.entry - sig.stopLoss) });
              // ⚠️ seuils LUS DE LA CONFIG, jamais écrits en dur : ce texte annonçait « BE at 1R » alors que
              // le breakeven du swing or est passé à 0.5R (#296) — la note du cockpit décrivait un réglage
              // qui n'existait plus, et servait de référence pour juger le comportement du moteur.
              await logNote(`⚡ SWING ${sig.direction.toUpperCase()} ${DISPLAY} @ ${sig.entry} · SL ${sig.stopLoss} · riding for days (BE at ${SW.beTrigger}R, ${SW.trailDist}R trailing)`, 'order');
              if (vipReady() && !SECONDARY) void postVip(`📈 <b>CORE position opened</b> · ${VIP_TAG}\n<i>${DISPLAY} ${sig.direction.toUpperCase()}</i>\n${VIP_RULE}\nEntry  <code>~ ${sig.entry}</code>\n🛑 SL  <code>${sig.stopLoss}</code>\n🎯 TP  <code>${sig.takeProfits[0]}</code>\n${VIP_RULE}\n<i>This one can ride for days. Copied to your account.</i>`);
            }
          }
        } catch (e) {
          console.error(`[algoria] swing ${DISPLAY} échoué:`, e);
        }
      };
      const h1seed = await loadHistory(account, BROKER, '1h', 700).catch(() => [] as Bar[]);
      swingAgg = makeAggregator('1h', h1seed, (b) => void onH1Closed(b));
      console.log(`[algoria] couche SWING active sur ${DISPLAY} (${SW.kind}, lot ${SW.lot}) · seed H1: ${h1seed.length} bougies`);

      // ASSURANCE WEEK-END 2/2 (étude 28-29/07, validé « go tout ») : le vendredi ≥ 20h UTC (l'or clôture
      // ~21h), on ferme les swings PERDANTS — les gagnants, déjà protégés par leur BE/trailing, portent le
      // week-end (c'est eux qui font la queue grasse : +1.9R de moyenne sur les holds overweek au backtest).
      // Check toutes les 5 min sur la fenêtre 20h-21h ven. ; idempotent (une position fermée sort de la base).
      const weekendFlatLosers = async () => {
        try {
          const now = new Date();
          if (now.getUTCDay() !== 5 || now.getUTCHours() < 20) return;
          const open = await listOpenSwingTrades(DISPLAY);
          if (!open.length) return;
          const px = terminal.price(BROKER);
          if (!px) return;
          const mid = (Number(px.bid) + Number(px.ask)) / 2;
          for (const t of open) {
            const dir = t.direction === 'long' ? 1 : -1;
            if (dir * (mid - t.entry) < 0) {
              await closePosition(stream, t.ticket);
              await logNote(`🛡 WEEK-END insurance — losing swing ${t.ticket} closed before the Friday bell (winners ride, protected by their trailing)`, 'order');
            }
          }
        } catch (e) {
          console.error(`[algoria] weekend flat ${DISPLAY} échoué:`, e);
        }
      };
      setInterval(() => void weekendFlatLosers(), 5 * 60_000);
    }

    // Agrégateur M1 LÉGER : log chaque bougie M1 clôturée (chart + data fraîche backtest), sans retenir l'historique.
    let m1cur: Bar | null = null;
    const feedM1 = (mid: number, t: number) => {
      const bucket = Math.floor(t / 60_000) * 60_000;
      if (!m1cur) {
        m1cur = { time: bucket, open: mid, high: mid, low: mid, close: mid, volume: 1 };
      } else if (bucket > m1cur.time) {
        void logCandle(DISPLAY, m1cur, 'M1');
        m1cur = { time: bucket, open: mid, high: mid, low: mid, close: mid, volume: 1 };
      } else {
        m1cur.high = Math.max(m1cur.high, mid);
        m1cur.low = Math.min(m1cur.low, mid);
        m1cur.close = mid;
        m1cur.volume++;
      }
    };

    // ===== RESTAURATION DE LA GESTION POST-ENTRÉE (03/08) =====
    // `custom` (manage.ts) vit en MÉMOIRE du process. Le runner redémarre à chaque déploiement — et un swing
    // tient des JOURS. Les positions survivantes retombaient donc sur la gestion par DÉFAUT (scalp) : breakeven
    // à 0.15R au lieu de 1R, et surtout NI palier NI trailing, puisque les deux branches de manageBreakeven
    // sont sautées quand `mgmt` est absent. Le stop se figeait au breakeven pour le reste de la vie du trade,
    // en silence, et un beau trade rentrait à ~0$ — exactement ce qu'on a vu sur le swing or S2 du 03/08
    // (BE posé deux minutes après l'entrée, plus jamais remonté, alors que le trade est monté à 2.1R).
    //
    // On relit donc le stop D'ORIGINE en base (`signals.stop_loss`, JAMAIS `trades.sl` qui est le stop courant :
    // après un BE il vaut ~l'entrée, et le risque recalculé dessus serait quasi nul → tous les seuils en R
    // exploseraient). La couche se déduit du signal_ref, comme partout ailleurs.
    // Passe paresseuse et idempotente : elle ne touche QUE les positions sans gestion, donc elle rattrape aussi
    // bien un redémarrage qu'une position ouverte à la main pendant que le runner tournait.
    let lastRestore = 0;
    const ensureManagement = async () => {
      if (Date.now() - lastRestore < 60_000) return;
      const live = ((terminal.positions ?? []) as any[]).filter((x) => x.symbol === BROKER && x.stopLoss != null);
      const orphans = live.filter((x) => !hasManagement(String(x.id)));
      if (!orphans.length) return;
      lastRestore = Date.now();
      try {
        const rows = await listOpenTradesWithInitialStop(DISPLAY);
        const byTicket = new Map(rows.map((r) => [r.ticket, r]));
        for (const p of orphans) {
          const r = byTicket.get(String(p.id));
          if (!r) continue; // trade manuel / mode show : le défaut est le bon comportement
          const riskDist = Math.abs(r.entry - r.stopLoss);
          if (!riskDist) continue;
          const SWc = inst.swing;
          if (r.ref.includes('-swing-') && SWc) rememberManagement(r.ticket, { beTrigger: SWc.beTrigger, trailActivate: SWc.trailActivate, trailDist: SWc.trailDist, ladder: SWc.ladder, riskDist });
          else if (r.ref.includes('-bk-') && inst.breakout) rememberManagement(r.ticket, { beTrigger: inst.breakout.beTrigger, trailActivate: inst.breakout.trailActivate, trailDist: inst.breakout.trailDist, riskDist });
          // même correctif qu'à l'exécution (voir le bloc hasCustomMgmt) : tester TOUTE gestion custom, pas le
          // seul trailing — sinon un scalp S1 réadopté après redéploiement repartait sur le BE par défaut (0.15).
          else if (inst.config.beTrigger != null || inst.config.ladder != null || (inst.config.trailActivate != null && inst.config.trailDist != null))
            rememberManagement(r.ticket, { beTrigger: inst.config.beTrigger ?? 0, ladder: inst.config.ladder, trailActivate: inst.config.trailActivate, trailDist: inst.config.trailDist, riskDist });
          else continue; // aucune gestion custom définie → le défaut EST la gestion
          await logNote(`🔧 management restored on ${DISPLAY} position ${r.ticket} (${r.ref.includes('-swing-') ? 'swing' : r.ref.includes('-bk-') ? 'breakout' : 'scalp'} · risk ${riskDist.toFixed(2)}) — stop ladder + trailing are live again`, 'order');
        }
      } catch (e) {
        console.error('[algoria] restauration gestion échec:', (e as { message?: string })?.message ?? e);
      }
    };

    // Tick (1 s) : alimente l'agrégateur M5 + M1, diffuse le prix (primaire), gère le breakeven. Isolé du reste.
    const tick = async () => {
      const p = terminal.price(BROKER);
      if (p) {
        const quoteMs = new Date(p.time).getTime();
        const stale = Number.isFinite(quoteMs) && Date.now() - quoteMs > 90_000;
        if (!stale) {
          agg(p.bid, p.ask, Date.now());
          swingAgg?.(p.bid, p.ask, Date.now()); // agrégateur H1 de la couche swing
          feedM1((p.bid + p.ask) / 2, Date.now());
          broadcastTick(DISPLAY, p.bid, p.ask); // tick tagué symbole → le cockpit multi-symbole suit le marché choisi
        }
      }
      // ⚠️ `await`, PAS `void` — ces deux lignes portaient déjà l'intention « ensureManagement AVANT la
      // gestion », mais `void` ne fait rien attendre : manageBreakeven partait sur le MÊME tick avec la table
      // `custom` encore vide, et manage.ts appliquait alors DEFAULT_CONFIG.beTrigger (0.15R, le défaut scalp)
      // à un swing dont le breakeven doit s'armer bien plus tard. Le stop montait à l'entraînement +0.05R —
      // et comme un stop ne redescend JAMAIS, la restauration qui arrivait quelques dizaines de ms plus tard
      // ne pouvait plus rien réparer : le trade restait figé au breakeven pour le reste de sa vie.
      // Mesuré le 12/08 : 52 swings sur 58 sortis « au breakeven » SANS avoir jamais atteint 1R — ce qui est
      // impossible avec le réglage prévu, et prouve qu'ils tournaient sur le défaut scalp.
      // ensureManagement est déjà bridée à un passage par minute et sort immédiatement s'il n'y a pas
      // d'orpheline : l'attendre ne coûte rien dans le cas normal.
      await ensureManagement();
      // PROTECTION AVANT ANNONCE (12/08) : à T−5 min d'une publication USD fort impact, toute position en
      // profit passe au breakeven+ sans attendre son beTrigger. Le lockout du calendrier, lui, ne bloque que
      // les ENTRÉES — une position déjà ouverte traversait le CPI avec son stop d'origine.
      // `calendarFresh()` est exigé ici : sans calendrier à jour, `imminentHighImpact` renverrait null en
      // permanence et on croirait à tort qu'aucune annonce n'approche (voir l'alerte de fraîcheur plus bas).
      const soon = calendarFresh() ? imminentHighImpact(NEWS_GUARD_MIN) : null;
      await manageBreakeven(stream, terminal, BROKER, soon?.title ?? null); // no-op sur les ordres nus (sans SL)
    };


    // Réconciliation anti-fantômes (60 s) : un trade "ouvert" en base qui n'existe plus chez le broker a été
    // clôturé pendant une coupure (redeploy) ou à la main. On cherche d'abord la VRAIE clôture dans l'historique
    // MetaApi synchronisé (exit + P&L réels → le win s'affiche correctement) ; fallback fermeture aveugle sinon.
    const reconcile = () => {
      if (!terminal.accountInformation || Date.now() - startedAt < 120_000) return; // pas synchronisé / trop tôt → on attend
      const live = ((terminal.positions ?? []) as any[]).filter((x) => x.symbol === BROKER).map((x) => String(x.id));
      void (async () => {
        const ghosts = await listGhostOpenTrades(DISPLAY, live);
        if (!ghosts.length) return;
        const orphans: string[] = [];
        const allDeals: any[] = ((stream as any).historyStorage?.deals ?? []) as any[];
        for (const ticket of ghosts) {
          const outs = allDeals.filter((d) => String(d?.positionId) === ticket && d?.entryType === 'DEAL_ENTRY_OUT');
          if (outs.length) {
            const pnl = outs.reduce((s, d) => s + (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0), 0);
            const last = outs[outs.length - 1];
            await recordTradeClose(ticket, DISPLAY, { exit: Number(last.price) || 0, pnl, r: null, reason: pnl >= 0 ? 'win' : 'loss', closedAt: last.time ? new Date(last.time).getTime() : Date.now() });
            console.log(`[algoria] réconciliation ${DISPLAY} : clôture réelle récupérée pour ${ticket} (${pnl.toFixed(2)}$)`);
          } else {
            orphans.push(ticket);
          }
        }
        const n = await closeGhostTrades(orphans);
        if (n > 0) {
          console.log(`[algoria] réconciliation ${DISPLAY} : ${n} fantôme(s) fermé(s) sans données de clôture`);
          void logNote(`${DISPLAY}: ${n} ghost position(s) cleaned up (closed on broker, not in DB)`, 'info');
        }
      })();
    };

    // Snapshot COMPTE toutes les 60 s (balance/equity/day P&L frais entre deux clôtures M5) — sinon le
    // cockpit attend jusqu'à 5 min après un TP pour refléter le gain. Primaire uniquement (état compte global).
    // SANS bougie traitée (week-end : l'or ne tique pas → lastCtx reste vide après un boot), on pousse quand
    // même un snapshot minimal — sinon la balance du cockpit reste FIGÉE sur vendredi soir tout le week-end.
    const pushAccount = async () => {
      if (!isPrimary) return;
      state = readState(terminal, BROKER, state, { targetPct: inst.config.risk.dailyProfitTargetPct, lossPct: inst.config.risk.maxDailyLossPct, lockTriggerPct: inst.config.risk.dayLockTriggerPct, lockFloorPct: inst.config.risk.dayLockFloorPct });
      state.killed = killed;
      const ctx: MarketContext = lastCtx ?? {
        symbol: DISPLAY, time: Date.now(), price: 0, session: 'closed', regime: 'range',
        adx: 0, atr: 0, atrPercentile: 0, emaBias: 'flat', macroBias: 0, spread: state.spread, zones: [], tradable: false,
      };
      await pushState(ctx, state, mode);
    };

    return { inst, isPrimary, tick, reconcile, pushAccount, executeSignal, buildManualSignal, setAction, setRafale };
  };

  // ===== On initialise chaque instrument (le premier = primaire = l'or). Un échec d'init n'empêche pas les autres. =====
  const engines: Engine[] = [];
  for (let i = 0; i < instruments.length; i++) {
    try {
      engines.push(await setupInstrument(instruments[i], i === 0));
    } catch (e) {
      console.error(`[algoria] init instrument ${instruments[i].display} échouée — ignoré:`, e);
    }
  }
  if (!engines.length) throw new Error('[algoria] aucun instrument initialisé — arrêt');
  const primary = engines[0];
  console.log(`[algoria] ${engines.length} moteur(s) actif(s) · primaire=${primary.inst.display}`);

  // Diagnostic STRATÉGIE au boot — chaque runner/master tourne UN profil (env ALGORIA_STRATEGY, défaut S2).
  {
    console.log(`[algoria] strategy: ${ACTIVE_STRATEGY.label} · intraday ${ACTIVE_STRATEGY.intraday ?? 'scalp'}${ACTIVE_STRATEGY.intraday === 'breakout' ? ` N${ACTIVE_STRATEGY.breakoutN ?? 96}` : ` thr ${ACTIVE_STRATEGY.thresholdScalp} · RR ${ACTIVE_STRATEGY.targetRR}`} · asia ${ACTIVE_STRATEGY.tradeAsia ? 'on' : 'OFF'} · caps +${ACTIVE_STRATEGY.dailyProfitTargetPct * 100}%/−${ACTIVE_STRATEGY.maxDailyLossPct * 100}% · swing ${ACTIVE_STRATEGY.swing ? 'on' : 'off'} · breakout ${ACTIVE_STRATEGY.breakout ? 'on' : 'off'}`);
  }

  // Diagnostic canal VIP au boot — dit dans les logs Railway pourquoi ça ne poste pas (token/chat manquant).
  console.log(
    `[algoria] VIP channel: ${vipReady() ? 'ready ✓' : 'NOT ready ✗'} · TELEGRAM_BOT_TOKEN=${process.env.TELEGRAM_BOT_TOKEN ? 'set' : 'MISSING'} · TELEGRAM_VIP_CHAT=${process.env.TELEGRAM_VIP_CHAT ? 'set' : 'MISSING'} · VIP_DEMO=${process.env.VIP_DEMO === '1' ? 'on' : 'off'}`,
  );

  // ===== DÉMO CANAL VIP : pose VIP_DEMO=1 sur Railway (+ TELEGRAM_VIP_CHAT) → au boot, une salve de messages
  // d'exemple part dans le canal (un de chaque type) pour vérifier la connexion sans attendre le marché.
  // À RETIRER ensuite (sinon la démo se re-poste à chaque redéploiement).
  if (process.env.VIP_DEMO === '1' && vipReady() && !SECONDARY) {
    void (async () => {
      const demo = [
        "✅ Algoria VIP channel connected. Here's a preview of what you'll get 👇 (DEMO messages)",
        "🟢 Algoria's working · 24 trades · 83% win today",
        "📈 Algoria just opened a CORE position — GOLD LONG\nEntry ~ 4021.5 · SL 4009.0 · TP 4085.0\nThis one can ride for days. Copied to your account.",
        "✅ Algoria hit its daily target and wrapped up.\nNow in ANALYSIS MODE: the next setups are yours to take manually if you want. 👇",
        "🎯 MANUAL SETUP — GOLD\n🔽 SHORT · conviction 78%\nEntry ~ 4021.5\n🛑 SL 4028.0\n🎯 TP 4014.0\n\nAlgoria's done for the day — over to you. Indicative levels, your risk, your call.",
        "🛡️ Algoria hit its daily safety limit and stopped for the day.\nWhy: a very volatile session that kept reversing — a cluster of stops, not a drift. The cap did its job: your downside is bounded.\nDays like today's chop are the hardest for any momentum system; we protect capital and never force trades. Fresh start tomorrow. 🔁",
        "📊 DAILY WRAP\n31 trades · 79% win · green day 🟢\nAll copied to your account. See you tomorrow. 👊",
        "— End of demo. Remove VIP_DEMO from Railway variables to go live. —",
      ];
      for (const m of demo) await postVip(m);
      console.log('[algoria] VIP demo posté');
    })();
  }

  // ===== Commandes du cockpit. mode + kill sont GLOBAUX ; manuel/action/rafale visent le primaire (l'or). =====
  watchCommands((cmd) => {
    void (async () => {
      try {
        // MULTI-RUNNERS : le cockpit pilote le master S2. Les runners secondaires (S1/S3) IGNORENT les
        // commandes de show/trade manuel — sinon un « manual trade » partirait sur les 3 masters à la fois.
        // Exception SÉCURITÉ : kill/resume restent GLOBAUX (un kill coupe tout, partout, toujours).
        if (SECONDARY && cmd.type !== 'kill' && cmd.type !== 'resume') return;
        if (cmd.type === 'set_mode' && (cmd.payload as any)?.mode) {
          mode = (cmd.payload as any).mode;
        } else if (cmd.type === 'kill') {
          killed = true;
          for (const eng of engines) { eng.setAction(false); eng.setRafale(false); } // kill coupe aussi les modes show
        } else if (cmd.type === 'resume') {
          killed = false;
        } else if (cmd.type === 'manual_trade') {
          const pl = cmd.payload as any;
          const dir = pl?.direction === 'short' ? 'short' : 'long';
          const lot = typeof pl?.lot === 'number' && pl.lot > 0 ? pl.lot : undefined;
          const sl = typeof pl?.sl === 'number' && pl.sl > 0 ? pl.sl : undefined;
          const tp = typeof pl?.tp === 'number' && pl.tp > 0 ? pl.tp : undefined;
          // Routé vers le MARCHÉ affiché dans le cockpit (payload.symbol) — permet long/short manuel sur BTC
          // (watch-only pour l'auto, libre pour l'opérateur). Fallback primaire (or) pour les vieux payloads.
          const eng = engines.find((x) => x.inst.display === pl?.symbol) ?? primary;
          if (killed) {
            await logNote(`manual trade ${dir} ignored — kill switch active`, 'veto');
          } else {
            const sig = eng.buildManualSignal(dir, { lot, sl, tp });
            if (sig) await eng.executeSignal(sig);
            else await logNote(`manual trade ${dir} ignored — no live price`, 'veto');
          }
        } else if (cmd.type === 'close_all') {
          const eng = engines.find((x) => x.inst.display === (cmd.payload as any)?.symbol) ?? primary;
          try {
            await closeAll(stream, eng.inst.broker);
            await logNote(`✕ close all — ${eng.inst.display} positions closed manually`, 'order');
          } catch (e) {
            await logNote(`close all failed · ${(e as { message?: string })?.message ?? String(e)}`, 'veto');
          }
        } else if (cmd.type === 'set_action') {
          primary.setAction(!!(cmd.payload as any)?.on);
        } else if (cmd.type === 'set_rafale') {
          primary.setRafale(!!(cmd.payload as any)?.on);
        } else if (cmd.type === 'autopilot') {
          // MODE AUTOPILOT : branche/coupe le pont TikTok Live (les commentaires arrivent dans live_comments).
          // Le trading, lui, est DÉJÀ autonome — l'autopilot n'ajoute que la présence "publique" d'Algoria.
          const on = !!(cmd.payload as any)?.on;
          const ttUser = process.env.TIKTOK_USERNAME;
          if (on && !ttUser) {
            await logNote('autopilot: TIKTOK_USERNAME missing on the runner — chat bridge OFF (voice/stage still work)', 'veto');
          } else if (on && ttUser) {
            await startTikTok(ttUser, (user, text) => void recordLiveComment(user, text).catch(() => {}));
            await logNote(`🤖 AUTOPILOT ON — reading TikTok live chat of @${ttUser}`, 'info');
          } else {
            stopTikTok();
            await logNote('autopilot OFF — TikTok chat bridge closed', 'info');
          }
        } else if (cmd.type === 'close_position') {
          const ticket = String((cmd.payload as any)?.ticket ?? '');
          if (!ticket) await logNote('close_position ignored — no ticket', 'veto');
          else {
            try {
              await closePosition(stream, ticket);
              await logNote(`✕ position ${ticket} closed manually`, 'order');
            } catch (e) {
              await logNote(`failed to close position ${ticket} · ${(e as { message?: string })?.message ?? String(e)}`, 'veto');
            }
          }
        }
        console.log('[algoria] commande:', cmd.type, cmd.payload ?? '');
      } catch (e) {
        console.error('[algoria] commande échouée:', cmd.type, e);
      }
    })();
  });

  // ===== Boucles PARTAGÉES : chaque moteur est tické/réconcilié isolément (un instrument qui casse n'affecte pas les autres). =====
  setInterval(() => {
    for (const eng of engines) {
      // tick est ASYNCHRONE depuis le 12/08 (il attend ensureManagement avant la gestion) : un try/catch
      // synchrone ne rattraperait plus rien, et une promesse rejetée non gérée peut tuer le process.
      // Le .catch() est donc obligatoire ici. Les instruments restent isolés : un tick qui casse n'empêche
      // pas les autres de tourner, et le suivant repartira dans une seconde.
      void eng.tick().catch((e) => console.error(`[algoria] tick ${eng.inst.display} échoué:`, e));
    }
  }, 1000);

  setInterval(() => {
    for (const eng of engines) {
      try { eng.reconcile(); } catch (e) { console.error(`[algoria] reconcile ${eng.inst.display} échoué:`, e); }
    }
    void primary.pushAccount().catch((e) => console.error('[algoria] pushAccount échoué:', e)); // compte frais toutes les 60 s
  }, 60_000);

  // ===== CALENDRIER ÉCO : fetch au boot + toutes les 6 h, et chaque minute on émet les rappels desk
  // (T−30 et T−5 min avant chaque annonce USD fort impact). Le lockout moteur, lui, est déjà servi par
  // state.newsWindows dans onClosed — même si le desk se tait, l'auto ne rentre pas autour d'une annonce. =====
  // ALERTE DE FRAÎCHEUR (12/08) : quand le flux échoue, `events` reste vide → `newsWindows()` renvoie une
  // liste vide → il n'y a PLUS AUCUN lockout, et plus aucune protection avant publication. Rien ne le
  // signalait : une ligne de console au boot, et le moteur continuait à tirer pendant les annonces comme
  // si le calendrier était vide de tout événement. Une panne de sécurité silencieuse est pire que pas de
  // sécurité du tout — on croit être couvert. Désormais chaque tentative ratée qui laisse le cache périmé
  // (> 24 h) écrit une note et pousse une alerte aux admins.
  const CAL_ALERT_MS = 6 * 3600_000; // même alerte au plus une fois par cycle de rafraîchissement
  let lastCalAlert = 0;
  const refreshCalendarGuarded = async (boot = false) => {
    const n = await refreshCalendar();
    if (n >= 0) { console.log(`[algoria] calendrier éco : ${n} événements chargés`); return; }
    console.error(`[algoria] calendrier éco : échec${boot ? ' initial' : ''} (retry auto)`);
    if (calendarFresh()) return; // le cache tient encore : le prochain essai a le temps de passer
    if (Date.now() - lastCalAlert < CAL_ALERT_MS) return;
    lastCalAlert = Date.now();
    void logNote('⚠️ economic calendar unavailable — news lockout and pre-release stop protection are OFF until the feed returns', 'veto');
    void pushToAdmins({
      title: '⚠ CALENDRIER ÉCO INDISPONIBLE',
      body: 'Plus de lockout news ni de protection avant publication — le moteur trade sans filet macro.',
      url: '/member/admin', tag: 'eco-calendar',
    }).catch(() => {});
  };
  void refreshCalendarGuarded(true);
  setInterval(() => void refreshCalendarGuarded(), 6 * 3600_000);
  setInterval(() => {
    void (async () => {
      try {
        if (!calendarFresh()) return;
        for (const { event, minutes, slot } of dueAnnouncements()) {
          const when = new Date(event.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
          const nums = [event.forecast ? `forecast ${event.forecast}` : '', event.previous ? `prev ${event.previous}` : ''].filter(Boolean).join(' · ');
          const msg = slot === 30
            ? `${event.title} drops in ${minutes} min (${when} UTC)${nums ? ' — ' + nums : ''}. High-impact USD — auto entries pause around the release.`
            : `${event.title} in ${minutes} min — Algoria stands aside until the dust settles.`;
          await logNarration(msg, Date.now(), { kind: 'news', title: event.title, impact: event.impact, country: event.country, minutes, at: event.time, forecast: event.forecast ?? null, previous: event.previous ?? null });
          console.log(`[algoria] éco news T−${slot} : ${event.title} dans ${minutes} min`);
        }
      } catch (e) {
        console.error('[algoria] annonce éco échouée:', e);
      }
    })();
  }, 60_000);

  // ===== SENTINELLE DES EDGES : re-validation HEBDO de chaque stratégie live sur les données fraîches
  // (dimanche 12h UTC, rattrapée au boot si > 8 jours sans check). Bulletin en base + alerte push admin
  // si un edge dégrade — le moteur qui se surveille lui-même. =====
  let sentinelRunning = false;
  const maybeSentinel = async (force = false) => {
    if (sentinelRunning) return;
    const last = await lastEdgeHealthCheck();
    const due = force || last == null || Date.now() - last > 8 * 86_400_000;
    const now = new Date();
    if (!due && !(now.getUTCDay() === 0 && now.getUTCHours() === 12 && (last == null || Date.now() - last > 2 * 86_400_000))) return;
    sentinelRunning = true;
    try {
      await runSentinel();
    } catch (e) {
      console.error('[algoria] sentinelle échouée:', e);
    } finally {
      sentinelRunning = false;
    }
  };
  if (!SECONDARY) setTimeout(() => void maybeSentinel(), 3 * 60_000); // au boot (après la synchro), rattrape un check manqué
  if (!SECONDARY) setInterval(() => void maybeSentinel(), 3600_000); // check horaire → ne déclenche que dimanche 12h UTC

  // ===== RECAP HORAIRE du desk : à chaque heure pleine, une carte "SESSION RECAP" (stats réelles du jour,
  // hors BEAST) + une clause IA d'ambiance. Rythme le stream et rappelle le track record sans intervention. =====
  // ===== MACHINE D'ACTIVATION (relance auto onboarding) — le levier n°1 : 84% des inscrits ne financent jamais.
  // SÉQUENCE MULTI-TOUCH adaptée à (étape, ancienneté) au lieu d'un ping unique répété. Le vocal perso de
  // Mathieu reste l'arme ultime (file RELANCES admin) ; ceci touche automatiquement toute la longue traîne.
  // Étape 0 = mur du dépôt (broker + $500) → réchauffer par la PREUVE (vidéo académie) + réassurance.
  // Étape 1 = connexion MT5 → « tu y es presque, un pas ». Chaque jour à 10h UTC, dédup 3 j, cap 20/j.
  const ACADEMY = 'app.algoria.tech/academy';
  // Séquence par ancienneté (bucket) × étape. Touche 1 douce → preuve → adresse le mur → perso → dernier appel.
  const nudgeMessage = (step: number, days: number): { dm: string; title: string; body: string } => {
    const s0 = step <= 0; // pas encore commencé (mur du dépôt) vs étape 1 (connexion MT5)
    if (days <= 2)
      return s0
        ? { dm: `Hey — welcome to Algoria 👋\nBefore anything, watch this 2-min video from the founder — it shows exactly what you just joined and how it works:\n\n🎥 ${ACADEMY}\n\nNo rush. When you're ready, your AI is waiting.`, title: '🎥 Start here — 2 min from the founder', body: 'See what Algoria is and how it trades for you. Watch the welcome video.' }
        : { dm: `You're literally one step from live 🚀 — just connect your MT5 and Algoria starts trading for you.\n\n👉 app.algoria.tech/member/onboarding\n\nStuck? Message @mathieu_algoria, he'll walk you through it in 2 min.`, title: '🚀 One step from live', body: 'Connect your MT5 and the AI takes over. Need a hand? We got you.' };
    if (days <= 5)
      return { dm: `Quick proof while you decide 👇\nAlgoria runs 3 strategies live every day — wins, stops and the daily wrap are all posted transparently. This is the engine that would be copying to YOUR account.\n\n🎥 See how it works: ${ACADEMY}\n\nWhenever you're ready.`, title: '📊 Real trades, every day', body: '3 strategies working live. See the proof, then decide.' };
    // J+6+ : les bloqués du MUR DU DÉPÔT (s0) reçoivent l'ARME DE CLOSING — le code ALGORIA100
    // (100% de bonus de dépôt RaiseFX, confirmé cumulable avec notre lien IB). Cadré « exclusif,
    // pas public » + toujours « double ta puissance de trading » (crédit broker), JAMAIS « double
    // ton argent » (le bonus n'est pas du cash retirable). Étape 1 (s1) : déjà déposé → pas de code,
    // ce serait de la confusion pure.
    if (days <= 9)
      return s0
        ? { dm: `The only thing left is opening your broker account and a starting deposit — that's the part people overthink 🙂\n\nSo here's something I don't hand out publicly 🎁 Use the code ALGORIA100 when you fund your RaiseFX account and the broker adds 100% of your deposit in trading credit. Deposit $300 → the AI trades with $600 of buying power.\n\nAnd remember:\n• You can start from just $200 (STEADY strategy)\n• YOUR deposit stays yours — withdraw it anytime\n• Risk is capped every single day\n\n👉 app.algoria.tech/member/onboarding\nWant me to walk you through it live? → @mathieu_algoria`, title: '🎁 Exclusive code: ALGORIA100', body: '100% deposit bonus at RaiseFX — double your trading power. Not public, use it while it lasts.' }
        : { dm: `You're SO close — the MT5 connection is the final step and it takes 60 seconds.\n👉 app.algoria.tech/member/onboarding\n\nIf the broker step is tripping you up, message @mathieu_algoria — he does this all day.`, title: '⏱️ 60 seconds to live', body: 'Just the MT5 connection left. Need help? Message Mathieu.' };
    if (days <= 14)
      return s0
        ? { dm: `Hey, it's worth 2 minutes of your time 🙂\nIf anything held you back — the broker, the deposit, a doubt — just tell me. Message @mathieu_algoria directly and I'll sort it with you personally. No pressure, no sales pitch.\n\nP.S. Your code ALGORIA100 is still active — 100% deposit bonus at RaiseFX, it doubles your trading power the day you start.`, title: '👋 Anything holding you back?', body: 'Message Mathieu directly — and your ALGORIA100 bonus code is still active.' }
        : { dm: `Hey, it's worth 2 minutes of your time 🙂\nIf anything held you back — the broker, the deposit, a doubt — just tell me. Message @mathieu_algoria directly and I'll sort it with you personally. No pressure, no sales pitch.`, title: '👋 Anything holding you back?', body: 'Message Mathieu directly — he’ll sort it with you personally.' };
    // ===== LA TRAÎNE (J+15 → J+60) — réécrite le 14/08 en élargissant la fenêtre =====
    // Le « Last note from me » était le SEUL message au-delà de J+14. Sur une fenêtre de 21 jours il
    // partait deux fois ; sur 60 jours il serait parti une dizaine de fois, et un adieu répété dix fois
    // n'est plus un adieu, c'est une farce qui abîme la marque. Surtout, il ferme la porte alors que la
    // raison d'élargir est précisément qu'elle reste ouverte : « certains ont besoin de 30/40 jours ».
    // Trois temps, du plus engageant au plus sobre — et un seul vrai adieu, tout à la fin.
    if (days <= 21)
      return s0
        ? { dm: `No rush, really 🙂\nAlgoria keeps trading whether you're in or not — that's the point of it. Your access stays open, and your code ALGORIA100 (100% deposit bonus at RaiseFX) is still on your account.\n👉 app.algoria.tech/member/onboarding`, title: '🎁 Your bonus code is still on your account', body: 'ALGORIA100 — 100% deposit bonus at RaiseFX, whenever you start.' }
        : { dm: `No rush 🙂 Your MT5 connection is the only thing left, and it takes 60 seconds whenever you're ready.\n👉 app.algoria.tech/member/onboarding`, title: '⏱️ 60 seconds left', body: 'Just the MT5 connection. Whenever you’re ready.' };
    // J+22 → J+45 : on ne redemande RIEN. On donne des nouvelles — les résultats sont le seul argument
    // qui travaille tout seul pendant qu'on attend que le moment soit bon.
    if (days <= 45)
      return { dm: `Still running 📈\nAlgoria has been trading every single day since you signed up — gold and Bitcoin, three strategies, wins and stops posted publicly. Nothing to do on your side, but the door is still open when your timing is right.\n\n🎥 ${ACADEMY}`, title: '📈 Algoria is still trading every day', body: 'Wins and stops posted publicly. Your access is still open.' };
    // J+46+ : le vrai dernier message, envoyé une fois toutes les deux semaines. Il DIT qu'il est le
    // dernier automatique, et laisse la porte humaine ouverte — sans ça, on perd les gens qui reviennent.
    return { dm: `Last automatic message from me 🤝\nI'll stop the reminders here — but your Algoria access doesn't expire, and neither does the invitation. The day your timing is right, everything is where you left it:\n👉 app.algoria.tech/member/onboarding\n\nAnd @mathieu_algoria stays one message away, whenever that is.`, title: '🤝 Your access doesn’t expire', body: 'Last automatic reminder — the door stays open whenever you’re ready.' };
  };
  // ===== ALARME TUNNEL (16/08/2026) — le capteur qui manquait ==========================================
  // Une vérification ajoutée le 14/08 refusait TOUTES les connexions de compte. Personne ne l'a su
  // pendant 24 h : la panne a été découverte parce que des membres ont écrit au support. Le tunnel
  // n'avait aucun capteur, et un « ça compile, c'est vert » ne dit rien du comportement réel.
  // ON NE SURVEILLE PAS LE VOLUME : sur 31 jours observés, 6 sont naturellement à zéro inscription et il
  // y a même 3 paires de deux jours consécutifs à zéro. Une alarme de volume sonnerait un jour sur cinq,
  // donc serait ignorée — et une alarme ignorée est pire que pas d'alarme.
  // On surveille le TAUX DE REFUS, qui ne dépend pas du trafic : au moins 3 tentatives sur 6 h et AUCUNE
  // acceptée, c'est anormal n'importe quel jour de la semaine.
  // DEUX MEMBRES DISTINCTS AU MINIMUM. Le seuil de 3 tentatives ne suffisait pas : un seul membre perdu
  // dans le formulaire produit facilement trois refus (champ vide, nom trop court, case non cochée), et
  // sur une journée calme il n'y a personne pour compenser avec un succès. L'alarme aurait donc sonné
  // pour un incident inexistant — et une alarme qui a crié au loup une fois ne sera plus lue.
  // Ce seuil reste aveugle au MOTIF, volontairement : la panne du 15/08 avait un motif qui n'existait pas
  // encore dans le code la veille. Filtrer sur une liste de motifs « graves » n'aurait pas vu la panne
  // qu'on cherche à détecter. Le critère qui survit aux causes inconnues, c'est « personne ne passe ».
  let lastFunnelAlert = 0;
  const checkFunnel = async () => {
    try {
      const h = await funnelHealth(6);
      if (h.total < 3 || h.ok > 0 || h.members < 2) return; // trop peu de signal, ça passe, ou un seul membre
      if (Date.now() - lastFunnelAlert < 6 * 3600_000) return; // au plus une alerte par 6 h
      lastFunnelAlert = Date.now();
      const msg = `${h.total} account-connection attempts by ${h.members} members in 6h, ALL refused${h.topReason ? ` (${h.topReason})` : ''}`;
      console.error('[algoria] ALARME TUNNEL :', msg);
      await logNote(`🚨 signup funnel is refusing everyone — ${msg}`, 'veto');
      const { pushToAdmins } = await import('../lib/push/send');
      await pushToAdmins({
        title: '🚨 TUNNEL BLOQUÉ — plus personne ne peut connecter son compte',
        body: msg, url: '/member/admin', tag: 'funnel-down',
      }).catch(() => {});
    } catch (e) {
      console.error('[algoria] contrôle tunnel échoué:', (e as { message?: string })?.message ?? e);
    }
  };
  if (!SECONDARY) setInterval(() => void checkFunnel(), 30 * 60_000); // toutes les 30 min, un seul runner

  let lastNudgeDay = ''; // relance déjà faite ce jour ? (survit au tick horaire, pas au reboot — recordNudge dédup en base)
  const maybeNudge = async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== 10 || lastNudgeDay === today) return;
    lastNudgeDay = today;
    try {
      const { sendDm } = await import('./telegram');
      const { pushToUser } = await import('../lib/push/send');
      const candidates = (await fetchNudgeCandidates()).slice(0, 20);
      let sent = 0;
      for (const c of candidates) {
        const m = nudgeMessage(c.step, c.days);
        // BOUTON VERS L'HUMAIN sur CHAQUE relance auto (14/08) : deux variantes sur six ne donnaient
        // aucun point de contact, et surtout, quelqu'un qui RÉPOND à ce DM écrit au bot — qui ne répond
        // pas. Le bouton évite ce cul-de-sac sans dépendre du texte de la variante.
        const dm = await sendDm(c.tg_id, m.dm, { text: '💬 Ask Mathieu directly', url: 'https://t.me/mathieu_algoria' });
        const push = await pushToUser(c.tg_id, { title: m.title, body: m.body, url: c.step <= 0 ? '/member/academy' : '/member/onboarding', tag: 'algoria-nudge' }).catch(() => 0);
        await recordNudge(c.tg_id, c.member_no, 'auto', `J+${c.days} step${c.step} · dm ${dm ? 'ok' : 'no-chat'} · push ${push ? 'ok' : 'none'}`, dm ? m.dm : undefined);
        if (dm || push) sent++;
      }
      if (candidates.length) console.log(`[algoria] activation : ${sent}/${candidates.length} prospect(s) touché(s)`);
    } catch (e) {
      console.error('[algoria] relance auto échouée:', e);
    }
  };
  if (!SECONDARY) setInterval(() => void maybeNudge(), 3600_000); // relances = un seul runner (S2), sinon triple envoi

  // ===== AUTO-APPROBATION des demandes d'adhésion au canal (31/07 — Mathieu les acceptait par lots de
  // 10-20 à la main quand il les voyait). Le webhook Vercel ne peut pas « attendre 3 minutes » (fonction
  // serverless) : c'est le runner, allumé en permanence, qui balaie la file chaque minute. Le délai laisse
  // au DM d'onboarding le temps d'être lu et évite l'effet « accepté à la milliseconde ».
  // ALGORIA_AUTOJOIN_MIN = délai en minutes (défaut 3) · 0 ou négatif = fonction DÉSACTIVÉE (retour au manuel).
  //
  // ⚠️ LE CANAL VIP EN EST EXCLU (24/08/2026, décision Mathieu). Le balayage ne filtrait AUCUN canal : il
  // acceptait donc aussi bien le canal public que le VIP, trois minutes après la demande. Mesuré sur la
  // période : 14 demandes VIP, 14 auto-approuvées, ZÉRO jamais restée en attente — Mathieu n'a pas pu en
  // voir une seule passer, alors que c'est LUI qui envoie ce lien, un par un, aux gens qu'il a choisis.
  // Aucun intrus au moment du constat (les 14 étaient des membres avec dépôt), mais un lien VIP transféré
  // faisait entrer n'importe qui sans le moindre contrôle. Le VIP se valide désormais à la main : ses
  // demandes restent 'waiting' et réapparaissent dans la liste d'attente Telegram, là où il les attend.
  const AUTOJOIN_MIN = Number(process.env.ALGORIA_AUTOJOIN_MIN ?? 3);
  const autoApproveJoins = async () => {
    try {
      const { approveJoinRequest, VIP_CHAT } = await import('./telegram');
      // VIP_CHAT vide ou non numérique = on ne sait pas identifier le canal VIP, donc rien à exclure :
      // on retombe sur le comportement d'avant plutôt que de bloquer toutes les adhésions par excès de zèle.
      const vipId = Number(VIP_CHAT);
      const ripe = await listRipeJoinRequests(AUTOJOIN_MIN, 25, Number.isFinite(vipId) ? [vipId] : []);
      if (!ripe.length) return;
      let ok = 0;
      for (const r of ripe) {
        const res = await approveJoinRequest(Number(r.chat_id), Number(r.user_id));
        if (res.ok) { ok++; await markJoinApproved(r.id, null); }
        else if (res.error) await markJoinApproved(r.id, res.error.slice(0, 200)); // refus structurel : ne pas boucler
        // res.error null = pépin réseau → on laisse la ligne en file pour le prochain passage
      }
      if (ok) await logNote(`🚪 ${ok} join request(s) auto-approved after ${AUTOJOIN_MIN} min`, 'info');
    } catch (e) {
      console.error('[algoria] auto-approbation des adhésions échouée:', e);
    }
  };
  if (!SECONDARY && AUTOJOIN_MIN > 0) {
    setInterval(() => void autoApproveJoins(), 60_000); // un seul runner balaie, sinon triple approbation
    console.log(`[algoria] auto-approbation des demandes d'adhésion : ON (délai ${AUTOJOIN_MIN} min)`);
  }

  // ===== CONTENU VIP À VALEUR (au-delà des trades) : briefing du matin + pédagogie tournante — pour que le
  // canal VIT et donne des messages « forwardables » vers le public. Postés par le SEUL runner primaire (S2).
  const VIP_TAGS: Record<number, string> = { 1: '🌱 S1 STEADY', 2: '⚖️ S2 BALANCED', 3: '🚀 S3 TURBO' };
  const VIP_TIPS = [
    // RÉÉCRITE le 19/08 — l'ancienne version affirmait « winners protected, not cut short » alors que 56 %
    // des trades sortent à +0,035 R en moyenne, ce qui EST les couper court. On ne peut pas enseigner à des
    // clients payants l'inverse de ce que montrent nos propres chiffres. La version honnête assume
    // l'arbitrage — et elle rassure davantage, parce qu'un arbitrage explicite prouve qu'il y a une méthode.
    "🎓 <b>Why the stop moves up</b>\nAs soon as a trade gets ahead, Algoria pulls its stop above the entry. The cost: on a choppy day, some trades come back out near zero. What it buys: <b>a winning trade can never turn into a losing one</b>. We'd rather book a lot of nothings than one avoidable loss.",
    "🎓 <b>Why we stand aside around news</b>\nHigh-impact releases turn spreads into a casino. Algoria simply doesn't trade the minutes around them — no edge, no trade. Discipline over FOMO.",
    "🎓 <b>What the daily cap means</b>\nEach strategy has a hard floor for the day. Hit it and Algoria stops — your downside is bounded <b>before the session even starts</b>. No revenge trading, ever.",
    // REMPLACE « why small wins compound » (19/08) : cette fiche affirmait que les petits gains composent,
    // alors que six semaines sur sept sont négatives en R. On la remplace par ce qui est VÉRIFIABLE par le
    // membre lui-même, et qui est le vrai argument « ce n'est pas du hasard » : on publie avant de savoir.
    "🎓 <b>Why we post before we know</b>\nEvery trade appears in this channel as it opens — not after it closes. We don't get to choose what to show you. Red days are as visible as green ones, and that's the only way you can judge a system on something other than screenshots.",
    "🎓 <b>Why a losing day isn't a broken system</b>\nAlgoria trades a defined edge, and an edge is a statistic, not a promise about today. What's fixed in advance is the <b>risk</b>: a stop on every trade, one size, a hard daily floor. The result of any single day varies — what it's allowed to cost you doesn't.",
    "🎓 <b>Three strategies, one engine</b>\n🌱 Steady books quick daily targets · ⚖️ Balanced runs the reference edge · 🚀 Turbo trades more for more variance. Pick the temperament that fits you.",
    "🎓 <b>The ratchet</b>\nOnce a day is nicely green, Algoria locks it and stops — a strong morning can't be given back by an afternoon. Protecting a good day is half the game.",
  ];
  const briefing = (c: { regime: string; adx: number; atrPct: number; price: number }): string => {
    const regime = c.regime === 'trend' ? '📈 TREND' : '📊 RANGE';
    const vol = c.atrPct >= 0.66 ? 'high' : c.atrPct <= 0.33 ? 'quiet' : 'normal';
    const read = c.adx >= 25 ? 'strong directional pressure' : c.adx >= 18 ? 'building direction' : 'no clear trend yet';
    return `🌅 <b>MORNING BRIEFING</b> · gold\n${VIP_RULE}\nMarket <b>${regime}</b>  ·  volatility <b>${vol}</b>\nRead: ${read} (ADX ${Math.round(c.adx)})${c.price ? `\nGold  <code>~ ${c.price}</code>` : ''}\n${VIP_RULE}\n<i>Algoria only fires on confluence and stands aside when the tape is unclear. Every copy lands in your account automatically.</i>`;
  };

  // HEURES D'OUVERTURE DU GOLD : fermé du vendredi 21:00 UTC au dimanche 22:00 UTC (+ pause quotidienne
  // 21h→22h). Le contenu VIP PROGRAMMÉ se TAIT marché fermé — un « morning briefing » posté un samedi qui
  // analyse un marché figé décrédibilise le canal (vécu 25/07 : brief gold envoyé pendant le week-end).
  // Le reste (pulse/wrap/scoreboard) est déjà protégé par « 0 trade → silence ».
  const goldOpen = (d = new Date()): boolean => {
    const day = d.getUTCDay(), h = d.getUTCHours();
    if (day === 6) return false; // samedi
    if (day === 0) return h >= 22; // dimanche avant la réouverture
    if (day === 5 && h >= 21) return false; // vendredi après la clôture hebdo
    if (h === 21) return false; // pause quotidienne 21→22h UTC
    return true;
  };
  let lastRecapHour = new Date().getUTCHours(); // pas de recap au démarrage — on attend la prochaine heure pleine
  let lastPulseKey = ''; // dédup du pulse 4h : "jour:nbTrades" — on ne reposte que si le compteur a bougé
  if (!SECONDARY) setInterval(() => {
    void (async () => {
      const h = new Date().getUTCHours();
      if (h === lastRecapHour) return;
      lastRecapHour = h;
      // CONTENU PROGRAMMÉ (indépendant du nombre de trades du jour) : briefing 06h UTC (avant Londres),
      // pédagogie 14h UTC (rotation déterministe par jour). Gaté par l'env VIP + marché OUVERT.
      if (vipReady() && goldOpen()) {
        try {
          if (h === 6) { const c = await fetchLatestContext(); if (c) void postVip(briefing(c)); }
          else if (h === 14) void postVip(VIP_TIPS[Math.floor(Date.now() / 86_400_000) % VIP_TIPS.length]);
        } catch (e) { console.error('[algoria] contenu VIP programmé échoué:', e); }
      }
      try {
        const stats = await fetchDayTradeStats();
        if (!stats || stats.trades === 0) return; // rien à raconter
        const meta = { kind: 'recap', trades: stats.trades, wins: stats.wins, winRate: stats.wins / stats.trades, net: Math.round(stats.net) };
        const clause = narrationReady() ? await narrateRecap(stats) : null;
        await logNarration(clause ?? '', Date.now(), meta);
        console.log(`[algoria] recap ${h}h : ${stats.trades} trades · ${stats.wins} wins · ${Math.round(stats.net)}$`);
        // Canal VIP : « pulse » preuve-de-vie toutes les 4 h + bilan du soir (21h UTC). En % / win rate, jamais
        // le P&L $ du master (≠ celui du client → éviterait la confusion). Gaté par l'env.
        if (vipReady()) {
          const wr = Math.round((stats.wins / stats.trades) * 100);
          if (h === 21) {
            // WRAP DE LA FLOTTE : les 3 stratégies côte à côte — un client dont la stratégie est rouge voit
            // que d'autres sont vertes (et inversement) : c'est le portefeuille de stratégies qu'on vend.
            const board = await fetchDayScoreboard().catch(() => null);
            const TAGS: Record<number, string> = { 1: '🌱 S1 STEADY', 2: '⚖️ S2 BALANCED', 3: '🚀 S3 TURBO' };
            const FLAG: Record<string, string> = { target: '✅ day target hit', lock: '🔒 gains locked', loss: '🛡️ daily cap — downside protected' };
            const active = (board ?? []).filter((b) => b.trades > 0 || b.done);
            // chaque stratégie = 2 lignes aérées : nom en gras, puis le net + drapeau (bloc lisible, pas empilé serré).
            const lines = active.map((b) => `${TAGS[b.strategy].replace(/^(\S+)\s(.+)$/, '$1 <b>$2</b>')}\n   ${b.net >= 0 ? '🟢 +' : '🔴 −'}<b>${usd(b.net)}</b>${b.reason && FLAG[b.reason] ? '  ·  ' + FLAG[b.reason] : ''}`);
            // PHRASE DE CLÔTURE ADAPTATIVE — jamais le mot « rouge » quand tout est vert (com du canal public).
            // Tout vert → positif franc. Mixte → le vrai argument portefeuille (le rouge de l'un ≠ rouge de tous).
            // Tout rouge → discipline (caps + track record public). Le mot « red » n'apparaît QUE s'il y a du rouge.
            const anyRed = active.some((b) => b.net < 0);
            const allGreen = active.length > 0 && active.every((b) => b.net >= 0);
            // ⚠️ L'ORDRE DES TESTS COMPTE, et il était faux (corrigé 19/08). « anyRed » est vrai DÈS QU'UNE
            // stratégie est rouge — donc aussi quand les trois le sont. La branche « tout rouge » était
            // du code mort, et le 19/08, avec S1/S2/S3 toutes négatives, les membres ont lu « un jour rouge
            // sur l'une est rarement un jour rouge sur toutes ». Le message le plus faux possible, le jour
            // où il compte le plus. On teste donc « tout rouge » AVANT « au moins une rouge ».
            const allRed = active.length > 0 && active.every((b) => b.net < 0);
            const tagline = allGreen
              ? "Every strategy green today. 🟢 This is the fleet working — your profile is set in the app. 👊"
              : allRed
                ? "A red day across the board. Every trade carried its stop from the moment it opened, so the day cost what it was allowed to cost — no averaging down, no revenge trade. That is the system doing its job."
                : anyRed
                  ? "Three strategies, three personalities — a red day on one is rarely a red day on all. Yours is set in the app. 👊"
                  : "Risk stayed capped across the board and the desk stays disciplined. 🔁";
            // JOUR ROUGE : on montre la MÉCANIQUE, on ne promet pas demain. Quelqu'un qui arrive le jour
            // d'une perte doit pouvoir vérifier qu'il y a une méthode derrière — combien de signaux ont été
            // REFUSÉS, combien de positions ont été protégées, et si la pire perte est restée dans son
            // enveloppe. Ce sont des faits du jour, pas une prévision. Demandé par Mathieu le 19/08 :
            // « ils doivent juste comprendre qu'il y a une stratégie derrière, ce n'est pas du hasard. »
            let discipline = '';
            if (allRed || anyRed) {
              const d = await fetchDayDiscipline().catch(() => null);
              if (d) {
                const bits: string[] = [];
                if (d.vetoed > 0) bits.push(`<b>${d.vetoed}</b> signal${d.vetoed > 1 ? 's' : ''} refused by the filters`);
                if (d.secured > 0) bits.push(`<b>${d.secured}</b> position${d.secured > 1 ? 's' : ''} moved to a protected stop`);
                if (d.worstR != null) bits.push(`worst trade <b>${d.worstR.toFixed(2)}R</b> — inside its planned risk`);
                if (bits.length) discipline = `\n\n🛡️ <b>What held today</b>\n${bits.map((b) => '· ' + b).join('\n')}`;
              }
            }
            const proof = anyRed ? '\n\n<i>Every trade is posted here as it opens — before anyone knows how it ends.</i>' : '';
            if (lines.length)
              void postVip(`📊 <b>DAILY WRAP</b>\n<i>the Algoria fleet · master-account scale</i>\n${VIP_RULE}\n${lines.join('\n\n')}\n${VIP_RULE}\n${tagline}${discipline}${proof}`);
            else if (stats.net >= 0) void postVip(`📊 <b>DAILY WRAP</b> · ${VIP_TAG}\n${VIP_RULE}\n${stats.trades} trades  ·  <b>${wr}% win</b>  ·  green day 🟢\n\nAll copied to your account. See you tomorrow. 👊`);
            else void postVip(`📊 <b>DAILY WRAP</b> · ${VIP_TAG}\n${VIP_RULE}\n${stats.trades} trades  ·  ${wr}% win\n\nRisk stayed capped and the desk stays disciplined — it's all in our public track record. We go again tomorrow. 🔁`);

            // 🏆 TRADE DU JOUR (le meilleur gagnant flotte, ≥ $200) — LE forward parfait vers le public.
            const dayStartIso = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
            const top = await fetchTopTrade(dayStartIso).catch(() => null);
            if (top && top.pnl >= 200)
              void postVip(`🏆 <b>TRADE OF THE DAY</b>\n${VIP_RULE}\n${VIP_TAGS[top.strategy] ?? `S${top.strategy}`}\n<b>+${usd(top.pnl)}</b> on ${top.symbol}\n${VIP_RULE}\n<i>Cleanly executed and copied to every account on this strategy.</i>`);
            // dimanche : 🏆 TRADE DE LA SEMAINE
            if (new Date().getUTCDay() === 0) {
              const wtop = await fetchTopTrade(new Date(Date.now() - 7 * 86_400_000).toISOString()).catch(() => null);
              if (wtop && wtop.pnl >= 300)
                void postVip(`🏆 <b>TRADE OF THE WEEK</b>\n${VIP_RULE}\n${VIP_TAGS[wtop.strategy] ?? `S${wtop.strategy}`}\n<b>+${usd(wtop.pnl)}</b> on ${wtop.symbol}\n${VIP_RULE}\n<i>Seven days, one standout — and everyone on this strategy caught it.</i>`);
            }

            // 🔥 SÉRIES & RECORDS — preuve sociale « forwardable ». Net flotte par jour → série de jours verts + record.
            const nets = await fetchFleetDailyNets(14).catch(() => [] as Array<{ day: string; net: number }>);
            if (nets.length) {
              const today = nets[nets.length - 1];
              let streak = 0;
              for (let i = nets.length - 1; i >= 0 && nets[i].net >= 0; i--) streak++;
              const isRecord = nets.length >= 3 && today.net > 0 && today.net === Math.max(...nets.map((n) => n.net));
              const badges: string[] = [];
              if (allGreen && active.length >= 2) badges.push(`🟢 <b>FLEET ALL-GREEN</b> — ${active.length}/${active.length} strategies green today`);
              if (streak >= 3) badges.push(`🔥 <b>${streak} green days in a row</b> across the fleet`);
              if (isRecord) badges.push(`⚡ <b>New record day</b> — +${usd(today.net)}, our best since launch`);
              if (badges.length) void postVip(`${badges.join('\n')}\n\n<i>This is the track record building in real time. 👊</i>`);
            }
          } else if (h % 4 === 0) {
            // PULSE preuve-de-vie — SEULEMENT s'il y a du NOUVEAU depuis le dernier pulse (compteur de
            // trades du jour). Sans ce verrou : 5 messages identiques « 2 trades · 100% win » en boucle
            // toute la journée (vécu le samedi 26/07 — les 2 clôtures BTC passaient la garde 0-trade et
            // le pulse répétait la même info toutes les 4 h). Un pulse qui ne dit rien de neuf se tait.
            const pulseKey = `${new Date().toISOString().slice(0, 10)}:${stats.trades}`;
            if (pulseKey !== lastPulseKey) {
              lastPulseKey = pulseKey;
              void postVip(`${stats.net >= 0 ? '🟢' : '🔴'} ${VIP_TAG} <b>working</b> · ${stats.trades} trades · ${wr}% win today`);
            }
          }
        }
        // PUSH recap du soir (21h UTC) vers les membres — 70/30 : uniquement si la journée est VERTE.
        // JOUR ROUGE : ON PARLE AUSSI (19/08). Jusqu'ici la notification du soir ne partait que si la
        // journée était verte — le membre voyait son compte baisser et n'entendait RIEN de nous. C'est ce
        // silence-là qui fait déconnecter, pas la perte : celui qui vient d'arriver ne peut pas distinguer
        // « mauvaise journée d'un système qui tourne » de « personne aux commandes ». On ne promet pas de
        // rebond, on renvoie vers le bilan où la mécanique du jour est détaillée.
        if (h === 21) {
          const { pushToAll } = await import('../lib/push/send');
          const wrPct = Math.round((stats.wins / stats.trades) * 100);
          void pushToAll(
            stats.net > 0
              ? {
                  title: `Algoria today: +$${Math.round(stats.net)}`,
                  body: `${stats.trades} trades · ${wrPct}% win rate — copied to your account.`,
                  url: '/member/history',
                  tag: 'algoria-recap',
                }
              : {
                  title: 'Algoria today: a red day',
                  body: `${stats.trades} trades · ${wrPct}% win rate. Every trade carried its stop — see exactly what the desk did.`,
                  url: '/member/history',
                  tag: 'algoria-recap',
                },
          ).catch(() => {});
        }
      } catch (e) {
        console.error('[algoria] recap échoué:', e);
      }
    })();
  }, 60_000);
}

main().catch((e) => {
  console.error('[algoria] runner crash:', e);
  process.exit(1);
});
