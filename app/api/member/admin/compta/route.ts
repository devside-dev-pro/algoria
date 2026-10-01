import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// COMPTA (30/09/2026) — les données de l'onglet COMPTA de l'admin. Admin uniquement.
// GET  → dépôts (member_actions kind='deposit'), membres (pays, source, broker), parrainages payés, dépenses.
//        Lignes brutes : tous les calculs se font dans lib/admin/compta.ts, côté navigateur.
// POST {addExpense: {spent_on, amount, category, note?}} → ajoute une dépense
// POST {deleteExpense: id}                               → la supprime (faute de frappe)
// POST {setPaidBy: {id, paid_by}}                        → qui l'a réglée : 'mathieu' | 'benjamin' (partage 60/40)

function gate(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return s && isAdmin(s.username) ? s : null;
}

/** Pagine jusqu'à épuisement : PostgREST plafonne ses réponses, et un total tronqué sans le dire est pire que rien. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sdb();
  try {
    const [deposits, members, payouts, expenses] = await Promise.all([
      all((a, b) => db.from('member_actions').select('id,tg_id,member_no,created_at,detail').eq('kind', 'deposit').order('created_at', { ascending: true }).range(a, b)),
      all((a, b) => db.from('members').select('tg_id,member_no,tg_username,country,source,broker').order('member_no', { ascending: true }).range(a, b)),
      all((a, b) => db.from('referral_payouts').select('id,tg_id,amount,status,created_at,decided_at').eq('status', 'paid').order('created_at', { ascending: true }).range(a, b)),
      all((a, b) => db.from('expenses').select('id,spent_on,amount_usd,category,note,paid_by').order('spent_on', { ascending: true }).range(a, b)),
    ]);
    return NextResponse.json({ deposits, members, payouts, expenses });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const s = gate(req);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { addExpense?: { spent_on?: string; amount?: unknown; category?: string; note?: string; paid_by?: string }; deleteExpense?: string; setPaidBy?: { id?: string; paid_by?: string } };
  const payer = (v: unknown) => (v === 'mathieu' || v === 'benjamin' ? v : null);
  const db = sdb();
  if (body.addExpense) {
    const e = body.addExpense;
    const amount = Number(e.amount);
    const day = String(e.spent_on ?? '');
    const category = String(e.category ?? '').trim().slice(0, 40);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    if (!category) return NextResponse.json({ error: 'category required' }, { status: 400 });
        const paidBy = payer(e.paid_by);
    if (!paidBy) return NextResponse.json({ error: 'who paid it? (mathieu or benjamin)' }, { status: 400 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any).from('expenses').insert({ spent_on: day, amount_usd: amount, category, note: String(e.note ?? '').trim().slice(0, 200) || null, created_by: s.username ?? String(s.tgId), paid_by: paidBy }).select('id,spent_on,amount_usd,category,note,paid_by');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, expense: data?.[0] ?? null });
  }
  if (body.setPaidBy) {
    const paidBy = payer(body.setPaidBy.paid_by);
    if (!body.setPaidBy.id || !paidBy) return NextResponse.json({ error: 'id and paid_by (mathieu | benjamin) required' }, { status: 400 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from('expenses').update({ paid_by: paidBy }).eq('id', String(body.setPaidBy.id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.deleteExpense) {
    const { error } = await db.from('expenses').delete().eq('id', String(body.deleteExpense));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
