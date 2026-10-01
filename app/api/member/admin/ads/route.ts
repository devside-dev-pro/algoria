import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';
import { ANGLES, HOOK_COLS, HOOK_STATUSES, LOVE_REASONS, NEEDS, POLES, REJECT_REASONS, SCRIPT_COLS, STATUSES } from '@/lib/admin/ads';
import { SEED_HOOKS, SEED_SCRIPTS } from '@/lib/admin/adsSeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ADS STUDIO (01/10/2026) — la bibliothèque d'ads de l'admin. Admin uniquement.
// GET  → { scripts, hooks }
// POST {seed: true}                    → importe la bibliothèque de départ (brief Benjamin) ; seulement si elle est vide
// POST {addScript: {...}}              → nouvelle fiche
// POST {patchScript: {id, patch}}      → modifie une fiche (statut, hook, déroulé…)
// POST {deleteScript: id}
// POST {addHook: {text, angle?, script_id?}} · {patchHook: {id, patch}} · {deleteHook: id}
// POST {verdict: {kind: 'script'|'hook', id, verdict: 'rejected'|'loved'|null, reasons?, note?}} → l'avis de Mathieu

function gate(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return s && isAdmin(s.username) ? s : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tb = (t: 'ad_scripts' | 'ad_hooks') => (sdb() as any).from(t);
/** Les statuts d'une ad déjà tournée. */
const DONE = new Set(['shot', 'edited', 'live']);
const txt = (v: unknown, max = 8000) => { const s = String(v ?? '').trim().slice(0, max); return s || null; };
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list as readonly string[]).includes(String(v)) ? (v as T) : undefined;

/** Ne garde que les champs connus, validés. `undefined` = champ absent ; une erreur = valeur refusée. */
function cleanScript(p: Record<string, unknown>): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  if ('pole' in p) { const v = oneOf(POLES, p.pole); if (!v) return 'unknown pole'; out.pole = v; }
  if ('status' in p) { const v = oneOf(STATUSES, p.status); if (!v) return 'unknown status'; out.status = v; }
  if ('title' in p) { const v = txt(p.title, 200); if (!v) return 'title required'; out.title = v; }
  if ('needs' in p) out.needs = Array.isArray(p.needs) ? [...new Set(p.needs.map((n) => oneOf(NEEDS, n)).filter(Boolean))] : [];
  for (const k of ['hook', 'body', 'prep', 'notes', 'meta_flag'] as const) if (k in p) out[k] = txt(p[k]);
  for (const k of ['duration', 'source'] as const) if (k in p) out[k] = txt(p[k], 80);
  return out;
}
function cleanHook(p: Record<string, unknown>): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  if ('text' in p) { const v = txt(p.text, 500); if (!v) return 'hook text required'; out.text = v; }
  if ('status' in p) { const v = oneOf(HOOK_STATUSES, p.status); if (!v) return 'unknown hook status'; out.status = v; }
  if ('angle' in p) out.angle = oneOf(ANGLES, p.angle) ?? txt(p.angle, 30);
  if ('notes' in p) out.notes = txt(p.notes, 1000);
  if ('script_id' in p) out.script_id = txt(p.script_id, 40);
  return out;
}

