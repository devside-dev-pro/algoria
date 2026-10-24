import { NextResponse, type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 📅 « Add to my calendar » (bouton du bot et de la page /webinar) : un fichier .ics de la session, sans le lien
// Zoom (il part en privé aux inscrits, 1 h avant). Un rendez-vous dans le calendrier fait venir plus de monde.
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get('s') ?? '').toLowerCase();
  if (!/^[a-z0-9-]{4,40}$/.test(id)) return NextResponse.json({ error: 'bad session' }, { status: 400 });
  const { data } = await (sdb() as any).from('webinar_sessions').select('id,starts_at').eq('id', id).eq('active', true).limit(1);
  const s = data?.[0] as { id: string; starts_at: string } | undefined;
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const start = Date.parse(s.starts_at);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Algoria//Webinar//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:webinar-${s.id}@getalgoria.com`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(start + 45 * 60_000)}`,
    'SUMMARY:Algoria live webinar with Mathieu',
    'DESCRIPTION:Trading gold without the 6 hours a day. The Zoom link is sent to you on Telegram 1 hour before.',
    'URL:https://getalgoria.com/webinar',
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Algoria webinar in 30 minutes', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return new NextResponse(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="algoria-webinar-${s.id}.ics"` } });
}
