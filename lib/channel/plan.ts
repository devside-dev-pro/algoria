// 🗓 LE PLAN DU JOUR DU CM, VERSION « COMME SI MATHIEU POSTAIT LUI-MÊME » (10/11/2026, refonte décidée par Mathieu).
//
// Avant : une séquence FIXE (WEEKDAY / WEEKEND) — bonjour 9h, How it works 11h, carte de gain 14h, CTA 17h30, carte
// 19h, CTA 20h30 — avec un « jitter » dérivé de la date (hash(jour:créneau) % 21 − 10 min). Ce hash glissait de façon
// régulière d'un jour à l'autre (cta2 et cta3 reculaient de 2 min chaque jour) : un automate, et ça se voyait.
//
// Maintenant (pur, sans base, testé par scripts/checks/cm-plan.ts) :
//   · 4 ou 5 posts du CM par jour (en semaine 4 + le récap de 23h05 = 5 ; le week-end 4 ou 5), parce que Mathieu poste
//     lui-même 3 à 4 bulles vidéo : ~8 posts par jour au total, à peu près un par heure ;
//   · des FENÊTRES larges, et dans chacune une heure tirée VRAIMENT au hasard au moment du plan (puis figée dans
//     scheduled_at), avec au moins MIN_GAP_MIN minutes entre deux posts du CM : la place d'une bulle entre les deux ;
//   · des FORMATS pondérés, jamais le même deux fois de suite (ni d'un jour sur l'autre), au plus un de chaque par jour
//     sauf le CTA (1 ou 2 par jour, jamais collés) : coulisses avec photo, avis sur l'or sans prévision, vraie question
//     de membre, histoire perso, trade commenté, sondage Telegram natif, pédagogie reformulée.
//   · 2 boutons par jour au plus : seuls les CTA en ont un.
// Les webinaires ne sont PAS planifiés ici : lib/channel/cm.ts transforme un CTA prévu en annonce, comme avant.

export type PlanFormat = 'backstage' | 'gold' | 'qa' | 'story' | 'trade' | 'poll' | 'lesson' | 'cta';
export type PlannedPost = { slot: string; kind: PlanFormat; at: number };

/** Fenêtres en heure de Paris (l'audience : Afrique du Sud = Paris +1 l'hiver, Royaume-Uni = Paris −1). */
export const WINDOWS: Record<'weekday' | 'weekend', Array<[string, string]>> = {
  weekday: [['08:30', '10:00'], ['11:00', '12:45'], ['13:30', '15:45'], ['17:00', '19:00'], ['20:00', '21:45']],
  weekend: [['09:30', '11:15'], ['12:15', '14:15'], ['15:30', '17:45'], ['18:45', '20:30'], ['21:00', '22:00']],
};
/** Écart minimal entre deux posts du CM : une bulle vidéo de Mathieu doit pouvoir tenir entre les deux. */
export const MIN_GAP_MIN = 75;

/** Poids des formats (hors coulisses, toujours en premier, et hors CTA, comptés à part). */
export const WEIGHTS: Record<Exclude<PlanFormat, 'backstage' | 'cta'>, number> = {
  qa: 3, lesson: 2.5, trade: 3, story: 2, gold: 2, poll: 1.5,
};
/** Le premier créneau où un format peut tomber (un trade commenté a besoin d'une séance déjà entamée). */
const EARLIEST_WINDOW: Partial<Record<PlanFormat, number>> = { trade: 2, cta: 1 };

export type PlanInput = {
  /** 'YYYY-MM-DD' (journée de Paris) */
  day: string;
  weekend: boolean;
  /** l'instant d'une heure de Paris ce jour-là (lib/display/tradingDay.ts, tradingTimeMs) */
  timeMs: (hhmm: string) => number;
  /** tirage dans [0, 1[ (Math.random en production ; une graine dans les tests) */
  rand: () => number;
  /** le format du dernier post de la veille (jamais deux fois de suite, même d'un jour à l'autre) */
  prevKind?: string | null;
  /** cartes de gain actives (support_settings 'cm_win_cards') et jour de séance : sinon pas de trade commenté */
  trades: boolean;
  /** nombre de CTA imposé (webinaire du jour : 2) ; sinon 1 ou 2 au hasard */
  ctas?: 1 | 2;
  /** nombre de posts imposé (tests) ; sinon 4 en semaine, 4 ou 5 le week-end */
  count?: number;
};

