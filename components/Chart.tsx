'use client';
import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { supabase } from '@/lib/supabase/client';
import { subscribeTicks } from '@/lib/cockpit/tickStore';
import { ema, swings } from '@/lib/engine/indicators';
import type { Bar } from '@/lib/engine/types';

/** Position ouverte à matérialiser sur le chart (entrée/SL/TP). null = aucune → chart propre. */
export type ActiveTrade = { direction: string; entry: number; sl: number | null; tp: number | null } | null;

const SYMBOL = 'XAUUSD';
const TFS = ['M1', 'M5', 'M15', 'H1', 'D1'] as const;
type TF = (typeof TFS)[number];
const PAGE = 1500;
const TF_MS: Record<TF, number> = { M1: 60_000, M5: 300_000, M15: 900_000, H1: 3_600_000, D1: 86_400_000 };
const BB_PERIOD = 20;
const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const toCandle = (b: Bar) => ({ time: toSec(b.time), open: b.open, high: b.high, low: b.low, close: b.close });
const toBar = (c: Record<string, unknown>): Bar => ({
  time: Number(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
});

export function Chart({ signals, activeTrade = null }: { signals: Array<Record<string, unknown>>; activeTrade?: ActiveTrade }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const emaFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLoRef = useRef<ISeriesApi<'Line'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const tradeLinesRef = useRef<IPriceLine[]>([]);
  const barsRef = useRef<Bar[]>([]);
  const loadingRef = useRef(false);
  const tfRef = useRef<TF>('M5');
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const activeRef = useRef<ActiveTrade>(activeTrade);
  activeRef.current = activeTrade;
  const [tf, setTf] = useState<TF>('M5');

  // EMA 9/21 (ruban de tendance) + Bandes de Bollinger (20, 2σ) — recalculés en direct → l'impression qu'Algoria « travaille ».
  function drawIndicators() {
    const bars = barsRef.current;
    if (bars.length < BB_PERIOD) return;
    const closes = bars.map((b) => b.close);
    const ef = ema(closes, 9);
    const es = ema(closes, 21);
    const up: { time: UTCTimestamp; value: number }[] = [];
    const mid: { time: UTCTimestamp; value: number }[] = [];
    const lo: { time: UTCTimestamp; value: number }[] = [];
    const fast: { time: UTCTimestamp; value: number }[] = [];
    const slow: { time: UTCTimestamp; value: number }[] = [];
    for (let i = 0; i < bars.length; i++) {
      const t = toSec(bars[i].time);
      fast.push({ time: t, value: ef[i] });
      slow.push({ time: t, value: es[i] });
      const start = Math.max(0, i - BB_PERIOD + 1);
      const win = closes.slice(start, i + 1);
      const m = win.reduce((a, b) => a + b, 0) / win.length;
      const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) * (b - m), 0) / win.length);
      mid.push({ time: t, value: m });
      up.push({ time: t, value: m + 2 * sd });
      lo.push({ time: t, value: m - 2 * sd });
    }
    emaFastRef.current?.setData(fast);
    emaSlowRef.current?.setData(slow);
    bbUpRef.current?.setData(up);
    bbMidRef.current?.setData(mid);
    bbLoRef.current?.setData(lo);
  }

  // Support / résistance les plus proches (swings) — lignes discrètes.
  function drawLevels() {
    const series = seriesRef.current;
    const bars = barsRef.current;
    if (!series) return;
    linesRef.current.forEach((l) => series.removePriceLine(l));
    linesRef.current = [];
    if (bars.length < 20) return;
    const sw = swings(bars, 5, 5);
    const lastClose = bars[bars.length - 1].close;
    const res = sw.filter((s) => s.kind === 'high' && s.price > lastClose).sort((a, b) => a.price - b.price)[0];
    const sup = sw.filter((s) => s.kind === 'low' && s.price < lastClose).sort((a, b) => b.price - a.price)[0];
    if (res) linesRef.current.push(series.createPriceLine({ price: res.price, color: 'rgba(245,194,74,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'R' }));
    if (sup) linesRef.current.push(series.createPriceLine({ price: sup.price, color: 'rgba(43,227,245,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'S' }));
  }

  function drawMarkers() {
    const markers = markersRef.current;
    const bars = barsRef.current;
    if (!markers || !bars.length) return;
    const mk: SeriesMarker<Time>[] = [];
    for (const s of signalsRef.current) {
      const t = parseRefTime(s.ref as string | undefined);
      if (!t) continue;
      const nearest = bars.reduce((p, b) => (Math.abs(b.time - t) < Math.abs(p.time - t) ? b : p), bars[0]);
      const long = s.direction === 'long';
      mk.push({ time: toSec(nearest.time), position: long ? 'belowBar' : 'aboveBar', color: long ? '#1fd8b0' : '#ff6b8a', shape: long ? 'arrowUp' : 'arrowDown', text: long ? 'LONG' : 'SHORT' });
    }
    mk.sort((a, b) => (a.time as number) - (b.time as number));
    markers.setMarkers(mk);
  }

  // Niveaux de la position OUVERTE uniquement (entrée/SL/TP) → chart propre, plus de niveaux fantômes.
  function drawTrade() {
    const series = seriesRef.current;
    if (!series) return;
    tradeLinesRef.current.forEach((l) => series.removePriceLine(l));
    tradeLinesRef.current = [];
    const a = activeRef.current;
    if (!a) return;
    const long = a.direction === 'long';
    const lines = tradeLinesRef.current;
    if (Number.isFinite(a.entry)) lines.push(series.createPriceLine({ price: a.entry, color: '#dce9ff', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `▸ ${long ? 'LONG' : 'SHORT'} ${a.entry.toFixed(1)}` }));
    if (a.sl != null && Number.isFinite(a.sl)) lines.push(series.createPriceLine({ price: a.sl, color: '#ff6b8a', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: `SL ${a.sl.toFixed(1)}` }));
    if (a.tp != null && Number.isFinite(a.tp)) lines.push(series.createPriceLine({ price: a.tp, color: '#1fd8b0', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: `TP ${a.tp.toFixed(1)}` }));
  }

  async function loadRecent(t: TF) {
    const series = seriesRef.current;
    if (!series) return;
    loadingRef.current = true;
    const { data } = await supabase.from('candles').select('*').eq('symbol', SYMBOL).eq('timeframe', t).order('time', { ascending: false }).limit(PAGE);
    loadingRef.current = false;
    const bars = (data ?? []).slice().reverse().map(toBar);
    barsRef.current = bars;
    series.setData(bars.map(toCandle));
    drawIndicators();
    drawLevels();
    drawMarkers();
    drawTrade();
    chartRef.current?.timeScale().fitContent();
  }

  async function loadOlder() {
    const series = seriesRef.current;
    const bars = barsRef.current;
    if (!series || !bars.length || loadingRef.current) return;
    loadingRef.current = true;
    const { data } = await supabase
      .from('candles')
      .select('*')
      .eq('symbol', SYMBOL)
      .eq('timeframe', tfRef.current)
      .lt('time', bars[0].time)
      .order('time', { ascending: false })
      .limit(PAGE);
    loadingRef.current = false;
    if (!data?.length) return;
    const merged = [...data.slice().reverse().map(toBar), ...bars];
    barsRef.current = merged;
    series.setData(merged.map(toCandle));
    drawIndicators();
    drawLevels();
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8298be', fontFamily: 'JetBrains Mono, monospace' },
      grid: { vertLines: { color: 'rgba(43,227,245,0.05)' }, horzLines: { color: 'rgba(43,227,245,0.06)' } },
      rightPriceScale: { borderColor: 'rgba(43,227,245,0.14)' },
      timeScale: { borderColor: 'rgba(43,227,245,0.14)', timeVisible: true, secondsVisible: false },
    });
    const bbUp = chart.addSeries(LineSeries, { color: 'rgba(130,152,190,.45)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const bbMid = chart.addSeries(LineSeries, { color: 'rgba(130,152,190,.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const bbLo = chart.addSeries(LineSeries, { color: 'rgba(130,152,190,.45)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const emaFast = chart.addSeries(LineSeries, { color: 'rgba(43,227,245,.9)', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const emaSlow = chart.addSeries(LineSeries, { color: 'rgba(245,194,74,.9)', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#1fd8b0', downColor: '#ff6b8a', borderVisible: false, wickUpColor: '#1fd8b0', wickDownColor: '#ff6b8a' });
    chartRef.current = chart;
    seriesRef.current = series;
    bbUpRef.current = bbUp;
    bbMidRef.current = bbMid;
    bbLoRef.current = bbLo;
    emaFastRef.current = emaFast;
    emaSlowRef.current = emaSlow;
    markersRef.current = createSeriesMarkers(series, []);

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && range.from < 12) void loadOlder();
    });

    void loadRecent(tfRef.current);

    const live = supabase
      .channel('rt-candles')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candles' }, (p) => {
        const c = p.new as Record<string, unknown>;
        if (c.symbol !== SYMBOL || c.timeframe !== tfRef.current) return;
        const bar = toBar(c);
        const bars = barsRef.current;
        const last = bars[bars.length - 1];
        if (last && bar.time === last.time) bars[bars.length - 1] = bar;
        else if (!last || bar.time > last.time) bars.push(bar);
        else return;
        seriesRef.current?.update(toCandle(bar));
        drawIndicators();
      })
      .subscribe();

    // Flux tick temps réel → bougie EN FORMATION + indicateurs recalculés à chaque tick (le chart « respire »).
    const unsubTicks = subscribeTicks((tick) => {
      const series = seriesRef.current;
      const bars = barsRef.current;
      if (!series || !bars.length) return;
      const step = TF_MS[tfRef.current];
      const mid = (tick.bid + tick.ask) / 2;
      const bucket = Math.floor(tick.t / step) * step;
      const last = bars[bars.length - 1];
      if (bucket > last.time) {
        const nb: Bar = { time: bucket, open: mid, high: mid, low: mid, close: mid, volume: 1 };
        bars.push(nb);
        series.update(toCandle(nb));
      } else if (bucket === last.time) {
        last.high = Math.max(last.high, mid);
        last.low = Math.min(last.low, mid);
        last.close = mid;
        series.update(toCandle(last));
      } else return;
      drawIndicators();
    });

    return () => {
      supabase.removeChannel(live);
      unsubTicks();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      bbUpRef.current = null;
      bbMidRef.current = null;
      bbLoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tfRef.current = tf;
    if (seriesRef.current) void loadRecent(tf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf]);

  useEffect(() => {
    drawMarkers();
    drawTrade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, activeTrade]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
        {TFS.map((t) => (
          <button key={t} onClick={() => setTf(t)} style={tfBtn(t === tf)}>
            {t}
          </button>
        ))}
        <span style={{ marginLeft: 10, display: 'flex', gap: 10, fontSize: 10, color: 'var(--dim)' }}>
          <span style={{ color: 'rgba(43,227,245,.9)' }}>— EMA9</span>
          <span style={{ color: 'rgba(245,194,74,.9)' }}>— EMA21</span>
          <span style={{ color: 'rgba(130,152,190,.8)' }}>·· Bollinger 20</span>
        </span>
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: 240 }} />
    </div>
  );
}

function tfBtn(active: boolean) {
  return {
    fontSize: 11,
    padding: '2px 9px',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? 'rgba(43,227,245,.16)' : 'transparent',
    color: active ? '#2be3f5' : 'var(--muted)',
    border: `1px solid ${active ? 'rgba(43,227,245,.4)' : 'rgba(130,152,190,.25)'}`,
  } as const;
}

function parseRefTime(ref?: string): number | null {
  if (!ref) return null;
  const t = Number(ref.split('-')[1]);
  return Number.isFinite(t) && t > 1e12 ? t : null; // ms epoch encodé dans l'id du signal
}
