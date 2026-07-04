// LABORATOIRE DE STRATÉGIES — familles de signaux ALTERNATIVES au scalp de confluence, jugées par le
// MÊME tribunal que l'edge historique : simulation causale (entrée à l'open de i+1, stop testé AVANT le TP,
// spread+slippage+commission réels, breakeven/trailing, kill switch journalier), robustesse H1/H2 obligatoire.
// Objectif : trouver l'arme qui correspond au CARACTÈRE de chaque marché (le BTC est momentum, l'or respecte
// ses niveaux…) au lieu de forcer partout la même stratégie.
//
// USAGE : npx tsx backtest/lab.ts BTCUSD        (un symbole, M5 = familles intraday)
//         npx tsx backtest/lab.ts all           (tous les caches disponibles)
//         npx tsx backtest/lab.ts BTCUSD H1     (H1 = familles SWING : positions tenues des jours,
//                                                SL serré, objectif loin, trailing par paliers)
// Prérequis : cache présent (backtest/.cache/<SYM>-<TF>-15.json — voir scripts/pull-cache.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { metrics } from './metrics';
import type { BacktestRun, SimTrade, EquityPoint } from './simulator';
import type { Bar } from '../lib/engine/types';

// ===== Specs marché (miroir de validate.ts — coûts RÉELS par symbole) =====
interface Spec { spread: number; contractSize: number; commissionPerLot: number }
const SPECS: Record<string, Spec> = {
  XAUUSD: { spread: 0.2, contractSize: 100, commissionPerLot: 7 },
  NAS100: { spread: 0.95, contractSize: 1, commissionPerLot: 0 },
  BTCUSD: { spread: 10, contractSize: 1, commissionPerLot: 0 }, // spread réel broker (mesuré MT5)
  EURUSD: { spread: 0.00012, contractSize: 100_000, commissionPerLot: 7 },
  GBPUSD: { spread: 0.00018, contractSize: 100_000, commissionPerLot: 7 },
  USDJPY: { spread: 0.015, contractSize: 100_000, commissionPerLot: 7 },
  DJ30: { spread: 2.0, contractSize: 1, commissionPerLot: 0 },
};

// ===== Interface stratégie : décision sur CLÔTURE de la bougie i, en ne voyant QUE bars[0..i] =====
interface LabSignal { direction: 'long' | 'short'; stopLoss: number; takeProfit: number }
interface Exits { be: number; trailActivate?: number; trailDist?: number } // gestion post-entrée (× riskDist)
interface StrategyDef { family: string; params: string; minBars: number; exits: Exits; onClose: (i: number, ind: Indicators) => LabSignal | null }

// ===== Indicateurs précalculés (tous CAUSAUX : la valeur en i n'utilise que les bougies ≤ i) =====
interface Indicators {
  bars: Bar[];
  atr: number[]; // ATR14 simple
  volSma: number[]; // SMA20 du volume
  emaF: number[]; // EMA "H1 rapide" ≈ EMA(240) sur M5 (20 périodes H1)
  emaS: number[]; // EMA "H1 lente"  ≈ EMA(600) sur M5 (50 périodes H1)
  ema9: number[];
  ema21: number[];
  vwap: number[]; // VWAP ancrée au jour UTC
  vwapAge: number[]; // bougies écoulées depuis l'ancrage (fiabilité)
}

