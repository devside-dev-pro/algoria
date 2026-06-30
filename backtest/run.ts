import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { connectAccount } from '../runner/metaapi/client';
import { backfill } from '../runner/metaapi/candles';
import { backtest } from './simulator';
import { metrics } from './metrics';
import { runTick } from '../lib/engine/pipeline';
import { DEFAULT_CONFIG, type EngineConfig } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import type { Bar, EngineState, Mode } from '../lib/engine/types';

const BROKER = process.env.ALGORIA_SYMBOL ?? 'XAUUSD'; // "Gold" chez RaiseGlobal
const PAGES = Number(process.env.BT_PAGES ?? 15); // pages × 1000 bougies M5
const WINDOW = Number(process.env.BT_WINDOW ?? 600); // bougies vues par le moteur (= live après restart). 0 = tout.
const CACHE = `backtest/.cache/${BROKER}-M5-${PAGES}.json`;

const P = {
  symbol: 'XAUUSD',
  mode: 'normal' as Mode,
  startBalance: 10_000,
  spread: 0.2,
  slippage: 0.05,
  commissionPerLot: 7,
  contractSize: 100,
  warmup: 210,
  window: WINDOW,
};

const pct = (x: number) => (x * 100).toFixed(1) + '%';
const r2 = (x: number) => x.toFixed(2);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

async function loadBars(): Promise<Bar[]> {
  if (process.env.BT_REFRESH !== '1' && existsSync(CACHE)) {
    const b = JSON.parse(readFileSync(CACHE, 'utf8')) as Bar[];
    console.log(`[backtest] ${b.length} bougies depuis le cache.`);
    return b;
  }
  console.log(`[backtest] connexion MetaApi (RPC) · broker=${BROKER} …`);
  const { account } = await connectAccount();
  console.log(`[backtest] chargement historique M5 (${PAGES} pages × 1000)…`);
  const bars = await backfill(account, BROKER, 'M5', PAGES);
  try {
    mkdirSync('backtest/.cache', { recursive: true });
    writeFileSync(CACHE, JSON.stringify(bars));
  } catch {
    /* cache best-effort */
  }
  return bars;
}

function neutralState(): EngineState {
  return { balance: P.startBalance, equity: P.startBalance, dayStartBalance: P.startBalance, dayPnL: 0, openPositions: 0, openRiskPct: 0, tradesToday: 0, spread: P.spread, newsWindows: [], killed: false };
}

/** Distribution de la confiance sur les bougies tradables — révèle pourquoi le moteur trade peu. */
function diagnose(bars: Bar[], mode: Mode) {
  const buckets = { '<0.40': 0, '0.40-0.50': 0, '0.50-0.60': 0, '0.60-0.65': 0, '0.65-0.72': 0, '>=0.72': 0 };
  let total = 0,
    tradable = 0,
    flat = 0,
    maxC = 0;
  const st = neutralState();
  for (let i = P.warmup; i < bars.length; i++) {
    total++;
    const lo = Math.max(0, i + 1 - WINDOW);
    const { confluence } = runTick({ symbol: P.symbol, bars: bars.slice(lo, i + 1), mode, state: st, ctxOpts: { spread: P.spread } }, FEATURES, DEFAULT_CONFIG);
    if (!confluence) continue;
    tradable++;
    if (confluence.direction === 'flat') flat++;
    const c = confluence.confidence;
    maxC = Math.max(maxC, c);
    if (c < 0.4) buckets['<0.40']++;
    else if (c < 0.5) buckets['0.40-0.50']++;
    else if (c < 0.6) buckets['0.50-0.60']++;
    else if (c < 0.65) buckets['0.60-0.65']++;
    else if (c < 0.72) buckets['0.65-0.72']++;
    else buckets['>=0.72']++;
  }
  return { total, tradable, flat, maxC, buckets };
}

