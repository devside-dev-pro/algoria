import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from '@/lib/member/server';
import { isShowTrade } from '@/lib/cockpit/showTrades';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Flux "Algoria Live" pour les MEMBRES (lecture seule) : cartes desk + trades clôturés.
// Servi côté serveur (service role) car events/trades sont réservés aux sessions authentifiées du cockpit.
// PROSPECTS (accès non activé) : les TRADES restent en clair (l'historique des gains est l'appât du
// paywall) mais les analyses du desk sont RÉDIGÉES ICI, côté serveur — le flou client n'est qu'un
// habillage, un curieux qui appelle l'API n'obtient que le teaser (3 premiers mots + …).
export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sdb();
  const [memberQ, desk, tradesQ, signalsQ] = await Promise.all([
    db.from('members').select('status').eq('tg_id', s.tgId).limit(1),
    db.from('events').select('id,ts,msg,data').eq('level', 'ai').order('ts', { ascending: false }).limit(24),
    db.from('trades').select('ticket,symbol,direction,entry,exit,pnl,r,reason,opened_at,closed_at,lot').not('closed_at', 'is', null).not('pnl', 'is', null).order('closed_at', { ascending: false }).limit(60),
    db.from('signals').select('ticket,rationale').order('created_at', { ascending: false }).limit(200),
  ]);
  const unlocked = isAdmin(s.username) || ['live', 'paused'].includes(String(memberQ.data?.[0]?.status ?? ''));
  // on écarte les micro-scalps BEAST/RAFALE (show du live, pas la stratégie copiée) ET le NAS100
  // (marché retiré : STH ne l'a jamais copié — ses pertes n'existent que sur le compte maître,
  // les montrer aux membres serait un rouge qui n'est pas le leur)
  const rafale = new Set((signalsQ.data ?? []).filter((x) => JSON.stringify(x.rationale ?? '').includes('RAFALE') || JSON.stringify(x.rationale ?? '').includes('ACTION mode')).map((x) => String(x.ticket)));
  let trades = (tradesQ.data ?? []).filter((t) => !isShowTrade(t, rafale) && String(t.symbol) !== 'NAS100');
  // PROSPECTS : la BANDE-ANNONCE, pas le flux brut — un curieux qui arrive sur 2 SL d'affilée ne rejoint
  // jamais, même après des semaines vertes. On ne montre que les GAINS (l'UI l'assume : "highlights") ;
  // l'historique complet, honnête, s'ouvre avec l'accès débloqué.
  if (!unlocked) trades = trades.filter((t) => Number(t.pnl) > 0);
  trades = trades.slice(0, 30);
  const deskFiltered = (desk.data ?? []).filter((e) => (e.data as { symbol?: string })?.symbol !== 'NAS100');
  const deskOut = unlocked
    ? deskFiltered
    : deskFiltered.map((e) => ({
        id: e.id,
        ts: e.ts,
        msg: String(e.msg ?? '').split(/\s+/).slice(0, 3).join(' ') + ' …',
        data: { symbol: (e.data as { symbol?: string })?.symbol, kind: (e.data as { kind?: string })?.kind },
      }));
  return NextResponse.json({ desk: deskOut, trades, locked: !unlocked });
}