const emaArr = (src: number[], n: number) => {
  const k = 2 / (n + 1);
  const out = new Array(src.length);
  out[0] = src[0];
  for (let i = 1; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
  return out;
};

function computeIndicators(bars: Bar[]): Indicators {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const atr = new Array(n).fill(0);
  const volSma = new Array(n).fill(0);
  const vwap = new Array(n).fill(0);
  const vwapAge = new Array(n).fill(0);
  let trSum = 0;
  const trs: number[] = [];
  let volSum = 0;
  const vols: number[] = [];
  let day = -1, cumPV = 0, cumV = 0, age = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const tr = i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - close[i - 1]), Math.abs(b.low - close[i - 1]));
    trs.push(tr); trSum += tr;
    if (trs.length > 14) trSum -= trs[trs.length - 15];
    atr[i] = trSum / Math.min(trs.length, 14);
    vols.push(b.volume); volSum += b.volume;
    if (vols.length > 20) volSum -= vols[vols.length - 21];
    volSma[i] = volSum / Math.min(vols.length, 20);
    const d = Math.floor(b.time / 86_400_000);
    if (d !== day) { day = d; cumPV = 0; cumV = 0; age = 0; }
    const typ = (b.high + b.low + b.close) / 3;
    cumPV += typ * (b.volume || 1); cumV += b.volume || 1; age++;
    vwap[i] = cumPV / cumV; vwapAge[i] = age;
  }
  return { bars, atr, volSma, emaF: emaArr(close, 240), emaS: emaArr(close, 600), ema9: emaArr(close, 9), ema21: emaArr(close, 21), vwap, vwapAge };
}

// ===== Familles de stratégies (grilles VOLONTAIREMENT petites — grosse grille = overfitting garanti) =====
function buildStrategies(): StrategyDef[] {
  const S: StrategyDef[] = [];

  // 1) BREAKOUT DONCHIAN — cassure du plus haut/bas des N dernières bougies (le pari "momentum" pur :
  //    quand le BTC casse, il continue). Filtre volume optionnel. Sortie : trailing (on laisse courir).
  for (const N of [24, 48, 96])
    for (const volF of [false, true])
      S.push({
        family: 'breakout', params: `N${N}${volF ? '+vol' : ''}`, minBars: 700,
        exits: { be: 0.8, trailActivate: 1.2, trailDist: 1.2 },
        onClose(i, ind) {
          const { bars, atr, volSma } = ind;
          if (i < N + 1) return null;
          let hi = -Infinity, lo = Infinity;
          for (let k = i - N; k < i; k++) { hi = Math.max(hi, bars[k].high); lo = Math.min(lo, bars[k].low); }
          const b = bars[i], a = atr[i];
          if (volF && b.volume < 1.5 * volSma[i]) return null;
          if (b.close > hi + 0.1 * a) return { direction: 'long', stopLoss: b.close - 1.5 * a, takeProfit: b.close + 3 * a };
          if (b.close < lo - 0.1 * a) return { direction: 'short', stopLoss: b.close + 1.5 * a, takeProfit: b.close - 3 * a };
          return null;
        },
      });

  // 2) IMPULSION DE MOMENTUM — bougie anormalement grande (> k×ATR) qui clôture dans son extrême avec
  //    pic de volume → continuation immédiate. SL de l'autre côté de l'impulsion.
  for (const k of [1.8, 2.4])
    for (const rr of [1, 1.5])
      S.push({
        family: 'momentum', params: `k${k} rr${rr}`, minBars: 700,
        exits: { be: 0.5 },
        onClose(i, ind) {
          const { bars, atr, volSma } = ind;
          const b = bars[i], a = atr[i];
          const range = b.high - b.low;
          if (range < k * a || b.volume < 1.5 * volSma[i]) return null;
          const posInBar = (b.close - b.low) / range; // 1 = clôture au plus haut
          if (posInBar > 0.75) { const sl = b.low - 0.2 * a; return { direction: 'long', stopLoss: sl, takeProfit: b.close + rr * (b.close - sl) }; }
          if (posInBar < 0.25) { const sl = b.high + 0.2 * a; return { direction: 'short', stopLoss: sl, takeProfit: b.close - rr * (sl - b.close) }; }
          return null;
        },
      });

  // 3) TENDANCE H1 + PULLBACK M5 — biais par EMA H1 20/50 (approximées EMA 240/600 sur M5), entrée quand
  //    le pullback sous l'EMA21 M5 REPREND dans le sens du biais (close repasse l'EMA9). Le classique du suivi.
  for (const rr of [1.5, 2])
    S.push({
      family: 'htf-trend', params: `rr${rr}`, minBars: 700,
      exits: { be: 0.4 },
      onClose(i, ind) {
        const { bars, atr, emaF, emaS, ema9, ema21 } = ind;
        if (i < 601) return null;
        const b = bars[i], a = atr[i];
        const bull = emaF[i] > emaS[i] * 1.0005, bear = emaF[i] < emaS[i] * 0.9995; // biais net, pas plat
        const dipped = bars[i - 1].low < ema21[i - 1] || bars[i - 2].low < ema21[i - 2];
        const popped = bars[i - 1].high > ema21[i - 1] || bars[i - 2].high > ema21[i - 2];
        if (bull && dipped && b.close > ema9[i] && b.close > b.open) { const sl = b.close - 1.2 * a; return { direction: 'long', stopLoss: sl, takeProfit: b.close + rr * 1.2 * a }; }
        if (bear && popped && b.close < ema9[i] && b.close < b.open) { const sl = b.close + 1.2 * a; return { direction: 'short', stopLoss: sl, takeProfit: b.close - rr * 1.2 * a }; }
        return null;
      },
    });

  // 4) RETOUR À LA VWAP — prix étiré à z×ATR de la VWAP du jour + bougie de rejet → on fade vers la VWAP.
  //    TP = la VWAP au moment du signal, SL au-delà de l'extrême.
  for (const z of [2.5, 3.5])
    S.push({
      family: 'vwap-fade', params: `z${z}`, minBars: 700,
      exits: { be: 0.5 },
      onClose(i, ind) {
        const { bars, atr, vwap, vwapAge } = ind;
        if (vwapAge[i] < 12) return null; // VWAP pas fiable la 1re heure du jour
        const b = bars[i], a = atr[i], v = vwap[i];
        const zNow = (b.close - v) / a;
        if (zNow > z && b.close < b.open) { const sl = Math.max(b.high, bars[i - 1].high) + 0.5 * a; if (v < b.close - 0.3 * a) return { direction: 'short', stopLoss: sl, takeProfit: v }; }
        if (zNow < -z && b.close > b.open) { const sl = Math.min(b.low, bars[i - 1].low) - 0.5 * a; if (v > b.close + 0.3 * a) return { direction: 'long', stopLoss: sl, takeProfit: v }; }
        return null;
      },
    });

  return S;
}

