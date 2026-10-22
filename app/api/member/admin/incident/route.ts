import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';
import { INCIDENT, INCIDENT_KIND, PROOF_BUCKET, affectedMembers, estimatedLoss, inAudience, type Affected, type SthSeen } from '@/lib/member/incident';
import { sthReady, sthStatus, sthConfiguredMaster, sthConnected } from '@/lib/member/sth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // le contrôle STH interroge ~70 comptes, par lots de 8

// 🚨 LE TABLEAU DES DÉCLARATIONS (incident du 21-22/10/2026) — admin seulement. Pour chaque membre touché : son lot,
// la perte estimée (trades de la nuit à son lot, plafonnée en vrai par son solde), ce qu'il a déclaré, sa capture
// (lien signé 1 h, le bucket est privé), et s'il a reçu la demande par le bot.
export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(s.username)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const db = sdb();
  const affected = await affectedMembers(db);
  const ids = affected.map((m) => m.tg_id);
  const [{ data: claims }, { data: asked }] = await Promise.all([
    db.from('member_actions').select('tg_id,detail,created_at').eq('kind', INCIDENT_KIND).eq('status', 'done').in('tg_id', ids.length ? ids : [0]),
    db.from('member_actions').select('tg_id,status').eq('kind', 'nudge').contains('detail', { broadcast: INCIDENT.tag } as never).in('tg_id', ids.length ? ids : [0]),
  ]);
  const byId = new Map(((claims ?? []) as Array<{ tg_id: number; detail: Record<string, unknown>; created_at: string }>).map((c) => [Number(c.tg_id), c]));
  const askedOk = new Set(((asked ?? []) as Array<{ tg_id: number; status: string }>).filter((a) => a.status === 'done').map((a) => Number(a.tg_id)));
  const askedFail = new Set(((asked ?? []) as Array<{ tg_id: number; status: string }>).filter((a) => a.status === 'failed').map((a) => Number(a.tg_id)));
  const rows = await Promise.all(affected.map(async (m) => {
    const c = byId.get(m.tg_id);
    const proof = c?.detail?.proof_path ? (await db.storage.from(PROOF_BUCKET).createSignedUrl(String(c.detail.proof_path), 3600)).data?.signedUrl ?? null : null;
    return {
      tg_id: m.tg_id, member_no: m.member_no, name: m.tg_name, username: m.tg_username, lot: m.lot, broker: m.broker, status: m.status,
      sth: m.sth, sth_detail: m.sth_detail, excluded: m.excluded, inAudience: inAudience(m),
      estimated: estimatedLoss(m.lot),
      asked: askedOk.has(m.tg_id) ? 'ok' : askedFail.has(m.tg_id) ? 'failed' : null,
      claim: c ? { before: c.detail.before, now: c.detail.now, loss: c.detail.loss, note: c.detail.note ?? '', proof, at: c.created_at } : null,
    };
  }));
  rows.sort((a, b) => (b.claim ? Number(b.claim.loss) : -1) - (a.claim ? Number(a.claim.loss) : -1) || b.lot - a.lot);
  const declared = rows.filter((r) => r.claim);
  return NextResponse.json({
    incident: INCIDENT.id,
    affected: rows.length,
    audience: rows.filter((r) => r.inAudience).length,
    sthChecked: affected.some((m) => m.sth != null),
    declared: declared.length,
    totalDeclared: Math.round(declared.reduce((t, r) => t + Number(r.claim?.loss ?? 0), 0)),
    asked: rows.filter((r) => r.asked === 'ok').length,
    rows,
  });
}

