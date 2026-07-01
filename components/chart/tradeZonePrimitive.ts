// Primitive lightweight-charts v5 (ISeriesPrimitive) : dessine les ZONES TP (vert) / SL (rouge) REMPLIES
// d'une position ouverte, + une ligne d'entrée pointillée. Rendue SOUS les bougies (zOrder 'bottom').
// Attachée une fois à la série candlestick → hérite automatiquement de l'échelle de prix.
import type { ISeriesApi, SeriesType, Time, SeriesAttachedParameter, IPrimitivePaneView } from 'lightweight-charts';
import { readChartTheme, withAlpha, type ChartTheme } from '@/lib/cockpit/chartTheme';

export type ZoneTrade = { direction: 'long' | 'short'; entry: number; sl: number | null; tps: number[] } | null;

// Sous-ensemble structurel de CanvasRenderingTarget2D (fancy-canvas) → évite une dépendance d'import.
interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface RenderTarget {
  useMediaCoordinateSpace: <T>(f: (scope: MediaScope) => T) => T;
}

class ZoneRenderer {
  constructor(private readonly p: TradeZonePrimitive) {}

  draw(target: RenderTarget) {
    const series = this.p.series;
    const trade = this.p.trade;
    if (!series || !trade) return;
    const th = this.p.theme;
    try {
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        const w = mediaSize.width;
        const yEntry = series.priceToCoordinate(trade.entry);
        if (yEntry == null) return; // hors échelle → on ne dessine rien (jamais throw)

        const dir = trade.direction === 'long' ? 1 : -1;

        // Escalier de zones TP (vert), alpha décroissant par palier, du plus proche au plus lointain.
        const tps = trade.tps
          .filter((t) => Number.isFinite(t) && (t - trade.entry) * dir > 0)
          .sort((a, b) => Math.abs(a - trade.entry) - Math.abs(b - trade.entry));
        let prev = trade.entry;
        tps.forEach((tp, i) => {
          const y0 = series.priceToCoordinate(prev);
          const y1 = series.priceToCoordinate(tp);
          if (y0 != null && y1 != null) {
            ctx.fillStyle = withAlpha(th.up, Math.max(0.05, 0.16 - i * 0.045));
            ctx.fillRect(0, Math.min(y0, y1), w, Math.abs(y1 - y0));
          }
          prev = tp;
        });

        // Zone SL (rouge) : entrée → SL.
        if (trade.sl != null && Number.isFinite(trade.sl)) {
          const ySl = series.priceToCoordinate(trade.sl);
          if (ySl != null) {
            ctx.fillStyle = withAlpha(th.down, 0.15);
            ctx.fillRect(0, Math.min(yEntry, ySl), w, Math.abs(ySl - yEntry));
          }
        }

        // Ligne d'entrée pointillée.
        ctx.save();
        ctx.strokeStyle = withAlpha(th.text, 0.8);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, yEntry + 0.5);
        ctx.lineTo(w, yEntry + 0.5);
        ctx.stroke();
        ctx.restore();
      });
    } catch {
      /* un throw dans draw() blanchit le chart → on avale, la frame suivante réessaiera */
    }
  }
}

class ZonePaneView implements IPrimitivePaneView {
  private readonly renderer_: ZoneRenderer;
  constructor(p: TradeZonePrimitive) {
    this.renderer_ = new ZoneRenderer(p);
  }
  zOrder() {
    return 'bottom' as const; // derrière les bougies
  }
  renderer() {
    return this.renderer_ as unknown as ReturnType<IPrimitivePaneView['renderer']>;
  }
}

export class TradeZonePrimitive {
  series: ISeriesApi<SeriesType> | null = null;
  trade: ZoneTrade = null;
  theme: ChartTheme = readChartTheme();
  private requestUpdate_: (() => void) | null = null;
  private readonly views: ZonePaneView[];

  constructor() {
    this.views = [new ZonePaneView(this)];
  }
  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series;
    this.requestUpdate_ = param.requestUpdate;
    this.theme = readChartTheme();
  }
  detached() {
    this.series = null;
    this.requestUpdate_ = null;
  }
  updateAllViews() {}
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
  /** Met à jour la position affichée (null = aucune zone) et redemande un rendu. */
  setTrade(t: ZoneTrade) {
    this.trade = t;
    this.requestUpdate_?.();
  }
}
