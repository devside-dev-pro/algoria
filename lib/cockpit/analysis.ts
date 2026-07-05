// ALGORIA DESSINE SON ANALYSE — le moteur qui pose la réflexion « sur le papier » du chart, comme un
// analyste au marqueur : FVG (fair value gaps), lignes de tendance sur les swings, poches de liquidité
// (égaux hauts/bas). 100 % déterministe et local (calculé sur les bougies affichées) → recalculé à chaque
// clôture de bougie, aucune dépendance serveur. Rendu via la même primitive que les dessins utilisateur.
import { atr, swings } from '@/lib/engine/indicators';
import type { Bar } from '@/lib/engine/types';
import type { Drawing } from '@/components/chart/drawings';

const sec = (ms: number) => Math.floor(ms / 1000);
const COL = { bull: '#1fd8b0', bear: '#ff6b8a', line: '#2be3f5', liq: '#f5c24a' };

/** ===== FVG — Fair Value Gaps (déséquilibre 3 bougies) =====
 * Bull : low(bougie 3) > high(bougie 1) → zone [high1 ; low3] laissée sans échange, aimant à retest.
 * Bear : high(bougie 3) < low(bougie 1). On ne garde que les gaps NON comblés (un gap traversé n'a plus
 * de valeur) et significatifs (≥ 0.25×ATR — sinon le M1/M5 en cracherait des dizaines). */
export function findFVGs(bars: Bar[], tfMs: number, maxShown = 4): Drawing[] {
  if (bars.length < 40) return [];
  const start = Math.max(2, bars.length - 400); // fenêtre récente — un gap de la semaine dernière n'intéresse personne
  const atrNow = atr(bars, 14)[bars.length - 1] || 0;
  if (!atrNow) return [];
  const minGap = 0.25 * atrNow;
  const lastT = bars[bars.length - 1].time;
  const out: Drawing[] = [];

  for (let i = bars.length - 1; i >= start; i--) {
    const c1 = bars[i - 2];
    const c3 = bars[i];
    let top: number | null = null;
    let bottom: number | null = null;
    let bull = false;
    if (c3.low - c1.high >= minGap) {
      bottom = c1.high;
      top = c3.low;
      bull = true;
    } else if (c1.low - c3.high >= minGap) {
      bottom = c3.high;
      top = c1.low;
    }
    if (top == null || bottom == null) continue;
    // comblé ? (le prix a retraversé TOUT le gap après sa création)
    let filled = false;
    for (let j = i + 1; j < bars.length; j++) {
      if (bull ? bars[j].low <= bottom : bars[j].high >= top) {
        filled = true;
        break;
      }
    }
    if (filled) continue;
    const color = bull ? COL.bull : COL.bear;
    out.push({
      id: `ai_fvg_${bars[i - 1].time}`,
      kind: 'rect',
      color,
      a: { time: sec(bars[i - 1].time), price: top },
      b: { time: sec(lastT + 4 * tfMs), price: bottom }, // étiré vers la droite : la zone reste « active »
    });
    out.push({ id: `ai_fvgl_${bars[i - 1].time}`, kind: 'text', color, text: 'FVG', a: { time: sec(bars[i - 1].time), price: bull ? top : bottom } });
    if (out.length >= maxShown * 2) break; // rect + label par gap
  }
  return out.reverse();
}

/** ===== Analyse structurelle : lignes de tendance + poches de liquidité =====
 * - Trendline : les 2 derniers swings hauts descendants (résistance dynamique) / bas montants (support),
 *   PROLONGÉE vers la droite, gardée seulement si « propre » (aucune clôture ne la viole nettement).
 * - Liquidité : cluster d'égaux bas sous le prix (stops des acheteurs) / égaux hauts au-dessus (stops des
 *   vendeurs) — ≥ 2 touches dans une tolérance ATR → boîte étiquetée, la cible classique d'un sweep. */
