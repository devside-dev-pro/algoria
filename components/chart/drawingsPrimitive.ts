// Primitive lightweight-charts v5 (ISeriesPrimitive) : rend les DESSINS utilisateur (trendline / ligne
// horizontale / rectangle / texte) SUR les bougies (zOrder 'top'). L'INTERACTION (souris) est gérée à part
// dans Chart.tsx via un overlay ; ici on ne fait QUE dessiner l'état courant (drawings + brouillon + sélection).
// La résolution time→x est injectée (this.timeToX) pour extrapoler hors data (pas de dessin qui « disparaît »).
import type { ISeriesApi, SeriesType, Time, SeriesAttachedParameter, IPrimitivePaneView } from 'lightweight-charts';
import { withAlpha } from '@/lib/cockpit/chartTheme';
import { anchorXY, type Drawing, type TimeToX } from './drawings';

// Sous-ensemble structurel de CanvasRenderingTarget2D (fancy-canvas) → évite une dépendance d'import.
interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface RenderTarget {
  useMediaCoordinateSpace: <T>(f: (scope: MediaScope) => T) => T;
}

type Ctx = CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Poignée de préhension (extrémité) : petit disque à liseré, style « grip » moderne.
function grip(ctx: Ctx, x: number, y: number, color: string) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1730';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

// Style de trait commun : bouts arrondis, plus épais + halo quand sélectionné.
function strokeStyle(ctx: Ctx, color: string, sel: boolean) {
  ctx.strokeStyle = color;
  ctx.lineWidth = sel ? 2.5 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = sel ? withAlpha(color, 0.55) : 'transparent';
  ctx.shadowBlur = sel ? 7 : 0;
}
function clearShadow(ctx: Ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

function drawOne(
  ctx: Ctx,
  timeToX: TimeToX,
  series: ISeriesApi<SeriesType>,
  d: Drawing,
  w: number,
  sel: boolean,
  draft: boolean,
  font: string,
) {
  ctx.save();
  ctx.setLineDash(draft ? [6, 4] : d.soft ? [4, 4] : []);

  if (d.kind === 'hline') {
    const y = series.priceToCoordinate(d.a.price);
    if (y != null) {
      const yy = (y as number) + 0.5;
      strokeStyle(ctx, d.color, sel);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
      // étiquette de prix en pastille (gauche)
      clearShadow(ctx);
      ctx.setLineDash([]);
      ctx.font = `600 11px ${font}`;
      const label = d.a.price.toFixed(2);
      const tw = ctx.measureText(label).width;
      const pad = 7;
      const h = 17;
      roundRectPath(ctx, 3, (y as number) - h / 2, tw + pad * 2, h, 5);
      ctx.fillStyle = withAlpha(d.color, 0.16);
      ctx.fill();
      ctx.strokeStyle = withAlpha(d.color, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = d.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 3 + pad, y as number);
      if (sel) grip(ctx, Math.min(w - 12, tw + pad * 2 + 24), y as number, d.color);
    }
    ctx.restore();
    return;
  }

  const A = anchorXY(timeToX, series, d.a);
  if (!A) {
    ctx.restore();
    return;
  }

  if (d.kind === 'text') {
    clearShadow(ctx);
    ctx.setLineDash([]);
    if (d.soft) {
      // étiquette d'analyse : PILULE à fond sombre, centrée verticalement sur l'ancre —
      // posée dans la marge droite du chart (hors bougies), lisible sans écraser le prix
      ctx.font = `600 9px ${font}`;
      const label = d.text ?? '';
      const tw = ctx.measureText(label).width;
      const h = 15;
      roundRectPath(ctx, A.x - 5, A.y - h / 2, tw + 10, h, 4);
      ctx.fillStyle = 'rgba(7,12,24,.85)';
      ctx.fill();
      ctx.strokeStyle = withAlpha(d.color, 0.45);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = withAlpha(d.color, 0.95);
      ctx.textBaseline = 'middle';
      ctx.fillText(label, A.x, A.y + 0.5);
      ctx.restore();
      return;
    }
    ctx.font = `13px ${font}`;
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = d.color;
    ctx.fillText(d.text ?? '', A.x, A.y);
    clearShadow(ctx);
    if (sel) {
      const tw = ctx.measureText(d.text ?? '').width;
      ctx.strokeStyle = withAlpha(d.color, 0.6);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(A.x - 4, A.y - 15, tw + 8, 20);
    }
    ctx.restore();
    return;
  }

  const B = d.b ? anchorXY(timeToX, series, d.b) : null;
  if (!B) {
    ctx.restore();
    return;
  }

  if (d.kind === 'trend') {
    if (d.soft) {
      // analyse d'Algoria : trait fin semi-transparent, pas de halo
      ctx.strokeStyle = withAlpha(d.color, 0.65);
      ctx.lineWidth = 1.25;
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
    } else strokeStyle(ctx, d.color, sel);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  } else {
    // rect : coins arrondis, remplissage léger, contour net (soft : voile discret + bord fin pointillé)
    const x = Math.min(A.x, B.x);
    const y = Math.min(A.y, B.y);
    const rw = Math.abs(B.x - A.x);
    const rh = Math.abs(B.y - A.y);
    const r = Math.max(0, Math.min(5, rw / 2, rh / 2));
    clearShadow(ctx);
    roundRectPath(ctx, x, y, rw, rh, r);
    ctx.fillStyle = withAlpha(d.color, d.soft ? 0.055 : 0.1);
    ctx.fill();
    if (d.soft) {
      ctx.strokeStyle = withAlpha(d.color, 0.32);
      ctx.lineWidth = 1;
    } else strokeStyle(ctx, d.color, sel);
    roundRectPath(ctx, x, y, rw, rh, r);
    ctx.stroke();
  }
  if (sel) {
    clearShadow(ctx);
    grip(ctx, A.x, A.y, d.color);
    grip(ctx, B.x, B.y, d.color);
  }
  ctx.restore();
}

class DrawingsRenderer {
  constructor(private readonly p: DrawingsPrimitive) {}
  draw(target: RenderTarget) {
    const { series, timeToX } = this.p;
    if (!series || !timeToX) return;
    try {
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        const ctx = context as Ctx;
        const w = mediaSize.width;
        for (const d of this.p.drawings) {
          drawOne(ctx, timeToX, series, d, w, d.id === this.p.selectedId, false, this.p.font);
        }
        if (this.p.draft) drawOne(ctx, timeToX, series, this.p.draft, w, false, true, this.p.font);
      });
    } catch {
      /* un throw dans draw() blanchit le chart → on avale, la frame suivante réessaiera */
    }
  }
}

