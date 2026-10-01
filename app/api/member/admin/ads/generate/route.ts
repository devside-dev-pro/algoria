import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';
import { HOOK_COLS, POLES, RESOURCE_KEYS, SCRIPT_COLS, type AdHook, type AdScript, type Pole, type Resource } from '@/lib/admin/ads';
import { ADS_PER_CALL, DAILY_CALLS, GEN_MODEL, costOf, generateAds, proposeMemory, type Library, type Usage } from '@/lib/admin/adsGenerator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // un lot de 5 ads prend ~1 min avec Opus 5.5 ; marge pour un jour lent

// ADS STUDIO · ✨ GÉNÉRATEUR (01/10/2026) — admin uniquement, sur la clé API de Mathieu. Voir lib/admin/adsGenerator.ts.
// GET                       → { today, limit, monthUsd, perCall } : le compteur affiché dans l'admin
// POST {generate: {count, resources, extra, poles, direction}} → écrit `count` (≤ 5) ads en IDEA, avec batch_id (🆕)
// POST {memory: true}       → propose une nouvelle version de la mémoire (rien n'est enregistré : Mathieu valide)

function gate(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return s && isAdmin(s.username) ? s : null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tb = (t: string) => (sdb() as any).from(t);

async function usageNow() {
  const day = new Date(Date.now() - 24 * 3600_000).toISOString();
  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const [{ count }, { data }] = await Promise.all([
    tb('ad_batches').select('id', { count: 'exact', head: true }).gte('created_at', day),
    tb('ad_batches').select('cost_usd').gte('created_at', month.toISOString()),
  ]);
  const monthUsd = ((data ?? []) as { cost_usd: number | null }[]).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  return { today: count ?? 0, limit: DAILY_CALLS, monthUsd: Math.round(monthUsd * 100) / 100, perCall: ADS_PER_CALL };
}

async function library(): Promise<Library> {
  const [doc, s, h] = await Promise.all([
    tb('agent_docs').select('content').eq('key', 'ads_memory').limit(1),
    tb('ad_scripts').select(SCRIPT_COLS).order('created_at', { ascending: true }).limit(2000),
    tb('ad_hooks').select(HOOK_COLS).order('created_at', { ascending: true }).limit(5000),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (h.error) throw new Error(h.error.message);
  return { memory: (doc.data?.[0] as { content?: string } | undefined)?.content ?? null, scripts: (s.data ?? []) as AdScript[], hooks: (h.data ?? []) as AdHook[] };
}

async function logCall(kind: 'generate' | 'memory', params: unknown, by: string, usage: Usage | null, nAds: number, error?: string) {
  const { data } = await tb('ad_batches').insert({
    kind, params, model: GEN_MODEL, n_ads: nAds, created_by: by, error: error ?? null,
    input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
    cache_read_tokens: usage?.cache_read_input_tokens ?? null, cache_write_tokens: usage?.cache_creation_input_tokens ?? null,
    cost_usd: usage ? Math.round(costOf(usage) * 10000) / 10000 : null,
  }).select('id,cost_usd');
  return (data?.[0] ?? null) as { id: string; cost_usd: number | null } | null;
}

export async function GET(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { return NextResponse.json(await usageNow()); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const s = gate(req);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const by = s.username ?? String(s.tgId);
  const body = (await req.json().catch(() => ({}))) as { generate?: Record<string, unknown>; memory?: boolean };
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set on the server' }, { status: 500 });
  const u = await usageNow().catch(() => null);
  if (u && u.today >= DAILY_CALLS) return NextResponse.json({ error: `Daily limit reached (${DAILY_CALLS} runs in 24 h). Try again later.` }, { status: 429 });

  if (body.memory) {
    try {
      const lib = await library();
      const r = await proposeMemory(lib);
      const row = await logCall('memory', {}, by, r.usage, 0);
      return NextResponse.json({ ok: true, proposal: r.memory, changes: r.changes, costUsd: row?.cost_usd ?? null });
    } catch (e) {
      await logCall('memory', {}, by, null, 0, (e as Error).message).catch(() => {});
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  if (body.generate) {
    const g = body.generate;
    const count = Math.max(1, Math.min(ADS_PER_CALL, Math.round(Number(g.count) || ADS_PER_CALL)));
    const resources = (Array.isArray(g.resources) ? g.resources : []).map(String).filter((r): r is Resource => (RESOURCE_KEYS as string[]).includes(r));
    const poles = (Array.isArray(g.poles) ? g.poles : []).map(String).filter((p): p is Pole => (POLES as readonly string[]).includes(p));
    const params = { count, resources: resources.length ? resources : (['phone'] as Resource[]), poles, extra: String(g.extra ?? '').slice(0, 600), direction: String(g.direction ?? '').slice(0, 1000) };
    let usage: Usage | null = null;
    try {
      const lib = await library();
      const r = await generateAds(params, lib);
      usage = r.usage;
      const batch = await logCall('generate', params, by, usage, r.ads.length);
      if (!r.ads.length) return NextResponse.json({ error: 'No usable ad came back. Try again.' }, { status: 502 });
      const rows = r.ads.map((a) => ({
        pole: a.pole, title: a.title.slice(0, 200), hook: a.hook, body: a.body, prep: a.prep || null, needs: a.needs,
        duration: a.duration.slice(0, 80) || null, status: 'idea', source: 'Claude · generator', meta_flag: a.meta_flag.trim() || null,
        batch_id: batch?.id ?? null, created_by: by,
      }));
      const ins = await tb('ad_scripts').insert(rows).select(SCRIPT_COLS);
      if (ins.error) throw new Error(ins.error.message);
      const scripts = (ins.data ?? []) as AdScript[];
      const hookRows = scripts.flatMap((sc, i) => r.ads[i].alt_hooks.map((t) => ({ text: t.slice(0, 500), script_id: sc.id, created_by: by })));
      const hi = hookRows.length ? await tb('ad_hooks').insert(hookRows).select(HOOK_COLS) : { data: [], error: null };
      if (hi.error) throw new Error(hi.error.message);
      return NextResponse.json({ ok: true, scripts, hooks: hi.data ?? [], costUsd: batch?.cost_usd ?? null, usage: await usageNow() });
    } catch (e) {
      if (!usage) await logCall('generate', params, by, null, 0, (e as Error).message).catch(() => {});
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
