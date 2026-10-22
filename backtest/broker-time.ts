// HEURE DU SERVEUR MT5 POUR LES LABOS M5 (22/10/2026).
//
// Le broker est un serveur « clôture de New York » : son heure = heure de New York + 7 h, soit UTC+3 pendant l'heure
// d'été américaine (2e dimanche de mars → 1er dimanche de novembre) et UTC+2 le reste de l'année. Les premiers labos
// (ea-arena.ts, mabb-arena.ts) prenaient UTC+3 toute l'année : de novembre à mars, leurs heures de session étaient
// décalées d'une heure par rapport à celles qu'un EA lit dans TimeCurrent(). lib/engine/zone.ts, lui, recalibre le
// décalage sur les D1 du broker ; ici on n'a que des M5, d'où la règle du calendrier américain, et `reopenCheck`
// pour vérifier sur les bougies que la reprise quotidienne tombe toujours à la même heure serveur.
import type { Bar } from '../lib/engine/types';

const HOUR = 3_600_000, DAY = 86_400_000;
const nthSundayUTC = (y: number, month: number, n: number) => {
  const dow = new Date(Date.UTC(y, month, 1)).getUTCDay();
  return Date.UTC(y, month, 1 + ((7 - dow) % 7) + 7 * (n - 1));
};
const dst = new Map<number, [number, number]>();
/** Décalage serveur ↔ UTC en ms à l'instant t (UTC) : 3 h pendant l'heure d'été américaine, 2 h sinon. */
export function brokerOffset(t: number): number {
  const y = new Date(t).getUTCFullYear();
  let r = dst.get(y);
  // l'heure d'été américaine commence à 2 h locales EST (7 h UTC) et finit à 2 h locales EDT (6 h UTC)
  if (!r) { r = [nthSundayUTC(y, 2, 2) + 7 * HOUR, nthSundayUTC(y, 10, 1) + 6 * HOUR]; dst.set(y, r); }
  return t >= r[0] && t < r[1] ? 3 * HOUR : 2 * HOUR;
}

/** Heure, jour et jour de la semaine serveur de l'ouverture et de la CLÔTURE de chaque bougie M5. */
export interface BrokerClock { openHour: Int8Array; openDay: Int32Array; closeHour: Int8Array; closeDay: Int32Array; closeDow: Int8Array }
export function brokerClock(bars: Bar[], barMs = 300_000): BrokerClock {
  const n = bars.length;
  const c: BrokerClock = { openHour: new Int8Array(n), openDay: new Int32Array(n), closeHour: new Int8Array(n), closeDay: new Int32Array(n), closeDow: new Int8Array(n) };
  for (let i = 0; i < n; i++) {
    const to = bars[i].time, tc = to + barMs;
    const so = to + brokerOffset(to), sc = tc + brokerOffset(tc);
    c.openHour[i] = new Date(so).getUTCHours(); c.openDay[i] = Math.floor(so / DAY);
    const d = new Date(sc); c.closeHour[i] = d.getUTCHours(); c.closeDay[i] = Math.floor(sc / DAY); c.closeDow[i] = d.getUTCDay();
  }
  return c;
}

/** Contrôle : heure serveur de la première bougie après chaque pause quotidienne (trou de 30 min à 12 h), en %. */
export function reopenCheck(bars: Bar[], clock: BrokerClock): string {
  const hist = new Map<number, number>(); let total = 0;
  for (let i = 1; i < bars.length; i++) {
    const gap = bars[i].time - bars[i - 1].time;
    if (gap < 30 * 60_000 || gap > 12 * HOUR) continue;
    hist.set(clock.openHour[i], (hist.get(clock.openHour[i]) ?? 0) + 1); total++;
  }
  return [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, k]) => `${h} h ${Math.round((100 * k) / total)} %`).join(' · ') + ` (${total} reprises)`;
}
