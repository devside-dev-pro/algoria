import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin, isVip } from '@/lib/member/server';
import { isShowTrade } from '@/lib/cockpit/showTrades';
import { OFFBOARDED } from '@/lib/member/winback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// MON COMPTE (ESTIMATION) — 28/09/2026, demande Mathieu : « les nouveaux m'envoient un screen et me demandent
// à combien est leur compte ». Beaucoup n'ont jamais ouvert MetaTrader. On connaît déjà leur LOT de copie ;
// avec une balance de départ et une date, la somme des trades d'Algoria clôturés depuis, ramenés à leur lot,
// donne une estimation de leur compte — sans jamais se connecter au broker.
//
// Point de départ = une ligne member_actions kind='account_baseline' (status 'done', la plus récente gagne) :
// pas de colonne à migrer, et l'admin la voit dans la chronologie du membre. Tant qu'il n'en a pas posé,
// on lui SUGGÈRE : l'HEURE EXACTE du GO LIVE (le clic CRM branche le copieur — la copie démarre à cette
// seconde, pas à minuit) et le montant du dépôt enregistré à ce moment-là. Un dépôt ancien (membre
// reconnecté des semaines plus tard, vécu #106 : dépôt 28/07, GO LIVE 23/09) ne dit rien de sa balance
// du jour : on ne pré-remplit alors que l'heure, jamais deux mois de trades qu'il n'a pas copiés.
//
// C'est une ESTIMATION et l'UI le dit : spread, commission du broker, trades manqués pendant une pause,
// dépôts/retraits en cours de route l'écartent du vrai chiffre. Le lot est figé au moment du point de départ :
// s'il a changé depuis, on le signale plutôt que de recalculer le passé avec un lot qu'il n'avait pas.

const KIND = 'account_baseline';
const MIN_SINCE = Date.parse('2026-06-01T00:00:00Z');

interface Baseline { balance: number; since: string; lot: number; set_at: string }

