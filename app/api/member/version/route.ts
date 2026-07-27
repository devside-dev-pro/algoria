import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Version de build servie (sha du commit Vercel) — lue par le garde-fraîcheur du PWA (MemberChrome).
// Une app installée gardée en mémoire peut tourner des JOURS sur un vieux bundle : des clients ont vu
// « minimum $500 » 3 jours après le passage à $200 et se sont bloqués au dépôt sur la foi d'un écran périmé.
export function GET() {
  return NextResponse.json(
    { v: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
