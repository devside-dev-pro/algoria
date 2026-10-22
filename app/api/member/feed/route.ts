import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin, isVip } from '@/lib/member/server';
import { isShowTrade } from '@/lib/cockpit/showTrades';
import { inMaintenance, LIVE_STRATEGY } from '@/lib/member/maintenance';
import { OFFBOARDED } from '@/lib/member/winback';
import { TRACK_SINCE, TRACK_SINCE_MS } from '@/lib/member/trackSince';
import { seesHistory } from '@/lib/member/historyMaintenance';
import { tradingDayOf, tradingDayStartMs } from '@/lib/display/tradingDay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Flux "Algoria Live" pour les MEMBRES (lecture seule) : cartes desk + trades clôturés.
// Servi côté serveur (service role) car events/trades sont réservés aux sessions authentifiées du cockpit.
// PROSPECTS (accès non activé) : les TRADES restent en clair, gains ET pertes (14/10/2026), mais les analyses
// du desk sont RÉDIGÉES ICI, côté serveur — le flou client n'est qu'un
// habillage, un curieux qui appelle l'API n'obtient que le teaser (3 premiers mots + …).
export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sdb();
  const range = req.nextUrl.searchParams.get('range');
  // JOURNÉES ENTIÈRES, À L'HEURE DE PARIS (14/10/2026, voir lib/display/tradingDay.ts) : la période part de minuit à
  // Paris, il y a 7 ou 30 jours. Une borne glissante coupait la plus ancienne journée en deux, et son bilan ne
  // correspondait plus à celui annoncé ce soir-là.
  const daysAgoStart = (n: number) => tradingDayStartMs(tradingDayOf(Date.now() - n * 86_400_000));
  const rangeFrom = range === 'all' ? 0 : daysAgoStart(range === '30d' ? 30 : 7);
  const [memberQ, desk, tradesQ, signalsQ, startQ] = await Promise.all([
    (db as any).from('members').select('status,risk_tier,strategy,lot').eq('tg_id', s.tgId).limit(1) as Promise<{ data: Array<{ status: string; risk_tier: string; strategy: number | null; lot: number | null }> | null }>,
    db.from('events').select('id,ts,msg,data').eq('level', 'ai').order('ts', { ascending: false }).limit(24),
    // MULTI-STRATÉGIES : le membre voit les trades de SA stratégie (défaut 2 = Balanced), et peut consulter
    // les deux autres. Fenêtre bornée aux 7 DERNIERS JOURS (choix produit) : c'est une comparaison de forme
    // récente, pas un track record — celui-ci vit sur /member/track-record. La borne par DATE et non par
    // nombre de lignes est ce qui rend les trois colonnes comparables : à « les N derniers trades », celle
    // qui trade le plus écrasait les autres dans le lot et couvrait une période bien plus courte qu'elles.
    // borne basse : les 7 derniers jours, jamais avant le départ du track record visible (lib/member/trackSince.ts)
    // PÉRIODE (28/09/2026) : `?range=7d|30d|all` — 7 jours par défaut (Home). L'History propose « depuis
    // Algoria 2.0 » : 7 jours seuls pouvaient afficher un net rouge alors que le membre est vert depuis le
    // départ — une fenêtre trop courte raconte la dernière mauvaise séance, pas la trajectoire.
    // Paginé par 1000 (plafond PostgREST) : « depuis 2.0 » dépasse vite le millier de lignes.
    (async () => {
      const out: Array<Record<string, unknown>> = [];
      const from = new Date(Math.max(rangeFrom, TRACK_SINCE_MS)).toISOString();
      for (let i = 0; i < 10_000; i += 1000) {
        const { data } = await db.from('trades').select('ticket,symbol,direction,entry,exit,pnl,r,reason,opened_at,closed_at,lot,strategy').not('closed_at', 'is', null).not('pnl', 'is', null).gte('closed_at', from).order('closed_at', { ascending: false }).range(i, i + 999);
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return { data: out as Array<{ ticket: string; symbol: string; direction: string; entry: number; exit: number; pnl: number; r: number | null; reason: string; opened_at: string; closed_at: string; lot: number | null; strategy: number | null }> };
    })(),
    db.from('signals').select('ticket,rationale').order('created_at', { ascending: false }).limit(200),
    // le début de SA copie : son premier passage en live
    db.from('member_actions').select('done_at').eq('tg_id', s.tgId).eq('kind', 'connect').eq('status', 'done').not('done_at', 'is', null).order('done_at', { ascending: true }).limit(1),
  ]);
  // même règle que /api/member/me : admin OU copie activée OU whitelist VIP/équipe (CM…)
  // même règle que /api/member/me, y compris la priorité de l'off-board sur la whitelist VIP : le retrait
  // du canal étant manuel, un membre off-boardé encore listé VIP continuerait de recevoir le flux.
  const feedStatus = String(memberQ.data?.[0]?.status ?? '');
  const unlocked = isAdmin(s.username) || (feedStatus !== OFFBOARDED && (['live', 'paused'].includes(feedStatus) || (await isVip(s.username))));
  // on écarte les micro-scalps BEAST/RAFALE (show du live, pas la stratégie copiée) ET le NAS100
  // (marché retiré : STH ne l'a jamais copié — ses pertes n'existent que sur le compte maître,
  // les montrer aux membres serait un rouge qui n'est pas le leur)
  const rafale = new Set((signalsQ.data ?? []).filter((x) => JSON.stringify(x.rationale ?? '').includes('RAFALE') || JSON.stringify(x.rationale ?? '').includes('ACTION mode')).map((x) => String(x.ticket)));
  // UNE SEULE STRATÉGIE (11/09/2026). Il y avait ici un paramètre `?strategy=` — le membre pouvait
  // consulter l'historique des trois. Le comparateur qu'il alimentait est retiré : il n'y a plus rien à
  // comparer, et un sélecteur dont deux entrées sur trois n'ont plus de moteur ne renseigne personne.
  // Les trades des stratégies retirées sont RETIRÉS DE L'AFFICHAGE, pas de la base : le filtre est ici,
  // les lignes restent intactes dans `trades` et reviennent dès qu'on retire l'id de maintenance.ts.
  const clean = (tradesQ.data ?? []).filter((t) => !isShowTrade(t, rafale) && String(t.symbol) !== 'NAS100' && !inMaintenance(Number((t as { strategy?: number }).strategy ?? 2)));
  // PROSPECT : les 7 DERNIERS JOURS, quelle que soit la période demandée (décision Mathieu, 14/10/2026 : l'historique
  // réel de la semaine, pertes comprises ; le reste s'ouvre avec l'accès). Borne appliquée ici, côté serveur.
  const prospectFrom = daysAgoStart(7);
  // SES TRADES, PAS CEUX D'AVANT LUI (18/10/2026, décision Mathieu). Un membre en copie ne voit et ne compte que les
  // trades OUVERTS après le début de sa copie : le Monero ouvert le 22/09 et fermé le 18/10 s'affichait en gain du jour
  // chez des membres arrivés après, qui ne l'avaient pas sur leur compte. Admins et prospects voient tout l'historique.
  const copyStart = (startQ.data?.[0] as { done_at?: string } | undefined)?.done_at ? Date.parse(String((startQ.data?.[0] as { done_at: string }).done_at)) : NaN;
  const mine = (t: { opened_at?: string | null }) => !Number.isFinite(copyStart) || isAdmin(s.username) || !['live', 'paused'].includes(feedStatus) || !t.opened_at || Date.parse(String(t.opened_at)) >= copyStart;
  // 🛠 HISTORIQUE EN MAINTENANCE pour les prospects (22/10/2026, lib/member/historyMaintenance.ts) : aucun trade
  const maintenance = !seesHistory(feedStatus, isAdmin(s.username));
  const trades = maintenance ? [] : clean.filter((t) => Number((t as { strategy?: number }).strategy ?? 2) === LIVE_STRATEGY && (unlocked || Date.parse(String(t.closed_at)) >= prospectFrom) && mine(t));
  // PROSPECTS : LES MÊMES TRADES QUE LES MEMBRES, PERTES COMPRISES (14/10/2026, décision Mathieu). Jusqu'ici le
  // prospect ne voyait que les 30 derniers GAINS (« bande-annonce ») : biaisé, et contredit par tout ce qu'on dit
  // (« every single trade is public, wins and losses »). Une prospecte l'a relevé au bot le 14/10. Ce qui évite de
  // faire fuir n'est plus le filtre mais la présentation (onglet History) : période longue par défaut (depuis 2.0,
  // nette positive), trades regroupés par journée avec le bilan du jour, pertes en gris et non en rouge, montants
  // à 0.10 lot, et une ligne qui dit pourquoi une perte reste une perte maîtrisée (stop loss sur chaque trade).
  // PÉRIODE ENTIÈRE, sans plafond de lignes, pour tout le monde. Le plafond à 30 créait deux chiffres
  // contradictoires sur le même écran — le sélecteur annonçait « 36 trades · −15,27$ » (7 jours complets)
  // pendant que le bloc juste en dessous affichait « 30 trades · −6,72$ » (les 30 derniers seulement).
  // Un chiffre qu'on ne sait pas lire abîme plus la confiance qu'un chiffre négatif honnête.
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
  return NextResponse.json({ desk: deskOut, trades, maintenance, locked: !unlocked, clientLot, social, trackSince: TRACK_SINCE, range: unlocked && (range === 'all' || range === '30d') ? range : '7d' });
}
