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
import { FEATURES } from '../lib/engine/features';
import { logEvents, logSignal, pushState, logCandle, logCandles, logNarration, logNote, recordTradeOpen, broadcastTick, watchCommands } from '../lib/supabase/sync';
import type { Bar, Confluence, EngineState, Mode, Signal } from '../lib/engine/types';

const BROKER = process.env.ALGORIA_SYMBOL ?? 'XAUUSD'; // nom du symbole chez le broker (ex. "Gold")
const DISPLAY = 'XAUUSD'; // label stocké/affiché dans le cockpit (cohérent)
const TF = '5m';
const ACTION_MS = 20_000; // mode Action : un trade toutes les ~20s
const ACTION_HOLD_MS = 9_000; // mode Action : on ferme la position auto après ~9s (open/close → écran vivant)
const MANUAL_LOT = 0.1; // lot par défaut d'un trade manuel (pilotable via le payload)
const ACTION_LOT = 0.05; // lot du mode Action (petit, juste pour l'animation)
const r2 = (x: number) => Math.round(x * 100) / 100;

async function main() {
  console.log('[algoria] runner démarre…');
  const { account, stream, terminal } = await connectMaster();
  await stream.subscribeToMarketData(BROKER);

  // Enregistre la CLÔTURE des trades (deals de sortie) dans Supabase → mesure honnête de la perf.
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

  /** Chemin d'exécution PARTAGÉ (auto + manuel + action). Retourne le ticket, ou undefined si échec. */
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
      const extra = [err.stringCode ? `code=${err.stringCode}` : '', err.numericCode != null ? `num=${err.numericCode}` : '', err.details ? `details=${JSON.stringify(err.details)}` : ''].filter(Boolean).join(' / ');
      const reason = `${err.message ?? String(e)}${extra ? ' / ' + extra : ''}`;
      await logNote(`échec ordre · ${signal.direction} ${BROKER} ${signal.lot} lot · ${reason}`, 'veto');
      await logSignal(signal, { code: reason.slice(0, 250), status: 'rejected' });
      console.error('[algoria] échec ordre:', e);
      return undefined;
    }
  };

  /** Trade au PRIX COURANT. SL/TP optionnels (fournis par le cockpit) ; sinon « nu » → l'utilisateur gère la sortie. */
  const buildManualSignal = (direction: 'long' | 'short', opts: { lot?: number; sl?: number; tp?: number; tight?: boolean } = {}): Signal | null => {
    const p = terminal.price(BROKER);
    if (!p?.bid || !p?.ask) return null;
    const price = r2((p.bid + p.ask) / 2);
    const lot = opts.lot && opts.lot > 0 ? opts.lot : opts.tight ? ACTION_LOT : MANUAL_LOT;
    const dir = direction === 'long' ? 1 : -1;
    let stopLoss = typeof opts.sl === 'number' && opts.sl > 0 ? r2(opts.sl) : 0;
    let takeProfits = typeof opts.tp === 'number' && opts.tp > 0 ? [r2(opts.tp)] : [];
    if (opts.tight && !stopLoss && !takeProfits.length) {
      const d = Math.max(price * 0.0008, 0.5);
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
      rationale: [opts.tight ? 'ACTION mode — trade auto' : `Trade MANUEL ${direction.toUpperCase()}${custom ? ' (SL/TP perso)' : ' au marché'}`],
      confluence,
    };
  };

  // ===== Mode ACTION : ouvre des positions nues et les ferme après ~9s → écran toujours vivant =====
  let actionTimer: ReturnType<typeof setInterval> | null = null;
  let actionPrev = 0;
  const actionTick = async () => {
    state = readState(terminal, BROKER, state);
    if (state.killed) return; // le kill switch coupe aussi le mode action
    if (state.openPositions >= 4) return; // évite l'empilement
    const p = terminal.price(BROKER);
    if (!p?.bid || !p?.ask) return;
    const mid = (p.bid + p.ask) / 2;
    const dir: 'long' | 'short' = mid >= actionPrev ? 'long' : 'short'; // suit le micro-momentum
    actionPrev = mid;
    const sig = buildManualSignal(dir, { tight: true });
    if (sig) await executeSignal(sig); // clôture auto
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
          const pl = cmd.payload as any;
          const dir = pl?.direction === 'short' ? 'short' : 'long';
          const lot = typeof pl?.lot === 'number' && pl.lot > 0 ? pl.lot : undefined;
          const sl = typeof pl?.sl === 'number' && pl.sl > 0 ? pl.sl : undefined;
          const tp = typeof pl?.tp === 'number' && pl.tp > 0 ? pl.tp : undefined;
          if (state.killed) {
            await logNote(`trade manuel ${dir} ignoré — kill switch actif`, 'veto');
          } else {
            const sig = buildManualSignal(dir, { lot, sl, tp });
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
    await logCandle(DISPLAY, bars[bars.length - 1], 'M5');
    await logEvents(events);
    await pushState(context, state, mode);
    if (signal) await executeSignal(signal);

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
  };

  const agg = makeAggregator(TF, seed, onClosed);
  setInterval(() => {
    const p = terminal.price(BROKER);
    if (p) {
      const quoteMs = new Date(p.time).getTime();
      const stale = Number.isFinite(quoteMs) && Date.now() - quoteMs > 90_000;
      if (!stale) {
        agg(p.bid, p.ask, Date.now());
        broadcastTick(p.bid, p.ask);
      }
    }
    void manageBreakeven(stream, terminal, BROKER); // no-op sur les ordres nus (sans SL)
  }, 1000);
}

main().catch((e) => {
  console.error('[algoria] runner crash:', e);
  process.exit(1);
});
