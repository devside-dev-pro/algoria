import type { Bar, Direction, MarketContext, Regime, Session, Zone } from './types';
import { adx, atr, ema, last, percentileRank, swings } from './indicators';

export interface SessionConfig {
  london?: [number, number];
  overlap?: [number, number];
  newyork?: [number, number];
  sundayOpen?: number;
  fridayClose?: number; // heures UTC
}

export interface ContextOptions {
  macroBias?: number; // -1..+1 depuis le feed DXY/US10Y ; 0 = inconnu
  spread?: number; // injecté par la couche data (tick MetaApi)
  forceTradable?: boolean; // démo/test : ignore le gate de session
  atrPeriod?: number;
  adxPeriod?: number;
  atrLookback?: number;
  trendAdx?: number;
  rangeAdx?: number;
  volMinPct?: number;
  volMaxPct?: number;
  zoneAtrTol?: number;
  roundStep?: number;
  sessions?: SessionConfig;
}

const DEFAULT_SESSIONS = {
  london: [7, 12] as [number, number],
  overlap: [12, 16] as [number, number],
  newyork: [16, 21] as [number, number],
  sundayOpen: 22,
  fridayClose: 21,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const isRound = (p: number, step: number) => Math.abs(p - Math.round(p / step) * step) < step * 0.08;

function withDefaults(o: ContextOptions) {
  return {
    macroBias: o.macroBias ?? 0,
    spread: o.spread ?? 0,
    forceTradable: o.forceTradable ?? false,
    atrPeriod: o.atrPeriod ?? 14,
    adxPeriod: o.adxPeriod ?? 14,
    atrLookback: o.atrLookback ?? 100,
    trendAdx: o.trendAdx ?? 23,
    rangeAdx: o.rangeAdx ?? 18,
    volMinPct: o.volMinPct ?? 0.15,
    volMaxPct: o.volMaxPct ?? 0.97,
    zoneAtrTol: o.zoneAtrTol ?? 0.6,
    roundStep: o.roundStep ?? 10,
    sessions: { ...DEFAULT_SESSIONS, ...(o.sessions ?? {}) },
  };
}

/** ⚠️ Heures UTC approximatives — à ajuster pour le DST si besoin de précision. */
function classifySession(time: number, s: typeof DEFAULT_SESSIONS): Session {
  const d = new Date(time);
  const day = d.getUTCDay();
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (day === 6) return 'closed';
  if (day === 0 && h < s.sundayOpen) return 'closed';
  if (day === 5 && h >= s.fridayClose) return 'closed';
  if (h >= s.overlap[0] && h < s.overlap[1]) return 'overlap';
  if (h >= s.london[0] && h < s.london[1]) return 'london';
  if (h >= s.newyork[0] && h < s.newyork[1]) return 'newyork';
  return 'asia';
}

function buildZones(bars: Bar[], atrNow: number, o: ReturnType<typeof withDefaults>): Zone[] {
  const tol = Math.max(1e-6, o.zoneAtrTol * atrNow);
  const clusters: { prices: number[]; lastIdx: number }[] = [];
  for (const sw of swings(bars, 3, 3)) {
    const hit = clusters.find((c) => Math.abs(avg(c.prices) - sw.price) <= tol);
    if (hit) {
      hit.prices.push(sw.price);
      hit.lastIdx = Math.max(hit.lastIdx, sw.index);
    } else {
      clusters.push({ prices: [sw.price], lastIdx: sw.index });
    }
  }
  const lastClose = last(bars).close;
  const N = bars.length;
  return clusters
    .filter((c) => c.prices.length >= 2 || isRound(avg(c.prices), o.roundStep))
    .map((c) => {
      const price = avg(c.prices);
      const touches = c.prices.length;
      const round = isRound(price, o.roundStep);
      const strength = clamp01(0.5 * Math.min(1, touches / 4) + 0.3 * (c.lastIdx / N) + (round ? 0.2 : 0));
      return {
        price,
        upper: price + tol / 2,
        lower: price - tol / 2,
        kind: price >= lastClose ? 'resistance' : 'support',
        touches,
        strength,
        isRound: round,
      } as Zone;
    })
    .sort((a, b) => Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose))
    .slice(0, 8);
}

/** Étage 1 — assemble le régime/contexte qui gate tout le reste. */
export function buildContext(symbol: string, bars: Bar[], htfBars?: Bar[], opts: ContextOptions = {}): MarketContext {
  const o = withDefaults(opts);
  const time = last(bars).time;

  const atrSeries = atr(bars, o.atrPeriod);
  const atrNow = last(atrSeries);
  const atrPercentile = percentileRank(atrSeries.slice(-o.atrLookback), atrNow);
  const adxNow = last(adx(bars, o.adxPeriod));

  // Biais directionnel — top-down : on prend la HTF si fournie
  const biasClose = (htfBars ?? bars).map((b) => b.close);
  const px = last(biasClose);
  const e50 = last(ema(biasClose, 50));
  const e200 = last(ema(biasClose, 200));
  const emaBias: Direction = px > e50 && e50 > e200 ? 'long' : px < e50 && e50 < e200 ? 'short' : 'flat';

  const regime: Regime =
    adxNow >= o.trendAdx ? 'trend' : adxNow <= o.rangeAdx ? 'range' : emaBias === 'flat' ? 'range' : 'trend';

  const session = classifySession(time, o.sessions);
  const zones = buildZones(bars, atrNow, o);

  const sessionOk = session === 'london' || session === 'overlap' || session === 'newyork';
  const volOk = atrPercentile >= o.volMinPct && atrPercentile <= o.volMaxPct;

  return {
    symbol,
    time,
    price: last(bars).close,
    session,
    regime,
    adx: adxNow,
    atr: atrNow,
    atrPercentile,
    emaBias,
    macroBias: o.macroBias,
    spread: o.spread,
    zones,
    tradable: o.forceTradable ? volOk : sessionOk && volOk,
  };
}
