// Modèle de données + persistance + géométrie (hit-test) des dessins utilisateur du chart.
// Les ancres sont stockées en (time, price) ABSOLUS → stables au pan/zoom et au rechargement.
//  - time  : secondes epoch (échelle UTCTimestamp de lightweight-charts), calé sur une bougie de la TF.
//  - price : prix brut de l'axe.
// La résolution time→x est fournie par Chart.tsx (TimeToX) : timeToCoordinate quand la bougie existe,
// sinon EXTRAPOLATION linéaire au-delà de la dernière/première bougie (sinon un dessin tiré à droite
// du prix courant « disparaîtrait »). priceToCoordinate reste porté par la série.
import type { ISeriesApi, SeriesType } from 'lightweight-charts';

export type DrawKind = 'trend' | 'hline' | 'rect' | 'text';
export type Anchor = { time: number; price: number };
export type Drawing = {
  id: string;
  kind: DrawKind;
  color: string;
  a: Anchor; // ancre primaire (pour hline : seul a.price compte)
  b?: Anchor; // ancre secondaire (trend, rect)
  text?: string; // libellé (kind === 'text')
  soft?: boolean; // rendu DISCRET (analyse d'Algoria) : traits fins pointillés, remplissage léger, labels réduits
};

/** Résout un temps (secondes) en coordonnée x, avec extrapolation hors data. null = irrésoluble. */
export type TimeToX = (timeSec: number) => number | null;

const TOL = 6; // tolérance de sélection (px) autour d'un trait
const HANDLE = 8; // rayon de préhension d'une poignée d'extrémité (px)

/** Coordonnées pixel d'une ancre, ou null si irrésoluble. */
export function anchorXY(timeToX: TimeToX, series: ISeriesApi<SeriesType>, a: Anchor): { x: number; y: number } | null {
  const x = timeToX(a.time);
  const y = series.priceToCoordinate(a.price);
  if (x == null || y == null) return null;
  return { x, y: y as number };
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export type HitHandle = 'a' | 'b' | 'body' | null;

/** Teste si (px,py) touche le dessin ; renvoie la poignée touchée ('a'/'b' = extrémité, 'body' = corps), sinon null. */
export function hitTest(
  timeToX: TimeToX,
  series: ISeriesApi<SeriesType>,
  d: Drawing,
  px: number,
  py: number,
  width: number,
): HitHandle {
  if (d.kind === 'hline') {
    const y = series.priceToCoordinate(d.a.price);
    if (y == null) return null;
    return Math.abs(py - (y as number)) <= TOL && px >= 0 && px <= width ? 'a' : null;
  }
  const A = anchorXY(timeToX, series, d.a);
  if (!A) return null;
  if (d.kind === 'text') {
    const w = Math.max(24, (d.text?.length ?? 4) * 7 + 8);
    return px >= A.x - 3 && px <= A.x + w && py >= A.y - 15 && py <= A.y + 5 ? 'body' : null;
  }
  const B = d.b ? anchorXY(timeToX, series, d.b) : null;
  if (!B) return null;
  if (Math.hypot(px - A.x, py - A.y) <= HANDLE) return 'a';
  if (Math.hypot(px - B.x, py - B.y) <= HANDLE) return 'b';
  if (d.kind === 'trend') return distToSeg(px, py, A.x, A.y, B.x, B.y) <= TOL ? 'body' : null;
  // rect : bord (à TOL près) ou intérieur
  const x1 = Math.min(A.x, B.x);
  const x2 = Math.max(A.x, B.x);
  const y1 = Math.min(A.y, B.y);
  const y2 = Math.max(A.y, B.y);
  const nearEdge =
    ((Math.abs(px - x1) <= TOL || Math.abs(px - x2) <= TOL) && py >= y1 - TOL && py <= y2 + TOL) ||
    ((Math.abs(py - y1) <= TOL || Math.abs(py - y2) <= TOL) && px >= x1 - TOL && px <= x2 + TOL);
  const inside = px >= x1 && px <= x2 && py >= y1 && py <= y2;
  return nearEdge || inside ? 'body' : null;
}

/** Le dessin le plus haut (dernier dessiné) touché en (px,py). */
export function topHit(
  timeToX: TimeToX,
  series: ISeriesApi<SeriesType>,
  drawings: Drawing[],
  px: number,
  py: number,
  width: number,
): { d: Drawing; handle: HitHandle } | null {
  for (let i = drawings.length - 1; i >= 0; i--) {
    const handle = hitTest(timeToX, series, drawings[i], px, py, width);
    if (handle) return { d: drawings[i], handle };
  }
  return null;
}

const KEY = (symbol: string, tf: string) => `algoria.draw.${symbol}.${tf}`;

export function loadDrawings(symbol: string, tf: string): Drawing[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY(symbol, tf));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr.filter(isDrawing) as Drawing[]) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(symbol: string, tf: string, ds: Drawing[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY(symbol, tf), JSON.stringify(ds));
  } catch {
    /* quota/private mode → on ignore */
  }
}

function isDrawing(d: unknown): d is Drawing {
  const x = d as Drawing;
  return !!x && typeof x.id === 'string' && typeof x.kind === 'string' && !!x.a && typeof x.a.price === 'number' && typeof x.a.time === 'number';
}

export function newId(): string {
  return 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
