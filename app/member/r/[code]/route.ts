import { NextResponse, type NextRequest } from 'next/server';
import { REF_CODE_RE } from '@/lib/member/login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// LIEN DE PARRAINAGE — app.algoria.tech/r/<code> (réécrit vers /member/r/<code> par le middleware).
// On pose le code en cookie (30 j) puis direction la page d'INVITATION, qui mène droit à l'APP (02/10/2026,
// décision Mathieu : on parraine son ami sur l'app, pas sur le canal). Le code est ensuite recopié sur le
// code de connexion côté serveur (tglogin) : il survit même si la connexion se termine dans Telegram.
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const res = NextResponse.redirect(new URL('/member/invite', req.url));
  if (REF_CODE_RE.test(code.toLowerCase())) {
    res.cookies.set('alg_ref', code.toLowerCase(), { maxAge: 30 * 86_400, path: '/', sameSite: 'lax', secure: true });
  }
  return res;
}
