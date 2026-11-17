// REMPLISSAGE DES TEXTES VIP VALIDÉS PAR MATHIEU (calendrier 18–24/11, décision du 17/11/2026).
//
// Jusqu'ici, un post de kind trade/tp était entièrement réécrit à l'heure de publication (writePost / tradeFallback).
// Les textes CM du calendrier (« What the VIP got this afternoon: +$[X] at [lot] lot … ») doivent garder le mot
// à mot de Mathieu, avec les vrais chiffres à la place des placeholders.
//
// Règles (documentées aussi dans le test) :
//   · +$[X] (et Y, Z) : P&L du trade ramené à 0.10 lot (atRef, décision Mathieu du 24/09). Le « +$ » du modèle
//     n'est pas doublé.
//   · [lot] : toujours 0.10, la taille d'affichage d'Algoria (REF_LABEL).
//   · [N] : nombre de trades gagnants retenus pour le récap.
//   · [NET] : net de la semaine à 0.10 lot ; si le modèle le demande et que le net est négatif, le post saute.
//   · Profit VIP du jour : le DERNIER trade copié gagnant de la séance (jour du post), déjà montré exclu
//     (ref = ticket déjà published/publishing en kind trade/tp). Seuil : +150 $ à 1 lot, comme pickWin.
//   · Récap « best trades » : les 3 meilleurs trades copiés gagnants de la semaine de trading (lundi–vendredi)
//     qui se termine le vendredi précédent un samedi, déjà montrés INCLUS (c'est un récap). Moins de 3 : skip.
//   · Aucun trade qui convient : le post passe en skipped, rien n'est publié.
//   · Ces textes ne passent pas par check()/humanize : ils ont des liens, et l'anglais du calendrier n'a pas
//     d'espace avant ? et !.
// Le format trade automatique (writePost) reste le secours quand il n'y a pas de modèle CM.

import { atOneLot, atRef, REF_LABEL, sumAtRef } from '@/lib/display/scale';
import { tradingDayOf, tradingDayStartMs } from '@/lib/display/tradingDay';
import { liveTrades, type Trade } from './recap';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const TP_MIN_AT_ONE_LOT = 150;
const RISK = "Trading involves risk. Past results don't guarantee future results.";
const placeholderRe = () => /(?:\+?\$)?\[(X|Y|Z|lot|N|NET)\]/gi;

export const hasVipPlaceholders = (text: string | null | undefined): boolean => !!text && placeholderRe().test(text);

export type VipReport = { vip_template?: string; recap_template?: string; fill?: string; recap?: string };

/** Le modèle à remplir : un texte déjà validé qui contient encore des placeholders, sinon le modèle rangé dans report. */
export function vipTemplateOf(text: string | null | undefined, report: unknown): string | null {
  const raw = text?.trim() ?? '';
  if (hasVipPlaceholders(raw)) return raw;
  const rep = (report && typeof report === 'object' ? report : {}) as VipReport;
  const stored = (rep.vip_template || rep.recap_template || '').trim();
  return hasVipPlaceholders(stored) ? stored : null;
}

