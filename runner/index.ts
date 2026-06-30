import 'dotenv/config';
import './env-check'; // valide les variables d'env et arrête net avec un message clair si une manque
import { connectMaster } from './metaapi/client';
import { loadHistory, makeAggregator, backfill } from './metaapi/candles';
import { readState } from './metaapi/state';
import { placeSignal } from './metaapi/execution';
import { manageBreakeven } from './metaapi/manage';
import { DealRecorder } from './metaapi/trades';
import { narrate, narrationReady } from './llm/narrate';
import { runTick } from '../lib/engine/pipeline';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import { logEvents, logSignal, pushState, logCandle, logCandles, logNarration, logNote, recordTradeOpen, broadcastTick, watchCommands } from '../lib/supabase/sync';
import type { Bar, EngineState, Mode } from '../lib/engine/types';

const BROKER = process.env.ALGORIA_SYMBOL ?? 'XAUUSD'; // nom du symbole chez le broker (ex. "Gold")
const DISPLAY = 'XAUUSD'; // label stocké/affiché dans le cockpit (cohérent)
const TF = '5m';

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

  // commandes venues du cockpit (mode, kill switch, flatten)
  watchCommands((cmd) => {
    if (cmd.type === 'set_mode' && (cmd.payload as any)?.mode) mode = (cmd.payload as any).mode;
    if (cmd.type === 'kill') state.killed = true;
    if (cmd.type === 'resume') state.killed = false;
    console.log('[algoria] commande:', cmd.type, cmd.payload ?? '');
  });

  const onClosed = async (bars: Bar[]) => {
    state = readState(terminal, BROKER, state);
    const { signal, events, context, confluence, threshold } = runTick({ symbol: DISPLAY, bars, mode, state, ctxOpts: { spread: state.spread } }, FEATURES, DEFAULT_CONFIG);
    await logCandle(DISPLAY, bars[bars.length - 1], 'M5');
    await logEvents(events);
    await pushState(context, state, mode);
    if (signal) {
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
    }

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