const pickWeighted = <T extends string>(items: Array<[T, number]>, rand: () => number): T | null => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return null;
  let x = rand() * total;
  for (const [k, w] of items) { x -= w; if (x < 0) return k; }
  return items[items.length - 1][0];
};

/** Le plan d'un jour : 4 ou 5 posts, heures tirées au hasard dans des fenêtres larges, formats variés. */
export function buildDayPlan(o: PlanInput): PlannedPost[] {
  const wins = WINDOWS[o.weekend ? 'weekend' : 'weekday'];
  const count = Math.max(4, Math.min(5, o.count ?? (o.weekend ? (o.rand() < 0.5 ? 4 : 5) : 4)));
  // quelles fenêtres : toujours la première (les coulisses du matin) ; à 4 posts, une fenêtre du milieu saute
  let idx = wins.map((_, i) => i);
  if (count < wins.length) {
    const drop = 1 + Math.floor(o.rand() * (wins.length - 2)); // ni la première ni la dernière
    idx = idx.filter((i) => i !== drop);
  }
  idx = idx.slice(0, count);
  const ctas = o.ctas ?? (o.rand() < 0.6 ? 1 : 2);

  // FORMATS : coulisses d'abord, puis les CTA placés sur des fenêtres non adjacentes (à partir de la 2e)
  const kinds: Array<PlanFormat | null> = idx.map(() => null);
  kinds[0] = 'backstage';
  const ctaSpots = idx.map((w, k) => ({ w, k })).filter(({ w, k }) => k > 0 && w >= (EARLIEST_WINDOW.cta ?? 0));
  const chosen: number[] = [];
  // le dernier créneau du jour est un bon moment pour un CTA (l'audience a fini sa journée) : on le préfère
  const order = [...ctaSpots];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(o.rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  order.sort((a, b) => (b.k === idx.length - 1 ? 1 : 0) - (a.k === idx.length - 1 ? 1 : 0));
  for (const s of order) {
    if (chosen.length >= ctas) break;
    if (chosen.some((c) => Math.abs(c - s.k) < 2)) continue;
    chosen.push(s.k);
  }
  for (const k of chosen) kinds[k] = 'cta';

  // le reste : tirage pondéré, au plus un de chaque, jamais le même que le voisin
  const used = new Set<PlanFormat>(kinds.filter(Boolean) as PlanFormat[]);
  for (let k = 0; k < kinds.length; k++) {
    if (kinds[k]) continue;
    const before = k === 0 ? o.prevKind ?? null : kinds[k - 1];
    const after = kinds[k + 1] ?? null;
    const pool = (Object.entries(WEIGHTS) as Array<[PlanFormat, number]>).filter(([f]) =>
      !used.has(f) && f !== before && f !== after && idx[k] >= (EARLIEST_WINDOW[f] ?? 0)
      && (f !== 'trade' || o.trades) && (f !== 'gold' || !o.weekend));
    const f = pickWeighted(pool, o.rand) ?? 'lesson';
    kinds[k] = f;
    used.add(f);
  }

  // HEURES : un vrai tirage dans chaque fenêtre, en respectant l'écart minimal avec le post d'avant
  const out: PlannedPost[] = [];
  let prev = -Infinity;
  idx.forEach((w, k) => {
    const start = Math.max(o.timeMs(wins[w][0]), prev + MIN_GAP_MIN * 60_000);
    const end = o.timeMs(wins[w][1]);
    const span = Math.max(0, end - start);
    const at = Math.round((start + o.rand() * span) / 60_000) * 60_000;
    prev = at;
    out.push({ slot: `p${k + 1}`, kind: kinds[k] as PlanFormat, at });
  });
  return out;
}

/** Vrai si deux posts consécutifs (veille comprise) ont le même format. */
export const hasConsecutiveRepeat = (kinds: string[], prevKind?: string | null) =>
  kinds.some((k, i) => k === (i === 0 ? prevKind ?? null : kinds[i - 1]));
