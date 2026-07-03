import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, encryptSecret, isAdmin } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Champs SÛRS renvoyés au client — jamais les identifiants MT5 (même chiffrés).
const SAFE = 'member_no,tg_username,tg_name,photo_url,status,broker,risk_tier,onboarding_step,created_at,mt5_login,mt5_server';

async function me(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const { data } = await sdb().from('members').select(SAFE).eq('tg_id', s.tgId).limit(1);
  return data?.[0] ? { session: s, member: data[0] as Record<string, unknown> } : null;
}

/** État du membre connecté (Home + wizard). */
export async function GET(req: NextRequest) {
  const ctx = await me(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ member: ctx.member, admin: isAdmin(ctx.session.username) });
}

/** Progression de l'onboarding + réglages. body: { action: 'broker'|'mt5'|'risk'|'pause'|'resume', ... } */
export async function POST(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = sdb();
  const { data: curRows } = await db.from('members').select('status,onboarding_step').eq('tg_id', s.tgId).limit(1);
  const cur = curRows?.[0] as { status: string; onboarding_step: number } | undefined;
  if (!cur) return NextResponse.json({ error: 'member not found' }, { status: 404 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.action === 'broker') {
    const broker = String(body.broker ?? '').slice(0, 40);
    if (!broker) return NextResponse.json({ error: 'broker required' }, { status: 400 });
    patch.broker = broker;
    patch.onboarding_step = 1;
  } else if (body.action === 'mt5') {
    const login = String(body.login ?? '').trim().slice(0, 40);
    const server = String(body.server ?? '').trim().slice(0, 80);
    const password = String(body.password ?? '');
    if (!login || !server || !password) return NextResponse.json({ error: 'login, server and password are required' }, { status: 400 });
    patch.mt5_login = login;
    patch.mt5_server = server;
    patch.mt5_password_enc = encryptSecret(password); // AES-256-GCM — jamais en clair, jamais renvoyé
    patch.onboarding_step = 2;
  } else if (body.action === 'risk') {
    const tier = String(body.tier ?? '');
    if (!['low', 'balanced', 'high'].includes(tier)) return NextResponse.json({ error: 'invalid tier' }, { status: 400 });
    patch.risk_tier = tier;
    // TODO(copieur) : répercuter le lot du tier via l'API Smart Trade Hub dès la doc reçue.
    if (cur.status === 'onboarding') {
      // fin du wizard : la copie doit être branchée côté copieur → pending_copier (un membre déjà live ne régresse pas)
      patch.onboarding_step = 3;
      patch.status = 'pending_copier';
    }
  } else if (body.action === 'pause' || body.action === 'resume') {
    // TODO(copieur) : répercuter pause/reprise via l'API du copieur. En attendant : statut local (visible par l'admin).
    patch.status = body.action === 'pause' ? 'paused' : 'live';
  } else {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  const { error } = await db.from('members').update(patch).eq('tg_id', s.tgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data } = await db.from('members').select(SAFE).eq('tg_id', s.tgId).limit(1);
  return NextResponse.json({ member: data?.[0] ?? null });
}
