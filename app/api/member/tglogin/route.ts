import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { sdb, hasAccess, signSession, SESSION_COOKIE } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Connexion Telegram NATIVE — POST crée un code à usage unique + le deep-link t.me ; GET (polling) vérifie :
// le webhook /api/telegram confirme le code quand l'utilisateur tape START dans Telegram (zéro numéro, zéro widget).

export async function POST() {
  const code = randomBytes(16).toString('hex');
  const { error } = await sdb().from('member_login_codes').insert({ code });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '';
  return NextResponse.json({ code, link: `https://t.me/${bot}?start=lg_${code}` });
}

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code') ?? '';
  if (!/^[A-Za-z0-9]{16,64}$/.test(code)) return NextResponse.json({ error: 'bad code' }, { status: 400 });
  const db = sdb();
  const { data } = await db.from('member_login_codes').select('*').eq('code', code).limit(1);
  const row = data?.[0] as { status: string; tg_id: number | null; tg_username: string | null; tg_name: string | null; photo_url: string | null; created_at: string } | undefined;
  if (!row || Date.now() - Date.parse(row.created_at) > 10 * 60_000) return NextResponse.json({ expired: true });
  if (row.status !== 'confirmed' || !row.tg_id) return NextResponse.json({ pending: true });

  // code confirmé → usage unique (anti-rejeu), puis contrôle d'accès identique au flux précédent
  await db.from('member_login_codes').update({ status: 'used' }).eq('code', code);
  if (!(await hasAccess(row.tg_id, row.tg_username))) return NextResponse.json({ denied: true });

  const patch = { tg_username: row.tg_username, tg_name: row.tg_name, ...(row.photo_url ? { photo_url: row.photo_url } : {}), updated_at: new Date().toISOString() };
  const { data: existing } = await db.from('members').select('id').eq('tg_id', row.tg_id).limit(1);
  if (existing?.length) await db.from('members').update(patch).eq('tg_id', row.tg_id);
  else await db.from('members').insert({ tg_id: row.tg_id, ...patch });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, signSession({ tgId: row.tg_id, username: row.tg_username, name: row.tg_name ?? String(row.tg_id), iat: Date.now() }), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 86_400,
  });
  return res;
}