// ===== Familles SWING (H1) — la "couche de fond" : on attend un VRAI setup, SL structurel, objectif à
// plusieurs R, et le stop REMONTE par paliers (breakeven puis trailing) → les gagnants courent des jours,
// les positions vivent le week-end (crypto). Grilles volontairement petites. =====
function buildSwingStrategies(): StrategyDef[] {
  const S: StrategyDef[] = [];

  // 1) BREAKOUT DONCHIAN H1 — cassure du plus haut/bas de N heures (24h/72h/168h). L'entrée "bon setup" :
  //    le marché sort d'un range multi-jours. Sortie : objectif loin (8R) mais surtout TRAILING par paliers.
  for (const N of [24, 72, 168])
    for (const trail of [1.5, 2.5])
      S.push({
        family: 'sw-breakout', params: `N${N} trail${trail}`, minBars: 700,
        exits: { be: 1, trailActivate: trail, trailDist: trail },
        onClose(i, ind) {
          const { bars, atr } = ind;
          if (i < N + 1) return null;
          let hi = -Infinity, lo = Infinity;
          for (let k = i - N; k < i; k++) { hi = Math.max(hi, bars[k].high); lo = Math.min(lo, bars[k].low); }
          const b = bars[i], a = atr[i];
          if (b.close > hi + 0.15 * a) return { direction: 'long', stopLoss: b.close - 2 * a, takeProfit: b.close + 16 * a };
          if (b.close < lo - 0.15 * a) return { direction: 'short', stopLoss: b.close + 2 * a, takeProfit: b.close - 16 * a };
          return null;
        },
      });

  // 2) TENDANCE DE FOND + PULLBACK H1 — biais par EMA longues (≈10j/25j), entrée sur reprise après repli.
  //    Le classique du swing-following : on rejoint la tendance au meilleur prix, et on la laisse courir.
  for (const trail of [1.5, 2.5])
    S.push({
      family: 'sw-trend', params: `trail${trail}`, minBars: 700,
      exits: { be: 1, trailActivate: trail, trailDist: trail },
      onClose(i, ind) {
        const { bars, atr, emaF, emaS, ema21 } = ind;
        if (i < 601) return null;
        const b = bars[i], a = atr[i];
        const bull = emaF[i] > emaS[i] * 1.001, bear = emaF[i] < emaS[i] * 0.999;
        const dipped = bars[i - 1].low < ema21[i - 1] || bars[i - 2].low < ema21[i - 2];
        const popped = bars[i - 1].high > ema21[i - 1] || bars[i - 2].high > ema21[i - 2];
        if (bull && dipped && b.close > b.open && b.close > ema21[i]) return { direction: 'long', stopLoss: b.close - 2 * a, takeProfit: b.close + 16 * a };
        if (bear && popped && b.close < b.open && b.close < ema21[i]) return { direction: 'short', stopLoss: b.close + 2 * a, takeProfit: b.close - 16 * a };
        return null;
      },
    });

  return S;
}

