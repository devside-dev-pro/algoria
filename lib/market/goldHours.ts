// Fermeture hebdo de l'or (XAUUSD) : du vendredi 17:00 au dimanche 18:00, heure de New York.
// L'heure NY est lue via Intl (America/New_York) : le changement d'heure US est géré, aucun décalage codé en dur.
// Pendant cette fenêtre, aucune bougie n'est attendue → le watchdog « RUNNER SILENT » ne doit pas alerter.
// graceMin : marge après la réouverture (par défaut le seuil watchdog de 20 min) pour laisser arriver la 1re bougie.

const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Jour (0 = dimanche) et minute de la journée, heure de New York. */
export function nyClock(now: Date): { day: number; min: number } {
  const p = Object.fromEntries(FMT.formatToParts(now).map((x) => [x.type, x.value]));
  return { day: DAYS[p.weekday as string] ?? -1, min: Number(p.hour) * 60 + Number(p.minute) };
}

export const GOLD_CLOSE_MIN = 17 * 60; // vendredi 17:00 NY
export const GOLD_OPEN_MIN = 18 * 60; // dimanche 18:00 NY

/** true si l'or est fermé (week-end), réouverture + graceMin comprise. */
export function isGoldClosed(now: Date = new Date(), graceMin = 20): boolean {
  const { day, min } = nyClock(now);
  if (day === 5) return min >= GOLD_CLOSE_MIN;
  if (day === 6) return true;
  if (day === 0) return min < GOLD_OPEN_MIN + graceMin;
  return false;
}

/** LE FLUX DE PRIX DOIT-IL COTER ? (03/11/2026) — pour le chien de garde du flux (runner/index.ts, feedWatchdog).
 *  Fermé le week-end (isGoldClosed) ET pendant la pause quotidienne 17:00 → 18:00 NY, plus graceMin après chaque
 *  réouverture (la première cotation peut tarder). En heure de New York : l'ancienne version comptait en UTC fixe
 *  (pause à 21h UTC = heure d'été) ; depuis l'heure d'hiver (01/11) la pause tombe à 22h UTC et le garde sortait en
 *  boucle de 22:00 à 22:40 UTC jusqu'au CRASHED de Railway (02/11). */
export function goldFeedExpected(now: Date = new Date(), graceMin = 20): boolean {
  if (isGoldClosed(now, graceMin)) return false;
  const { min } = nyClock(now);
  return !(min >= GOLD_CLOSE_MIN && min < GOLD_OPEN_MIN + graceMin);
}
