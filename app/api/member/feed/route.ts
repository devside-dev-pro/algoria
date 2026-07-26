import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin, isVip } from '@/lib/member/server';
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
    (db as any).from('members').select('status,risk_tier,strategy,lot').eq('tg_id', s.tgId).limit(1) as Promise<{ data: Array<{ status: string; risk_tier: string; strategy: number | null; lot: number | null }> | null }>,
    db.from('events').select('id,ts,msg,data').eq('level', 'ai').order('ts', { ascending: false }).limit(24),
    // MULTI-STRATÉGIES : le membre voit les trades de SA stratégie (défaut 2 = Balanced, historique inclus).
    db.from('trades').select('ticket,symbol,direction,entry,exit,pnl,r,reason,opened_at,closed_at,lot,strategy').not('closed_at', 'is', null).not('pnl', 'is', null).order('closed_at', { ascending: false }).limit(90),
    db.from('signals').select('ticket,rationale').order('created_at', { ascending: false }).limit(200),
  ]);
  // même règle que /api/member/me : admin OU copie activée OU whitelist VIP/équipe (CM…)
  const unlocked = isAdmin(s.username) || ['live', 'paused'].includes(String(memberQ.data?.[0]?.status ?? '')) || (await isVip(s.username));
  // on écarte les micro-scalps BEAST/RAFALE (show du live, pas la stratégie copiée) ET le NAS100
  // (marché retiré : STH ne l'a jamais copié — ses pertes n'existent que sur le compte maître,
  // les montrer aux membres serait un rouge qui n'est pas le leur)
  const rafale = new Set((signalsQ.data ?? []).filter((x) => JSON.stringify(x.rationale ?? '').includes('RAFALE') || JSON.stringify(x.rationale ?? '').includes('ACTION mode')).map((x) => String(x.ticket)));
  const memberStrategy = Number((memberQ.data?.[0] as { strategy?: number } | undefined)?.strategy ?? 2) || 2;
  let trades = (tradesQ.data ?? []).filter((t) => !isShowTrade(t, rafale) && String(t.symbol) !== 'NAS100')
    .filter((t) => Number((t as { strategy?: number }).strategy ?? 2) === memberStrategy);
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
  // TAILLE DE COPIE du membre (lot STH fixe par tier) → l'UI convertit chaque montant master À SON ÉCHELLE.
  // Leçon churn : un client à 500$ qui voit « −1291$ » (le master à 70k en lot 1) retire immédiatement —
  // son vrai chiffre était −13$. On affiche SON échelle en premier, le master en petit.
  // Le lot vient de la COLONNE lot (le VRAI lot copieur) — plus jamais du vieux mapping risk_tier qui
  // affichait 0.05 à des membres copiés en 0.01 (vécu 25/07 : « my app says 0.05 but MT shows 0.01 »).
  const clientLot = Number(memberQ.data?.[0]?.lot ?? 0.01) || 0.01;

  // PREUVE SOCIALE (prospects) — agrégats ANONYMES (numéros de membre uniquement, jamais de nom) :
  // inscrits 48h, activations récentes (<72h pour ne jamais montrer du « figé »), compteurs. Le Home
  // les affiche en bandeau rotatif — vivant tant qu'il y a du volume, muet sinon (jamais de stale).
  const { data: socialRows } = await db.from('members').select('member_no,status,created_at,updated_at').order('created_at', { ascending: false }).limit(200);
  const nowMs = Date.now();
  const all = socialRows ?? [];
  const lastLive = all
    .filter((m) => ['live', 'paused'].includes(String(m.status)) && m.updated_at)
    .sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at)))[0];
  const lastLiveHours = lastLive ? Math.floor((nowMs - Date.parse(String(lastLive.updated_at))) / 3_600_000) : null;
  const social = {
    members: all.length,
    live: all.filter((m) => String(m.status) === 'live').length,
    joins48h: all.filter((m) => nowMs - Date.parse(String(m.created_at)) < 48 * 3_600_000).length,
    lastLiveNo: lastLive && lastLiveHours != null && lastLiveHours < 72 ? Number(lastLive.member_no) : null,
    lastLiveHours: lastLive && lastLiveHours != null && lastLiveHours < 72 ? lastLiveHours : null,
  };
  return NextResponse.json({ desk: deskOut, trades, locked: !unlocked, clientLot, social });
}