// ===== Simulateur du labo — MÊMES règles d'exécution que backtest/simulator.ts (pessimiste, causal) =====
const RISK_PCT = 0.01, MAX_DAILY_LOSS = 0.04, START = 10_000;
const dayOf = (t: number) => Math.floor(t / 86_400_000);

function labBacktest(ind: Indicators, strat: StrategyDef, spec: Spec): BacktestRun {
  const bars = ind.bars;
  const slippage = spec.spread * 0.25;
  let balance = START, dayStart = balance, dayKilled = false, lastDay = dayOf(bars[strat.minBars].time);
  let open: { dir: 1 | -1; direction: 'long' | 'short'; entryPrice: number; entryTime: number; lot: number; risk: number; riskDist: number; stop: number; tp: number; peak: number } | null = null;
  const trades: SimTrade[] = [];
  const equity: EquityPoint[] = [];
  const close = (px: number, time: number, reason: SimTrade['reason']) => {
    if (!open) return;
    const pnl = (px - open.entryPrice) * open.dir * open.lot * spec.contractSize - spec.commissionPerLot * open.lot;
    balance += pnl;
    trades.push({ dir: open.direction, entryTime: open.entryTime, entryPrice: open.entryPrice, exitTime: time, exitPrice: px, reason, lot: open.lot, pnl, r: open.risk ? pnl / open.risk : 0, confidence: 0 });
    open = null;
  };

  for (let i = strat.minBars; i < bars.length - 1; i++) {
    const bar = bars[i];
    // 1) sorties sur la bougie i (stop AVANT tp — pessimiste ; le stop testé a été figé en i-1 → causal)
    if (open) {
      const o = open;
      const hitStop = o.dir === 1 ? bar.low <= o.stop : bar.high >= o.stop;
      const hitTp = o.dir === 1 ? bar.high >= o.tp : bar.low <= o.tp;
      if (hitStop) {
        const above = o.dir * (o.stop - o.entryPrice);
        close(o.stop, bar.time, above > 0.1 * o.riskDist ? 'trail' : above >= -1e-9 ? 'be' : 'sl');
      } else if (hitTp) close(o.tp, bar.time, 'tp');
      else {
        o.peak = o.dir === 1 ? Math.max(o.peak, bar.high) : Math.min(o.peak, bar.low);
        const fav = o.dir * (o.peak - o.entryPrice);
        const ex = strat.exits;
        if (ex.be && fav >= ex.be * o.riskDist) {
          const be = o.entryPrice + o.dir * 0.05 * o.riskDist;
          o.stop = o.dir === 1 ? Math.max(o.stop, be) : Math.min(o.stop, be);
        }
        if (ex.trailActivate && ex.trailDist && fav >= ex.trailActivate * o.riskDist) {
          const trail = o.peak - o.dir * ex.trailDist * o.riskDist;
          o.stop = o.dir === 1 ? Math.max(o.stop, trail) : Math.min(o.stop, trail);
        }
      }
    }
    // 2) frontière de jour + equity + kill switch
    const d = dayOf(bar.time);
    if (d !== lastDay) { lastDay = d; dayStart = balance; dayKilled = false; }
    const floating = open ? (bar.close - open.entryPrice) * open.dir * open.lot * spec.contractSize : 0;
    const eq = balance + floating;
    equity.push({ time: bar.time, equity: eq });
    if ((dayStart - eq) / dayStart >= MAX_DAILY_LOSS) dayKilled = true;
    // 3) signal sur clôture de i → entrée à l'OPEN de i+1 (jamais de lookahead), 1 position max
    if (open || dayKilled) continue;
    const sig = strat.onClose(i, ind);
    if (!sig) continue;
    const next = bars[i + 1];
    const dir = sig.direction === 'long' ? 1 : -1;
    const entryPrice = next.open + dir * (spec.spread / 2 + slippage);
    const riskDist = Math.abs(entryPrice - sig.stopLoss);
    if (riskDist <= 0 || dir * (sig.takeProfit - entryPrice) <= 0) continue; // TP déjà dépassé par le gap d'entrée → on passe
    const lot = Math.max(0.01, +((balance * RISK_PCT) / (riskDist * spec.contractSize)).toFixed(2));
    open = { dir: dir as 1 | -1, direction: sig.direction, entryPrice, entryTime: next.time, lot, risk: riskDist * lot * spec.contractSize, riskDist, stop: sig.stopLoss, tp: sig.takeProfit, peak: entryPrice };
  }
  const last = bars[bars.length - 1];
  close(last.close, last.time, 'eod');
  return { trades, equity, finalBalance: balance };
}

