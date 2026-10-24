import { NextResponse } from 'next/server';
import { sdb } from '@/lib/member/server';
import { runWebinarInvites, runWebinarReminders } from '@/lib/member/webinar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 🎤 LES RAPPELS DES WEBINAIRES (24/10/2026) — voir lib/member/webinar.ts.
// Appelé par pg_cron toutes les 5 min (migration 0035). Sans secret, comme support-jobs : chaque rappel est marqué
// avant d'être envoyé, un appel de trop ne renvoie rien. Puis, avec le temps qui reste, un lot d'invitations des
// prospects (seulement pour une session dont Mathieu a validé l'envoi : invite_at).
export async function GET() {
  const t0 = Date.now();
  try {
    const db = sdb();
    const reminders = await runWebinarReminders(db);
    // une invitation qui échoue n'empêche jamais les rappels (déjà partis) : on le dit, sans 500
    const invites = await runWebinarInvites(db, t0 + 45_000).catch((e) => ({ invited: 0, failed: 0, invite_error: (e as Error).message }));
    return NextResponse.json({ ok: true, ...reminders, ...invites });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
