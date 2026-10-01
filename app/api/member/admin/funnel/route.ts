import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ENTONNOIR D'INSCRIPTION (01/10/2026) — lit funnel_events (écrit par l'app membre, lib/member/funnel.ts) et dit
// OÙ les inscrits s'arrêtent : combien de personnes DIFFÉRENTES atteignent chaque étape sur la période, le temps
// passé sur chaque écran avant de partir, les brokers cliqués, les refus du serveur. Admin uniquement.
// GET ?days=14

function gate(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return s && isAdmin(s.username) ? s : null;
}
type Ev = { tg_id: number; event: string; step: number | null; meta: Record<string, unknown>; created_at: string };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

export async function GET(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const days = Math.max(1, Math.min(90, Number(req.nextUrl.searchParams.get('days')) || 14));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = sdb() as any;
  try {
    const evs: Ev[] = [];
    for (let from = 0; from < 200_000; from += 1000) {
      const { data, error } = await db.from('funnel_events').select('tg_id,event,step,meta,created_at').gte('created_at', since).order('id', { ascending: true }).range(from, from + 999);
      if (error) throw new Error(error.message);
      evs.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const [{ count: signups }, { data: first }] = await Promise.all([
      db.from('members').select('id', { count: 'exact', head: true }).gte('created_at', since),
      db.from('funnel_events').select('created_at').order('id', { ascending: true }).limit(1),
    ]);

    const who = (pred: (e: Ev) => boolean) => new Set(evs.filter(pred).map((e) => e.tg_id));
    const is = (event: string, step?: number) => (e: Ev) => e.event === event && (step === undefined || e.step === step);
    const stages = [
      { key: 'home', label: 'Saw the home screen (not activated)', set: who(is('home_view')) },
      { key: 'unlock', label: 'Tapped ⚡ UNLOCK MY ACCESS', set: who(is('unlock_open')) },
      { key: 'ob0', label: 'Opened the broker screen (step 1/3)', set: who(is('ob_view', 0)) },
      { key: 'link', label: 'Clicked a broker link', set: who((e) => e.event === 'ob_broker_link' || e.event === 'ob_bonus_click') },
      { key: 'confirm', label: 'Said “I have my account” → MT5 screen', set: who(is('ob_broker_confirm')) },
      { key: 'ob1', label: 'Saw the MT5 form (step 2/3)', set: who(is('ob_view', 1)) },
      { key: 'mt5', label: 'Sent MT5 details', set: who(is('ob_mt5_click')) },
      { key: 'ob2', label: 'Reached the last screen (step 3/3)', set: who(is('ob_view', 2)) },
      { key: 'done', label: 'Finished → request sent', set: who(is('ob_strategy_done')) },
    ].map((s) => ({ key: s.key, label: s.label, people: s.set.size }));

    const leaveSecs = [0, 1, 2].map((step) => {
      const xs = evs.filter((e) => e.event === 'ob_leave' && e.step === step).map((e) => Number(e.meta?.secs)).filter((n) => Number.isFinite(n) && n >= 0);
      return { step, n: xs.length, medianSecs: median(xs) };
    });
    const linkPeople = new Map<string, Set<number>>();
    for (const e of evs) if (e.event === 'ob_broker_link' || e.event === 'ob_bonus_click') {
      const b = String(e.meta?.broker ?? '?');
      if (!linkPeople.has(b)) linkPeople.set(b, new Set());
      linkPeople.get(b)!.add(e.tg_id);
    }
    const confirmed = who(is('ob_broker_confirm'));
    const brokers = [...linkPeople.entries()].map(([broker, s]) => ({ broker, clicked: s.size, thenConfirmed: [...s].filter((id) => confirmed.has(id)).length }))
      .sort((a, b) => b.clicked - a.clicked);
    const errCount = new Map<string, number>();
    for (const e of evs) if (e.event === 'ob_error') { const m = String(e.meta?.msg ?? '?'); errCount.set(m, (errCount.get(m) ?? 0) + 1); }
    const errors = [...errCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([msg, n]) => ({ msg, n }));
    const budgets = new Map<string, number>();
    for (const e of evs) if (e.event === 'ob_budget') { const b = String(e.meta?.bracket ?? '?'); budgets.set(b, (budgets.get(b) ?? 0) + 1); }
    const bonus = { shown: who(is('ob_bonus_shown')).size, clicked: who(is('ob_bonus_click')).size };
    const backs = who(is('ob_back')).size;
    // 🆘 « je bloque » : ouvert, puis envoyé (par sujet)
    const helpOpened = who((e) => e.event === 'ob_help' && e.meta?.opened === true).size;
    const helpTopics = new Map<string, Set<number>>();
    for (const e of evs) if (e.event === 'ob_help' && typeof e.meta?.topic === 'string') {
      const k = String(e.meta.topic);
      if (!helpTopics.has(k)) helpTopics.set(k, new Set());
      helpTopics.get(k)!.add(e.tg_id);
    }
    // 📤 partages de gains : feuille ouverte, puis partage lancé par canal
    const shareCh = new Map<string, number>();
    for (const e of evs) if (e.event === 'share_done') { const c = String(e.meta?.channel ?? '?'); shareCh.set(c, (shareCh.get(c) ?? 0) + 1); }
    const shares = { openedBy: who(is('share_open')).size, sharers: who(is('share_done')).size, byChannel: [...shareCh.entries()].map(([channel, n]) => ({ channel, n })).sort((a, b) => b.n - a.n) };
    const invCh = new Map<string, number>();
    for (const e of evs) if (e.event === 'invite_share') { const c = String(e.meta?.channel ?? '?'); invCh.set(c, (invCh.get(c) ?? 0) + 1); }
    const invites = { openedBy: who(is('invite_open')).size, sharers: who(is('invite_share')).size, byChannel: [...invCh.entries()].map(([channel, n]) => ({ channel, n })).sort((a, b) => b.n - a.n) };
    const help = { opened: helpOpened, topics: [...helpTopics.entries()].map(([topic, s]) => ({ topic, people: s.size })).sort((a, b) => b.people - a.people) };

    return NextResponse.json({
      days, signups: signups ?? 0, since: first?.[0]?.created_at ?? null, events: evs.length,
      stages, leaveSecs, brokers, errors, budgets: [...budgets.entries()].map(([bracket, n]) => ({ bracket, n })), bonus, backs, help, shares, invites,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
