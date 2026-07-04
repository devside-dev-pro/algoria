import 'dotenv/config';
import './env-check'; // valide les variables d'env et arrête net avec un message clair si une manque
import { connectMaster } from './metaapi/client';
import { loadHistory, makeAggregator, backfill } from './metaapi/candles';
import { readState } from './metaapi/state';
import { placeSignal, closeAll, closePosition } from './metaapi/execution';
import { manageBreakeven, rememberManagement } from './metaapi/manage';
import { DealRecorder } from './metaapi/trades';
import { narrate, narrateRecap, narrationReady, deskMeta, type DeskKind } from './llm/narrate';
import { runTick } from '../lib/engine/pipeline';
import { checkRisk } from '../lib/engine/risk';
import { breakoutSignal } from '../lib/engine/breakout';
import { swingSignal, swingMinBars } from '../lib/engine/swing';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { activeInstruments, type InstrumentSpec } from '../lib/engine/instruments';
import { portfolioVeto, PORTFOLIO } from '../lib/engine/portfolio';
import { FEATURES } from '../lib/engine/features';
import { refreshCalendar, newsWindows, dueAnnouncements, calendarFresh } from './news';
import { runSentinel } from './sentinel';
import { lastEdgeHealthCheck } from '../lib/supabase/sync';
import { logEvents, logSignal, pushState, logCandle, logCandles, logNarration, logNote, recordTradeOpen, recordTradeClose, listGhostOpenTrades, closeGhostTrades, latestCandleTime, broadcastTick, watchCommands, fetchDayTradeStats, hasOpenSwingTrade } from '../lib/supabase/sync';
import type { Bar, Confluence, EngineState, Mode, Signal } from '../lib/engine/types';

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
  tick: () => void; // appelé chaque seconde par la boucle partagée
  reconcile: () => void; // appelé chaque 60 s par la boucle partagée
  pushAccount: () => Promise<void>; // snapshot compte (balance/equity/day P&L) — 60 s, primaire uniquement
  executeSignal: (signal: Signal) => Promise<string | undefined>;
  buildManualSignal: (direction: 'long' | 'short', opts?: ManualOpts) => Signal | null;
  setAction: (on: boolean) => void;
  setRafale: (on: boolean) => void;
}

