import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 🤝 REFERRALS (02/10/2026) — ce que le panneau parrainage de l'onglet Affiliate ne peut pas déduire de la liste
// des membres : les clics sur chaque lien (referral_clicks, écrit par /r/<code>) et l'argent de chaque parrain
// (referral_commissions). Inscrits, activés et filleuls bloqués viennent de la liste des membres, côté client.
// GET → { since, totalClicks, clicks30, byReferrer: [{ tg_id, clicks, clicks30, earnedUsd, pendingUsd }] }

function gate(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return s && isAdmin(s.username) ? s : null;
}

export async function GET(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = sdb() as any;
  try {
    const [clicksQ, commsQ, firstQ] = await Promise.all([
      db.from('referral_clicks').select('referrer_tg_id,created_at').order('id', { ascending: false }).limit(20000),
      db.from('referral_commissions').select('referrer_tg_id,amount,status').in('status', ['confirmed', 'pending']),
      db.from('referral_clicks').select('created_at').order('id', { ascending: true }).limit(1),
    ]);
    if (clicksQ.error) throw new Error(clicksQ.error.message);
    if (commsQ.error) throw new Error(commsQ.error.message);
    const d30 = Date.now() - 30 * 86_400_000;
    const by = new Map<number, { tg_id: number; clicks: number; clicks30: number; earnedUsd: number; pendingUsd: number }>();
    const get = (tg: number) => { let r = by.get(tg); if (!r) { r = { tg_id: tg, clicks: 0, clicks30: 0, earnedUsd: 0, pendingUsd: 0 }; by.set(tg, r); } return r; };
    let clicks30 = 0;
    for (const c of (clicksQ.data ?? []) as { referrer_tg_id: number; created_at: string }[]) {
      const r = get(Number(c.referrer_tg_id));
      r.clicks++;
      if (Date.parse(c.created_at) >= d30) { r.clicks30++; clicks30++; }
    }
    for (const c of (commsQ.data ?? []) as { referrer_tg_id: number; amount: number; status: string }[]) {
      const r = get(Number(c.referrer_tg_id));
      if (c.status === 'confirmed') r.earnedUsd += Number(c.amount); else r.pendingUsd += Number(c.amount);
    }
    return NextResponse.json({
      since: firstQ.data?.[0]?.created_at ?? null,
      totalClicks: (clicksQ.data ?? []).length,
      clicks30,
      byReferrer: [...by.values()],
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
