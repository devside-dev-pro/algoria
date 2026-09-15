import { NextResponse } from 'next/server';
import { sdb } from '@/lib/member/server';
import { isShowTrade } from '@/lib/cockpit/showTrades';
import { brokerDayStartMs, brokerDateOf } from '@/lib/cockpit/brokerDay';
import { TRACK_SINCE_MS } from '@/lib/member/trackSince';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PREUVE SOCIALE PUBLIQUE (landing algoria.tech) — AUCUNE session requise, donc règle 70/30 stricte :
// UNIQUEMENT des gains (≥5$, hors micro-scalps show, hors NAS retiré), jamais une perte, jamais le desk.
// C'est exactement ce que le viewer voit déjà à l'antenne — la landing ne révèle rien de plus.
export async function GET() {
  const db = sdb();
  const [tradesQ, signalsQ] = await Promise.all([
    // fenêtre large : les jours BEAST spamment des micro-trades (exclus ensuite) qui éjecteraient
    // les vrais gains d'une fenêtre trop courte → le récap SEMAINE sous-compterait
    db.from('trades').select('ticket,symbol,direction,pnl,lot,closed_at').not('closed_at', 'is', null).not('pnl', 'is', null).order('closed_at', { ascending: false }).limit(500),
    db.from('signals').select('ticket,rationale').order('created_at', { ascending: false }).limit(200),
  ]);
  const rafale = new Set((signalsQ.data ?? []).filter((x) => JSON.stringify(x.rationale ?? '').includes('RAFALE') || JSON.stringify(x.rationale ?? '').includes('ACTION mode')).map((x) => String(x.ticket)));
  const wins = (tradesQ.data ?? [])
    .filter((t) => Number(t.pnl) >= 5 && String(t.symbol) !== 'NAS100' && !isShowTrade(t, rafale) && Date.parse(String(t.closed_at)) >= TRACK_SINCE_MS)
    .map((t) => ({ symbol: String(t.symbol), direction: String(t.direction), pnl: Math.round(Number(t.pnl)), closed_at: t.closed_at as string }));
  const dayStart = brokerDayStartMs();
  const today = wins.filter((t) => Date.parse(t.closed_at) >= dayStart);
  const week = wins.filter((t) => Date.parse(t.closed_at) >= Date.now() - 7 * 86_400_000);
  // ═══ LA SÉANCE À PARTAGER ≠ « AUJOURD'HUI » (15/09/2026) ════════════════════════════════════════
  // Le serveur MT5 est en UTC+3, donc son minuit tombe à 21h00 UTC — l'heure exacte où l'or ferme.
  // La journée de trading se termine et le compteur `today` repart à zéro dans la même minute. Résultat
  // vécu : à 21h56, au moment précis où l'on veut poster le bilan de la séance, la carte DAY RECAP
  // affichait « no wins yet » alors que la journée venait de faire 42 gains. Par construction elle était
  // vide chaque fois qu'on en avait besoin.
  // `today` ne bouge PAS : la landing écrit « Wins today » à côté, et ce chiffre doit rester littéralement
  // vrai. On ajoute donc la DERNIÈRE SÉANCE QUI A DES GAINS — celle qu'on partage. En pleine séance c'est
  // la journée en cours ; après la clôture, celle qui vient de finir ; le week-end, celle de vendredi.
  let sessionStart = dayStart;
  let session = today;
  for (let back = 1; back <= 7 && session.length === 0; back++) {
    sessionStart = dayStart - back * 86_400_000;
    const end = sessionStart + 86_400_000;
    session = wins.filter((t) => { const ts = Date.parse(t.closed_at); return ts >= sessionStart && ts < end; });
  }
  const res = NextResponse.json({
    wins: wins.slice(0, 12),
    today: { count: today.length, total: today.reduce((a, t) => a + t.pnl, 0), best: today.reduce((m, t) => Math.max(m, t.pnl), 0) },
    // count/best aussi : alimente les cartes RÉCAP (jour/semaine) du studio admin
    week: { count: week.length, total: week.reduce((a, t) => a + t.pnl, 0), best: week.reduce((m, t) => Math.max(m, t.pnl), 0) },
    // la séance partageable + SA date : la carte doit dater ce qu'elle montre, pas le moment du clic
    session: { count: session.length, total: session.reduce((a, t) => a + t.pnl, 0), best: session.reduce((m, t) => Math.max(m, t.pnl), 0), date: brokerDateOf(sessionStart) },
  });
  // cache CDN 60s : la landing peut encaisser un raid TikTok sans marteler Supabase
  res.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res;
}
