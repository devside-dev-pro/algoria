import 'dotenv/config';
// BACKTEST COMBINÉ « TOUS LES TRADES » SUR 12 MOIS — tourne LÀ OÙ sont les données + les credentials
// (Railway ou ta machine). Va chercher le M5 (scalp) ET le H1 (swings) directement chez le broker, lance le
// backtest combiné (un seul compte, 1% de risque/trade), et IMPRIME un petit JSON de résultat à copier-coller.
// Aucun fichier à transférer, aucun git : tu colles la sortie et je régénère algoria.tech/backtest.
//
//   npx tsx scripts/backtest-12mo.ts            (symboles = ALGORIA_SYMBOL / BTCUSD_SYMBOL)
//   npx tsx scripts/backtest-12mo.ts Gold BTCUSD
import { connectMaster } from '../runner/metaapi/client';
import { backfill } from '../runner/metaapi/candles';
import { backtest } from '../backtest/simulator';
import { computeIndicators, labBacktest, SPECS, type StrategyDef } from '../backtest/labcore';
import { metrics } from '../backtest/metrics';
import { DEFAULT_CONFIG } from '../lib/engine/config';
import { FEATURES } from '../lib/engine/features';
import type { Bar } from '../lib/engine/types';
import type { ContextOptions } from '../lib/engine/context';

const goldSym = process.argv[2] ?? process.env.ALGORIA_SYMBOL ?? 'XAUUSD';
const btcSym = process.argv[3] ?? process.env.BTCUSD_SYMBOL ?? 'BTCUSD';
const START = 10_000;

// ---- configs de PROD ----
const CTX: Partial<ContextOptions> = { tradeAsia: true, volMinPct: 0.05, volMaxPct: 0.995 };
const scalpCfg = { ...DEFAULT_CONFIG, targetRR: 0.4, slAtrMult: 1.2, minRR: 0.2, minStopAtr: 0.35, maxStopAtr: 3.2, beTrigger: 0.15, threshold: { soft: 0.25, normal: 0.25, turbo: 0.25, scalp: 0.25 }, risk: { ...DEFAULT_CONFIG.risk, maxTradesPerDay: 200, minSecondsBetweenTrades: 0, maxOpenPositions: 2 } };
const trend = (slAtr: number): StrategyDef => ({ family: 'sw-trend', params: 't', minBars: 700, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5 }, onClose(i, d) {
  const { bars: b, atr, emaF, emaS, ema21 } = d; if (i < 601) return null; const bar = b[i], a = atr[i];
  const bull = emaF[i] > emaS[i] * 1.001, bear = emaF[i] < emaS[i] * 0.999;
  const dip = b[i - 1].low < ema21[i - 1] || b[i - 2].low < ema21[i - 2], pop = b[i - 1].high > ema21[i - 1] || b[i - 2].high > ema21[i - 2];
  if (bull && dip && bar.close > bar.open && bar.close > ema21[i]) return { direction: 'long', stopLoss: bar.close - slAtr * a, takeProfit: bar.close + 16 * a };
  if (bear && pop && bar.close < bar.open && bar.close < ema21[i]) return { direction: 'short', stopLoss: bar.close + slAtr * a, takeProfit: bar.close - 16 * a };
  return null; } });
const brk = (N: number): StrategyDef => ({ family: 'sw-brk', params: 'b', minBars: 700, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5 }, onClose(i, d) {
  const { bars: b, atr } = d; if (i < N + 1) return null; let hi = -Infinity, lo = Infinity; for (let k = i - N; k < i; k++) { hi = Math.max(hi, b[k].high); lo = Math.min(lo, b[k].low); }
  const bar = b[i], a = atr[i]; if (bar.close > hi + 0.15 * a) return { direction: 'long', stopLoss: bar.close - 2 * a, takeProfit: bar.close + 16 * a };
  if (bar.close < lo - 0.15 * a) return { direction: 'short', stopLoss: bar.close + 2 * a, takeProfit: bar.close - 16 * a }; return null; } });

type Tr = { t: number; r: number; win: boolean; src: string };

