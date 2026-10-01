import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb } from '@/lib/member/server';
import { FUNNEL_EVENTS } from '@/lib/member/funnel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ENTONNOIR D'INSCRIPTION (01/10/2026) — reçoit les mesures de l'app membre (lib/member/funnel.ts) et les range
// dans funnel_events. Membre connecté uniquement ; événements en liste blanche ; meta courte et à plat.
// Répond 204 sans corps : le navigateur n'attend rien (sendBeacon).
export async function POST(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return new NextResponse(null, { status: 204 });
  const body = (await req.json().catch(() => ({}))) as { event?: unknown; step?: unknown; meta?: unknown };
  const event = String(body.event ?? '');
  if (!(FUNNEL_EVENTS as readonly string[]).includes(event)) return new NextResponse(null, { status: 204 });
  const step = Number.isInteger(body.step) && Number(body.step) >= 0 && Number(body.step) < 10 ? Number(body.step) : null;
  const meta: Record<string, string | number | boolean> = {};
  if (body.meta && typeof body.meta === 'object') {
    for (const [k, v] of Object.entries(body.meta as Record<string, unknown>).slice(0, 8)) {
      if (typeof v === 'number' && Number.isFinite(v)) meta[k.slice(0, 30)] = v;
      else if (typeof v === 'boolean') meta[k.slice(0, 30)] = v;
      else if (typeof v === 'string') meta[k.slice(0, 30)] = v.slice(0, 120);
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sdb() as any).from('funnel_events').insert({ tg_id: s.tgId, event, step, meta });
  } catch { /* une mesure perdue ne doit jamais remonter d'erreur au membre */ }
  return new NextResponse(null, { status: 204 });
}
