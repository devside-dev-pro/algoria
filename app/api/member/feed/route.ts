import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Flux "Algoria Live" pour les MEMBRES (lecture seule) : cartes desk + trades clôturés.
// Servi côté serveur (service role) car events/trades sont réservés aux sessions authentifiées du cockpit —
// on ne les ouvre PAS au monde en anon : seuls les membres connectés (cookie signé) voient le flux.
export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sdb();
  const [desk, tradesQ, signalsQ] = await Promise.all([
    db.from('events').select('id,ts,msg,data').eq('level', 'ai').order('ts', { ascending: false }).limit(24),
    db.from('trades').select('ticket,symbol,direction,entry,exit,pnl,r,reason,opened_at,closed_at,lot').not('closed_at', 'is', null).not('pnl', 'is', null).order('closed_at', { ascending: false }).limit(60),
    db.from('signals').select('ticket,rationale').order('created_at', { ascending: false }).limit(200),
  ]);
  // on écarte les micro-scalps BEAST/RAFALE (show du live, pas la stratégie copiée)
  const rafale = new Set((signalsQ.data ?? []).filter((x) => JSON.stringify(x.rationale ?? '').includes('RAFALE') || JSON.stringify(x.rationale ?? '').includes('ACTION mode')).map((x) => String(x.ticket)));
  const trades = (tradesQ.data ?? []).filter((t) => !rafale.has(String(t.ticket))).slice(0, 30);
  return NextResponse.json({ desk: desk.data ?? [], trades });
}
