import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// L'app installée se signale (une fois par jour, depuis InstallPrompt dans app/member/ui.tsx) : c'est la
// seule mesure fiable du nombre d'installations — voir supabase/migrations/0011_pwa_seen.sql.
const PLATFORMS = new Set(['ios', 'android', 'desktop']);

export async function POST(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { platform?: string };
  const platform = PLATFORMS.has(String(body.platform)) ? String(body.platform) : 'desktop';
  const { error } = await (sdb() as any).from('members').update({ pwa_seen_at: new Date().toISOString(), pwa_platform: platform }).eq('tg_id', s.tgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