async function main() {
  const bars = await loadBars();
  if (bars.length < P.warmup + 50) {
    console.error('[backtest] pas assez de bougies');
    process.exit(1);
  }
  console.log(`[backtest] ${bars.length} bougies M5 · ${day(bars[0].time)} → ${day(bars[bars.length - 1].time)} · window=${WINDOW}\n`);

  const wired = metrics(backtest(bars, FEATURES, DEFAULT_CONFIG, { ...P, mode: 'normal' }), P.startBalance);
  console.log(`>>> CONFIG CÂBLÉE (DEFAULT_CONFIG · mode normal) : ${wired.trades} trades · winRate ${pct(wired.winRate)} · PF ${wired.profitFactor === Infinity ? '∞' : r2(wired.profitFactor)} · netPnl $${wired.netPnl.toFixed(0)} · maxDD ${pct(wired.maxDrawdownPct)}\n`);

  const dg = diagnose(bars, 'normal');
  console.log('— DIAGNOSTIC (mode normal) : pourquoi si peu de trades ? —');
  console.log(`bougies traitées ${dg.total} · tradables (en session) ${dg.tradable} · dont direction flat ${dg.flat} · confiance MAX vue ${pct(dg.maxC)}`);
  console.log('distribution de la confiance (bougies tradables) :');
  console.table(dg.buckets);

  // GRILLE de recherche : R:R × largeur de SL × seuil. Objectif = win rate élevé en restant rentable.
  // minRR débloqué (sinon les R:R < 1.2 sont rejetés) ; maxStopAtr relâché pour autoriser les SL larges.
  const cfgWith = (o: { targetRR: number; slAtrMult: number; thr: number }): EngineConfig => ({
    ...DEFAULT_CONFIG,
    targetRR: o.targetRR,
    slAtrMult: o.slAtrMult,
    minRR: Math.min(0.3, o.targetRR * 0.8),
    maxStopAtr: Math.max(4, o.slAtrMult + 3),
    threshold: { soft: o.thr, normal: o.thr, turbo: o.thr, scalp: o.thr },
  });

  type Res = { targetRR: number; slAtr: number; thr: number; trades: number; winRate: number; pf: number; expR: number; net: number; ddl: number };
  const grid: Res[] = [];
  for (const targetRR of [0.3, 0.5, 0.7, 1.0, 1.8])
    for (const slAtrMult of [0.6, 1.2, 2.0])
      for (const thr of [0.45, 0.55]) {
        const m = metrics(backtest(bars, FEATURES, cfgWith({ targetRR, slAtrMult, thr }), { ...P, mode: 'normal' }), P.startBalance);
        grid.push({ targetRR, slAtr: slAtrMult, thr, trades: m.trades, winRate: m.winRate, pf: m.profitFactor, expR: m.expectancyR, net: m.netPnl, ddl: m.maxDrawdownPct });
      }

  const show = (r: Res) => ({ 'R:R': r.targetRR, slATR: r.slAtr, seuil: r.thr, trades: r.trades, winRate: pct(r.winRate), PF: r.pf === Infinity ? '∞' : r2(r.pf), 'exp R': r2(r.expR), netPnl: '$' + r.net.toFixed(0), maxDD: pct(r.ddl) });

  const byWin = [...grid].filter((r) => r.trades >= 30).sort((a, b) => b.winRate - a.winRate);
  console.log('\n========== GRILLE — top 14 par WIN RATE (trades ≥ 30) ==========');
  console.table(byWin.slice(0, 14).map(show));

  const profitable = grid.filter((r) => r.trades >= 40 && r.net >= 0).sort((a, b) => b.winRate - a.winRate);
  const fallback = [...grid].filter((r) => r.trades >= 40).sort((a, b) => b.pf - a.pf);
  const best = profitable[0] ?? fallback[0];
  console.log('\n>>> RECOMMANDATION:', profitable.length ? `meilleur win rate parmi ${profitable.length} configs rentables` : 'aucune config rentable — la moins pire (PF max)');
  console.log(show(best));

  // ROBUSTESSE out-of-sample : chaque config évaluée sur la 1ère moitié PUIS la 2ème, séparément.
  // Rentable sur les DEUX → robuste. Rentable sur une seule → chance de régime → poubelle.
  console.log('\n========== ROBUSTESSE (1ère moitié vs 2ème moitié) ==========');
  const mid = Math.floor(bars.length / 2);
  const halves = [bars.slice(0, mid), bars.slice(mid)] as const;
  const pf = (v: number) => (v === Infinity ? '∞' : r2(v));
  const candidates = [
    { targetRR: 0.3, slAtrMult: 1.2, thr: 0.55 },
    { targetRR: 0.5, slAtrMult: 1.2, thr: 0.55 },
    { targetRR: 0.7, slAtrMult: 1.2, thr: 0.55 },
    { targetRR: 1.0, slAtrMult: 1.2, thr: 0.55 },
  ];
  console.table(
    candidates.map((c) => {
      const cfg = cfgWith(c);
      const a = metrics(backtest(halves[0], FEATURES, cfg, { ...P, mode: 'normal' }), P.startBalance);
      const b = metrics(backtest(halves[1], FEATURES, cfg, { ...P, mode: 'normal' }), P.startBalance);
      return {
        config: `RR${c.targetRR} sl${c.slAtrMult}`,
        'H1 trades': a.trades, 'H1 win': pct(a.winRate), 'H1 PF': pf(a.profitFactor), 'H1 net': '$' + a.netPnl.toFixed(0),
        'H2 trades': b.trades, 'H2 win': pct(b.winRate), 'H2 PF': pf(b.profitFactor), 'H2 net': '$' + b.netPnl.toFixed(0),
      };
    }),
  );
  console.log('\n[backtest] terminé.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[backtest] erreur:', e);
  process.exit(1);
});
