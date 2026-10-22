import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb } from '@/lib/member/server';
import { INCIDENT, INCIDENT_KIND, PROOF_BUCKET, affectedMembers } from '@/lib/member/incident';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 🚨 LA DÉCLARATION DE PERTE (incident du 21-22/10/2026) — voir lib/member/incident.ts.
// GET : est-il concerné, et ce qu'il a déjà déclaré. POST (multipart) : solde avant, solde actuel, commentaire,
// capture facultative (image, 6 Mo max, rangée dans un bucket PRIVÉ). Une nouvelle déclaration remplace la précédente.

const MAX_PROOF = 6 * 1024 * 1024;
const money = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? '').replace(/[\s,$£€]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
};

export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sdb();
  const me = (await affectedMembers(db)).find((m) => m.tg_id === Number(s.tgId)) ?? null;
  const { data } = await db.from('member_actions').select('detail,created_at').eq('tg_id', s.tgId).eq('kind', INCIDENT_KIND).eq('status', 'done').order('created_at', { ascending: false }).limit(1);
  const last = data?.[0] as { detail: Record<string, unknown>; created_at: string } | undefined;
  return NextResponse.json({
    affected: !!me,
    lot: me?.lot ?? null,
    broker: me?.broker ?? null,
    declared: last ? { before: last.detail.before, now: last.detail.now, note: last.detail.note ?? '', proof: !!last.detail.proof_path, at: last.created_at } : null,
  });
}

export async function POST(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sdb();
  const me = (await affectedMembers(db)).find((m) => m.tg_id === Number(s.tgId));
  if (!me) return NextResponse.json({ error: 'Your account was not copying during the incident.' }, { status: 403 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid form' }, { status: 400 });
  const before = money(form.get('before'));
  const now = money(form.get('now'));
  if (before == null || now == null) return NextResponse.json({ error: 'Please enter both balances as numbers.' }, { status: 400 });
  const note = String(form.get('note') ?? '').trim().slice(0, 1000);

  let proof_path: string | null = null;
  const file = form.get('proof');
  if (file && typeof file !== 'string' && file.size > 0) {
    if (file.size > MAX_PROOF) return NextResponse.json({ error: 'The screenshot is too big (6 MB max).' }, { status: 400 });
    if (!/^image\//.test(file.type)) return NextResponse.json({ error: 'The screenshot must be an image.' }, { status: 400 });
    const ext = (file.type.split('/')[1] ?? 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
    const key = `${INCIDENT.id}/${s.tgId}-${Date.now()}.${ext}`;
    const { error } = await db.storage.from(PROOF_BUCKET).upload(key, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (error) return NextResponse.json({ error: 'Could not save the screenshot, please try again.' }, { status: 500 });
    proof_path = key;
  }

  // la dernière déclaration fait foi ; on garde l'ancienne capture si la nouvelle n'en a pas
  const { data: prev } = await db.from('member_actions').select('id,detail').eq('tg_id', s.tgId).eq('kind', INCIDENT_KIND).eq('status', 'done');
  const prevProof = ((prev ?? []) as Array<{ detail: Record<string, unknown> }>).map((p) => p.detail?.proof_path).find(Boolean) as string | undefined;
  if (prev?.length) await db.from('member_actions').update({ status: 'superseded' }).eq('tg_id', s.tgId).eq('kind', INCIDENT_KIND).eq('status', 'done');
  await db.from('member_actions').insert({
    tg_id: s.tgId, member_no: me.member_no, kind: INCIDENT_KIND, status: 'done', done_by: 'member',
    detail: { incident: INCIDENT.id, before, now, loss: Math.max(0, Math.round((before - now) * 100) / 100), note, proof_path: proof_path ?? prevProof ?? null, lot: me.lot, broker: me.broker } as never,
  });
  return NextResponse.json({ ok: true });
}
