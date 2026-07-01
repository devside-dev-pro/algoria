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
import { TradeZonePrimitive } from '@/components/chart/tradeZonePrimitive';
import type { Bar } from '@/lib/engine/types';

/** Position ouverte à matérialiser sur le chart (entrée/SL/TP). tps = échelle de TP (TP1, TP2…). null = aucune. */
export type ActiveTrade = { direction: string; entry: number; sl: number | null; tp: number | null; tps?: number[]; entryTime?: number | null } | null;

type Ind = { ema9: number; ema21: number; vwap: number; bbU: number; bbL: number };
type Hud = { o: number; h: number; l: number; c: number; prevC: number | null; ind: Partial<Ind> } | null;

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
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const tradeLinesRef = useRef<IPriceLine[]>([]);
  const zoneRef = useRef<TradeZonePrimitive | null>(null);
  const barsRef = useRef<Bar[]>([]);
  const loadingRef = useRef(false);
  const tfRef = useRef<TF>('M5');
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const activeRef = useRef<ActiveTrade>(activeTrade);
  activeRef.current = activeTrade;
  const [tf, setTf] = useState<TF>('M5');
  // Visibilité des indicateurs (toggles cliquables). On garde le calcul, on masque juste l'affichage.
  const [vis, setVis] = useState({ ema: true, bb: true, vwap: true, sr: true, marks: true });
  const visRef = useRef(vis);
  visRef.current = vis;
  // HUD crosshair (O/H/L/C + indicateurs de la bougie survolée, sinon la dernière)
  const [hud, setHud] = useState<Hud>(null);
  const lastIndRef = useRef<Partial<Ind>>({}); // dernières valeurs EMA/VWAP/BB (pour le HUD hors survol)
  const hudRafRef = useRef<number | null>(null);
  const indRafRef = useRef<number | null>(null); // coalesce des updates d'indicateurs par frame

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
    const vwap: { time: UTCTimestamp; value: number }[] = [];
    let vday = -1; // VWAP de SESSION : cumul prix×volume remis à zéro à chaque jour UTC
    let cumPV = 0;
    let cumV = 0;
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
      const day = Math.floor(bars[i].time / 86_400_000);
      if (day !== vday) {
        vday = day;
        cumPV = 0;
        cumV = 0;
      }
      const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
      const v = bars[i].volume || 1;
      cumPV += tp * v;
      cumV += v;
      vwap.push({ time: t, value: cumPV / cumV });
    }
    emaFastRef.current?.setData(fast);
    emaSlowRef.current?.setData(slow);
    bbUpRef.current?.setData(up);
    bbMidRef.current?.setData(mid);
    bbLoRef.current?.setData(lo);
    vwapRef.current?.setData(vwap);
    const n = bars.length - 1; // dernières valeurs → HUD hors survol
    lastIndRef.current = { ema9: ef[n], ema21: es[n], vwap: vwap[n]?.value, bbU: up[n]?.value, bbL: lo[n]?.value };
  }

  // PERF : sur un tick, ne met à jour que le DERNIER point (series.update) au lieu de setData(1500)×6.
  // Recompute léger de la dernière bougie uniquement (les précédentes sont figées).
  function updateLastIndicators() {
    const bars = barsRef.current;
    const N = bars.length;
    if (N < BB_PERIOD) return;
    const closes = bars.map((b) => b.close);
    const t = toSec(bars[N - 1].time);
    const ef = ema(closes, 9)[N - 1];
    const es = ema(closes, 21)[N - 1];
    const win = closes.slice(N - BB_PERIOD, N);
    const m = win.reduce((a, b) => a + b, 0) / win.length;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) * (b - m), 0) / win.length);
    const bbU = m + 2 * sd;
    const bbL = m - 2 * sd;
    // VWAP de la dernière bougie : cumul sur le jour UTC courant (remonte jusqu'à la frontière de jour).
    const day = Math.floor(bars[N - 1].time / 86_400_000);
    let cumPV = 0;
    let cumV = 0;
    for (let i = N - 1; i >= 0 && Math.floor(bars[i].time / 86_400_000) === day; i--) {
      const b = bars[i];
      const v = b.volume || 1;
      cumPV += ((b.high + b.low + b.close) / 3) * v;
      cumV += v;
    }
    const vwapLast = cumV ? cumPV / cumV : bars[N - 1].close;
    emaFastRef.current?.update({ time: t, value: ef });
    emaSlowRef.current?.update({ time: t, value: es });
    bbUpRef.current?.update({ time: t, value: bbU });
    bbMidRef.current?.update({ time: t, value: m });
    bbLoRef.current?.update({ time: t, value: bbL });
    vwapRef.current?.update({ time: t, value: vwapLast });
    lastIndRef.current = { ema9: ef, ema21: es, vwap: vwapLast, bbU, bbL };
  }

  // Coalesce les mises à jour d'indicateurs à 1 flush par frame (les ticks peuvent arriver en rafale).
  function scheduleIndUpdate() {
    if (indRafRef.current != null) return;
    indRafRef.current = requestAnimationFrame(() => {
      indRafRef.current = null;
      updateLastIndicators();
    });
  }

  // Support / résistance les plus proches (swings) — lignes discrètes.
  function drawLevels() {
    const series = seriesRef.current;
    const bars = barsRef.current;
    if (!series) return;
    linesRef.current.forEach((l) => series.removePriceLine(l));
    linesRef.current = [];
    if (!visRef.current.sr) return; // toggle S/R désactivé → on n'affiche aucun niveau
    if (bars.length < 20) return;
    const sw = swings(bars, 5, 5);
    const lastClose = bars[bars.length - 1].close;
    const res = sw.filter((s) => s.kind === 'high' && s.price > lastClose).sort((a, b) => a.price - b.price)[0];
    const sup = sw.filter((s) => s.kind === 'low' && s.price < lastClose).sort((a, b) => b.price - a.price)[0];
    if (res) linesRef.current.push(series.createPriceLine({ price: res.price, color: 'rgba(245,194,74,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'R' }));
    if (sup) linesRef.current.push(series.createPriceLine({ price: sup.price, color: 'rgba(43,227,245,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'S' }));
  }

  // Marqueurs d'entrée PROPRES (style TradingView) : petits triangles, AUCUN texte, un seul par bougie (pas d'empilement).
  // On ignore les micro-scalps BEAST/rafale (sinon le chart est noyé) — ils restent dans la bande TRADES.
  function drawMarkers() {
    const markers = markersRef.current;
    const bars = barsRef.current;
    if (!markers || !bars.length) return;
    if (!visRef.current.marks) { markers.setMarkers([]); return; } // toggle MARKS désactivé → chart sans marqueurs
    const seen = new Set<string>();
    const mk: SeriesMarker<Time>[] = [];
    for (const s of signalsRef.current) {
      const rationale = Array.isArray(s.rationale) ? (s.rationale as string[]).join(' ') : '';
      if (/RAFALE/i.test(rationale)) continue; // spam show → pas sur le chart
      const t = parseRefTime(s.ref as string | undefined);
      if (!t) continue;
      const nearest = bars.reduce((p, b) => (Math.abs(b.time - t) < Math.abs(p.time - t) ? b : p), bars[0]);
      const long = s.direction === 'long';
      const key = `${nearest.time}${long ? 'L' : 'S'}`;
      if (seen.has(key)) continue; // un seul triangle par bougie+sens
      seen.add(key);
      mk.push({ time: toSec(nearest.time), position: long ? 'belowBar' : 'aboveBar', color: long ? 'rgba(31,216,176,.9)' : 'rgba(255,107,138,.9)', shape: long ? 'arrowUp' : 'arrowDown' });
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
    // ZONES remplies TP (vert) / SL (rouge) via la primitive — sous les bougies
    zoneRef.current?.setTrade(
      a && Number.isFinite(a.entry)
        ? { direction: a.direction === 'long' ? 'long' : 'short', entry: a.entry, entryTime: a.entryTime ?? null, sl: a.sl, tps: a.tps && a.tps.length ? a.tps : a.tp != null ? [a.tp] : [] }
        : null,
    );
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
    seedHud(); // légende visible dès le chargement (dernière bougie), avant tout survol
    chartRef.current?.timeScale().fitContent();
  }

  // HUD = dernière bougie (état par défaut hors survol).
  function seedHud() {
    const bars = barsRef.current;
    const b = bars[bars.length - 1];
    if (b) setHud({ o: b.open, h: b.high, l: b.low, c: b.close, prevC: bars.length > 1 ? bars[bars.length - 2].close : null, ind: lastIndRef.current });
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
    // le canvas ne lit pas les var() CSS → on résout la police mono self-hosted une fois
    const monoFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'JetBrains Mono, monospace';
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8298be', fontFamily: monoFamily },
      grid: { vertLines: { color: 'rgba(43,227,245,0.05)' }, horzLines: { color: 'rgba(43,227,245,0.06)' } },
      rightPriceScale: { borderColor: 'rgba(43,227,245,0.14)' },
      timeScale: { borderColor: 'rgba(43,227,245,0.14)', timeVisible: true, secondsVisible: false },
    });
    const bbUp = chart.addSeries(LineSeries, { color: 'rgba(130,152,190,.45)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const bbMid = chart.addSeries(LineSeries, { color: 'rgba(130,152,190,.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const bbLo = chart.addSeries(LineSeries, { color: 'rgba(130,152,190,.45)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const emaFast = chart.addSeries(LineSeries, { color: 'rgba(43,227,245,.9)', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const emaSlow = chart.addSeries(LineSeries, { color: 'rgba(245,194,74,.9)', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const vwap = chart.addSeries(LineSeries, { color: 'rgba(190,120,245,.95)', lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#1fd8b0', downColor: '#ff6b8a', borderVisible: false, wickUpColor: '#1fd8b0', wickDownColor: '#ff6b8a' });
    chartRef.current = chart;
    seriesRef.current = series;
    bbUpRef.current = bbUp;
    bbMidRef.current = bbMid;
    bbLoRef.current = bbLo;
    vwapRef.current = vwap;
    emaFastRef.current = emaFast;
    emaSlowRef.current = emaSlow;
    markersRef.current = createSeriesMarkers(series, []);
    // primitive ZONES TP/SL (attachée à la série → hérite de l'échelle de prix)
    const zone = new TradeZonePrimitive();
    series.attachPrimitive(zone as Parameters<typeof series.attachPrimitive>[0]);
    zoneRef.current = zone;

    // HUD crosshair (O/H/L/C + indicateurs) — coalescé en 1 flush par frame (subscribeCrosshairMove tire à chaque mousemove)
    chart.subscribeCrosshairMove((param) => {
      if (hudRafRef.current != null) return;
      hudRafRef.current = requestAnimationFrame(() => {
        hudRafRef.current = null;
        const s = seriesRef.current;
        const bars = barsRef.current;
        if (!s || !bars.length) return setHud(null);
        const cd = (param.time != null ? param.seriesData.get(s) : undefined) as { open: number; high: number; low: number; close: number } | undefined;
        if (cd && typeof cd.close === 'number') {
          const val = (r: typeof emaFastRef) => (param.seriesData.get(r.current!) as { value?: number } | undefined)?.value;
          const idx = bars.findIndex((b) => toSec(b.time) === param.time);
          setHud({ o: cd.open, h: cd.high, l: cd.low, c: cd.close, prevC: idx > 0 ? bars[idx - 1].close : null, ind: { ema9: val(emaFastRef), ema21: val(emaSlowRef), vwap: val(vwapRef), bbU: val(bbUpRef), bbL: val(bbLoRef) } });
        } else {
          const b = bars[bars.length - 1]; // hors survol → dernière bougie
          setHud({ o: b.open, h: b.high, l: b.low, c: b.close, prevC: bars.length > 1 ? bars[bars.length - 2].close : null, ind: lastIndRef.current });
        }
      });
    });

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
        scheduleIndUpdate();
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
      scheduleIndUpdate();
    });

    return () => {
      supabase.removeChannel(live);
      unsubTicks();
      if (hudRafRef.current != null) cancelAnimationFrame(hudRafRef.current);
      if (indRafRef.current != null) cancelAnimationFrame(indRafRef.current);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      bbUpRef.current = null;
      bbMidRef.current = null;
      bbLoRef.current = null;
      vwapRef.current = null;
      zoneRef.current = null; // chart.remove() dispose la primitive
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

  // Toggles indicateurs : masque/affiche les séries (EMA/Bollinger/VWAP) et redessine les niveaux S/R.
  useEffect(() => {
    emaFastRef.current?.applyOptions({ visible: vis.ema });
    emaSlowRef.current?.applyOptions({ visible: vis.ema });
    bbUpRef.current?.applyOptions({ visible: vis.bb });
    bbMidRef.current?.applyOptions({ visible: vis.bb });
    bbLoRef.current?.applyOptions({ visible: vis.bb });
    vwapRef.current?.applyOptions({ visible: vis.vwap });
    drawLevels();
    drawMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vis]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {TFS.map((t) => (
          <button key={t} onClick={() => setTf(t)} style={tfBtn(t === tf)}>
            {t}
          </button>
        ))}
        <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 5px' }} />
        <button onClick={() => setVis((v) => ({ ...v, ema: !v.ema }))} style={indBtn(vis.ema, 'rgba(43,227,245,.95)')}>EMA 9/21</button>
        <button onClick={() => setVis((v) => ({ ...v, bb: !v.bb }))} style={indBtn(vis.bb, 'rgba(150,170,205,.95)')}>Bollinger</button>
        <button onClick={() => setVis((v) => ({ ...v, vwap: !v.vwap }))} style={indBtn(vis.vwap, 'rgba(190,120,245,.95)')}>VWAP</button>
        <button onClick={() => setVis((v) => ({ ...v, sr: !v.sr }))} style={indBtn(vis.sr, 'rgba(245,194,74,.95)')}>S/R</button>
        <button onClick={() => setVis((v) => ({ ...v, marks: !v.marks }))} style={indBtn(vis.marks, 'rgba(220,233,255,.9)')}>MARKS</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 240 }}>
        <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
        {hud && <ChartHud hud={hud} />}
      </div>
    </div>
  );
}

// Bandeau O/H/L/C + indicateurs (style TradingView), en surimpression haut-gauche du chart.
function ChartHud({ hud }: { hud: NonNullable<Hud> }) {
  const up = hud.c >= hud.o;
  const col = up ? 'var(--up)' : 'var(--down)';
  const chg = hud.prevC ? ((hud.c - hud.prevC) / hud.prevC) * 100 : null;
  const n1 = (v: number | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
  const cell = (k: string, v: string, c?: string) => (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      <span style={{ color: 'var(--dim)' }}>{k}</span>
      <span className="mono" style={{ color: c ?? 'var(--muted)' }}>{v}</span>
    </span>
  );
  return (
    <div className="mono" style={{ position: 'absolute', top: 8, left: 10, display: 'flex', gap: 12, fontSize: 11.5, pointerEvents: 'none', textShadow: '0 1px 4px rgba(0,0,0,.6)', zIndex: 3, flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', gap: 10 }}>
        {cell('O', n1(hud.o), col)}
        {cell('H', n1(hud.h), col)}
        {cell('L', n1(hud.l), col)}
        {cell('C', n1(hud.c), col)}
        {chg != null && <span className="mono" style={{ color: col }}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
      </span>
      <span style={{ display: 'inline-flex', gap: 10 }}>
        {cell('EMA9', n1(hud.ind.ema9), 'rgba(43,227,245,.95)')}
        {cell('EMA21', n1(hud.ind.ema21), 'rgba(245,194,74,.95)')}
        {cell('VWAP', n1(hud.ind.vwap), 'rgba(190,120,245,.95)')}
      </span>
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

// Chip toggle d'un indicateur : allumé = couleur de l'indicateur, éteint = grisé/barré.
function indBtn(active: boolean, color: string) {
  return {
    fontSize: 10.5,
    padding: '2px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? 'rgba(255,255,255,.04)' : 'transparent',
    color: active ? color : 'var(--dim)',
    border: `1px solid ${active ? color.replace(/[\d.]+\)$/, '.4)') : 'rgba(130,152,190,.2)'}`,
    opacity: active ? 1 : 0.5,
    textDecoration: active ? 'none' : 'line-through',
  } as const;
}

function parseRefTime(ref?: string): number | null {
  if (!ref) return null;
  const t = Number(ref.split('-')[1]);
  return Number.isFinite(t) && t > 1e12 ? t : null; // ms epoch encodé dans l'id du signal
}
