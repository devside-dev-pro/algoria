import type { Bar } from '../../lib/engine/types';

const TF_MS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 };
const TF_API: Record<string, string> = { M1: '1m', M5: '5m', M15: '15m', H1: '1h', D1: '1d' };

/** Bougies historiques (getHistoricalCandles : G1 / MT4 G2). */
export async function loadHistory(account: any, symbol: string, tf = '5m', count = 300): Promise<Bar[]> {
  const raw = await account.getHistoricalCandles(symbol, tf, undefined, count);
  return raw.map((c: any) => ({
    time: new Date(c.time).getTime(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.tickVolume ?? 0,
  }));
}

/** Backfill d'historique profond pour un timeframe (paginé, ~pages × 1000 bougies). */
export async function backfill(account: any, symbol: string, tf: string, pages = 5): Promise<Bar[]> {
  const api = TF_API[tf] ?? '5m';
  const out: Bar[] = [];
  let before: Date | undefined;
  for (let p = 0; p < pages; p++) {
    const raw = await account.getHistoricalCandles(symbol, api, before, 1000);
    if (!raw?.length) break;
    const bars: Bar[] = raw.map((c: any) => ({
      time: new Date(c.time).getTime(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.tickVolume ?? 0,
    }));
    out.unshift(...bars);
    before = new Date(bars[0].time - 1); // page suivante = plus ancienne
  }
  return out;
}

/** Agrège les ticks en bougies. Appelle onClosed à CHAQUE clôture de bougie. */
export function makeAggregator(tf: string, seed: Bar[], onClosed: (closedBars: Bar[]) => void) {
  const step = TF_MS[tf];
  const bars = [...seed];
  let cur: Bar | null = null;
  const fresh = (bucket: number, p: number): Bar => ({ time: bucket, open: p, high: p, low: p, close: p, volume: 1 });

  return (bid: number, ask: number, t: number) => {
    const mid = (bid + ask) / 2;
    const bucket = Math.floor(t / step) * step;
    if (!cur) {
      cur = fresh(bucket, mid);
      return;
    }
    if (bucket > cur.time) {
      bars.push(cur);
      onClosed([...bars]); // bougie clôturée → tick moteur
      cur = fresh(bucket, mid);
    } else {
      cur.high = Math.max(cur.high, mid);
      cur.low = Math.min(cur.low, mid);
      cur.close = mid;
      cur.volume++;
    }
  };
}