class DrawingsPaneView implements IPrimitivePaneView {
  private readonly renderer_: DrawingsRenderer;
  constructor(
    p: DrawingsPrimitive,
    private readonly z: 'top' | 'bottom',
  ) {
    this.renderer_ = new DrawingsRenderer(p);
  }
  zOrder() {
    return this.z; // 'top' = dessins utilisateur (sur les bougies) · 'bottom' = analyse d'Algoria (sous les bougies, lisible)
  }
  renderer() {
    return this.renderer_ as unknown as ReturnType<IPrimitivePaneView['renderer']>;
  }
}

export class DrawingsPrimitive {
  series: ISeriesApi<SeriesType> | null = null;
  timeToX: TimeToX | null = null; // injecté par Chart.tsx (extrapolation hors data)
  drawings: Drawing[] = [];
  draft: Drawing | null = null;
  selectedId: string | null = null;
  font = 'JetBrains Mono, monospace';
  private requestUpdate_: (() => void) | null = null;
  private readonly views: DrawingsPaneView[];

  constructor(zOrder: 'top' | 'bottom' = 'top') {
    this.views = [new DrawingsPaneView(this, zOrder)];
  }
  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series;
    this.requestUpdate_ = param.requestUpdate;
    if (typeof document !== 'undefined') {
      this.font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || this.font;
    }
  }
  detached() {
    this.series = null;
    this.timeToX = null;
    this.requestUpdate_ = null;
  }
  updateAllViews() {}
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
  /** Injecte le résolveur time→x (avec extrapolation). */
  setTimeToX(fn: TimeToX) {
    this.timeToX = fn;
    this.requestUpdate_?.();
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
