import { NextResponse, type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';
import { readDepositSheetEnv, syncDepositsCatchUp } from '@/lib/admin/depositSheetSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Catch-up quotidien « Dépôts Algoria » — mois courant (Dubai) ; J1–J3 aussi mois précédent si onglet vide. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!readDepositSheetEnv()) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'missing_env' });
  }
  const result = await syncDepositsCatchUp(sdb());
  const failed = [result.current, result.previous].filter((r) => r && !r.ok);
  return NextResponse.json({ ok: failed.length === 0, ...result }, { status: failed.length ? 500 : 200 });
}
