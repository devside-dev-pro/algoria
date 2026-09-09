import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ALGORIA DESK (09/09/2026) — l'analyse du jour d'un marché, avec le rapport de chaque agent, et l'historique des
// appels du desk pour le suivi honnête. Lecture seule, session requise, tout compte connecté (décision Mathieu :
// « le desk c'est le contenu, la lecture, la matière » — c'est l'accroche, pas le paywall).
// Les tables desk_* sont écrites par desk/run_desk.py (Railway, 06:00 UTC) ; RLS sans politique → clé service.
const MARKETS = ['XAUUSD', 'BTCUSD'];

export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const asked = req.nextUrl.searchParams.get('market') ?? '';
  const market = MARKETS.includes(asked) ? asked : 'XAUUSD';
  const db = sdb() as unknown as { from: (t: string) => any };
  // les 30 dernières analyses publiées (jamais les passages à blanc) : la première est celle du jour
  const { data: runs } = await db
    .from('desk_runs')
    .select('id,market,run_date,rating,price,summary,decision_md,brief,lang,duration_s,agents,price_1d,price_3d,price_7d,created_at')
    .eq('market', market).eq('published', true).eq('dry_run', false)
    .order('run_date', { ascending: false }).limit(30);
  const list = (runs ?? []) as Array<Record<string, unknown>>;
  const run = list[0] ?? null;
  const reports = run
    ? (((await db.from('desk_reports').select('agent,team,content_md').eq('run_id', run.id)).data ?? []) as Array<{ agent: string; team: string; content_md: string }>)
    : [];
  // l'historique ne porte pas les verdicts complets (lourds) : date, note, prix, et le prix à 1/3/7 jours
  const history = list.map(({ decision_md: _d, summary: _s, agents: _a, brief: _b, ...rest }) => rest);
  const res = NextResponse.json({ market, run, reports, history });
  res.headers.set('Cache-Control', 'private, max-age=60');
  return res;
}
