import 'dotenv/config';
import './env-check'; // valide les variables d'env et arrête net avec un message clair si une manque
import { connectMaster } from './metaapi/client';
import { loadHistory, makeAggregator, backfill } from './metaapi/candles';
import { readState } from './metaapi/state';
import { placeSignal, closeAll } from './metaapi/execution';
import { manageBreakeven } from './metaapi/manage';
import { DealRecorder } from './metaapi/trades';
import { narrate, narrationReady } from './llm/narrate';
import { runTick } from '../lib/engine/pipeline';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import { logEvents, logSignal, pushState, logCandle, logCandles, logNarration, logNote, recordTradeOpen, broadcastTick, watchCommands } from '../lib/supabase/sync';
import type { Bar, Confluence, EngineState, MarketContext, Mode, Signal } from '../lib/engine/types';

const BROKER = process.env.ALGORIA_SYMBOL ?? 'XAUUSD'; // nom du symbole chez le broker (ex. "Gold")
const DISPLAY = 'XAUUSD'; // label stocké/affiché dans le cockpit (cohérent)
const TF = '5m';
const ACTION_MS = 20_000; // mode Action : un trade toutes les ~20s pour garder l'écran vivant en live
const r2 = (x: number) => Math.round(x * 100) / 100;

async function main() {
  console.log('[algoria] runner démarre…');
  const { account, stream, terminal } = await connectMaster();
  await stream.subscribeToMarketData(BROKER);

  // Enregistre la CLÔTURE des trades (deals de sortie) dans Supabase → mesure honnête de la perf en démo/réel.
  const dealRecorder = new DealRecorder(BROKER, DISPLAY);
  stream.addSynchronizationListener(dealRecorder);

  console.log(`[algoria] connecté · broker=${BROKER} → display=${DISPLAY} · TF ${TF}`);
  console.log(`[algoria] narration ${narrationReady() ? 'ON (Claude)' : 'OFF — ajoute ANTHROPIC_API_KEY dans .env'}`);

  // Backfill d'historique profond pour le chart (tous les timeframes).
  for (const tf of ['M5', 'M15', 'H1', 'D1']) {
    try {
      const hist = await backfill(account, BROKER, tf, 5);
      await logCandles(DISPLAY, hist, tf);
      console.log(`[algoria] backfill ${tf}: ${hist.length} bougies`);
    } catch (e) {
      console.error(`[algoria] backfill ${tf} échoué (getHistoricalCandles non supporté ?):`, e);
    }
  }

  const seed = await loadHistory(account, BROKER, TF, 300);
  let state: EngineState = readState(terminal, BROKER, { dayStartBalance: terminal.accountInformation?.balance });
  let mode: Mode = 'normal';
  let lastCtx: MarketContext | null = null; // dernier contexte (atr) — sert aux trades manuels hors clôture M5

  /** Chemin d'exécution PARTAGÉ (auto + manuel + action) : place l'ordre, persiste signal + ouverture, gère les échecs visiblement. */
  const executeSignal = async (signal: Signal) => {
    try {
      const res = await placeSignal(stream, signal, BROKER);
      state.tradesToday++;
      state.lastTradeTime = signal.time;
      await logSignal(signal, { ...res, status: 'placed' });
      if (res.ticket) {
        dealRecorder.remember(res.ticket, signal); // pour calculer R + reason à la clôture
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
    } catch (e) {
      // Échec d'envoi : on le rend VISIBLE (events Supabase, pas seulement la console Railway) ET on persiste le signal rejeté.
      const reason = (e as { message?: string })?.message ?? String(e);
      await logNote(`échec ordre · ${signal.direction} ${BROKER} ${signal.lot} lot · ${reason}`, 'veto');
      await logSignal(signal, { code: reason.slice(0, 120), status: 'rejected' });
      console.error('[algoria] échec ordre:', e);
    }
  };

  /** Construit un signal au PRIX COURANT (trade manuel / action) — SL/TP dérivés de l'ATR, dimensionné comme le moteur. `tight` = stops serrés pour le mode action. */
  const buildManualSignal = (direction: 'long' | 'short', tight = false): Signal | null => {
    const p = terminal.price(BROKER);
    if (!p?.bid || !p?.ask) return null;
    const price = r2((p.bid + p.ask) / 2);
    const atr = lastCtx?.atr ?? price * 0.001;
    const dir = direction === 'long' ? 1 : -1;
    const slMult = tight ? 0.6 : DEFAULT_CONFIG.slAtrMult;
    const rr = tight ? 0.5 : DEFAULT_CONFIG.targetRR;
    const riskDist = Math.max(atr * slMult, price * 0.0003);
    const sl = r2(price - dir * riskDist);
    const tp1 = r2(price + dir * rr * riskDist);
    const tp2 = r2(price + dir * rr * 1.6 * riskDist);
    const riskAmount = state.balance * (tight ? 0.0025 : DEFAULT_CONFIG.riskPct[mode]);
    const perLot = riskDist * DEFAULT_CONFIG.contractSize;
    let lot = Math.floor(riskAmount / perLot / DEFAULT_CONFIG.lotStep) * DEFAULT_CONFIG.lotStep;
    if (!Number.isFinite(lot) || lot < DEFAULT_CONFIG.minLot) lot = DEFAULT_CONFIG.minLot;
    lot = +lot.toFixed(2);
    const confluence: Confluence = { direction, rawScore: 0, alignment: 0, quality: 0, macro: 0, confidence: 1, contributions: [] };
    return {
      id: `${DISPLAY}-${Date.now()}-${direction}`,
      symbol: DISPLAY,
      time: Date.now(),
      direction,
      mode,
      confidence: 1,
      entry: price,
      stopLoss: sl,
      takeProfits: [tp1, tp2],
      riskReward: r2(rr),
      lot,
      rationale: [tight ? 'ACTION mode — trade auto' : `Trade MANUEL ${direction.toUpperCase()} au marché`],
      confluence,
    };
  };

  // ===== Mode ACTION : envoie des trades en continu pour garder l'écran vivant en live =====
  let actionTimer: ReturnType<typeof setInterval> | null = null;
  let actionPrev = 0;
  const actionTick = async () => {
    state = readState(terminal, BROKER, state);
    if (state.killed) return; // le kill switch coupe aussi le mode action
    if (state.openPositions >= 4) return; // laisse les positions ouvertes respirer (SL/TP serrés → elles se résolvent vite)
    const p = terminal.price(BROKER);
    if (!p?.bid || !p?.ask) return;
    const mid = (p.bid + p.ask) / 2;
    const dir: 'long' | 'short' = mid >= actionPrev ? 'long' : 'short'; // suit le micro-momentum
    actionPrev = mid;
    const sig = buildManualSignal(dir, true);
    if (sig) await executeSignal(sig);
  };
  const setActionMode = (on: boolean) => {
    if (on && !actionTimer) {
      actionTimer = setInterval(() => void actionTick(), ACTION_MS);
      void logNote('● ACTION mode ON — Algoria envoie des trades en continu', 'order');
    } else if (!on && actionTimer) {
      clearInterval(actionTimer);
      actionTimer = null;
      void logNote('ACTION mode OFF', 'info');
    }
  };

  // commandes venues du cockpit (mode, kill switch, contrôle manuel, action)
  watchCommands((cmd) => {
    void (async () => {
      try {
        if (cmd.type === 'set_mode' && (cmd.payload as any)?.mode) mode = (cmd.payload as any).mode;
        else if (cmd.type === 'kill') {
          state.killed = true;
          setActionMode(false); // kill coupe aussi le mode action
        } else if (cmd.type === 'resume') state.killed = false;
        else if (cmd.type === 'manual_trade') {
          const dir = (cmd.payload as any)?.direction === 'short' ? 'short' : 'long';
          if (state.killed) {
            await logNote(`trade manuel ${dir} ignoré — kill switch actif`, 'veto');
          } else {
            const sig = buildManualSignal(dir, false);
            if (sig) await executeSignal(sig);
            else await logNote(`trade manuel ${dir} ignoré — pas de prix live`, 'veto');
          }
        } else if (cmd.type === 'close_all') {
          try {
            await closeAll(stream, BROKER);
            await logNote('✕ close all — toutes les positions fermées manuellement', 'order');
          } catch (e) {
            await logNote(`close all échoué · ${(e as { message?: string })?.message ?? String(e)}`, 'veto');
          }
        } else if (cmd.type === 'set_action') {
          setActionMode(!!(cmd.payload as any)?.on);
        }
        console.log('[algoria] commande:', cmd.type, cmd.payload ?? '');
      } catch (e) {
        console.error('[algoria] commande échouée:', cmd.type, e);
      }
    })();
  });

  const onClosed = async (bars: Bar[]) => {
    state = readState(terminal, BROKER, state);
    const { signal, events, context, confluence, threshold } = runTick({ symbol: DISPLAY, bars, mode, state, ctxOpts: { spread: state.spread } }, FEATURES, DEFAULT_CONFIG);
    lastCtx = context; // mémorise l'atr pour le dimensionnement des trades manuels
    await logCandle(DISPLAY, bars[bars.length - 1], 'M5');
    await logEvents(events);
    await pushState(context, state, mode);
    if (signal) await executeSignal(signal);

    // Desk Claude — trades / opportunités / analyses. No-op sans ANTHROPIC_API_KEY ; après l'ordre (ne bloque jamais l'exécution).
    if (narrationReady()) {
      if (signal) {
        const line = await narrate({ kind: 'trade', ctx: context, signal, confluence, threshold });
        if (line) await logNarration(line, signal.time, { kind: 'trade', direction: signal.direction, confidence: signal.confidence, entry: signal.entry, sl: signal.stopLoss, tp: signal.takeProfits[0] });
      } else if (confluence && confluence.direction !== 'flat' && confluence.confidence >= threshold * 0.7) {
        // setup en formation (proche du seuil) → call-out "opportunité" à chaque bougie qui couve
        const line = await narrate({ kind: 'opportunity', ctx: context, confluence, threshold });
        if (line) await logNarration(line, context.time, { kind: 'opportunity', direction: confluence.direction, confidence: confluence.confidence });
      } else {
        // sinon → lecture de marché à chaque clôture (le desk a toujours quelque chose de frais)
        const line = await narrate({ kind: 'analysis', ctx: context, logLines: events.map((e) => e.msg) });
        if (line) await logNarration(line, context.time, { kind: 'analysis' });
      }
    }
  };

  const agg = makeAggregator(TF, seed, onClosed);
  setInterval(() => {
    const p = terminal.price(BROKER);
    if (p) {
      const quoteMs = new Date(p.time).getTime();
      const stale = Number.isFinite(quoteMs) && Date.now() - quoteMs > 90_000; // quote > 90s = marché fermé (week-end/férié)
      if (!stale) {
        agg(p.bid, p.ask, Date.now()); // → bougies + moteur (uniquement marché ouvert, sinon fausses bougies plates + desk qui narre dans le vide)
        broadcastTick(p.bid, p.ask); // → mission control (prix live)
      }
    }
    void manageBreakeven(stream, terminal, BROKER); // SL → breakeven dès que le trade est assez en profit
  }, 1000);
}

main().catch((e) => {
  console.error('[algoria] runner crash:', e);
  process.exit(1);
});
