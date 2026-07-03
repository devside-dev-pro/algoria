// CALENDRIER ÉCO — la conscience macro d'Algoria. Deux rôles :
// 1) SÉCURITÉ : alimente state.newsWindows → checkRisk refuse toute entrée auto dans la fenêtre
//    [annonce − newsLockoutBeforeSec ; annonce + newsLockoutAfterSec] (déjà câblé dans le moteur, jamais nourri).
//    Fini l'entrée bête 1 minute avant un CPI.
// 2) SHOW : le desk PRÉVIENT à l'avance (« ⚠ NFP in 28 min — standing aside ») → Algoria a l'air (et est)
//    consciente du calendrier, en live.
// Source : miroir JSON du calendrier ForexFactory (semaine courante, gratuit, sans clé). On ne garde que les
// annonces USD (l'or, le NAS et le BTC sont tous cotés/pilotés en USD) à FORT impact.
export interface EcoEvent {
  time: number; // ms epoch
  title: string;
  country: string;
  impact: string; // 'High' | 'Medium' | 'Low' | 'Holiday'
  forecast?: string;
  previous?: string;
}

const FEED = process.env.ECO_CALENDAR_URL ?? 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
let events: EcoEvent[] = [];
let lastOk = 0;

/** Récupère la semaine courante. Retourne le nb d'événements, ou -1 si échec (on garde l'ancien cache). */
export async function refreshCalendar(): Promise<number> {
  try {
    // UA navigateur : le CDN du calendrier rejette parfois les clients « nus » (403)
    const res = await fetch(FEED, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    const parsed = raw
      .map((e) => ({
        time: Date.parse(String(e.date ?? '')),
        title: String(e.title ?? '').trim(),
        country: String(e.country ?? ''),
        impact: String(e.impact ?? ''),
        forecast: e.forecast != null && String(e.forecast) !== '' ? String(e.forecast) : undefined,
        previous: e.previous != null && String(e.previous) !== '' ? String(e.previous) : undefined,
      }))
      .filter((e) => Number.isFinite(e.time) && e.title);
    if (!parsed.length) throw new Error('flux vide');
    events = parsed;
    lastOk = Date.now();
    return events.length;
  } catch (e) {
    console.error('[algoria] calendrier éco : rafraîchissement échoué —', (e as { message?: string })?.message ?? e);
    return -1;
  }
}

/** Le calendrier est-il alimenté et frais (< 24 h) ? */
export const calendarFresh = (): boolean => lastOk > 0 && Date.now() - lastOk < 24 * 3600_000;

const highUSD = () => events.filter((e) => e.country === 'USD' && e.impact === 'High');

/** Fenêtres de lockout pour le moteur — annonces USD à fort impact à ±24 h (le moteur ajoute ses buffers). */
export function newsWindows(): Array<{ start: number; end: number; label: string }> {
  const now = Date.now();
  return highUSD()
    .filter((e) => Math.abs(e.time - now) < 24 * 3600_000)
    .map((e) => ({ start: e.time, end: e.time, label: e.title }));
}

/** Prochaine annonce USD fort impact à venir (pour le desk / une future voix d'Algoria). */
export function nextHighImpact(): EcoEvent | null {
  const now = Date.now();
  return highUSD().filter((e) => e.time > now).sort((a, b) => a.time - b.time)[0] ?? null;
}

// ===== Annonces desk : T−30 min et T−5 min, une seule fois chacune par événement =====
const announced = new Set<string>();
export interface DueAnnouncement { event: EcoEvent; minutes: number; slot: 30 | 5 }

/** À appeler chaque minute : renvoie les rappels À ÉMETTRE maintenant (dédupliqués en interne). */
export function dueAnnouncements(): DueAnnouncement[] {
  const now = Date.now();
  const due: DueAnnouncement[] = [];
  for (const e of highUSD()) {
    const mins = (e.time - now) / 60_000;
    if (mins <= 0) continue;
    for (const slot of [30, 5] as const) {
      const key = `${e.time}|${e.title}|${slot}`;
      if (mins <= slot && !announced.has(key)) {
        announced.add(key);
        due.push({ event: e, minutes: Math.max(1, Math.round(mins)), slot });
      }
    }
  }
  // hygiène : on ne garde pas des clés d'événements passés indéfiniment
  if (announced.size > 500) announced.clear();
  return due;
}
