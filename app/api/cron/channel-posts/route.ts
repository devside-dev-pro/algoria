import { NextResponse, type NextRequest } from 'next/server';
import { sdb, verifySession, SESSION_COOKIE, isAdmin } from '@/lib/member/server';
import { HOWTO, CTAS, planDay, planTarget, renderPlan, runDue, sendPlan } from '@/lib/channel/cm';
import { tradingDayOf } from '@/lib/display/tradingDay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 📣 LE CM AUTOMATIQUE (15/10/2026) — voir lib/channel/cm.ts.
// Appelé par pg_cron toutes les 5 minutes (migration 0025). Sans secret, comme le récap : un appel prépare au plus
// un plan (celui du lendemain à partir de 23h15, sinon celui du jour s'il manque ; une fois, clé = le jour) et ne publie que ce qu'un admin a validé.
// CHANNEL_CM=off (env Vercel) coupe tout, sans redéploiement de code.
// GET ?preview=1 (session admin) → le plan du jour, la banque How it works et les CTA, sans rien enregistrer ni envoyer.
export async function GET(req: NextRequest) {
  const db = sdb() as unknown as Parameters<typeof planDay>[0];
  if (req.nextUrl.searchParams.get('preview')) {
    const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!s || !isAdmin(s.username)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const day = tradingDayOf(new Date());
    const { data } = await db.from('channel_posts').select('*').eq('day', day).order('scheduled_at', { ascending: true });
    return NextResponse.json({ day, plan: renderPlan(day, data ?? []), howto: HOWTO, ctas: CTAS });
  }
  if ((process.env.CHANNEL_CM ?? '').trim().toLowerCase() === 'off') return NextResponse.json({ ok: true, status: 'off' });
  try {
    // le plan du lendemain à partir de 23h15 (Paris), sinon celui du jour s'il manque encore (premier jour, panne)
    const day = planTarget();
    const planned = await planDay(db, day);
    const dm = planned ? await sendPlan(db, day) : 0;
    const run = await runDue(db);
    return NextResponse.json({ ok: true, day, planned, dm, ...run });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
