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
  // ?w=<ticket> (gain partagé) et le code passent dans l'URL de la page d'invitation : WhatsApp / Telegram suivent
  // la redirection SANS cookie, et c'est cette URL qui leur donne l'aperçu (la carte du gain, le prénom du parrain).
  const dest = new URL('/member/invite', req.url);
  if (REF_CODE_RE.test(code)) dest.searchParams.set('c', code);
  const w = req.nextUrl.searchParams.get('w') ?? '';
  if (/^\d{1,20}$/.test(w)) dest.searchParams.set('w', w);
  const res = NextResponse.redirect(dest);
  if (REF_CODE_RE.test(code)) {
    // CLIC COMPTÉ (panneau 🤝 REFERRALS de l'admin) — une fois par navigateur et par code : le même ami qui
    // rouvre le lien ne gonfle pas le chiffre. Best effort : une mesure perdue ne doit jamais bloquer l'ami.
    // les robots d'aperçu (WhatsApp, Telegram, Facebook…) ouvrent le lien avant l'ami : ce n'est pas un clic
    const bot = /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|preview|slack|discord|twitter/i.test(req.headers.get('user-agent') ?? '');
    if (!bot && req.cookies.get('alg_ref')?.value !== code) {
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