async function main() {
  console.log(`[12mo] connexion MetaApi… (gold="${goldSym}" btc="${btcSym}")`);
  const { account, stream } = await connectMaster();
  await stream.subscribeToMarketData(goldSym);
  try { await stream.subscribeToMarketData(btcSym); } catch { /* btc optionnel */ }

  console.log('[12mo] récupération M5 gold (scalp, ~12 mois)…');
  const m5 = await backfill(account, goldSym, 'M5', Number(process.env.M5_PAGES ?? 100));
  console.log('[12mo] récupération H1 gold + BTC (swings)…');
  const h1g = await backfill(account, goldSym, 'H1', 12);
  let h1b: Bar[] = [];
  try { h1b = await backfill(account, btcSym, 'H1', 12); } catch { /* btc optionnel */ }
  if (m5.length < 2000) { console.error('[12mo] pas assez de M5 — symbole broker gold incorrect ?'); process.exit(1); }

  // fenêtre = span du M5 dispo (la seule couche limitante) ; les swings filtrés dessus
  const W0 = m5[0].time, W1 = m5[m5.length - 1].time;
  const scalp = backtest(m5, FEATURES, scalpCfg, { symbol: 'XAUUSD', mode: 'normal', startBalance: START, spread: 0.2, slippage: 0.05, commissionPerLot: 7, contractSize: 100, warmup: 210, window: 600, ctxOpts: CTX });
  const swing = (bars: Bar[], s: StrategyDef, sym: 'XAUUSD' | 'BTCUSD') => bars.length > 800 ? labBacktest(computeIndicators(bars), s, SPECS[sym]).trades.filter((t) => t.exitTime >= W0 && t.exitTime <= W1) : [];
  const all: Tr[] = [
    ...scalp.trades.map((t) => ({ t: t.exitTime, r: t.r, win: t.pnl > 0, src: 'scalp' })),
    ...swing(h1g, trend(1), 'XAUUSD').map((t) => ({ t: t.exitTime, r: t.r, win: t.pnl > 0, src: 'gold-swing' })),
    ...swing(h1b, brk(24), 'BTCUSD').map((t) => ({ t: t.exitTime, r: t.r, win: t.pnl > 0, src: 'btc-swing' })),
  ].sort((a, b) => a.t - b.t);

  // UN compte : chaque trade risque 1% du solde courant (compounding)
  let bal = START, peak = START, maxDD = 0, gW = 0, gL = 0, wins = 0; const curveRaw: { t: number; eq: number }[] = [{ t: W0, eq: bal }];
  for (const tr of all) { bal += tr.r * 0.01 * bal; curveRaw.push({ t: tr.t, eq: Math.round(bal) }); peak = Math.max(peak, bal); maxDD = Math.max(maxDD, (peak - bal) / peak); if (tr.r > 0) gW += tr.r; else gL += -tr.r; if (tr.win) wins++; }
  // mensuel
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const byM: Record<string, { n: number; w: number; net: number }> = {}; let mb = START;
  for (const tr of all) { const d = new Date(tr.t); const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; (byM[k] ??= { n: 0, w: 0, net: 0 }); const delta = tr.r * 0.01 * mb; byM[k].n++; if (tr.win) byM[k].w++; byM[k].net += delta; mb += delta; }
  const months = Object.keys(byM).sort().map((k) => { const [y, m] = k.split('-'); return { label: `${MO[+m - 1]} ${y.slice(2)}`, n: byM[k].n, win: Math.round(byM[k].w / byM[k].n * 100), net: Math.round(byM[k].net) }; });
  // équité downsamplée ~150 pts
  const step = Math.max(1, Math.floor(curveRaw.length / 150)); const eq: number[] = []; for (let i = 0; i < curveRaw.length; i += step) eq.push(curveRaw[i].eq); eq.push(curveRaw[curveRaw.length - 1].eq);

  const result = {
    window: { from: new Date(W0).toISOString().slice(0, 10), to: new Date(W1).toISOString().slice(0, 10), days: Math.round((W1 - W0) / 86_400_000) },
    trades: all.length, win: Math.round(wins / all.length * 100), pf: +(gW / gL).toFixed(2), maxDD: +(maxDD * 100).toFixed(1), ret: Math.round((bal - START) / START * 100), end: Math.round(bal),
    split: { scalp: all.filter((t) => t.src === 'scalp').length, goldSwing: all.filter((t) => t.src === 'gold-swing').length, btcSwing: all.filter((t) => t.src === 'btc-swing').length },
    months, eq,
  };
  console.log('\n================ COPIE TOUT CE BLOC ET COLLE-LE MOI ================');
  console.log('ALGORIA_12MO_RESULT=' + JSON.stringify(result));
  console.log('===================================================================\n');
  console.log(`résumé : ${result.window.from}→${result.window.to} (${result.window.days}j) · ${result.trades} trades · win ${result.win}% · PF ${result.pf} · DD ${result.maxDD}% · net +${result.ret}%`);
  process.exit(0);
}
main().catch((e) => { console.error('[12mo] crash:', e); process.exit(1); });
