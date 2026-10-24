import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, sdb, verifySession } from '@/lib/member/server';
import { saHour, seatLink, ukDay, ukHour, upcomingSessions } from '@/lib/member/webinar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 🎤 LA POP-UP DU WEBINAIRE DANS L'APP (24/10/2026, Mathieu : « on enverra une pop up sur l'app »). Dit à l'app s'il
// faut la montrer : seulement aux prospects (status 'onboarding'), pas encore inscrits, quand la prochaine session est
// dans moins de 4 jours. Jamais le lien Zoom ici : il part en privé par le bot.
const WINDOW_MS = 4 * 86_400_000;

export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ show: false });
  try {
    const db = sdb();
    const next = (await upcomingSessions(db, 1))[0];
    const start = next ? Date.parse(next.starts_at) : 0;
    if (!next || start <= Date.now() || start - Date.now() > WINDOW_MS) return NextResponse.json({ show: false });
    const [{ data: m }, { data: reg }] = await Promise.all([
      db.from('members').select('status').eq('tg_id', s.tgId).limit(1),
      db.from('webinar_registrations').select('id').eq('session_id', next.id).eq('tg_id', s.tgId).limit(1),
    ]);
    if ((m?.[0] as { status?: string } | undefined)?.status !== 'onboarding' || reg?.length) return NextResponse.json({ show: false });
    return NextResponse.json({
      show: true,
      session: { id: next.id, startsAt: next.starts_at, day: ukDay(next.starts_at), hour: ukHour(next.starts_at), sa: saHour(next.starts_at), seat: seatLink(next.id) },
    });
  } catch {
    return NextResponse.json({ show: false });
  }
}
