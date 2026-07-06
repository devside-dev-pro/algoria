'use client';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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
import { DrawingsPrimitive } from '@/components/chart/drawingsPrimitive';
import { loadDrawings, saveDrawings, newId, topHit, anchorXY, type Drawing, type DrawKind, type Anchor, type HitHandle } from '@/components/chart/drawings';
import { findFVGs, buildAnalysis } from '@/lib/cockpit/analysis';
import type { Bar } from '@/lib/engine/types';

/** Position ouverte à matérialiser sur le chart (entrée/SL/TP). tps = échelle de TP (TP1, TP2…). null = aucune. */
export type ActiveTrade = { direction: string; entry: number; sl: number | null; tp: number | null; tps?: number[]; entryTime?: number | null } | null;

type Ind = { ema9: number; ema21: number; vwap: number; bbU: number; bbL: number };
type Hud = { o: number; h: number; l: number; c: number; prevC: number | null; ind: Partial<Ind> } | null;

const TFS = ['M1', 'M5', 'M15', 'H1', 'D1'] as const;
type TF = (typeof TFS)[number];
const PAGE = 1500;
const TF_MS: Record<TF, number> = { M1: 60_000, M5: 300_000, M15: 900_000, H1: 3_600_000, D1: 86_400_000 };
const BB_PERIOD = 20;
const COLORS = ['#2be3f5', '#f5c24a', '#1fd8b0', '#ff6b8a', '#dce9ff']; // palette des dessins (cyan/or/vert/rouge/blanc)
const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const toCandle = (b: Bar) => ({ time: toSec(b.time), open: b.open, high: b.high, low: b.low, close: b.close });
const toBar = (c: Record<string, unknown>): Bar => ({
  time: Number(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
});

export function Chart({ signals, activeTrade = null, symbol = 'XAUUSD', wins = [], focusAt = null, defaultTf = 'M5', broadcast = false }: { signals: Array<Record<string, unknown>>; activeTrade?: ActiveTrade; symbol?: string; wins?: Array<{ time: number; pnl: number }>; focusAt?: number | null; defaultTf?: TF; broadcast?: boolean }) {
  const SYMBOL = symbol; // le parent remonte le Chart (key={symbol}) au changement → réinit propre du chart impératif
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
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const activeRef = useRef<ActiveTrade>(activeTrade);
  activeRef.current = activeTrade;
  const [tf, setTf] = useState<TF>(defaultTf); // la scène /live démarre en M1 (rythme de décision à la minute)
  // Visibilité des indicateurs (toggles cliquables). On garde le calcul, on masque juste l'affichage.
  // fvg = Fair Value Gaps · ai = l'ANALYSE dessinée par Algoria (trendlines + poches de liquidité)
  const [vis, setVis] = useState({ ema: true, bb: true, vwap: true, sr: true, marks: true, fvg: true, ai: true });
  const visRef = useRef(vis);
  visRef.current = vis;
  // primitive des dessins d'ALGORIA (séparée des dessins utilisateur : ni sélection, ni persistance)
  const aiRef = useRef<DrawingsPrimitive | null>(null);
  const aiKeyRef = useRef(''); // mémo — on ne recalcule l'analyse qu'à la clôture d'une bougie (pas à chaque tick)
  // HUD crosshair (O/H/L/C + indicateurs de la bougie survolée, sinon la dernière)
  const [hud, setHud] = useState<Hud>(null);
  const lastIndRef = useRef<Partial<Ind>>({}); // dernières valeurs EMA/VWAP/BB (pour le HUD hors survol)
  const hudRafRef = useRef<number | null>(null);
  const indRafRef = useRef<number | null>(null); // coalesce des updates d'indicateurs par frame

  // === DESSINS utilisateur (trendline / hline / rect / texte) — persistés en localStorage par TF ===
  const drawRef = useRef<DrawingsPrimitive | null>(null);
  const drawingsRef = useRef<Drawing[]>([]); // source de vérité (la primitive lit ce tableau)
  const draftRef = useRef<Drawing | null>(null); // tracé en cours
  const dragRef = useRef<{ id: string; handle: HitHandle; start: Anchor; orig: Drawing } | null>(null);
  const [tool, setTool] = useState<DrawKind | 'cursor' | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [activeColor, setActiveColor] = useState(COLORS[0]);
  const activeColorRef = useRef(activeColor);
  activeColorRef.current = activeColor;
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; anchor: Anchor } | null>(null);

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

  // L'ANALYSE d'ALGORIA posée sur le chart : FVG + trendlines + poches de liquidité. Recalculée uniquement
  // quand une bougie clôture ou qu'un toggle change (mémo aiKeyRef) — les ticks intra-bougie ne coûtent rien.
  function drawAnalysis(force = false) {
    const ai = aiRef.current;
    const bars = barsRef.current;
    if (!ai) return;
    const v = visRef.current;
    const key = bars.length ? `${bars.length}:${bars[bars.length - 1].time}:${v.fvg}:${v.ai}:${tfRef.current}` : 'empty';
    if (!force && key === aiKeyRef.current) return;
    aiKeyRef.current = key;
    if (bars.length < 60 || (!v.fvg && !v.ai)) return ai.setDrawings([], null);
    const tfMs = TF_MS[tfRef.current];
    const ds: Drawing[] = [];
    if (v.fvg) ds.push(...findFVGs(bars, tfMs));
    if (v.ai) ds.push(...buildAnalysis(bars, tfMs));
    ai.setDrawings(ds, null);
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
    // Célébration des GAINS : pastille verte "+X$" à la bougie de sortie (le moment de win visible sur le chart).
    const first = bars[0].time;
    const last = bars[bars.length - 1].time;
    for (const w of winsRef.current) {
      if (!Number.isFinite(w.time) || w.time < first || w.time > last + TF_MS[tfRef.current]) continue;
      const nearest = bars.reduce((p, b) => (Math.abs(b.time - w.time) < Math.abs(p.time - w.time) ? b : p), bars[0]);
      mk.push({ time: toSec(nearest.time), position: 'aboveBar', color: 'rgba(34,224,166,.95)', shape: 'circle', text: `+${Math.round(w.pnl)}$`, size: 1 });
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
    // SL en rose SOURD + pointillés (moins agressif à l'écran en live) ; TP en vert franc (positif).
    // SL SÉCURISÉ (à/au-delà de l'entrée = breakeven ou trailing en profit) → ligne VERTE « 🔒 BE » :
    // le viewer voit d'un coup d'œil que ce trade ne peut plus perdre.
    if (a.sl != null && Number.isFinite(a.sl)) {
      const secured = (a.entry - a.sl) * (long ? 1 : -1) <= 0;
      lines.push(series.createPriceLine({
        price: a.sl,
        color: secured ? 'rgba(31,216,176,.75)' : 'rgba(196,132,150,.6)',
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
        title: secured ? `🔒 BE ${a.sl.toFixed(1)}` : `SL ${a.sl.toFixed(1)}`,
      }));
    }
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
    drawAnalysis();
    drawMarkers();
    drawTrade();
    seedHud(); // légende visible dès le chargement (dernière bougie), avant tout survol
    chartRef.current?.timeScale().fitContent();
  }

  // === MODE RECAP : voyage dans le temps — centre la vue sur un instant passé (clic sur un trade de la semaine).
  // Charge l'historique manquant page par page jusqu'à atteindre l'instant, puis cadre ±80 bougies autour.
  async function focusOn(ms: number) {
    for (let i = 0; i < 50 && (!barsRef.current.length || loadingRef.current); i++) await new Promise((r) => setTimeout(r, 120)); // attend le chargement initial
    let guard = 0;
    while (barsRef.current.length && barsRef.current[0].time > ms && guard++ < 12) {
      const oldest = barsRef.current[0].time;
      await loadOlder();
      if (barsRef.current[0].time === oldest) break; // plus d'historique en base
    }
    const chart = chartRef.current;
    if (!chart || !barsRef.current.length) return;
    const tfMs = TF_MS[tfRef.current];
    const lastT = barsRef.current[barsRef.current.length - 1].time;
    const from = Math.max(barsRef.current[0].time, ms - 80 * tfMs);
    const to = Math.min(lastT + tfMs, ms + 80 * tfMs);
    chart.timeScale().setVisibleRange({ from: toSec(from), to: toSec(to) });
    drawMarkers(); // les marqueurs de la zone (triangles + pastilles win) reflètent les données fraîchement chargées
  }
  useEffect(() => {
    if (focusAt != null) void focusOn(focusAt);
    else chartRef.current?.timeScale().scrollToRealTime(); // sortie du recap → retour au présent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAt]);

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
    drawAnalysis();
  }

  // --- Dessins : persistance + rendu + sélection ---
  const persist = () => saveDrawings(SYMBOL, tfRef.current, drawingsRef.current);
  const repaint = () => drawRef.current?.setDrawings(drawingsRef.current, selectedIdRef.current);
  const select = (id: string | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    repaint();
  };
  const toggleTool = (t: DrawKind | 'cursor') => {
    const next = toolRef.current === t ? null : t;
    toolRef.current = next;
    setTool(next);
  };

  // time(sec) → x px : timeToCoordinate si la bougie existe, sinon EXTRAPOLATION linéaire hors data
  // (barSpacing px/bougie). Sans ça, un dessin tiré à droite du prix courant « disparaîtrait ».
  const timeToX = (timeSec: number): number | null => {
    const chart = chartRef.current;
    if (!chart) return null;
    const ts = chart.timeScale();
    const direct = ts.timeToCoordinate(timeSec as Time);
    if (direct != null) return direct as number;
    const bars = barsRef.current;
    if (!bars.length) return null;
    const stepSec = TF_MS[tfRef.current] / 1000;
    const barSpacing = ts.options().barSpacing || 6;
    const lastSec = Math.floor(bars[bars.length - 1].time / 1000);
    const firstSec = Math.floor(bars[0].time / 1000);
    if (timeSec > lastSec) {
      const xLast = ts.timeToCoordinate(lastSec as Time);
      return xLast == null ? null : (xLast as number) + ((timeSec - lastSec) / stepSec) * barSpacing;
    }
    if (timeSec < firstSec) {
      const xFirst = ts.timeToCoordinate(firstSec as Time);
      return xFirst == null ? null : (xFirst as number) - ((firstSec - timeSec) / stepSec) * barSpacing;
    }
    return null; // dans la plage mais hors bougie (rare : les ancres sont calées sur des bougies)
  };

  // x px → time(sec) : coordinateToTime si sur une bougie, sinon EXTRAPOLATION → on peut tracer/étirer
  // dans le vide à droite de la dernière bougie (comme TradingView), sans « coller » au prix courant.
  const xToTime = (px: number): number | null => {
    const chart = chartRef.current;
    if (!chart) return null;
    const ts = chart.timeScale();
    const t = ts.coordinateToTime(px);
    if (t != null) return Number(t);
    const bars = barsRef.current;
    if (!bars.length) return null;
    const stepSec = TF_MS[tfRef.current] / 1000;
    const barSpacing = ts.options().barSpacing || 6;
    const lastSec = Math.floor(bars[bars.length - 1].time / 1000);
    const xLast = ts.timeToCoordinate(lastSec as Time);
    if (xLast == null) return null;
    return Math.round(lastSec + ((px - (xLast as number)) / barSpacing) * stepSec);
  };

  // pixel (px,py) → ancre { time, price } (extrapolée hors data).
  const snapAnchor = (px: number, py: number): Anchor | null => {
    const series = seriesRef.current;
    if (!series) return null;
    const p = series.coordinateToPrice(py);
    if (p == null) return null;
    const time = xToTime(px);
    if (time == null) return null;
    return { time, price: Number(p) };
  };

  // Déplace le dessin sélectionné (poignée 'a'/'b' = une extrémité, 'body' = le tout) selon le delta souris.
  const applyDrag = (cur: Anchor) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dT = cur.time - drag.start.time;
    const dP = cur.price - drag.start.price;
    const arr = drawingsRef.current;
    const idx = arr.findIndex((x) => x.id === drag.id);
    if (idx < 0) return;
    const o = drag.orig;
    const nd: Drawing = { ...o };
    if (o.kind === 'hline') nd.a = { time: o.a.time, price: o.a.price + dP };
    else if (drag.handle === 'a') nd.a = { time: o.a.time + dT, price: o.a.price + dP };
    else if (drag.handle === 'b' && o.b) nd.b = { time: o.b.time + dT, price: o.b.price + dP };
    else {
      nd.a = { time: o.a.time + dT, price: o.a.price + dP };
      if (o.b) nd.b = { time: o.b.time + dT, price: o.b.price + dP };
    }
    const next = arr.slice();
    next[idx] = nd;
    drawingsRef.current = next;
    repaint();
  };

  const onDrawPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = toolRef.current;
    if (!t) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (t === 'text') {
      // PAS de pointer-capture ici → l'input texte peut prendre et garder le focus
      e.preventDefault();
      const a = snapAnchor(px, py);
      if (a) setTextEdit({ x: px, y: py, anchor: a });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (t === 'cursor') {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;
      const hit = topHit(timeToX, series, drawingsRef.current, px, py, chart.timeScale().width());
      if (hit) {
        const start = snapAnchor(px, py);
        if (start) dragRef.current = { id: hit.d.id, handle: hit.handle, start, orig: JSON.parse(JSON.stringify(hit.d)) as Drawing };
        select(hit.d.id);
      } else select(null);
      return;
    }
    const a = snapAnchor(px, py);
    if (!a) return;
    const color = activeColorRef.current;
    draftRef.current = t === 'hline' ? { id: newId(), kind: 'hline', color, a } : { id: newId(), kind: t, color, a, b: a };
    drawRef.current?.setDraft(draftRef.current);
  };

  const onDrawPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!toolRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (dragRef.current) {
      const cur = snapAnchor(px, py);
      if (cur) applyDrag(cur);
      return;
    }
    const d = draftRef.current;
    if (!d) return;
    const a = snapAnchor(px, py);
    if (!a) return;
    if (d.kind === 'hline') d.a = a;
    else d.b = a;
    drawRef.current?.setDraft({ ...d });
  };

  const onDrawPointerUp = () => {
    if (dragRef.current) {
      dragRef.current = null;
      persist();
      return;
    }
    const d = draftRef.current;
    draftRef.current = null;
    drawRef.current?.setDraft(null);
    if (!d) return;
    if (d.kind === 'trend' || d.kind === 'rect') {
      const series = seriesRef.current;
      const A = series ? anchorXY(timeToX, series, d.a) : null;
      const B = series && d.b ? anchorXY(timeToX, series, d.b) : null;
      if (A && B && Math.hypot(A.x - B.x, A.y - B.y) < 4) return; // tracé trop petit → ignoré
    }
    drawingsRef.current = [...drawingsRef.current, d];
    persist();
    toolRef.current = null;
    setTool(null); // retour au pan après un tracé
    select(d.id);
  };

  const deleteSelected = () => {
    const id = selectedIdRef.current;
    if (!id) return;
    drawingsRef.current = drawingsRef.current.filter((d) => d.id !== id);
    persist();
    select(null);
  };
  const clearDrawings = () => {
    drawingsRef.current = [];
    persist();
    select(null);
  };
  const pickColor = (c: string) => {
    setActiveColor(c);
    activeColorRef.current = c;
    const id = selectedIdRef.current;
    if (id) {
      drawingsRef.current = drawingsRef.current.map((d) => (d.id === id ? { ...d, color: c } : d));
      persist();
      repaint();
    }
  };
  const commitText = (value: string) => {
    const te = textEdit;
    setTextEdit(null);
    toolRef.current = null;
    setTool(null);
    const v = value.trim();
    if (!te || !v) return;
    const d: Drawing = { id: newId(), kind: 'text', color: activeColorRef.current, a: te.anchor, text: v };
    drawingsRef.current = [...drawingsRef.current, d];
    persist();
    select(d.id);
  };

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
    // primitive ANALYSE d'ALGORIA (FVG, trendlines, liquidité) — rendue SOUS les bougies (lisibilité)
    const ai = new DrawingsPrimitive('bottom');
    series.attachPrimitive(ai as Parameters<typeof series.attachPrimitive>[0]);
    aiRef.current = ai;
    ai.setTimeToX(timeToX);
    // primitive DESSINS utilisateur (au-dessus des bougies) + restauration localStorage
    const draw = new DrawingsPrimitive();
    series.attachPrimitive(draw as Parameters<typeof series.attachPrimitive>[0]);
    drawRef.current = draw;
    draw.setTimeToX(timeToX); // résolveur time→x avec extrapolation hors data
    drawingsRef.current = loadDrawings(SYMBOL, tfRef.current);
    draw.setDrawings(drawingsRef.current, null);

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
        drawAnalysis(); // bougie clôturée → l'analyse d'Algoria se rafraîchit (mémo interne : coût nul sinon)
      })
      .subscribe();

    // Flux tick temps réel DU SYMBOLE AFFICHÉ → bougie EN FORMATION (sans filtre, un tick NAS ferait spiker l'or).
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
      drawAnalysis(); // ne recalcule réellement qu'à l'ouverture d'une NOUVELLE bougie (mémo)
    }, SYMBOL);

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
      drawRef.current = null;
      aiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tfRef.current = tf;
    if (seriesRef.current) void loadRecent(tf);
    // recharge le jeu de dessins de la nouvelle TF (les dessins sont scopés par timeframe)
    drawingsRef.current = loadDrawings(SYMBOL, tf);
    selectedIdRef.current = null;
    setSelectedId(null);
    drawRef.current?.setDrawings(drawingsRef.current, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf]);

  // Raccourcis clavier : Échap = annuler/désélectionner ; Suppr/Retour = supprimer le dessin sélectionné.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // ne pas capturer pendant la saisie texte
      if (e.key === 'Escape') {
        draftRef.current = null;
        dragRef.current = null;
        drawRef.current?.setDraft(null);
        setTextEdit(null);
        toolRef.current = null;
        setTool(null);
        select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    drawMarkers();
    drawTrade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, activeTrade, wins]);

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
    drawAnalysis(true); // toggles FVG / ANALYSIS → re-render forcé
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vis]);

  // MODE BROADCAST (/live) : le chart se pilote TOUT SEUL toute la nuit — recalé sur le présent toutes
  // les 20 s (sinon les bougies dérivent hors cadre au fil des minutes) + zoom verrouillé lisible mobile.
  useEffect(() => {
    if (!broadcast) return;
    const follow = () => {
      const ts = chartRef.current?.timeScale();
      if (!ts) return;
      ts.applyOptions({ rightOffset: 5, barSpacing: 9 });
      ts.scrollToRealTime();
    };
    const t0 = window.setTimeout(follow, 1200); // premier calage après le seed
    const iv = window.setInterval(follow, 20_000);
    return () => { window.clearTimeout(t0); window.clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* barres d'outils OPÉRATEUR — masquées en broadcast (elles faisaient tache sur la scène live) */}
      {!broadcast && (
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
        <button onClick={() => setVis((v) => ({ ...v, fvg: !v.fvg }))} style={indBtn(vis.fvg, 'rgba(31,216,176,.95)')} title="Fair Value Gaps — unfilled 3-candle imbalances (teal = bullish, rose = bearish)">FVG</button>
        <button onClick={() => setVis((v) => ({ ...v, ai: !v.ai }))} style={indBtn(vis.ai, 'rgba(43,227,245,.95)')} title="Algoria draws her read: trendlines on the swings + liquidity pools (equal highs/lows)">✦ ANALYSIS</button>
        <button onClick={() => setVis((v) => ({ ...v, marks: !v.marks }))} style={indBtn(vis.marks, 'rgba(220,233,255,.9)')}>MARKS</button>
        <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 5px' }} />
        <div style={drawGroup}>
          <IconButton title="Select / move (Esc to deselect)" active={tool === 'cursor'} onClick={() => toggleTool('cursor')}><CursorIcon /></IconButton>
          <IconButton title="Trend line" active={tool === 'trend'} onClick={() => toggleTool('trend')}><TrendIcon /></IconButton>
          <IconButton title="Horizontal line" active={tool === 'hline'} onClick={() => toggleTool('hline')}><HLineIcon /></IconButton>
          <IconButton title="Rectangle" active={tool === 'rect'} onClick={() => toggleTool('rect')}><RectIcon /></IconButton>
          <IconButton title="Text" active={tool === 'text'} onClick={() => toggleTool('text')}><TextIcon /></IconButton>
          <span style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 2px' }} />
          {COLORS.map((c) => (
            <button key={c} onClick={() => pickColor(c)} title="Color" style={swatch(c, c === activeColor)} aria-label={`color ${c}`} />
          ))}
          <span style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 2px' }} />
          <IconButton title="Delete selected (Del)" active={false} disabled={!selectedId} onClick={deleteSelected}><TrashIcon /></IconButton>
          <button onClick={clearDrawings} title="Remove all drawings" className="drawtool" style={clearBtn}>Clear</button>
        </div>
      </div>
      )}
      <div style={{ position: 'relative', flex: 1, minHeight: 240 }}>
        <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
        {/* overlay de capture souris : actif seulement quand un outil est sélectionné (sinon le chart pan/zoom normalement) */}
        <div
          onPointerDown={onDrawPointerDown}
          onPointerMove={onDrawPointerMove}
          onPointerUp={onDrawPointerUp}
          style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: tool ? 'auto' : 'none', cursor: tool && tool !== 'cursor' ? 'crosshair' : 'default' }}
        />
        {textEdit && (
          <TextEditInput
            textEdit={textEdit}
            color={activeColor}
            onCommit={commitText}
            onCancel={() => {
              setTextEdit(null);
              toolRef.current = null;
              setTool(null);
            }}
          />
        )}
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

// Champ de saisie inline pour l'outil TEXTE. Entrée = valider, Échap = annuler, clic ailleurs = valider.
// `armed` ignore le blur PARASITE du tout premier focus (sinon l'éditeur se fermait aussitôt → « le texte ne marche pas »).
function TextEditInput({
  textEdit,
  color,
  onCommit,
  onCancel,
}: {
  textEdit: { x: number; y: number };
  color: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState('');
  const done = useRef(false);
  const armed = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const id = window.setTimeout(() => {
      armed.current = true;
    }, 90);
    return () => window.clearTimeout(id);
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(v);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  return (
    <input
      ref={inputRef}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={() => {
        if (armed.current) commit();
      }}
      placeholder="type + Enter"
      className="mono"
      style={{
        position: 'absolute',
        left: textEdit.x,
        top: textEdit.y - 13,
        zIndex: 4,
        background: 'rgba(8,16,31,.94)',
        color,
        caretColor: color,
        border: `1px solid ${color}`,
        borderRadius: 6,
        padding: '3px 8px',
        fontSize: 13,
        outline: 'none',
        minWidth: 120,
        boxShadow: '0 6px 20px rgba(3,8,18,.55)',
      }}
    />
  );
}

// Conteneur groupé de la barre d'outils de dessin (aspect « toolbar » cohérent, pas des chips épars).
const drawGroup = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 8,
  background: 'rgba(12,23,48,.6)',
  border: '1px solid var(--border)',
} as const;

const clearBtn = {
  fontSize: 10.5,
  padding: '3px 8px',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--muted)',
  border: '1px solid transparent',
} as const;

