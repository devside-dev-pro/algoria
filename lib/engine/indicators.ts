import type { Bar } from './types';

export const last = <T,>(a: T[]) => a[a.length - 1];

/** SMA — les valeurs de tête utilisent une fenêtre partielle. */
export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(sum / Math.min(i + 1, period));
  }
  return out;
}

/** EMA — amorcée sur la 1ère valeur. */
export function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** RSI de Wilder. */
export function rsi(values: number[], period = 14): number[] {
  const out = new Array(values.length).fill(50);
  if (values.length < period + 1) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const c = values[i] - values[i - 1];
    g += Math.max(0, c);
    l += Math.max(0, -c);
  }
  g /= period;
  l /= period;
  const calc = (gain: number, loss: number) => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = calc(g, l);
  for (let i = period + 1; i < values.length; i++) {
    const c = values[i] - values[i - 1];
    g = (g * (period - 1) + Math.max(0, c)) / period;
    l = (l * (period - 1) + Math.max(0, -c)) / period;
    out[i] = calc(g, l);
  }
  return out;
}

export function trueRange(bars: Bar[]): number[] {
  return bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)),
  );
}

/** ATR de Wilder. */
export function atr(bars: Bar[], period = 14): number[] {
  const tr = trueRange(bars);
  const out: number[] = [];
  let prev = tr[0];
  for (let i = 0; i < tr.length; i++) {
    if (i === 0) prev = tr[0];
    else if (i < period) prev = (prev * i + tr[i]) / (i + 1);
    else prev = (prev * (period - 1) + tr[i]) / period;
    out.push(prev);
  }
  return out;
}

/** ADX de Wilder (force de tendance, sans direction). */
export function adx(bars: Bar[], period = 14): number[] {
  const n = bars.length;
  const out = new Array(n).fill(0);
  if (n < period * 2) return out;
  const pDM = [0];
  const mDM = [0];
  const tr = [bars[0].high - bars[0].low];
  for (let i = 1; i < n; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const dn = bars[i - 1].low - bars[i].low;
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  }
  const smooth = (a: number[]) => {
    const s = new Array(n).fill(0);
    let acc = a.slice(1, period + 1).reduce((x, y) => x + y, 0);
    s[period] = acc;
    for (let i = period + 1; i < n; i++) {
      acc = acc - acc / period + a[i];
      s[i] = acc;
    }
    return s;
  };
  const sTR = smooth(tr);
  const sP = smooth(pDM);
  const sM = smooth(mDM);
  const dx = new Array(n).fill(0);
  for (let i = period; i < n; i++) {
    const pdi = sTR[i] ? (100 * sP[i]) / sTR[i] : 0;
    const mdi = sTR[i] ? (100 * sM[i]) / sTR[i] : 0;
    dx[i] = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
  }
  const first = period * 2 - 1;
  let acc = 0;
  for (let i = period; i <= first; i++) acc += dx[i];
  out[first] = acc / period;
  for (let i = first + 1; i < n; i++) out[i] = (out[i - 1] * (period - 1) + dx[i]) / period;
  return out;
}

export interface Swing {
  index: number;
  price: number;
  kind: 'high' | 'low';
}

/** Points pivots (fractals) : un haut/bas entouré de `left`/`right` bougies plus basses/hautes. */
export function swings(bars: Bar[], left = 3, right = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = left; i < bars.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
    }
    if (isHigh) out.push({ index: i, price: bars[i].high, kind: 'high' });
    if (isLow) out.push({ index: i, price: bars[i].low, kind: 'low' });
  }
  return out;
}

/** Rang percentile (0..1) de `value` dans `window`. */
export function percentileRank(window: number[], value: number): number {
  if (!window.length) return 0.5;
  return window.reduce((c, v) => c + (v <= value ? 1 : 0), 0) / window.length;
}