async function gate(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const db = sdb();
  const { data } = await db.from('members').select('status,lot,strategy,member_no').eq('tg_id', s.tgId).limit(1);
  const m = data?.[0] as { status?: string; lot?: number | null; strategy?: number | null; member_no?: number | null } | undefined;
  const status = String(m?.status ?? '');
  // même règle que /api/member/feed : admin, copie activée, ou whitelist VIP — jamais un off-boardé
  const unlocked = isAdmin(s.username) || (status !== OFFBOARDED && (['live', 'paused'].includes(status) || (await isVip(s.username))));
  if (!unlocked) return { error: NextResponse.json({ error: 'copy not activated yet' }, { status: 403 }) };
  return { s, db, lot: Number(m?.lot ?? 0.01) || 0.01, strategy: Number(m?.strategy ?? 2) || 2, memberNo: m?.member_no ?? null };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const { s, db, lot, strategy } = g;

  const { data: bRows } = await db.from('member_actions').select('detail,created_at').eq('tg_id', s.tgId).eq('kind', KIND).order('created_at', { ascending: false }).limit(1);
  const bd = bRows?.[0]?.detail as Partial<Baseline> | undefined;
  const baseline: Baseline | null = bd && Number(bd.balance) > 0 && bd.since
    ? { balance: Number(bd.balance), since: String(bd.since), lot: Number(bd.lot) > 0 ? Number(bd.lot) : lot, set_at: String(bd.set_at ?? bRows?.[0]?.created_at ?? '') }
    : null;

  if (!baseline) {
    // SUGGESTION : départ = dernier GO LIVE (connect validé) à la seconde ; balance = le dépôt enregistré
    // dans les 48 h autour de ce GO LIVE (GO LIVE le logge dans la foulée), sinon vide.
    const [depQ, conQ] = await Promise.all([
      db.from('member_actions').select('detail,created_at').eq('tg_id', s.tgId).eq('kind', 'deposit').order('created_at', { ascending: false }).limit(1),
      db.from('member_actions').select('done_at').eq('tg_id', s.tgId).eq('kind', 'connect').eq('status', 'done').not('done_at', 'is', null).order('done_at', { ascending: false }).limit(1),
    ]);
    const dep = depQ.data?.[0] as { detail?: { amount_usd?: number; deposited_at?: string }; created_at?: string } | undefined;
    const goLive = (conQ.data?.[0] as { done_at?: string | null } | undefined)?.done_at ?? null;
    const depAt = dep?.created_at ?? null;
    const amount = Number(dep?.detail?.amount_usd ?? 0);
    const depMatches = amount > 0 && (!goLive || (depAt != null && Math.abs(Date.parse(depAt) - Date.parse(goLive)) < 48 * 3_600_000));
    const since = goLive ?? dep?.detail?.deposited_at ?? depAt;
    return NextResponse.json({ baseline: null, lot, suggestion: { balance: depMatches ? Math.round(amount) : null, since: since ? new Date(since).toISOString() : null } });
  }

  // Trades COPIÉS depuis le point de départ : mêmes exclusions que le flux membre (show BEAST/RAFALE,
  // NAS100 jamais copié par STH), stratégie du membre. Pas de borne TRACK_SINCE ici : le compte du membre,
  // lui, a vécu tout ce qui s'est passé depuis SON départ — l'estimation doit coller à son MetaTrader.
  const sinceIso = new Date(baseline.since).toISOString();
  const rows: Array<{ ticket: string; symbol: string; pnl: number; lot: number | null; strategy: number | null; closed_at: string }> = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await db.from('trades').select('ticket,symbol,pnl,lot,strategy,closed_at').not('closed_at', 'is', null).not('pnl', 'is', null).gte('closed_at', sinceIso).order('closed_at', { ascending: true }).range(from, from + 999);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const { data: sig } = await db.from('signals').select('ticket,rationale').order('created_at', { ascending: false }).limit(2000);
  const rafale = new Set((sig ?? []).filter((x) => { const j = JSON.stringify(x.rationale ?? ''); return j.includes('RAFALE') || j.includes('ACTION mode'); }).map((x) => String(x.ticket)));
  const copied = rows.filter((t) => !isShowTrade(t, rafale) && String(t.symbol) !== 'NAS100' && (Number(t.strategy ?? 2) || 2) === strategy);

  let pnl = 0, wins = 0, peak = baseline.balance, maxDd = 0, bal = baseline.balance;
  const days = new Map<string, number>();
  for (const t of copied) {
    const v = Number(t.pnl) * baseline.lot / (Number(t.lot) > 0 ? Number(t.lot) : 1);
    pnl += v;
    if (Number(t.pnl) > 0) wins++;
    bal += v;
    peak = Math.max(peak, bal);
    maxDd = Math.min(maxDd, (bal - peak) / peak);
    const d = String(t.closed_at).slice(0, 10);
    days.set(d, (days.get(d) ?? 0) + v);
  }
  // courbe jour par jour (balance estimée en fin de journée) — pour le mini-graphe de la carte
  let run = baseline.balance;
  const curve = [...days.entries()].map(([d, v]) => ({ d, b: Math.round((run += v) * 100) / 100 }));

  return NextResponse.json({
    baseline,
    lot,
    lotChanged: Math.abs(baseline.lot - lot) > 1e-9,
    estimate: {
      balance: Math.round((baseline.balance + pnl) * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      pct: Math.round((pnl / baseline.balance) * 10_000) / 100,
      trades: copied.length,
      wins,
      maxDdPct: Math.round(maxDd * 10_000) / 100,
      curve,
    },
  });
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const { s, db, lot, memberNo } = g;
  const body = (await req.json().catch(() => ({}))) as { balance?: unknown; since?: unknown };
  const balance = Math.round(Number(body.balance) * 100) / 100;
  if (!Number.isFinite(balance) || balance < 10 || balance > 10_000_000) return NextResponse.json({ error: 'enter your starting balance in $ (10 or more)' }, { status: 400 });
  const sinceMs = Date.parse(String(body.since ?? ''));
  if (!Number.isFinite(sinceMs) || sinceMs < MIN_SINCE || sinceMs > Date.now() + 86_400_000) return NextResponse.json({ error: 'pick the date your copy started' }, { status: 400 });
  // horodatage COMPLET : « depuis le GO LIVE de 19:35 », pas « depuis minuit » (les trades du matin
  // n'étaient pas copiés). Une date seule (saisie à la main) vaut minuit UTC.
  const detail: Baseline = { balance, since: new Date(sinceMs).toISOString(), lot, set_at: new Date().toISOString() };
  const { error } = await db.from('member_actions').insert({ tg_id: s.tgId, member_no: memberNo, kind: KIND, status: 'done', done_by: 'member', done_at: detail.set_at, detail: detail as never });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
