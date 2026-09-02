// CŒUR du laboratoire de stratégies — specs marché, indicateurs causaux et simulateur pessimiste.
// Partagé entre le CLI d'exploration (backtest/lab.ts) et la SENTINELLE du runner (re-validation hebdo
// des edges live sur données fraîches). Une seule implémentation = un seul tribunal.
import type { BacktestRun, SimTrade, EquityPoint } from './simulator';
import type { Bar } from '../lib/engine/types';
import { GOLD_SWING } from '../lib/engine/swing';

// ===== Specs marché (miroir de validate.ts — coûts RÉELS par symbole) =====
export interface Spec { spread: number; contractSize: number; commissionPerLot: number }
export const SPECS: Record<string, Spec> = {
  XAUUSD: { spread: 0.2, contractSize: 100, commissionPerLot: 7 },
  NAS100: { spread: 0.95, contractSize: 1, commissionPerLot: 0 },
  BTCUSD: { spread: 10, contractSize: 1, commissionPerLot: 0 }, // spread réel broker (mesuré MT5)
  EURUSD: { spread: 0.00012, contractSize: 100_000, commissionPerLot: 7 },
  GBPUSD: { spread: 0.00018, contractSize: 100_000, commissionPerLot: 7 },
  USDJPY: { spread: 0.015, contractSize: 100_000, commissionPerLot: 7 },
  DJ30: { spread: 2.0, contractSize: 1, commissionPerLot: 0 },
};

// ===== Interface stratégie : décision sur CLÔTURE de la bougie i, en ne voyant QUE bars[0..i] =====
export interface LabSignal { direction: 'long' | 'short'; stopLoss: number; takeProfit: number }
// gestion post-entrée (× riskDist). Étude 28/07 : beOffset (verrou du BE, défaut 0.05), ladder (paliers
// [déclencheur, verrou] sur le pic — spec Mathieu « +1R→lock 0.5R, +1.5R→lock 1R… »), weekendFlat (flat
// vendredi ≥ 20h UTC — les overnights en semaine restent intacts, seul l'overweek saute).
// weekendFlatLosers : ne ferme au cutoff QUE les positions en perte latente (les runners gagnants gardent
// leur week-end — ils font +1.9R de moyenne sur 21 mois). noEntryFriFrom : bloque les OUVERTURES le vendredi
// dès l'heure UTC donnée (les 2 stops de −1850$ du 26/07 étaient des entrées du vendredi 19h) sans toucher
// aux positions déjà en cours.
export interface Exits { be: number; beOffset?: number; trailActivate?: number; trailDist?: number; ladder?: Array<[number, number]>; weekendFlat?: boolean; weekendFlatLosers?: boolean; noEntryFriFrom?: number }
export interface StrategyDef { family: string; params: string; minBars: number; exits: Exits; onClose: (i: number, ind: Indicators) => LabSignal | null }

