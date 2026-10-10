// RÉSULTATS PASSÉS RÉELS POUR LE BOT (30/09/2026). Server-only.
//
// Décision Mathieu : « une performance passée on ne va pas la cacher, c'est factuel ; ce que je n'aime pas c'est
// parler du futur ou spéculer ». Le bot peut donc citer des résultats PASSÉS — mais il n'avait aucun chiffre en
// main : lever l'interdit sans lui donner les vrais chiffres, c'était l'inviter à en inventer. On lui fournit
// donc ceux du track record, calculés ici avec EXACTEMENT la même méthode que la page (components/TrackRecord.tsx :
// indice chaîné jour par jour sur le solde de la veille, les dépôts/retraits bougent le solde, jamais le rendement),
// à partir de la même route publique (/api/public/track, en cache CDN 10 min). Aucun montant en dollars, aucune
// taille de compte : des pourcentages de rendement du compte, mois par mois.
import { APP_URL } from './i18n';

interface TrackDay { d: string; net: number; cash: number; n: number; w: number; base?: number }
interface Track { startBalance: number; maxDdPct?: number; updatedAt: string; days: TrackDay[] }

export interface TrackSummary {
  months: Array<{ ym: string; pct: number }>;
  totalPct: number;
  maxDdPct: number | null;
  trades: number;
  winRate: number;
  updatedAt: string;
}

/** Même calcul que la page track record : un point par jour, rendement du jour rapporté au solde de la veille. */
export function summarizeTrack(t: Track): TrackSummary | null {
  if (!t.days?.length || !(t.startBalance > 0)) return null;
  let bal = t.startBalance, idx = 1;
  const months = new Map<string, { i0: number; i1: number }>();
  for (const day of t.days) {
    const ym = day.d.slice(0, 7);
    const m = months.get(ym) ?? { i0: idx, i1: idx };
    if (day.base != null && day.base > 0) bal = day.base; // jours du master : son vrai solde du matin
    idx *= 1 + (bal > 0 ? day.net / bal : 0);
    bal += day.net + day.cash;
    m.i1 = idx;
    months.set(ym, m);
  }
  const trades = t.days.reduce((a, d) => a + d.n, 0);
  const wins = t.days.reduce((a, d) => a + d.w, 0);
  return {
    months: [...months.entries()].map(([ym, m]) => ({ ym, pct: (m.i1 / m.i0 - 1) * 100 })),
    totalPct: (idx - 1) * 100,
    maxDdPct: typeof t.maxDdPct === 'number' ? t.maxDdPct : null,
    trades,
    winRate: trades ? Math.round((wins / trades) * 100) : 0,
    updatedAt: t.updatedAt,
  };
}

/** Format de la page (components/TrackRecord.tsx) : signe, 1 décimale, pas de décimale à partir de 100 %. */
export const fmtPct = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
const monthName = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

let cache: { at: number; text: string | null } | null = null;

/** Le bloc « REAL PAST RESULTS » injecté dans le prompt du bot, ou null (le bot renvoie alors au lien). */
export async function trackFacts(): Promise<string | null> {
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache.text;
  let text: string | null = null;
  try {
    const r = await fetch(`${APP_URL}/api/public/track`, { signal: AbortSignal.timeout(3000) });
    const s = r.ok ? summarizeTrack((await r.json()) as Track) : null;
    if (s) {
      text = [
        `REAL PAST RESULTS of the account Algoria trades (from the track record, updated ${s.updatedAt.slice(0, 10)}; account return in %, never in dollars):`,
        ...s.months.map((m) => `- ${monthName(m.ym)}${m.ym === new Date().toISOString().slice(0, 7) ? ' (month to date)' : ''}: ${fmtPct(m.pct)}`),
        `- Since the launch on 1 July 2026: ${fmtPct(s.totalPct)}`,
        s.maxDdPct != null ? `- Worst drawdown so far (trade by trade): ${fmtPct(s.maxDdPct)}` : '',
        `- ${s.trades} closed trades, ${s.winRate}% of them winners`,
      ].filter(Boolean).join('\n');
    }
  } catch { /* track record injoignable : pas de chiffres, le bot envoie le lien */ }
  cache = { at: Date.now(), text };
  return text;
}