// POST — deux gestes de Mathieu sur la liste (Mathieu, 22/10 : « que les gens qui étaient connectés… moins cela
// fera de bruit, mieux c'est pour notre image »).
//  · { sthCheck: true } : demande à STH, pour chacun, si son compte MetaTrader est branché et abonné au master. Les
//    deux → il copiait ; sinon il sort de l'audience. Enregistré (avec la réponse brute) sur la ligne de l'instantané.
//  · { exclude: { tg_id, excluded } } : retirer (ou remettre) un membre à la main.
export async function POST(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(s.username)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { sthCheck?: boolean; exclude?: { tg_id: number; excluded: boolean } };
  const db = sdb();
  const affected = await affectedMembers(db);
  const save = (m: Affected, patch: Record<string, unknown>) =>
    db.from('member_actions').update({ detail: { ...m.snapshot!.detail, ...patch } as never }).eq('id', m.snapshot!.id);

  if (body.exclude) {
    const m = affected.find((x) => x.tg_id === Number(body.exclude!.tg_id));
    if (!m?.snapshot) return NextResponse.json({ error: 'not in the incident list' }, { status: 404 });
    await save(m, { excluded: !!body.exclude.excluded, excluded_by: s.username, excluded_at: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }

  if (body.sthCheck) {
    if (!sthReady()) return NextResponse.json({ error: 'STH not configured — set STH_PARTNER_LICENSE (Vercel)' }, { status: 400 });
    const master = sthConfiguredMaster();
    // Mis en pause / débranché APRÈS le début de la nuit : il copiait, même si STH ne le montre plus abonné.
    const { data: stopped } = await db.from('member_actions').select('tg_id').in('kind', ['pause', 'disconnect']).gte('created_at', INCIDENT.start)
      .in('tg_id', affected.length ? affected.map((m) => m.tg_id) : [0]);
    const stoppedAfter = new Set(((stopped ?? []) as Array<{ tg_id: number }>).map((r) => Number(r.tg_id)));
    // CE QUE STH DIT, BRUT (22/10, 2e version) : la 1re ne regardait que la liste des masters, et répondait « 72 sur 72
    // copiaient » — faux d'après Mathieu. On regarde aussi si le compte MetaTrader est réellement branché chez STH
    // (isTradingAccountConnected, le bon champ depuis le 01/10), et on garde la réponse brute de chacun pour pouvoir
    // relire ce que STH a dit.
    type Seen = { m: Affected; sth: SthSeen; detail: string; raw: { connected: boolean | null; masters: string[]; error?: string } };
    const todo = affected.filter((m) => m.snapshot);
    const seen: Seen[] = [];
    for (let i = 0; i < todo.length; i += 12) {
      seen.push(...await Promise.all(todo.slice(i, i + 12).map(async (m): Promise<Seen> => {
        const st = await sthStatus(String(m.tg_id));
        if (!st.ok) return { m, sth: stoppedAfter.has(m.tg_id) ? 'copying' : 'unknown', detail: st.errorMessage || 'STH did not answer', raw: { connected: null, masters: [], error: st.errorMessage } };
        const ids = (st.data.masterAccountsList ?? []).map((x) => String(x.id));
        const connected = sthConnected(st.data);
        const raw = { connected, masters: ids };
        if (stoppedAfter.has(m.tg_id)) return { m, sth: 'copying', detail: 'paused after the incident started', raw };
        if (!connected) return { m, sth: 'not-copying', detail: 'MetaTrader account not connected on STH', raw };
        if (!ids.length) return { m, sth: 'not-copying', detail: 'subscribed to no master on STH', raw };
        if (master && !ids.includes(master)) return { m, sth: 'not-copying', detail: `on ${ids.join(', ')}, not on ${master}`, raw };
        return { m, sth: 'copying', detail: `connected, on ${ids.join(', ')}`, raw };
      })));
    }
    // GARDE : si la copie a déjà été mise en pause pour tout le monde, la plupart apparaissent « sans master » et ça ne dit
    // plus rien de la nuit — ceux-là restent « ? » (gardés dans l'envoi) au lieu d'être retirés.
    const noMaster = seen.filter((r) => r.raw.connected && !r.raw.masters.length).length;
    const massPause = noMaster > seen.length / 2;
    if (massPause) for (const r of seen) if (r.detail === 'subscribed to no master on STH') { r.sth = 'unknown'; r.detail = 'no master on STH (copy probably paused for everyone)'; }
    const at = new Date().toISOString();
    let saved = 0;
    const saveErrors: string[] = [];
    for (let i = 0; i < seen.length; i += 12) {
      const res = await Promise.all(seen.slice(i, i + 12).map((r) => save(r.m, { sth: r.sth, sth_detail: r.detail, sth_raw: r.raw, sth_checked_at: at })));
      for (const x of res as Array<{ error: { message: string } | null }>) { if (x.error) saveErrors.push(x.error.message); else saved++; }
    }
    const count = (k: SthSeen) => seen.filter((r) => r.sth === k).length;
    return NextResponse.json({
      saved, saveErrors: [...new Set(saveErrors)].slice(0, 3), massPause,
      copying: count('copying'), notCopying: count('not-copying'), unknown: count('unknown'),
      notConnected: seen.filter((r) => r.raw.connected === false).length, noMaster,
      masterLists: [...new Set(seen.map((r) => r.raw.masters.join(',')))].slice(0, 5),
    });
  }

  return NextResponse.json({ error: 'nothing to do' }, { status: 400 });
}
