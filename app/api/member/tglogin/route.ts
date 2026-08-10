import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { sdb, SESSION_COOKIE } from '@/lib/member/server';
import { consumeLoginCode, SESSION_COOKIE_OPTS } from '@/lib/member/login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Connexion Telegram NATIVE — POST crée un code à usage unique + le deep-link t.me ; GET (polling) vérifie :
// le webhook /api/telegram confirme le code quand l'utilisateur tape START dans Telegram (zéro numéro, zéro widget).
// La logique de consommation vit dans lib/member/login.ts — PARTAGÉE avec /member/login/confirm, le bouton
// que le bot envoie après le START (seule porte qui fonctionne quand le navigateur intégré de Telegram
// emporte l'onglet qui poll). Deux portes, une seule implémentation de session.

export async function POST() {
  const code = randomBytes(16).toString('hex');
  const { error } = await sdb().from('member_login_codes').insert({ code });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '';
  return NextResponse.json({ code, link: `https://t.me/${bot}?start=lg_${code}` });
}

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code') ?? '';
  // allowUsed absent : le polling garde son usage unique STRICT (comportement inchangé depuis le 02/08).
  const out = await consumeLoginCode(req, code);
  if (out.kind === 'bad') return NextResponse.json({ error: 'bad code' }, { status: 400 });
  if (out.kind === 'expired') return NextResponse.json({ expired: true });
  if (out.kind === 'pending') return NextResponse.json({ pending: true });
  if (out.kind === 'denied') return NextResponse.json({ denied: true });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, out.session, SESSION_COOKIE_OPTS);
  return res;
}
