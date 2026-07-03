import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// LIEN DE PARRAINAGE — app.algoria.tech/r/<code> (réécrit vers /member/r/<code> par le middleware).
// On pose le code en cookie (30 j) puis direction le login : l'attribution se fait à la création du membre.
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const res = NextResponse.redirect(new URL('/member/login', req.url));
  if (/^[a-f0-9]{6,12}$/i.test(code)) {
    res.cookies.set('alg_ref', code.toLowerCase(), { maxAge: 30 * 86_400, path: '/', sameSite: 'lax', secure: true });
  }
  return res;
}