export function buildAnalysis(bars: Bar[], tfMs: number): Drawing[] {
  if (bars.length < 80) return [];
  const view = bars.slice(-260); // structure RÉCENTE — le regard d'un analyste, pas un musée
  const atrNow = atr(bars, 14)[bars.length - 1] || 0;
  if (!atrNow) return [];
  const sw = swings(view, 3, 3);
  const lastT = bars[bars.length - 1].time;
  const lastClose = bars[bars.length - 1].close;
  const out: Drawing[] = [];

  // ── Lignes de tendance
  const trendline = (kind: 'high' | 'low'): Drawing | null => {
    const pts = sw.filter((s) => s.kind === kind).slice(-3);
    if (pts.length < 2) return null;
    const [p1, p2] = pts.slice(-2);
    const descending = p2.price < p1.price - 0.2 * atrNow;
    const ascending = p2.price > p1.price + 0.2 * atrNow;
    if (kind === 'high' ? !descending : !ascending) return null; // une trendline plate = une hline, pas une tendance
    const slope = (p2.price - p1.price) / (p2.index - p1.index);
    // propreté : entre p1 et AUJOURD'HUI, aucune clôture ne viole la ligne de plus de 0.2×ATR
    for (let i = p1.index; i < view.length; i++) {
      const lineAt = p1.price + slope * (i - p1.index);
      if (kind === 'high' ? view[i].close > lineAt + 0.2 * atrNow : view[i].close < lineAt - 0.2 * atrNow) return null; // cassée → plus d'actualité
    }
    const projIdx = view.length - 1 + 8; // prolongée 8 bougies dans le futur
    return {
      id: `ai_tl_${kind}_${view[p1.index].time}`,
      kind: 'trend',
      color: COL.line,
      a: { time: sec(view[p1.index].time), price: p1.price },
      b: { time: sec(lastT + 8 * tfMs), price: p1.price + slope * (projIdx - p1.index) },
    };
  };
  const tlHigh = trendline('high');
  const tlLow = trendline('low');
  if (tlHigh) out.push(tlHigh);
  if (tlLow) out.push(tlLow);

  // ── Poches de liquidité (égaux bas / égaux hauts)
  const liquidity = (kind: 'high' | 'low'): Drawing[] => {
    const pts = sw.filter((s) => s.kind === kind);
    const tol = 0.35 * atrNow;
    // clustering glouton sur le prix
    const clusters: { prices: number[]; first: number; last: number }[] = [];
    for (const p of pts) {
      const hit = clusters.find((c) => Math.abs(c.prices.reduce((a, b) => a + b, 0) / c.prices.length - p.price) <= tol);
      if (hit) {
        hit.prices.push(p.price);
        hit.last = p.index;
      } else clusters.push({ prices: [p.price], first: p.index, last: p.index });
    }
    const eligible = clusters
      .filter((c) => c.prices.length >= 2)
      .map((c) => ({ ...c, mid: c.prices.reduce((a, b) => a + b, 0) / c.prices.length }))
      // la poche PERTINENTE : sous le prix pour les égaux bas, au-dessus pour les égaux hauts, et pas à l'autre bout du monde
      .filter((c) => (kind === 'low' ? c.mid < lastClose : c.mid > lastClose) && Math.abs(c.mid - lastClose) < 6 * atrNow)
      .sort((a, b) => Math.abs(a.mid - lastClose) - Math.abs(b.mid - lastClose));
    const c = eligible[0];
    if (!c) return [];
    const top = Math.max(...c.prices) + 0.12 * atrNow;
    const bottom = Math.min(...c.prices) - 0.12 * atrNow;
    return [
      {
        id: `ai_liq_${kind}_${view[c.first].time}`,
        kind: 'rect',
        color: COL.liq,
        a: { time: sec(view[c.first].time), price: top },
        b: { time: sec(lastT + 4 * tfMs), price: bottom },
      },
      {
        id: `ai_liql_${kind}_${view[c.first].time}`,
        kind: 'text',
        color: COL.liq,
        text: `liquidity (${c.prices.length} touches)`,
        a: { time: sec(view[c.first].time), price: kind === 'low' ? bottom : top },
      },
    ];
  };
  out.push(...liquidity('low'), ...liquidity('high'));

  return out;
}
