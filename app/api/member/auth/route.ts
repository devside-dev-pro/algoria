import { NextResponse, type NextRequest } from 'next/server';
import { verifyTelegramLogin, hasAccess, sdb, signSession, SESSION_COOKIE } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Callback du Telegram Login Widget (data-auth-url) : Telegram redirige ici avec les infos signées.
// Vérif HMAC → contrôle d'accès (accepté dans le canal OU liste VIP OU admin) → upsert membre → cookie session.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));

  const ok = verifyTelegramLogin(params);
  if (!ok.ok) return NextResponse.redirect(new URL(`/member/login?error=${encodeURIComponent(ok.reason ?? 'auth failed')}`, url.origin));

  const tgId = Number(params.id);
  const username = params.username ?? null;
  const name = [params.first_name, params.last_name].filter(Boolean).join(' ') || username || `user ${tgId}`;

  if (!(await hasAccess(tgId, username))) {
    return NextResponse.redirect(new URL('/member/denied', url.origin));
  }

  // upsert du membre (le member_no naît ici, à la première connexion)
  const db = sdb();
  const patch = { tg_username: username, tg_name: name, photo_url: params.photo_url ?? null, updated_at: new Date().toISOString() };
  const { data: existing } = await db.from('members').select('id').eq('tg_id', tgId).limit(1);
  if (existing?.length) await db.from('members').update(patch).eq('tg_id', tgId);
  else await db.from('members').insert({ tg_id: tgId, ...patch });

  const res = NextResponse.redirect(new URL('/member', url.origin));
  res.cookies.set(SESSION_COOKIE, signSession({ tgId, username, name, iat: Date.now() }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 86_400,
  });
  return res;
}
