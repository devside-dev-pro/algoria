import 'dotenv/config';
import './env-check'; // valide les variables d'env et arrête net avec un message clair si une manque
import { connectMaster } from './metaapi/client';
import { loadHistory, makeAggregator, backfill } from './metaapi/candles';
import { readState } from './metaapi/state';
import { placeSignal, closeAll, closePosition } from './metaapi/execution';
import { manageBreakeven } from './metaapi/manage';
import { DealRecorder } from './metaapi/trades';
import { narrate, narrationReady } from './llm/narrate';
import { runTick } from '../lib/engine/pipeline';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { activeInstruments, type InstrumentSpec } from '../lib/engine/instruments';
import { portfolioVeto, PORTFOLIO } from '../lib/engine/portfolio';
import { FEATURES } from '../lib/engine/features';
import { logEvents, logSignal, pushState, logCandle, logCandles, logNarration, logNote, recordTradeOpen, reconcileOpenTrades, broadcastTick, watchCommands } from '../lib/supabase/sync';
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

  // ===== Backfill optionnel d'un symbole SUPPLÉMENTAIRE (pour backtester un indice pas encore au registre) =====
  // Piloté par env, one-shot au démarrage. Ex: BACKFILL_EXTRA=US500 → ~2 semaines de M1/M5 dans Supabase.
  const extra = process.env.BACKFILL_EXTRA?.trim();
  if (extra && !instruments.some((i) => i.broker === extra)) {
    try {
      await stream.subscribeToMarketData(extra);
      for (const tf of ['M1', 'M5', 'M15', 'H1', 'D1']) {
        const hist = await backfill(account, extra, tf, BACKFILL_PAGES[tf] ?? 5);
        if (hist.length) await logCandles(extra, hist, tf);
        console.log(`[algoria] backfill EXTRA ${extra} ${tf}: ${hist.length} bougies`);
      }
    } catch (e) {
      console.error(`[algoria] backfill EXTRA ${extra} échoué (symbole introuvable chez le broker ?):`, e);
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

    // ===== Boucle MOTEUR : à chaque bougie M5 clôturée, on fait tourner la confluence sur CET instrument =====
    const onClosed = async (bars: Bar[]) => {
      try {
        state = readState(terminal, BROKER, state);
        state.killed = killed; // le kill switch global gèle l'auto sur tous les instruments
        // mode scalp = config scalp VALIDÉE de l'instrument (l'or et le Nasdaq n'ont pas la même). NORMAL → DEFAULT strict.
        const cfg = mode === 'scalp' ? inst.config : DEFAULT_CONFIG;
        // SCALP : on injecte le contexte propre à l'instrument (session asia, gate vol élargi, roundStep) + le spread live.
        const ctxOpts = mode === 'scalp' ? { spread: state.spread, ...inst.ctx } : { spread: state.spread };
        const { signal, events, context, confluence, threshold } = runTick({ symbol: DISPLAY, bars, mode, state, ctxOpts }, FEATURES, cfg);
        await logCandle(DISPLAY, bars[bars.length - 1], 'M5');
        if (signal) {
          // Garde-fou PORTEFEUILLE (global) au-dessus des limites par-symbole : on ne laisse pas l'or + le Nasdaq
          // (+ Forex à venir) empiler des positions corrélées. N'affecte que l'auto (manuel/show restent libres).
          const veto = portfolioVeto({ positions: (terminal.positions ?? []) as any[], symbol: BROKER });
          if (veto) {
            await logSignal(signal, { code: `portfolio: ${veto}`.slice(0, 250), status: 'rejected' });
            if (isPrimary) await logNote(`${DISPLAY}: trade bloqué — ${veto}`, 'veto');
          } else {
            await executeSignal(signal);
          }
        }

        // Canaux UI mono-symbole (état global, feed d'events, narration) → PRIMAIRE uniquement, pour ne pas
        // écraser le cockpit de l'or. Les secondaires tradent et s'enregistrent (trades/signals/candles par symbole).
        if (isPrimary) {
          await logEvents(events);
          await pushState(context, state, mode);
          if (narrationReady()) {
            if (signal) {
              const line = await narrate({ kind: 'trade', ctx: context, signal, confluence, threshold });
              if (line) await logNarration(line, signal.time, { kind: 'trade', direction: signal.direction, confidence: signal.confidence, entry: signal.entry, sl: signal.stopLoss, tp: signal.takeProfits[0] });
            } else if (confluence && confluence.direction !== 'flat' && confluence.confidence >= threshold * 0.7) {
              const line = await narrate({ kind: 'opportunity', ctx: context, confluence, threshold });
              if (line) await logNarration(line, context.time, { kind: 'opportunity', direction: confluence.direction, confidence: confluence.confidence });
            } else {
              const line = await narrate({ kind: 'analysis', ctx: context, logLines: events.map((e) => e.msg) });
              if (line) await logNarration(line, context.time, { kind: 'analysis' });
            }
          }
        }
      } catch (e) {
        console.error(`[algoria] onClosed ${DISPLAY} échoué:`, e);
      }
    };

    const agg = makeAggregator(TF, seed, onClosed);

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
          feedM1((p.bid + p.ask) / 2, Date.now());
          if (isPrimary) broadcastTick(p.bid, p.ask); // le chart cockpit suit l'or (le multi-symbole viendra après)
        }
      }
      void manageBreakeven(stream, terminal, BROKER); // no-op sur les ordres nus (sans SL)
    };

    // Réconciliation anti-fantômes (60 s) : ferme en base les trades "ouverts" qui n'existent plus chez le broker.
    const reconcile = () => {
      if (!terminal.accountInformation || Date.now() - startedAt < 120_000) return; // pas synchronisé / trop tôt → on attend
      const live = ((terminal.positions ?? []) as any[]).filter((x) => x.symbol === BROKER).map((x) => String(x.id));
      void reconcileOpenTrades(DISPLAY, live).then((n) => {
        if (n > 0) {
          console.log(`[algoria] réconciliation ${DISPLAY} : ${n} position(s) fantôme(s) fermée(s) en base`);
          void logNote(`${DISPLAY}: ${n} ghost position(s) cleaned up (closed on broker, not in DB)`, 'info');
        }
      });
    };

    return { inst, isPrimary, tick, reconcile, executeSignal, buildManualSignal, setAction, setRafale };
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
          if (killed) {
            await logNote(`manual trade ${dir} ignored — kill switch active`, 'veto');
          } else {
            const sig = primary.buildManualSignal(dir, { lot, sl, tp });
            if (sig) await primary.executeSignal(sig);
            else await logNote(`manual trade ${dir} ignored — no live price`, 'veto');
          }
        } else if (cmd.type === 'close_all') {
          try {
            await closeAll(stream, primary.inst.broker);
            await logNote('✕ close all — all positions closed manually', 'order');
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
  }, 60_000);
}

main().catch((e) => {
  console.error('[algoria] runner crash:', e);
  process.exit(1);
});
