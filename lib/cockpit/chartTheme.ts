// Le canvas (lightweight-charts) ne lit pas les var() CSS → on résout les tokens de palette une fois,
// depuis :root, pour que les primitives dessinent aux couleurs de la marque. Une seule source de vérité.

export interface ChartTheme {
  up: string;
  down: string;
  gold: string;
  cyan: string;
  text: string;
  dim: string;
}

const FALLBACK: ChartTheme = {
  up: '#1fd8b0',
  down: '#ff6b8a',
  gold: '#f5c24a',
  cyan: '#2be3f5',
  text: '#dce9ff',
  dim: '#54688e',
};

export function readChartTheme(): ChartTheme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
  return {
    up: v('--up', FALLBACK.up),
    down: v('--down', FALLBACK.down),
    gold: v('--gold', FALLBACK.gold),
    cyan: v('--cyan', FALLBACK.cyan),
    text: v('--text', FALLBACK.text),
    dim: v('--dim', FALLBACK.dim),
  };
}

/** Applique une opacité à une couleur (#rgb / #rrggbb / rgb() / rgba()). */
export function withAlpha(color: string, a: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return c;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (c.startsWith('rgba(')) return c.replace(/,\s*[\d.]+\s*\)$/, `, ${a})`);
  if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(/\)$/, `, ${a})`);
  return c;
}
