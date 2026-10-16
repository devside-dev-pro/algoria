import { NextResponse } from 'next/server';
import { sdb } from '@/lib/member/server';
import { runSupportJobs } from '@/lib/member/supportAuto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 🤖 LE SUPPORT EN PILOTE AUTOMATIQUE (16/10/2026) — voir lib/member/supportAuto.ts.
// Appelé par pg_cron chaque minute (migration 0028). Sans secret, comme le CM : un appel ne fait qu'exécuter les envois
// déjà prévus par le webhook (accueil, réponses), jamais rien d'autre. Les coupe-circuits sont dans supportAuto.ts.
export async function GET() {
  try {
    const run = await runSupportJobs(sdb());
    return NextResponse.json({ ok: true, ...run });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