type ManualOpts = { lot?: number; sl?: number; tp?: number; tight?: boolean; ultraTight?: boolean };

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
        state = readState(terminal, BROKER, state);
        state.killed = killed; // le kill switch global gèle l'auto sur tous les instruments
        state.newsWindows = newsWindows(); // annonces éco USD fort impact → checkRisk refuse les entrées autour
        // mode scalp = config scalp VALIDÉE de l'instrument (l'or et le Nasdaq n'ont pas la même). NORMAL → DEFAULT strict.
        const cfg = mode === 'scalp' ? inst.config : DEFAULT_CONFIG;
        // SCALP : on injecte le contexte propre à l'instrument (session asia, gate vol élargi, roundStep) + le spread live.
        const ctxOpts = mode === 'scalp' ? { spread: state.spread, ...inst.ctx } : { spread: state.spread };
        const { signal, events, context, confluence, threshold } = runTick({ symbol: DISPLAY, bars, mode, state, ctxOpts }, FEATURES, cfg);
        lastCtx = context;
        await logCandle(DISPLAY, bars[bars.length - 1], 'M5');
        // WATCH-ONLY (ex. BTC) : le desk lit et raconte le marché, mais l'auto ne tire JAMAIS — aucun edge
        // validé. Le signal éventuel devient une simple « opportunity » à l'écran (le manuel reste possible).
        const autoSignal = inst.watchOnly ? null : signal;
        if (autoSignal) {
          // Garde-fou PORTEFEUILLE (global) au-dessus des limites par-symbole : on ne laisse pas l'or + le Nasdaq
          // (+ Forex à venir) empiler des positions corrélées. N'affecte que l'auto (manuel/show restent libres).
          const veto = portfolioVeto({ positions: (terminal.positions ?? []) as any[], symbol: BROKER });
          if (veto) {
            await logSignal(autoSignal, { code: `portfolio: ${veto}`.slice(0, 250), status: 'rejected' });
            if (isPrimary) await logNote(`${DISPLAY}: trade bloqué — ${veto}`, 'veto');
          } else {
            await executeSignal(autoSignal);
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
    // jours avec breakeven à 1R puis trailing par paliers (manage.ts). Le slot survit aux reboots : l'état
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
              rememberManagement(ticket, { beTrigger: SW.beTrigger, trailActivate: SW.trailActivate, trailDist: SW.trailDist, riskDist: Math.abs(sig.entry - sig.stopLoss) });
              await logNote(`⚡ SWING ${sig.direction.toUpperCase()} ${DISPLAY} @ ${sig.entry} · SL ${sig.stopLoss} · riding for days (BE at 1R, ${SW.trailDist}R trailing)`, 'order');
            }
          }
        } catch (e) {
          console.error(`[algoria] swing ${DISPLAY} échoué:`, e);
        }
      };
      const h1seed = await loadHistory(account, BROKER, '1h', 700).catch(() => [] as Bar[]);
      swingAgg = makeAggregator('1h', h1seed, (b) => void onH1Closed(b));
      console.log(`[algoria] couche SWING active sur ${DISPLAY} (${SW.kind}, lot ${SW.lot}) · seed H1: ${h1seed.length} bougies`);
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

    // Tick (1 s) : alimente l'agrégateur M5 + M1, diffuse le prix (primaire), gère le breakeven. Isolé du reste.
    const tick = () => {
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
      void manageBreakeven(stream, terminal, BROKER); // no-op sur les ordres nus (sans SL)
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
    const pushAccount = async () => {
      if (!isPrimary || !lastCtx) return;
      state = readState(terminal, BROKER, state);
      state.killed = killed;
      await pushState(lastCtx, state, mode);
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

  // ===== Commandes du cockpit. mode + kill sont GLOBAUX ; manuel/action/rafale visent le primaire (l'or). =====
  watchCommands((cmd) => {
    void (async () => {
      try {
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
      try { eng.tick(); } catch (e) { console.error(`[algoria] tick ${eng.inst.display} échoué:`, e); }
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
  void refreshCalendar().then((n) => console.log(`[algoria] calendrier éco : ${n >= 0 ? n + ' événements chargés' : 'échec initial (retry auto)'}`));
  setInterval(() => void refreshCalendar(), 6 * 3600_000);
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
  setTimeout(() => void maybeSentinel(), 3 * 60_000); // au boot (après la synchro), rattrape un check manqué
  setInterval(() => void maybeSentinel(), 3600_000); // check horaire → ne déclenche que dimanche 12h UTC

  // ===== RECAP HORAIRE du desk : à chaque heure pleine, une carte "SESSION RECAP" (stats réelles du jour,
  // hors BEAST) + une clause IA d'ambiance. Rythme le stream et rappelle le track record sans intervention. =====
  let lastRecapHour = new Date().getUTCHours(); // pas de recap au démarrage — on attend la prochaine heure pleine
  setInterval(() => {
    void (async () => {
      const h = new Date().getUTCHours();
      if (h === lastRecapHour) return;
      lastRecapHour = h;
      try {
        const stats = await fetchDayTradeStats();
        if (!stats || stats.trades === 0) return; // rien à raconter
        const meta = { kind: 'recap', trades: stats.trades, wins: stats.wins, winRate: stats.wins / stats.trades, net: Math.round(stats.net) };
        const clause = narrationReady() ? await narrateRecap(stats) : null;
        await logNarration(clause ?? '', Date.now(), meta);
        console.log(`[algoria] recap ${h}h : ${stats.trades} trades · ${stats.wins} wins · ${Math.round(stats.net)}$`);
        // PUSH recap du soir (21h UTC) vers les membres — 70/30 : uniquement si la journée est VERTE.
        if (h === 21 && stats.net > 0) {
          const { pushToAll } = await import('../lib/push/send');
          void pushToAll({
            title: `Algoria today: +$${Math.round(stats.net)}`,
            body: `${stats.trades} trades · ${Math.round((stats.wins / stats.trades) * 100)}% win rate — copied to your account.`,
            url: '/member/history',
            tag: 'algoria-recap',
          }).catch(() => {});
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
