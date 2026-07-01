// Primitive lightweight-charts v5 (ISeriesPrimitive) : rend les DESSINS utilisateur (trendline / ligne
// horizontale / rectangle / texte) SUR les bougies (zOrder 'top'). L'INTERACTION (souris) est gérée à part
// dans Chart.tsx via un overlay ; ici on ne fait QUE dessiner l'état courant (drawings + brouillon + sélection).
import type { ISeriesApi, SeriesType, Time, SeriesAttachedParameter, IPrimitivePaneView } from 'lightweight-charts';
import { withAlpha } from '@/lib/cockpit/chartTheme';
import { anchorXY, type Drawing } from './drawings';

// Sous-ensemble structurel de CanvasRenderingTarget2D (fancy-canvas) → évite une dépendance d'import.
interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface RenderTarget {
  useMediaCoordinateSpace: <T>(f: (scope: MediaScope) => T) => T;
}

type Chart = SeriesAttachedParameter<Time>['chart'];

function handle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = '#08101f';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(x - 3, y - 3, 6, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  chart: Chart,
  series: ISeriesApi<SeriesType>,
  d: Drawing,
  w: number,
  sel: boolean,
  draft: boolean,
  font: string,
) {
  ctx.save();
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(draft ? [5, 4] : []);

  if (d.kind === 'hline') {
    const y = series.priceToCoordinate(d.a.price);
    if (y != null) {
      const yy = (y as number) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
      // étiquette de prix à gauche
      ctx.setLineDash([]);
      ctx.font = `11px ${font}`;
      const label = d.a.price.toFixed(1);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(8,16,31,.85)';
      ctx.fillRect(2, (y as number) - 8, tw + 8, 16);
      ctx.fillStyle = d.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 6, y as number);
      if (sel) handle(ctx, w / 2, y as number, d.color);
    }
    ctx.restore();
    return;
  }

  const A = anchorXY(chart, series, d.a);
  if (!A) {
    ctx.restore();
    return;
  }

  if (d.kind === 'text') {
    ctx.setLineDash([]);
    ctx.font = `13px ${font}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = d.color;
    ctx.fillText(d.text ?? '', A.x, A.y);
    if (sel) {
      const tw = ctx.measureText(d.text ?? '').width;
      ctx.strokeStyle = withAlpha(d.color, 0.6);
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(A.x - 3, A.y - 14, tw + 6, 18);
    }
    ctx.restore();
    return;
  }

  const B = d.b ? anchorXY(chart, series, d.b) : null;
  if (!B) {
    ctx.restore();
    return;
  }

  if (d.kind === 'trend') {
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  } else {
    // rect
    const x = Math.min(A.x, B.x);
    const y = Math.min(A.y, B.y);
    const rw = Math.abs(B.x - A.x);
    const rh = Math.abs(B.y - A.y);
    ctx.fillStyle = withAlpha(d.color, 0.08);
    ctx.fillRect(x, y, rw, rh);
    ctx.strokeStyle = d.color;
    ctx.strokeRect(x, y, rw, rh);
  }
  if (sel) {
    handle(ctx, A.x, A.y, d.color);
    handle(ctx, B.x, B.y, d.color);
  }
  ctx.restore();
}

class DrawingsRenderer {
  constructor(private readonly p: DrawingsPrimitive) {}
  draw(target: RenderTarget) {
    const { series, chart } = this.p;
    if (!series || !chart) return;
    try {
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        const w = mediaSize.width;
        for (const d of this.p.drawings) {
          drawOne(ctx, chart, series, d, w, d.id === this.p.selectedId, false, this.p.font);
        }
        if (this.p.draft) drawOne(ctx, chart, series, this.p.draft, w, false, true, this.p.font);
      });
    } catch {
      /* un throw dans draw() blanchit le chart → on avale, la frame suivante réessaiera */
    }
  }
}

class DrawingsPaneView implements IPrimitivePaneView {
  private readonly renderer_: DrawingsRenderer;
  constructor(p: DrawingsPrimitive) {
    this.renderer_ = new DrawingsRenderer(p);
  }
  zOrder() {
    return 'top' as const; // au-dessus des bougies
  }
  renderer() {
    return this.renderer_ as unknown as ReturnType<IPrimitivePaneView['renderer']>;
  }
}

export class DrawingsPrimitive {
  series: ISeriesApi<SeriesType> | null = null;
  chart: Chart | null = null;
  drawings: Drawing[] = [];
  draft: Drawing | null = null;
  selectedId: string | null = null;
  font = 'JetBrains Mono, monospace';
  private requestUpdate_: (() => void) | null = null;
  private readonly views: DrawingsPaneView[];

  constructor() {
    this.views = [new DrawingsPaneView(this)];
  }
  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series;
    this.chart = param.chart;
    this.requestUpdate_ = param.requestUpdate;
    if (typeof document !== 'undefined') {
      this.font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || this.font;
    }
  }
  detached() {
    this.series = null;
    this.chart = null;
    this.requestUpdate_ = null;
  }
  updateAllViews() {}
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
  /** Remplace la liste des dessins + la sélection, puis redemande un rendu. */
  setDrawings(drawings: Drawing[], selectedId: string | null) {
    this.drawings = drawings;
    this.selectedId = selectedId;
    this.requestUpdate_?.();
  }
  /** Brouillon en cours de tracé (null = aucun). */
  setDraft(draft: Drawing | null) {
    this.draft = draft;
    this.requestUpdate_?.();
  }
}
