import { NextResponse, type NextRequest } from 'next/server';
import { REF_CODE_RE } from '@/lib/member/login';
import { sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// LIEN DE PARRAINAGE — app.algoria.tech/r/<code> (réécrit vers /member/r/<code> par le middleware).
// On pose le code en cookie (30 j) puis direction la page d'INVITATION, qui mène droit à l'APP (02/10/2026,
// décision Mathieu : on parraine son ami sur l'app, pas sur le canal). Le code est ensuite recopié sur le
// code de connexion côté serveur (tglogin) : il survit même si la connexion se termine dans Telegram.
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code: raw } = await ctx.params;
  const code = raw.toLowerCase();
  const res = NextResponse.redirect(new URL('/member/invite', req.url));
  if (REF_CODE_RE.test(code)) {
    // CLIC COMPTÉ (panneau 🤝 REFERRALS de l'admin) — une fois par navigateur et par code : le même ami qui
    // rouvre le lien ne gonfle pas le chiffre. Best effort : une mesure perdue ne doit jamais bloquer l'ami.
    if (req.cookies.get('alg_ref')?.value !== code) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = sdb() as any;
        const { data } = await db.from('members').select('tg_id').eq('referral_code', code).limit(1);
        if (data?.[0]?.tg_id) await db.from('referral_clicks').insert({ referrer_tg_id: Number(data[0].tg_id) });
      } catch { /* mesure perdue */ }
    }
    res.cookies.set('alg_ref', code, { maxAge: 30 * 86_400, path: '/', sameSite: 'lax', secure: true });
  }
  return res;
}
