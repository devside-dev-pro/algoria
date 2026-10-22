import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';
import { INCIDENT, INCIDENT_KIND, PROOF_BUCKET, affectedMembers, estimatedLoss } from '@/lib/member/incident';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 🚨 LE TABLEAU DES DÉCLARATIONS (incident du 21-22/10/2026) — admin seulement. Pour chaque membre touché : son lot,
// la perte estimée (trades de la nuit à son lot, plafonnée en vrai par son solde), ce qu'il a déclaré, sa capture
// (lien signé 1 h, le bucket est privé), et s'il a reçu la demande par le bot.
export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(s.username)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const db = sdb();
  const affected = await affectedMembers(db);
  const ids = affected.map((m) => m.tg_id);
  const [{ data: claims }, { data: asked }] = await Promise.all([
    db.from('member_actions').select('tg_id,detail,created_at').eq('kind', INCIDENT_KIND).eq('status', 'done').in('tg_id', ids.length ? ids : [0]),
    db.from('member_actions').select('tg_id,status').eq('kind', 'nudge').contains('detail', { broadcast: INCIDENT.tag } as never).in('tg_id', ids.length ? ids : [0]),
  ]);
  const byId = new Map(((claims ?? []) as Array<{ tg_id: number; detail: Record<string, unknown>; created_at: string }>).map((c) => [Number(c.tg_id), c]));
  const askedOk = new Set(((asked ?? []) as Array<{ tg_id: number; status: string }>).filter((a) => a.status === 'done').map((a) => Number(a.tg_id)));
  const askedFail = new Set(((asked ?? []) as Array<{ tg_id: number; status: string }>).filter((a) => a.status === 'failed').map((a) => Number(a.tg_id)));
  const rows = await Promise.all(affected.map(async (m) => {
    const c = byId.get(m.tg_id);
    const proof = c?.detail?.proof_path ? (await db.storage.from(PROOF_BUCKET).createSignedUrl(String(c.detail.proof_path), 3600)).data?.signedUrl ?? null : null;
    return {
      member_no: m.member_no, name: m.tg_name, username: m.tg_username, lot: m.lot, broker: m.broker, status: m.status,
      estimated: estimatedLoss(m.lot),
      asked: askedOk.has(m.tg_id) ? 'ok' : askedFail.has(m.tg_id) ? 'failed' : null,
      claim: c ? { before: c.detail.before, now: c.detail.now, loss: c.detail.loss, note: c.detail.note ?? '', proof, at: c.created_at } : null,
    };
  }));
  rows.sort((a, b) => (b.claim ? Number(b.claim.loss) : -1) - (a.claim ? Number(a.claim.loss) : -1) || b.lot - a.lot);
  const declared = rows.filter((r) => r.claim);
  return NextResponse.json({
    incident: INCIDENT.id,
    affected: rows.length,
    declared: declared.length,
    totalDeclared: Math.round(declared.reduce((t, r) => t + Number(r.claim?.loss ?? 0), 0)),
    asked: rows.filter((r) => r.asked === 'ok').length,
    rows,
  });
}
