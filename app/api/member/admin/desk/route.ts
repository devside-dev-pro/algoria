import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, isAdmin, sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PANNEAU DESK DE L'ADMIN (11/09/2026, phase 6) — voir ce que le desk a produit, et pouvoir retirer une
// lecture de l'app sans toucher à la base.
//
// Pourquoi cet écran existe : pendant trois jours, savoir si le desk avait bien tourné demandait de lire les
// journaux Railway et Vercel à la main. Un brief manquant est resté invisible une journée entière. Tout ce
// qui a servi à ce diagnostic est ici : la note, la durée, le nombre de rapports, le brief présent ou non,
// l'annonce partie ou non, et le suivi des prix rempli ou non.
//
// Ce qu'on NE met PAS ici : un bouton « relancer maintenant ». Il faudrait un jeton Railway côté Vercel, donc
// un secret de plus, pour une action devenue rare — un brief manquant se retente tout seul pendant trois
// jours et le suivi des prix se rattrape aussi. La marche à suivre manuelle est dans docs/DESK.md.
const MARKETS = ['XAUUSD', 'BTCUSD'];

function guard(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s || !isAdmin(s.username)) return null;
  return s;
}

export async function GET(req: NextRequest) {
  if (!guard(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const db = sdb() as unknown as { from: (t: string) => any };
  const { data } = await db
    .from('desk_runs')
    .select('id,market,run_date,rating,price,price_1d,price_3d,price_7d,summary,brief,lang,model_deep,model_quick,duration_s,dry_run,published,announced_at,agents,created_at')
    .order('run_date', { ascending: false }).limit(60);
  const runs = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const brief = (r.brief ?? null) as { headline?: string; story?: string[]; call?: string } | null;
    return {
      id: String(r.id),
      market: String(r.market),
      runDate: String(r.run_date),
      rating: String(r.rating ?? ''),
      price: r.price == null ? null : Number(r.price),
      price1d: r.price_1d == null ? null : Number(r.price_1d),
      price3d: r.price_3d == null ? null : Number(r.price_3d),
      price7d: r.price_7d == null ? null : Number(r.price_7d),
      headline: brief?.headline ? String(brief.headline) : null,
      call: brief?.call ? String(brief.call) : null,
      storyCount: Array.isArray(brief?.story) ? brief.story.length : 0,
      agents: Array.isArray(r.agents) ? (r.agents as string[]).length : 0,
      durationS: r.duration_s == null ? null : Number(r.duration_s),
      modelDeep: r.model_deep ? String(r.model_deep) : null,
      modelQuick: r.model_quick ? String(r.model_quick) : null,
      dryRun: Boolean(r.dry_run),
      published: Boolean(r.published),
      announced: r.announced_at != null,
      createdAt: String(r.created_at ?? ''),
      // ce qui manque, dit en clair : c'est exactement ce qu'on cherchait dans les journaux
      missing: [
        !brief?.headline ? 'brief' : null,
        r.announced_at == null && !r.dry_run ? 'annonce' : null,
      ].filter(Boolean) as string[],
    };
  });
  return NextResponse.json({ runs, markets: MARKETS, vipOn: process.env.DESK_VIP_POST === '1' });
}

export async function POST(req: NextRequest) {
  if (!guard(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { publish?: { id: string; value: boolean } };
  if (body.publish?.id) {
    // Dépublier retire la lecture de l'app et de la carte SANS rien effacer : la remettre est un clic.
    // C'est le geste qu'on veut avoir sous la main si un brief sort une phrase qu'on n'assume pas.
    const db = sdb() as unknown as { from: (t: string) => any };
    const { error } = await db.from('desk_runs').update({ published: Boolean(body.publish.value) }).eq('id', body.publish.id);
    if (error) return NextResponse.json({ error: String(error.message ?? error) }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