async function list() {
  const [s, h] = await Promise.all([
    tb('ad_scripts').select(SCRIPT_COLS).order('created_at', { ascending: true }).limit(2000),
    tb('ad_hooks').select(HOOK_COLS).order('created_at', { ascending: true }).limit(5000),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (h.error) throw new Error(h.error.message);
  return { scripts: s.data ?? [], hooks: h.data ?? [] };
}

export async function GET(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await list());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const s = gate(req);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const by = s.username ?? String(s.tgId);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
  try {
    if (body.seed) {
      // Une seule fois : seed_key est unique, donc même deux clics simultanés ne créent pas de doublon.
      const { count } = await tb('ad_scripts').select('id', { count: 'exact', head: true });
      if ((count ?? 0) > 0) return fail('the library is not empty');
      const rows = SEED_SCRIPTS.map((x) => ({
        seed_key: x.key, pole: x.pole, title: x.title, hook: x.hook, body: x.body, prep: x.prep ?? null, needs: x.needs,
        duration: x.duration ?? null, status: x.status, source: x.source, notes: x.notes ?? null, meta_flag: x.meta_flag ?? null, created_by: by,
      }));
      const ins = await tb('ad_scripts').upsert(rows, { onConflict: 'seed_key', ignoreDuplicates: true });
      if (ins.error) return fail(ins.error.message, 500);
      const { data: keyed, error: kErr } = await tb('ad_scripts').select('id,seed_key').not('seed_key', 'is', null);
      if (kErr) return fail(kErr.message, 500);
      const idOf = new Map<string, string>((keyed ?? []).map((r: { id: string; seed_key: string }) => [r.seed_key, r.id]));
      const hooks = [
        ...SEED_SCRIPTS.flatMap((x) => (x.alt ?? []).map(([text, angle], i) => ({ seed_key: `${x.key}-alt-${i + 1}`, text, angle, script_id: idOf.get(x.key) ?? null, created_by: by }))),
        ...SEED_HOOKS.map((h) => ({ seed_key: h.key, text: h.text, angle: h.angle, script_id: null, created_by: by })),
      ];
      const hIns = await tb('ad_hooks').upsert(hooks, { onConflict: 'seed_key', ignoreDuplicates: true });
      if (hIns.error) return fail(hIns.error.message, 500);
      return NextResponse.json({ ok: true, ...(await list()) });
    }

    if (body.addScript) {
      const c = cleanScript({ status: 'idea', ...(body.addScript as Record<string, unknown>) });
      if (typeof c === 'string') return fail(c);
      if (!c.pole || !c.title) return fail('pole and title required');
      if (DONE.has(String(c.status))) c.shot_at = new Date().toISOString();
      const { data, error } = await tb('ad_scripts').insert({ ...c, created_by: by }).select(SCRIPT_COLS);
      if (error) return fail(error.message, 500);
      return NextResponse.json({ ok: true, script: data?.[0] ?? null });
    }
    if (body.patchScript) {
      const { id, patch } = body.patchScript as { id?: string; patch?: Record<string, unknown> };
      if (!id || !patch) return fail('id and patch required');
      const c = cleanScript(patch);
      if (typeof c === 'string') return fail(c);
      const now = new Date().toISOString();
      // Date de tournage : effacée si l'ad revient en idée / « à tourner », posée au PREMIER passage en
      // shot / edited / live (passer de shot à edited ne change pas le jour où elle a été tournée).
      if (c.status && !DONE.has(String(c.status))) c.shot_at = null;
      const { data, error } = await tb('ad_scripts').update({ ...c, updated_at: now }).eq('id', String(id)).select(SCRIPT_COLS);
      if (error) return fail(error.message, 500);
      if (c.status && DONE.has(String(c.status)) && data?.[0] && !data[0].shot_at) {
        const r = await tb('ad_scripts').update({ shot_at: now }).eq('id', String(id)).is('shot_at', null).select(SCRIPT_COLS);
        if (r.error) return fail(r.error.message, 500);
        return NextResponse.json({ ok: true, script: r.data?.[0] ?? { ...data[0], shot_at: now } });
      }
      return NextResponse.json({ ok: true, script: data?.[0] ?? null });
    }
    if (body.deleteScript) {
      const { error } = await tb('ad_scripts').delete().eq('id', String(body.deleteScript));
      if (error) return fail(error.message, 500);
      return NextResponse.json({ ok: true });
    }

    if (body.addHook) {
      const c = cleanHook(body.addHook as Record<string, unknown>);
      if (typeof c === 'string') return fail(c);
      if (!c.text) return fail('hook text required');
      const { data, error } = await tb('ad_hooks').insert({ ...c, created_by: by }).select(HOOK_COLS);
      if (error) return fail(error.message, 500);
      return NextResponse.json({ ok: true, hook: data?.[0] ?? null });
    }
    if (body.patchHook) {
      const { id, patch } = body.patchHook as { id?: string; patch?: Record<string, unknown> };
      if (!id || !patch) return fail('id and patch required');
      const c = cleanHook(patch);
      if (typeof c === 'string') return fail(c);
      const { data, error } = await tb('ad_hooks').update(c).eq('id', String(id)).select(HOOK_COLS);
      if (error) return fail(error.message, 500);
      return NextResponse.json({ ok: true, hook: data?.[0] ?? null });
    }
    if (body.verdict) {
      // L'avis de Mathieu : rejetée (avec au moins une raison ou une note) ou adorée ; null = on efface l'avis.
      const v = body.verdict as { kind?: string; id?: string; verdict?: string | null; reasons?: unknown; note?: unknown };
      const table = v.kind === 'hook' ? 'ad_hooks' : v.kind === 'script' ? 'ad_scripts' : null;
      if (!table || !v.id) return fail('kind (script | hook) and id required');
      const verdict = v.verdict === 'rejected' || v.verdict === 'loved' ? v.verdict : null;
      if (v.verdict != null && !verdict) return fail('verdict must be rejected, loved or null');
      const allowed = verdict === 'rejected' ? REJECT_REASONS : LOVE_REASONS;
      const reasons = verdict && Array.isArray(v.reasons) ? [...new Set(v.reasons.map(String).filter((r) => r in allowed))] : [];
      const note = verdict ? txt(v.note, 1000) : null;
      if (verdict === 'rejected' && !reasons.length && !note) return fail('say why: pick a reason or write a note');
      const cols = table === 'ad_hooks' ? HOOK_COLS : SCRIPT_COLS;
      const { data, error } = await tb(table).update({ verdict, verdict_reasons: reasons, verdict_note: note, verdict_at: verdict ? new Date().toISOString() : null }).eq('id', String(v.id)).select(cols);
      if (error) return fail(error.message, 500);
      return NextResponse.json({ ok: true, row: data?.[0] ?? null });
    }
    if (body.deleteHook) {
      const { error } = await tb('ad_hooks').delete().eq('id', String(body.deleteHook));
      if (error) return fail(error.message, 500);
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    return fail((e as Error).message, 500);
  }
  return fail('unknown action');
}
