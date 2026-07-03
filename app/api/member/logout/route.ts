import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/member/login', new URL(req.url).origin), 303);
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
