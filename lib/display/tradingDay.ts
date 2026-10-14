// LA JOURNÉE DE TRADING = LA JOURNÉE DE PARIS (14/10/2026, décision Mathieu).
//
// Le même jour donnait trois chiffres : le bilan VIP comptait de minuit à minuit UTC, le récap du canal de
// minuit à minuit à Paris, l'app à l'heure du téléphone du membre. Un membre anglais a vu, pour le 14/10,
// « 17 trades +141 » (VIP, 0.10 lot), « 19 trades +10 » (canal, 0.01 lot) et « 18 trades +7 » (son app,
// 0.01 lot) : les mêmes trades, coupés à trois endroits différents (deux trades fermés à 22h51 et 23h17 UTC).
//
// Une seule horloge désormais : Paris. Elle colle à la séance de l'or, qui rouvre à minuit et ferme à 23h
// (Paris) toute l'année : une journée ne coupe jamais une séance en deux. Le bilan VIP et le récap du canal
// sont calculés après la fermeture (23h), donc sur exactement les mêmes trades.
export const TRADING_TZ = 'Europe/Paris';

/** 'YYYY-MM-DD' : la journée de trading (Paris) d'un instant. */
export const tradingDayOf = (d: Date | string | number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TRADING_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

/** Heure (0-23) à Paris. */
export const tradingHour = (d: Date = new Date()) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TRADING_TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));

/** Décalage de Paris par rapport à UTC, en minutes, à un instant donné (+60 l'hiver, +120 l'été). */
const offsetMin = (ms: number) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TRADING_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ms);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - ms) / 60_000;
};

/** Instant (ms) du début de la journée de trading `day` : minuit à Paris. */
export const tradingDayStartMs = (day: string) => {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  return utcMidnight - offsetMin(utcMidnight) * 60_000;
};

/** Instant (ms) d'une heure de Paris 'HH:MM' le jour `day`, juste aussi les jours de changement d'heure. */
export const tradingTimeMs = (day: string, hhmm: string) => {
  const naive = Date.parse(`${day}T${hhmm}:00Z`);
  const first = naive - offsetMin(naive) * 60_000;
  return naive - offsetMin(first) * 60_000;
};