/** +$14.80 sous 100 $, +$148 au-delà (même règle que writer.ts / recap.ts). */
export const usd = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(2)}`;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 dimanche … 6 samedi

/** Semaine de trading du récap du samedi : le lundi–vendredi qui précède (ou la semaine en cours un autre jour). */
export function recapWeekOf(day: string): { monday: string; friday: string } {
  const wd = weekday(day);
  const monday = addDays(day, wd === 0 ? -6 : 1 - wd);
  return { monday, friday: addDays(monday, 4) };
}

export function isWinningCopy(t: Trade, now = Date.now()): boolean {
  return Date.parse(t.closed_at) <= now && atOneLot(t.pnl, t.lot) >= TP_MIN_AT_ONE_LOT;
}

/** Dernier (plus récemment clôturé) trade copié gagnant du jour, tickets déjà montrés exclus. */
export function pickLastWinOfDay(trades: Trade[], day: string, usedTickets: Iterable<string>, now = Date.now()): Trade | null {
  const done = new Set([...usedTickets].map(String));
  const wins = trades
    .filter((t) => tradingDayOf(t.closed_at) === day && isWinningCopy(t, now) && !done.has(String(t.ticket)))
    .sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at));
  return wins[0] ?? null;
}

/** Les `n` meilleurs trades copiés gagnants de [monday, friday], déjà montrés inclus, triés du plus gros au plus petit. */
export function pickBestWinsOfWeek(trades: Trade[], monday: string, friday: string, n: number, now = Date.now()): Trade[] {
  return trades
    .filter((t) => {
      const d = tradingDayOf(t.closed_at);
      return d >= monday && d <= friday && isWinningCopy(t, now);
    })
    .sort((a, b) => atOneLot(b.pnl, b.lot) - atOneLot(a.pnl, a.lot) || Date.parse(b.closed_at) - Date.parse(a.closed_at))
    .slice(0, n);
}

/** Remplace les placeholders ; null si un jeton demandé n'a pas de valeur (le post devra sauter). */
export function fillVipTemplate(template: string, fills: Partial<Record<'X' | 'Y' | 'Z' | 'lot' | 'N' | 'NET', string>>): string | null {
  const keyOf = (k: string): keyof typeof fills => (k.toLowerCase() === 'lot' ? 'lot' : k.toUpperCase() as 'X' | 'Y' | 'Z' | 'N' | 'NET');
  const needed = new Set([...template.matchAll(placeholderRe())].map((m) => keyOf(m[1])));
  for (const k of needed) if (!fills[k]) return null;
  let t = template;
  // d'abord les formes avec +$ déjà dans le modèle, pour ne pas écrire +$+$148
  for (const k of ['X', 'Y', 'Z', 'NET'] as const) {
    const v = fills[k];
    if (!v) continue;
    const amount = v; // déjà formaté avec le signe, ex. +$148
    t = t.replace(new RegExp(`\\+\\$\\[${k}\\]`, 'gi'), amount);
    t = t.replace(new RegExp(`\\$\\[${k}\\]`, 'gi'), amount);
    t = t.replace(new RegExp(`\\[${k}\\]`, 'gi'), amount.replace(/^[+−\-]?\$/, ''));
  }
  if (fills.lot) t = t.replace(/\[lot\]/gi, fills.lot);
  if (fills.N) t = t.replace(/\[N\]/gi, fills.N);
  if (placeholderRe().test(t)) return null;
  t = t.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function fillsFromWin(t: Trade): { X: string; lot: string } {
  return { X: usd(atRef(t.pnl, t.lot)), lot: REF_LABEL.replace(/ lot$/, '') };
}

export function fillsFromBest(wins: Trade[]): Partial<Record<'X' | 'Y' | 'Z' | 'lot' | 'N' | 'NET', string>> {
  const keys = ['X', 'Y', 'Z'] as const;
  const out: Partial<Record<'X' | 'Y' | 'Z' | 'lot' | 'N' | 'NET', string>> = {
    lot: REF_LABEL.replace(/ lot$/, ''),
    N: String(wins.length),
    NET: usd(sumAtRef(wins)),
  };
  wins.forEach((t, i) => { out[keys[i]] = usd(atRef(t.pnl, t.lot)); });
  return out;
}

export type VipFillOk = { ok: true; text: string; ref: string; tickets: string[] };
export type VipFillSkip = { ok: false; reason: string };

/** Remplit un modèle du calendrier à partir des trades déjà chargés (testable sans base). */
export function fillFromTrades(
  template: string,
  trades: Trade[],
  opts: { day: string; usedTickets?: Iterable<string>; now?: number; weekly?: boolean },
): VipFillOk | VipFillSkip {
  const now = opts.now ?? Date.now();
  if (opts.weekly || /\[[YZ]\]/i.test(template) || /\[N\]/i.test(template) || /\[NET\]/i.test(template)) {
    const { monday, friday } = recapWeekOf(opts.day);
    const weekTrades = trades.filter((t) => {
      const d = tradingDayOf(t.closed_at);
      return d >= monday && d <= friday;
    });
    if (/\[NET\]/i.test(template) && sumAtRef(weekTrades) < 0) {
      return { ok: false, reason: 'semaine dans le rouge' };
    }
    const need = [...template.matchAll(/\[([XYZ])\]/gi)].length;
    const best = pickBestWinsOfWeek(trades, monday, friday, Math.max(need, 0) || 3, now);
    if (need && best.length < need) return { ok: false, reason: `seulement ${best.length} gain(s) sur la semaine, ${need} demandés` };
    const text = fillVipTemplate(template, fillsFromBest(best));
    if (!text) return { ok: false, reason: 'placeholders du récap incomplets' };
    return { ok: true, text, ref: best.map((t) => String(t.ticket)).join(','), tickets: best.map((t) => String(t.ticket)) };
  }
  const win = pickLastWinOfDay(trades, opts.day, opts.usedTickets ?? [], now);
  if (!win) return { ok: false, reason: 'aucun gain assez net sur la séance' };
  const text = fillVipTemplate(template, fillsFromWin(win));
  if (!text) return { ok: false, reason: 'placeholders VIP incomplets' };
  return { ok: true, text, ref: String(win.ticket), tickets: [String(win.ticket)] };
}

/** Charge les trades copiés et remplit le modèle. */
export async function fillApprovedVip(
  db: Db,
  r: { day: string; text: string | null; report: unknown },
  template: string,
): Promise<VipFillOk | VipFillSkip> {
  const day = String(r.day).slice(0, 10);
  const weekly = !!(r.report && typeof r.report === 'object' && ((r.report as VipReport).recap_template || (r.report as VipReport).recap));
  const sinceDay = weekly ? recapWeekOf(day).monday : day;
  const trades = await liveTrades(db, new Date(tradingDayStartMs(sinceDay)).toISOString());
  const { data: used } = weekly
    ? { data: [] }
    : await db.from('channel_posts').select('ref').in('kind', ['tp', 'trade']).in('status', ['published', 'publishing']).gte('day', day);
  const usedTickets = ((used ?? []) as Array<{ ref: string | null }>).map((u) => String(u.ref ?? '')).filter(Boolean);
  return fillFromTrades(template, trades, { day, usedTickets, weekly });
}