// ===== Exécution + rapport =====
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const pf = (v: number) => (v === Infinity ? '∞' : v.toFixed(2));
const isWknd = (t: number) => [0, 6].includes(new Date(t).getUTCDay());

function runSymbol(sym: string, tf: 'M5' | 'H1' = 'M5') {
  const cache = `backtest/.cache/${sym}-${tf}-15.json`;
  const strategies = tf === 'H1' ? buildSwingStrategies() : buildStrategies();
  if (!existsSync(cache)) { console.log(`(pas de cache pour ${sym} — skip)`); return; }
  const bars = JSON.parse(readFileSync(cache, 'utf8')) as Bar[];
  const spec = SPECS[sym];
  if (!spec || bars.length < 1500) { console.log(`(${sym}: spec absente ou historique trop court — skip)`); return; }
  const DAYS = (bars[bars.length - 1].time - bars[0].time) / 86_400_000;
  const ind = computeIndicators(bars);
  const mid = Math.floor(bars.length / 2);
  const indH1 = computeIndicators(bars.slice(0, mid));
  const indH2 = computeIndicators(bars.slice(mid));

  console.log(`\n================ LAB ${sym} · ${bars.length} bougies ${tf} · ${DAYS.toFixed(1)} jours · spread ${spec.spread} ================`);
  type Row = { strat: string; trades: number; perDay: string; win: string; PF: string; net: string; DD: string; h1: string; h2: string; robuste: string };
  const rows: Row[] = [];
  const robustRuns: Array<{ label: string; run: BacktestRun; pfVal: number }> = [];
  for (const s of strategies) {
    const run = labBacktest(ind, s, spec);
    const m = metrics(run, START);
    if (m.trades < 20) continue;
    const a = metrics(labBacktest(indH1, s, spec), START);
    const b = metrics(labBacktest(indH2, s, spec), START);
    const robust = a.netPnl > 0 && b.netPnl > 0 && m.profitFactor > 1.1;
    rows.push({
      strat: `${s.family} ${s.params}`, trades: m.trades, perDay: (m.trades / DAYS).toFixed(1), win: pct(m.winRate),
      PF: pf(m.profitFactor), net: '$' + m.netPnl.toFixed(0), DD: pct(m.maxDrawdownPct),
      h1: '$' + a.netPnl.toFixed(0), h2: '$' + b.netPnl.toFixed(0), robuste: robust ? '✅' : '❌',
    });
    if (robust) robustRuns.push({ label: `${s.family} ${s.params}`, run, pfVal: m.profitFactor });
  }
  rows.sort((x, y) => (parseFloat(y.PF) || 0) - (parseFloat(x.PF) || 0));
  console.table(rows);
  const best = robustRuns.sort((a, b) => b.pfVal - a.pfVal)[0];
  if (!best) { console.log(`>>> ${sym}: aucune famille robuste (rentable H1 ET H2, PF>1.1).`); return; }
  console.log(`>>> ${sym}: MEILLEURE FAMILLE ROBUSTE = ${best.label}`);
  // Contre-épreuve en TIERS (plus dure que H1/H2) : un edge réel doit gagner sur les 3 sous-périodes.
  const third = Math.floor(bars.length / 3);
  const slices = [bars.slice(0, third), bars.slice(third, 2 * third), bars.slice(2 * third)].map(computeIndicators);
  for (const rr of robustRuns.sort((a, b) => b.pfVal - a.pfVal)) {
    const def = strategies.find((s) => `${s.family} ${s.params}` === rr.label)!;
    const nets = slices.map((sl) => metrics(labBacktest(sl, def, spec), START).netPnl);
    console.log(`   TIERS ${rr.label}: $${nets[0].toFixed(0)} / $${nets[1].toFixed(0)} / $${nets[2].toFixed(0)} ${nets.every((x) => x > 0) ? '✅' : '⚠️'}`);
  }
  // TENUE des positions (config verdict) : durée moyenne/médiane + part du temps passé en position —
  // la métrique clé du swing ("des trades toujours ouverts, qui vivent le week-end").
  {
    const hold = best.run.trades.map((t) => (t.exitTime - t.entryTime) / 3_600_000).sort((a, b) => a - b);
    const avg = hold.reduce((a, x) => a + x, 0) / Math.max(1, hold.length);
    const med = hold[Math.floor(hold.length / 2)] ?? 0;
    const inPos = best.run.trades.reduce((a, t) => a + (t.exitTime - t.entryTime), 0) / (bars[bars.length - 1].time - bars[0].time);
    console.log(`   TENUE: moy ${avg.toFixed(1)}h (${(avg / 24).toFixed(1)}j) · méd ${med.toFixed(1)}h · en position ${(inPos * 100).toFixed(0)}% du temps`);
  }
  const wk = best.run.trades.filter((t) => !isWknd(t.entryTime));
  const we = best.run.trades.filter((t) => isWknd(t.entryTime));
  const line = (lbl: string, ts: SimTrade[]) => {
    if (!ts.length) return console.log(`   ${lbl}: aucun trade`);
    const wins = ts.filter((t) => t.pnl > 0), gp = wins.reduce((a, t) => a + t.pnl, 0), gl = Math.abs(ts.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
    console.log(`   ${lbl}: ${ts.length} trades · win ${pct(wins.length / ts.length)} · PF ${pf(gl > 0 ? gp / gl : Infinity)} · net $${ts.reduce((a, t) => a + t.pnl, 0).toFixed(0)}`);
  };
  line('SEMAINE ', wk);
  line('WEEK-END', we);
}

const arg = (process.argv[2] ?? 'all').toUpperCase();
const tfArg = (process.argv[3] ?? 'M5').toUpperCase() as 'M5' | 'H1';
const targets = arg === 'ALL' ? Object.keys(SPECS) : [arg];
for (const sym of targets) runSymbol(sym, tfArg);
process.exit(0);