// ===== Indicateurs précalculés (tous CAUSAUX : la valeur en i n'utilise que les bougies ≤ i) =====
export interface Indicators {
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

export function computeIndicators(bars: Bar[]): Indicators {
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

// ===== Simulateur du labo — MÊMES règles d'exécution que backtest/simulator.ts (pessimiste, causal) =====
/**
 * STRATÉGIE SWING « TREND » — LA DÉFINITION PARTAGÉE (02/09/2026).
 *
 * Elle vivait à l'intérieur de walkforward.ts, donc tout autre test voulant la rejouer devait la RECOPIER.
 * Un test de parité qui recopie la stratégie ne prouve rien : il compare le live à une copie, et le jour où
 * les deux divergent d'une ligne, il valide un simulateur qui n'est plus celui sur lequel on décide.
 * Elle est donc ici, importée par les deux.
 */
export const swingTrendDef = (exits: Exits, tpAtr: number): StrategyDef => ({
  family: 'sw', params: 't', minBars: 700, exits,
  onClose(i, d) {
    const { bars: b, atr, emaF, emaS, ema21 } = d; if (i < 601) return null; const bar = b[i], a = atr[i];
    const bull = emaF[i] > emaS[i] * 1.001, bear = emaF[i] < emaS[i] * 0.999;
    const dip = b[i - 1].low < ema21[i - 1] || b[i - 2].low < ema21[i - 2], pop = b[i - 1].high > ema21[i - 1] || b[i - 2].high > ema21[i - 2];
    if (bull && dip && bar.close > bar.open && bar.close > ema21[i]) return { direction: 'long', stopLoss: bar.close - a, takeProfit: bar.close + tpAtr * a };
    if (bear && pop && bar.close < bar.open && bar.close < ema21[i]) return { direction: 'short', stopLoss: bar.close + a, takeProfit: bar.close - tpAtr * a };
    return null;
  },
});

/**
 * LA CONFIG PROD EST DÉRIVÉE DU LIVE, PLUS RECOPIÉE (02/09/2026, trouvé par le test de parité).
 *
 * Cette constante était écrite à la main et NE CORRESPONDAIT PAS à GOLD_SWING. Trois écarts, dont deux
 * gouvernent directement le taux de breakeven — c'est-à-dire exactement la mesure qui a échoué :
 *
 *                       live (GOLD_SWING)                          sim (l'ancienne constante)
 *   breakeven           0,5 R                                      1 R
 *   paliers             [0.75→0.3, 1→0.5, 1.5→1.0, 2→1.5]          [2→0.5]
 *   coupure vendredi    18h (depuis #342)                          12h
 *
 * Un BE à 0,5 R se déclenche BEAUCOUP plus souvent qu'à 1 R, et quatre paliers verrouillent bien plus tôt
 * qu'un seul. Le simulateur ne « mentait » donc pas : il jouait une autre stratégie. Le live sort 54 % de
 * ses swings au breakeven, le sim 22 % — et personne ne pouvait le voir, puisque les deux configurations
 * vivaient dans deux fichiers sans lien.
 *
 * On les relie. Si GOLD_SWING change, le backtest suit — il ne peut plus juger une stratégie qu'on ne
 * fait pas tourner.
 *
 * `weekendFlatLosers` reste en dur : ce n'est pas un champ de SwingConfig mais une boucle du runner
 * (runner/index.ts:552), active sur tous les instruments. Le jour où elle devient configurable, elle se
 * dérivera aussi.
 */
export const SWING_PROD_EXITS: Exits = {
  be: GOLD_SWING.beTrigger,
  trailActivate: GOLD_SWING.trailActivate,
  trailDist: GOLD_SWING.trailDist,
  ladder: GOLD_SWING.ladder,
  noEntryFriFrom: GOLD_SWING.noEntryFriFromUtc,
  weekendFlatLosers: true,
};
export const SWING_PROD_TP_ATR = GOLD_SWING.tpAtr;

export const RISK_PCT = 0.01, MAX_DAILY_LOSS = 0.04, START = 10_000;
const dayOf = (t: number) => Math.floor(t / 86_400_000);
const isFriCutoff = (t: number) => { const d = new Date(t); return d.getUTCDay() === 5 && d.getUTCHours() >= 20; }; // or clôture ~21h UTC ven.

export function labBacktest(ind: Indicators, strat: StrategyDef, spec: Spec): BacktestRun {
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
          const be = o.entryPrice + o.dir * (ex.beOffset ?? 0.05) * o.riskDist;
          o.stop = o.dir === 1 ? Math.max(o.stop, be) : Math.min(o.stop, be);
        }
        if (ex.ladder) // échelle : palier atteint (pic) → verrouille entrée + lock×R (jamais de recul)
          for (const [trig, lock] of ex.ladder)
            if (fav >= trig * o.riskDist) {
              const lvl = o.entryPrice + o.dir * lock * o.riskDist;
              o.stop = o.dir === 1 ? Math.max(o.stop, lvl) : Math.min(o.stop, lvl);
            }
        if (ex.trailActivate && ex.trailDist && fav >= ex.trailActivate * o.riskDist) {
          const trail = o.peak - o.dir * ex.trailDist * o.riskDist;
          o.stop = o.dir === 1 ? Math.max(o.stop, trail) : Math.min(o.stop, trail);
        }
      }
      // FLAT WEEK-END : vendredi ≥ 20h UTC → fermeture au close (stop/TP de la bougie déjà honorés ci-dessus).
      // Variante 'losers' : seules les positions en perte latente sont coupées — les runners gagnants restent.
      if (open && isFriCutoff(bar.time)) {
        const o = open as NonNullable<typeof open>;
        const losing = o.dir * (bar.close - o.entryPrice) < 0;
        if (strat.exits.weekendFlat || (strat.exits.weekendFlatLosers && losing)) close(bar.close, bar.time, 'wkd');
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
    if ((strat.exits.weekendFlat || strat.exits.weekendFlatLosers) && isFriCutoff(next.time)) continue; // pas d'ouverture dans la fenêtre de coupe
    const nf = strat.exits.noEntryFriFrom;
    if (nf != null) { const dt = new Date(next.time); if (dt.getUTCDay() === 5 && dt.getUTCHours() >= nf) continue; } // vendredi : pas de nouvelle position
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

