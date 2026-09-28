import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';
import { AGENT_DOC_KEYS, AGENT_DOC_MAX, type AgentDocKey } from '@/lib/member/agentDocs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// LE CERVEAU D'ALGORIA AI — lecture / écriture de ses documents depuis l'admin (onglet TOOLS).
// GET ?key=knowledge → le document + ses 20 dernières versions ; GET ?key=knowledge&version=<id> → une version.
// POST {key, content} → enregistre (et archive la version). Admin uniquement.

function gate(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return s && isAdmin(s.username) ? s : null;
}
const keyOf = (v: unknown): AgentDocKey | null => (AGENT_DOC_KEYS as readonly string[]).includes(String(v)) ? (String(v) as AgentDocKey) : null;

export async function GET(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const key = keyOf(req.nextUrl.searchParams.get('key') ?? 'knowledge');
  if (!key) return NextResponse.json({ error: 'unknown document' }, { status: 400 });
  const db = sdb();
  const version = req.nextUrl.searchParams.get('version');
  if (version) {
    const { data } = await db.from('agent_doc_versions').select('id,content,created_at,created_by').eq('key', key).eq('id', Number(version)).limit(1);
    return data?.[0] ? NextResponse.json({ version: data[0] }) : NextResponse.json({ error: 'version not found' }, { status: 404 });
  }
  const [docQ, verQ] = await Promise.all([
    db.from('agent_docs').select('content,updated_at,updated_by').eq('key', key).limit(1),
    db.from('agent_doc_versions').select('id,created_at,created_by,content').eq('key', key).order('created_at', { ascending: false }).limit(20),
  ]);
  const doc = docQ.data?.[0] as { content?: string; updated_at?: string; updated_by?: string | null } | undefined;
  const versions = ((verQ.data ?? []) as Array<{ id: number; created_at: string; created_by: string | null; content: string }>)
    .map((v) => ({ id: v.id, created_at: v.created_at, created_by: v.created_by, size: v.content.length }));
  return NextResponse.json({ key, content: doc?.content ?? '', updated_at: doc?.updated_at ?? null, updated_by: doc?.updated_by ?? null, versions, max: AGENT_DOC_MAX });
}

export async function POST(req: NextRequest) {
  const s = gate(req);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { key?: string; content?: unknown };
  const key = keyOf(body.key ?? 'knowledge');
  if (!key) return NextResponse.json({ error: 'unknown document' }, { status: 400 });
  const content = String(body.content ?? '').replace(/\r\n/g, '\n');
  if (content.length > AGENT_DOC_MAX) return NextResponse.json({ error: `too long: ${content.length} / ${AGENT_DOC_MAX} characters` }, { status: 400 });
  const who = s.username ?? String(s.tgId);
  const db = sdb();
  const now = new Date().toISOString();
  const { error } = await db.from('agent_docs').upsert({ key, content, updated_at: now, updated_by: who });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from('agent_doc_versions').insert({ key, content, created_at: now, created_by: who });
  return NextResponse.json({ ok: true, updated_at: now });
}
