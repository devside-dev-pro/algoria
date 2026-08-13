import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/member/server';
import { consumeLoginCode, recordFailedAttempt, tooManyAttempts, SESSION_COOKIE_OPTS, SHORT_CODE_RE } from '@/lib/member/login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SAISIE DU CODE À 6 CHIFFRES — la porte d'entrée qui traverse deux magasins de cookies.
// Sur iPhone, une app ajoutée à l'écran d'accueil a son PROPRE stockage, séparé de Safari : le bouton du
// bot s'ouvre dans Safari et connecte Safari, jamais l'app installée. Ici, rien ne transite entre
// navigateurs — la personne recopie six chiffres LÀ OÙ elle veut sa session, et le cookie est posé dans
// ce contexte-là. Voir lib/member/login.ts (issueShortCode) pour l'émission côté bot.
//
// La session posée est RIGOUREUSEMENT la même que sur les deux autres portes (consumeLoginCode).

/** IP du client derrière le proxy Vercel. x-forwarded-for peut chaîner plusieurs sauts : le premier est le client. */
const clientIp = (req: NextRequest): string =>
  (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = String(body.code ?? '').replace(/\D/g, ''); // les gens collent « 123 456 » ou « 123-456 »
  const ip = clientIp(req);

  // GARDE ANTI-FORCE BRUTE, avant toute lecture en base : 6 chiffres ne résistent pas à un tirage au sort
  // répété. Le blocage se fait sur l'IP, en fenêtre glissante, et seuls les ÉCHECS comptent.
  if (await tooManyAttempts(ip))
    return NextResponse.json({ error: 'too many attempts — wait 10 minutes and ask the bot for a fresh code' }, { status: 429 });

  if (!SHORT_CODE_RE.test(code)) {
    await recordFailedAttempt(ip);
    return NextResponse.json({ error: 'enter the 6 digits the bot sent you' }, { status: 400 });
  }

  // allowUsed absent : usage unique STRICT. Un code court est court, il ne doit jamais resservir.
  const out = await consumeLoginCode(req, code);
  if (out.kind === 'denied') return NextResponse.json({ denied: true }, { status: 403 });
  if (out.kind !== 'ok') {
    await recordFailedAttempt(ip);
    // On ne distingue PAS « code inconnu » de « code périmé » dans le message rendu : dire lequel des deux
    // reviendrait à confirmer à un devineur qu'il vient de tomber sur un code réel.
    return NextResponse.json({ error: 'this code is not valid (or has expired) — send /code to the bot for a new one' }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, out.session, SESSION_COOKIE_OPTS);
  return res;
}
