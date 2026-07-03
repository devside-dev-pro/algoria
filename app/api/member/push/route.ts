import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Abonnements push du membre connecté : POST enregistre l'appareil, DELETE le retire.
export async function POST(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
  const { error } = await sdb().from('member_push_subs').upsert({ endpoint: body.endpoint, tg_id: s.tgId, p256dh: body.keys.p256dh, auth: body.keys.auth });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await sdb().from('member_push_subs').delete().eq('endpoint', body.endpoint).eq('tg_id', s.tgId);
  return NextResponse.json({ ok: true });
}
