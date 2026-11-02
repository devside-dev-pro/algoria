// L'ASSISTANT DE L'APP (02/11/2026) — voir lib/member/assistant.ts pour le pourquoi.
// GET  : l'état (peut écrire ? crédits restants) + la conversation.
// POST : { question } → la réponse CONTRÔLÉE (jamais un flux non vérifié), le compteur à jour.
// Le quota est tenu en base (fonctions assistant_take_credit / assistant_refund_credit, migration 0040) : un membre
// qui rafraîchit ou ouvre deux onglets ne peut pas dépasser 10, et le plafond global tient même sous la charge.
import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';
import { accessFor, askAssistant, DAILY_LIMIT, GLOBAL_DAILY_CAP, MAX_QUESTION, HISTORY_TURNS, type AssistantTurn } from '@/lib/member/assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Db = ReturnType<typeof sdb>;
// les tables de la migration 0040 ne sont pas encore dans les types générés
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (db: Db) => db as any;

const utcDay = () => new Date().toISOString().slice(0, 10);
const resetsInMin = () => { const n = new Date(); const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1); return Math.ceil((next - n.getTime()) / 60_000); };

async function who(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const db = sdb();
  const { data } = await db.from('members').select('tg_id,member_no,status,locale').eq('tg_id', s.tgId).limit(1);
  const m = data?.[0] ?? null;
  return { s, db, m, access: accessFor({ admin: isAdmin(s.username), status: m?.status ?? null }) };
}

async function usedToday(db: Db, tgId: number): Promise<number> {
  const { data } = await raw(db).from('assistant_quota').select('used').eq('tg_id', tgId).eq('day', utcDay()).limit(1);
  return Number(data?.[0]?.used ?? 0);
}

async function conversationOf(db: Db, tgId: number, create: boolean): Promise<string | null> {
  const { data } = await raw(db).from('assistant_conversations').select('id').eq('tg_id', tgId).order('updated_at', { ascending: false }).limit(1);
  if (data?.[0]?.id) return String(data[0].id);
  if (!create) return null;
  const { data: ins } = await raw(db).from('assistant_conversations').insert({ tg_id: tgId }).select('id').limit(1);
  return ins?.[0]?.id ? String(ins[0].id) : null;
}

async function lastTurns(db: Db, convId: string | null, n: number): Promise<Array<AssistantTurn & { created_at: string }>> {
  if (!convId) return [];
  const { data } = await raw(db).from('assistant_messages').select('role,content,created_at').eq('conversation_id', convId).order('created_at', { ascending: false }).limit(n);
  return ((data ?? []) as Array<AssistantTurn & { created_at: string }>).reverse();
}

export async function GET(req: NextRequest) {
  const w = await who(req);
  if (!w) return NextResponse.json({ loggedIn: false, canChat: false, reason: 'logged_out' });
  const used = w.access.canChat && !w.access.unlimited ? await usedToday(w.db, w.s.tgId).catch(() => 0) : 0;
  const conv = w.access.canChat ? await conversationOf(w.db, w.s.tgId, false).catch(() => null) : null;
  return NextResponse.json({
    loggedIn: true, canChat: w.access.canChat, reason: w.access.reason, unlimited: w.access.unlimited,
    limit: DAILY_LIMIT, left: w.access.unlimited ? null : Math.max(0, DAILY_LIMIT - used), resetsInMin: resetsInMin(),
    messages: (await lastTurns(w.db, conv, 40).catch(() => [])).map((t) => ({ role: t.role, content: t.content })),
  });
}

export async function POST(req: NextRequest) {
  const w = await who(req);
  if (!w) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  if (!w.access.canChat) return NextResponse.json({ error: 'not available', reason: w.access.reason }, { status: 403 });
  let body: { question?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }); }
  const question = String(body.question ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION);
  if (!question) return NextResponse.json({ error: 'empty question' }, { status: 400 });

  // CRÉDIT PRIS AVANT l'appel au modèle (atomique en base), rendu si la réponse n'est pas utilisable.
  const { data: taken, error: qErr } = await raw(w.db).rpc('assistant_take_credit', {
    p_tg_id: w.s.tgId, p_limit: w.access.unlimited ? 1_000_000 : DAILY_LIMIT, p_global_cap: GLOBAL_DAILY_CAP(),
  });
  if (qErr) return NextResponse.json({ error: 'assistant unavailable' }, { status: 503 });
  const t = (Array.isArray(taken) ? taken[0] : taken) as { ok?: boolean; used?: number; reason?: string } | null;
  if (!t?.ok) {
    const status = t?.reason === 'global_cap' ? 503 : 429;
    return NextResponse.json({ error: t?.reason === 'global_cap' ? 'busy today' : 'no credits left', reason: t?.reason ?? 'limit', left: 0, resetsInMin: resetsInMin() }, { status });
  }
  const refund = () => raw(w.db).rpc('assistant_refund_credit', { p_tg_id: w.s.tgId }).then(() => null, () => null);

  const convId = await conversationOf(w.db, w.s.tgId, true).catch(() => null);
  const history = (await lastTurns(w.db, convId, HISTORY_TURNS * 2).catch(() => [])).map(({ role, content }) => ({ role, content }));
  const r = await askAssistant({ question, history, status: w.m?.status ?? null, locale: w.m?.locale ?? null });
  if (!r.ok) await refund();

  if (convId) {
    const now = new Date();
    await raw(w.db).from('assistant_messages').insert([
      { conversation_id: convId, tg_id: w.s.tgId, role: 'user', content: question, created_at: now.toISOString() },
      {
        conversation_id: convId, tg_id: w.s.tgId, role: 'assistant', content: r.text, created_at: new Date(now.getTime() + 1).toISOString(),
        model: r.model, input_tokens: r.usage.input, cache_read_tokens: r.usage.cacheRead, cache_write_tokens: r.usage.cacheWrite,
        output_tokens: r.usage.output, prompt_hash: r.promptHash, knowledge_hash: r.knowledgeHash, issue: r.issue, retried: r.retried, fallback: !r.ok,
      },
    ]).then(() => null, () => null);
    await raw(w.db).from('assistant_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId).then(() => null, () => null);
  }
  const used = w.access.unlimited ? null : r.ok ? Number(t.used ?? 0) : Math.max(0, Number(t.used ?? 1) - 1);
  return NextResponse.json({ answer: r.text, fallback: !r.ok, left: used == null ? null : Math.max(0, DAILY_LIMIT - used), resetsInMin: resetsInMin() });
}
