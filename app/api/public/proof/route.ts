import { NextResponse } from 'next/server';
import { sdb } from '@/lib/member/server';
import { isShowTrade } from '@/lib/cockpit/showTrades';
import { brokerDayStartMs } from '@/lib/cockpit/brokerDay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PREUVE SOCIALE PUBLIQUE (landing algoria.tech) — AUCUNE session requise, donc règle 70/30 stricte :
// UNIQUEMENT des gains (≥5$, hors micro-scalps show, hors NAS retiré), jamais une perte, jamais le desk.
// C'est exactement ce que le viewer voit déjà à l'antenne — la landing ne révèle rien de plus.
export async function GET() {
  const db = sdb();
  const [tradesQ, signalsQ] = await Promise.all([
    db.from('trades').select('ticket,symbol,direction,pnl,lot,closed_at').not('closed_at', 'is', null).not('pnl', 'is', null).order('closed_at', { ascending: false }).limit(120),
    db.from('signals').select('ticket,rationale').order('created_at', { ascending: false }).limit(200),
  ]);
  const rafale = new Set((signalsQ.data ?? []).filter((x) => JSON.stringify(x.rationale ?? '').includes('RAFALE') || JSON.stringify(x.rationale ?? '').includes('ACTION mode')).map((x) => String(x.ticket)));
  const wins = (tradesQ.data ?? [])
    .filter((t) => Number(t.pnl) >= 5 && String(t.symbol) !== 'NAS100' && !isShowTrade(t, rafale))
    .map((t) => ({ symbol: String(t.symbol), direction: String(t.direction), pnl: Math.round(Number(t.pnl)), closed_at: t.closed_at as string }));
  const dayStart = brokerDayStartMs();
  const today = wins.filter((t) => Date.parse(t.closed_at) >= dayStart);
  const res = NextResponse.json({
    wins: wins.slice(0, 12),
    today: { count: today.length, total: today.reduce((a, t) => a + t.pnl, 0), best: today.reduce((m, t) => Math.max(m, t.pnl), 0) },
    week: { total: wins.filter((t) => Date.parse(t.closed_at) >= Date.now() - 7 * 86_400_000).reduce((a, t) => a + t.pnl, 0) },
  });
  // cache CDN 60s : la landing peut encaisser un raid TikTok sans marteler Supabase
  res.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res;
}
