import { NextResponse } from 'next/server';
import { sdb } from '@/lib/member/server';
import { runSupportDigest } from '@/lib/member/supportDigest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 🌙 LE RÉCAP DU SOIR DU SUPPORT (19/10/2026) — voir lib/member/supportDigest.ts.
// Appelé par pg_cron à 19 h et 20 h UTC (migration 0034) ; seul le passage de 21 h à Paris envoie, une fois par jour.
// Sans secret, comme support-jobs : un appel hors de 21 h, ou un 2e appel le même jour, ne fait rien.
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await runSupportDigest(sdb())) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
