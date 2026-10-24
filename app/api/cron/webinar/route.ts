import { NextResponse } from 'next/server';
import { sdb } from '@/lib/member/server';
import { runWebinarReminders } from '@/lib/member/webinar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 🎤 LES RAPPELS DES WEBINAIRES (24/10/2026) — voir lib/member/webinar.ts.
// Appelé par pg_cron toutes les 5 min (migration 0035). Sans secret, comme support-jobs : chaque rappel est marqué
// avant d'être envoyé, un appel de trop ne renvoie rien.
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await runWebinarReminders(sdb())) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