// Bouton d'outil (icône). Allumé = cyan ; hover subtil via la classe .drawtool.
function IconButton({ active, disabled = false, onClick, title, children }: { active: boolean; disabled?: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="drawtool"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 24,
        padding: 0,
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? 'rgba(43,227,245,.16)' : 'transparent',
        color: disabled ? 'var(--dim)' : active ? '#2be3f5' : 'var(--muted)',
        border: `1px solid ${active ? 'rgba(43,227,245,.4)' : 'transparent'}`,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

const ICON = { width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
function CursorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M5 3l0 13 3.2-3.3 2 4.2 1.9-.9-2-4.1 4.6 0z" />
    </svg>
  );
}
function TrendIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M4 16 L16 4" />
      <circle cx="4" cy="16" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="16" cy="4" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
function HLineIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M3 10 H17" />
    </svg>
  );
}
function RectIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <rect x="3.5" y="5.5" width="13" height="9" rx="1.5" />
    </svg>
  );
}
function TextIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M5 5 H15 M10 5 V16" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M4 6 H16 M8.5 6 V4.5 H11.5 V6 M6.4 6 L7.2 16 H12.8 L13.6 6" />
    </svg>
  );
}

// Pastille de couleur (ronde) : anneau blanc + halo si couleur active.
function swatch(color: string, active: boolean) {
  return {
    width: 15,
    height: 15,
    padding: 0,
    borderRadius: '50%',
    cursor: 'pointer',
    background: color,
    border: active ? '2px solid #fff' : '1px solid rgba(255,255,255,.3)',
    boxShadow: active ? `0 0 6px ${color}` : 'none',
  } as const;
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
