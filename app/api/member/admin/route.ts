import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin, decryptSecret, encryptSecret } from '@/lib/member/server';
import { MILESTONES, commissionForActivation } from '@/lib/member/affiliate';
import { sthReady, sthConnectAndJoin, sthDisconnect, sthStatus, sthMoveMaster } from '@/lib/member/sth';
import { BROKERS } from '@/lib/member/brokers';
import { LOT_MAX, isLotAllowed } from '@/lib/member/lots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // le CONNECT STH peut poller ~25 s (connexion MT asynchrone côté STH)

// Gestion de la liste VIP (support) : seuls les @ de ADMIN_TG_USERNAMES passent.
function guard(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s || !isAdmin(s.username)) return null;
  return s;
}

// TOUS les membres, paginés (04/08). La requête était plafonnée à 200 alors qu'ils étaient déjà 209 : triée
// par member_no DÉCROISSANT, elle coupait les plus ANCIENS — ils disparaissaient de la liste, de la recherche,
// de l'entonnoir et de tous les compteurs. Le pire était le silence : le dashboard affichait « 200 » comme si
// c'était le total, et le mur reculait d'un membre à chaque inscription. Une limite plus haute ne ferait que
// repousser la date, et PostgREST plafonne de toute façon ses réponses — donc on pagine jusqu'à épuisement.
const MEMBER_COLS = 'member_no,tg_id,tg_username,tg_name,status,broker,risk_tier,created_at,updated_at,onboarding_step,mt5_login,mt5_server,usdt_trc20,referred_by,country,source,banned_at,locale,strategy,lot';
type MemberRow = { tg_id: number; tg_username: string | null; member_no: number | null } & Record<string, unknown>;
async function allMembers(db: ReturnType<typeof sdb>): Promise<{ data: MemberRow[] }> {
  const PAGE = 1000;
  const out: MemberRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await (db as any).from('members').select(MEMBER_COLS).order('member_no', { ascending: false }).range(from, from + PAGE - 1) as { data: MemberRow[] | null };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break; // dernière page (ou plafond serveur atteint et rien de plus à lire)
  }
  return { data: out };
}

/**
 * Dépôt CONNU d'un membre, dans l'ordre de fiabilité : montant VALIDÉ du registre des dépôts (ce que tu
 * as constaté chez le broker), à défaut le montant DÉCLARÉ au wizard, à défaut 0.
 * L'écart entre les deux n'est pas théorique : le premier filleul réel avait déclaré 400$ et déposé 200$.
 */
async function knownDepositFor(db: ReturnType<typeof sdb>, tgId: number): Promise<number> {
  const { data } = await (db as any).from('member_actions')
    .select('kind,detail').eq('tg_id', tgId).in('kind', ['deposit', 'kyc'])
    .order('created_at', { ascending: false }).limit(20) as { data: Array<{ kind: string; detail: Record<string, unknown> | null }> | null };
  const rows = data ?? [];
  const validated = rows.find((r) => r.kind === 'deposit' && Number(r.detail?.amount_usd ?? 0) > 0);
  if (validated) return Number(validated.detail?.amount_usd);
  const declared = rows.find((r) => r.kind === 'kyc' && Number(r.detail?.declared_deposit ?? 0) > 0);
  return declared ? Number(declared.detail?.declared_deposit) : 0;
}

/**
 * Réaligne la commission de parrainage d'un filleul sur son dépôt réel — appelé quand une ligne du
 * registre des dépôts est créée ou corrigée.
 *
 * La commission naît à l'APPROBATION, alors que le dépôt validé n'est pas encore saisi : elle part donc
 * du montant déclaré, qui peut être faux. Sans ce réalignement, une correction dans le registre laissait
 * la commission sur l'ancien chiffre — invisible, et payée telle quelle.
 * Ne touche QUE les commissions `pending` : une commission confirmée est un engagement pris, elle ne se
 * révise plus à la baisse dans le dos du parrain.
 */
async function syncPendingReferralCommission(db: ReturnType<typeof sdb>, tgId: number, depositUsd: number): Promise<void> {
  if (!Number.isFinite(depositUsd) || depositUsd <= 0) return;
  const { data: com } = await (db as any).from('referral_commissions')
    .select('id,referrer_tg_id,amount,detail').eq('referred_tg_id', tgId).eq('kind', 'referral').eq('status', 'pending').limit(1) as
    { data: Array<{ id: string; referrer_tg_id: number; amount: number; detail: Record<string, unknown> | null }> | null };
  const row = com?.[0];
  if (!row) return;
  // COMMISSIONS ANTÉRIEURES AU BARÈME (14/08) : celles nées sous le forfait à 50$ portent `grandfathered`
  // et ne se recalculent JAMAIS. Le montant affiché au parrain au moment où il a parrainé est un
  // engagement — le premier affilié d'Algoria ne doit pas voir sa commission fondre parce qu'on a changé
  // la règle après coup. Une simple correction du dépôt aurait suffi à la ramener de 50$ à 20$.
  if ((row.detail as { grandfathered?: boolean } | null)?.grandfathered) return;
  // rang du parrain AU MOMENT de cette activation : on ne compte que ses commissions antérieures
  const { data: prior } = await (db as any).from('referral_commissions')
    .select('id').eq('referrer_tg_id', row.referrer_tg_id).eq('kind', 'referral').neq('status', 'canceled').neq('id', row.id) as { data: Array<{ id: string }> | null };
  const amount = commissionForActivation(prior?.length ?? 0, depositUsd);
  if (amount === Number(row.amount)) return;
  await (db as any).from('referral_commissions')
    .update({ amount, detail: { ...(row.detail ?? {}), deposit_usd: depositUsd } })
    .eq('id', row.id);
}

export async function GET(req: NextRequest) {
  // PAS DE SESSION vs SESSION NON-ADMIN (01/08) — la distinction manquait et créait une boucle insoluble :
  // on répondait 403 dans les deux cas, sans jamais dire QUEL compte venait de se connecter. Quelqu'un
  // dont le Telegram est basculé sur un autre compte (un compte de test, par exemple) tapait START,
  // arrivait bien connecté, se faisait refuser, retapait START avec le même compte… en boucle, sans
  // aucun moyen de voir d'où venait le refus. On renvoie donc le pseudo : la page l'affiche, et le
  // problème saute aux yeux en une seconde.
  const sess = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(sess.username)) return NextResponse.json({ error: 'forbidden', username: sess.username ?? null }, { status: 403 });
  const s = sess;
  const db = sdb();
  const [wl, members, actions, commsQ, payoutsQ, depositsQ, pushQ, nudgesQ, heartQ, kycQ] = await Promise.all([
    db.from('member_whitelist').select('*').order('created_at', { ascending: false }),
    // cast : la colonne country n'est pas dans les types générés (comme edge_health) — le runtime est identique
    allMembers(db),
    db.from('member_actions').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(100),
    db.from('referral_commissions').select('*').order('created_at', { ascending: false }).limit(300),
    db.from('referral_payouts').select('*').order('created_at', { ascending: false }).limit(200),
    // REGISTRE DES DÉPÔTS (bilan broker) : lignes saisies par l'admin, kind='deposit' status='done'
    // (jamais dans la file). Stockées dans member_actions — zéro migration, pattern du stash kyc.
    db.from('member_actions').select('*').eq('kind', 'deposit').order('created_at', { ascending: false }).limit(500),
    // ABONNEMENTS PUSH : qui a activé les alertes (au moins 1 appareil). Sert au tableau « qui relancer ».
    db.from('member_push_subs').select('tg_id'),
    // RELANCES (kind='nudge', auto + manuelles) : nourrit la file « RELANCES DU JOUR » (qui a été touché quand).
    db.from('member_actions').select('tg_id,created_at,done_by').eq('kind', 'nudge').order('created_at', { ascending: false }).limit(500),
    // HEARTBEAT runner : la dernière bougie écrite (BTC 24/7 → toujours attendue) — bandeau rouge si > 20 min.
    db.from('candles').select('time').order('time', { ascending: false }).limit(1),
    // NOMS LÉGAUX (kyc.broker_name, déclarés au wizard) : LE pont entre les 3 identités d'une personne
    // (nom Telegram ≠ @pseudo ≠ nom sur le compte broker) — affiché partout + cherchable dans l'admin.
    db.from('member_actions').select('tg_id,detail,created_at').eq('kind', 'kyc').order('created_at', { ascending: false }).limit(500),
  ]);
  // COMPTES SUPPLÉMENTAIRES (multi-stratégies) — affichés sur la fiche membre (broker + stratégie + statut)
  const { data: extraAccounts } = await (db as any).from('member_accounts')
    .select('id,tg_id,member_no,account_no,broker,strategy,status,mt5_login,mt5_server,declared_deposit,holder_name,created_at')
    .order('created_at', { ascending: false }).limit(300) as { data: Array<Record<string, unknown>> | null };
  // 🤖 BOT ACTIVITY : fil unifié envoyé (nudge, avec le texte du DM) / reçu (bot_reply) — le plus récent d'abord
  const { data: botActivity } = await db.from('member_actions').select('id,tg_id,member_no,kind,detail,created_at,done_by')
    .in('kind', ['nudge', 'bot_reply']).order('created_at', { ascending: false }).limit(120);
  // 📣 SOURCES DES DEMANDES D'ADHÉSION (30/07) : agrégat par lien d'invitation Telegram — un lien nommé
  // par campagne relie enfin une pub à ses demandes (les ads pointent vers le canal, pas vers l'app, donc
  // les ?src= étaient inexploitables). dm = taux de DM automatique délivré (bloqué/privé → 'failed').
  const { data: joinRows } = await (db as any).from('telegram_joins')
    .select('invite_name,status,dm_status,joined_at').order('joined_at', { ascending: false }).limit(1000) as { data: Array<{ invite_name: string | null; status: string | null; dm_status: string | null; joined_at: string }> | null };
  const joinSources = Object.values(
    (joinRows ?? []).reduce((acc: Record<string, { source: string; n: number; accepted: number; dmSent: number; dmFailed: number; last: string }>, r) => {
      const key = r.invite_name ?? '(lien direct / inconnu)';
      const cur = (acc[key] ??= { source: key, n: 0, accepted: 0, dmSent: 0, dmFailed: 0, last: r.joined_at });
      cur.n++;
      if (r.status === 'accepted') cur.accepted++;
      if (r.dm_status === 'sent') cur.dmSent++;
      if (r.dm_status === 'failed') cur.dmFailed++;
      if (r.joined_at > cur.last) cur.last = r.joined_at;
      return acc;
    }, {}),
  ).sort((a, b) => b.n - a.n);
  // 📡 CANAUX VUS PAR LE BOT — l'ID numérique (-100…) qu'aucune interface Telegram n'affiche, à copier
  // dans les variables Vercel. On calcule ici le RÔLE de chacun : source du fan-out, miroir UK, canal IT.
  // Un canal listé « — » n'est branché sur rien : c'est le signe qu'une variable manque.
  const roles: Record<string, string> = {};
  for (const [env, role] of [['TELEGRAM_CHANNEL_EN', 'source'], ['TELEGRAM_CHANNEL_MIRROR', 'mirror UK'], ['TELEGRAM_CHANNEL_IT', 'canale IT']] as const) {
    const v = (process.env[env] ?? '').trim();
    if (v) roles[v] = role;
  }
  const { data: chatRows } = await (db as any).from('telegram_chats')
    .select('chat_id,title,type,username,last_seen_at').order('last_seen_at', { ascending: false }).limit(30) as { data: Array<{ chat_id: number; title: string | null; type: string | null; username: string | null; last_seen_at: string }> | null };
  // Attendre un post de canal pour découvrir un canal serait absurde : le bot y reçoit DÉJÀ les demandes
  // d'adhésion, donc telegram_joins connaît son ID depuis le premier jour. On complète la liste avec ces
  // canaux-là, et getChat va chercher le titre manquant (le bot y est admin, l'appel passe). Le résultat
  // est mémorisé : ce détour ne coûte qu'un seul chargement, la fois où un canal apparaît.
  const { data: joinChats } = await (db as any).from('telegram_joins')
    .select('chat_id').not('chat_id', 'is', null).limit(2000) as { data: Array<{ chat_id: number }> | null };
  const known = new Map((chatRows ?? []).map((c) => [Number(c.chat_id), c]));
  const missing = [...new Set((joinChats ?? []).map((r) => Number(r.chat_id)).filter(Boolean))]
    .filter((id) => !known.get(id)?.title).slice(0, 8);
  if (missing.length && process.env.TELEGRAM_BOT_TOKEN) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const found = await Promise.all(missing.map(async (id) => {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${id}`, { signal: AbortSignal.timeout(3500) });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: { title?: string; type?: string; username?: string } };
        return d.ok ? { chat_id: id, title: String(d.result?.title ?? '').slice(0, 120) || null, type: String(d.result?.type ?? 'channel'), username: d.result?.username ?? null } : null;
      } catch { return null; }
    }));
    for (const f of found) {
      if (!f) continue;
      known.set(f.chat_id, { ...f, last_seen_at: known.get(f.chat_id)?.last_seen_at ?? new Date().toISOString() });
      await (db as any).from('telegram_chats').upsert({ ...f, last_seen_at: known.get(f.chat_id)!.last_seen_at }, { onConflict: 'chat_id' }).then(() => {}, () => {});
    }
  }
  const tgChats = [...known.values()]
    .map((c) => ({ ...c, chat_id: Number(c.chat_id), role: roles[String(c.chat_id)] ?? null }))
    .sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));

  // état RÉEL du webhook (getWebhookInfo) — SAIN uniquement s'il pointe sur /api/telegram (le webhook
  // unique : login + waitlist + inbox). Toute autre URL = cassé → le bouton de réparation s'affiche.
  let tgInboxOn = false;
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const wh = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(3000) });
      const wd = (await wh.json().catch(() => ({}))) as { result?: { url?: string } };
      tgInboxOn = String(wd.result?.url ?? '').includes('/api/telegram');
    }
  } catch { /* Telegram injoignable → on laisse le bouton visible */ }
  const pushTgIds = [...new Set((pushQ.data ?? []).map((r) => Number(r.tg_id)).filter(Boolean))];
  // AFFILIATION — la dette réelle par parrain : Σ confirmées − Σ retraits (demandés + payés).
  // Une balance NÉGATIVE (commission annulée APRÈS retrait) est le signal d'abus n°1 → flag rouge.
  const comms = commsQ.data ?? [];
  const payouts = payoutsQ.data ?? [];
  const balances = new Map<number, number>();
  for (const c of comms) if (c.status === 'confirmed') balances.set(Number(c.referrer_tg_id), (balances.get(Number(c.referrer_tg_id)) ?? 0) + Number(c.amount));
  for (const p of payouts) if (['requested', 'paid'].includes(String(p.status))) balances.set(Number(p.tg_id), (balances.get(Number(p.tg_id)) ?? 0) - Number(p.amount));
  const byTg = new Map((members.data ?? []).map((m) => [Number(m.tg_id), m]));
  const affiliate = {
    pendingCommissions: comms.filter((c) => c.status === 'pending'),
    recentCommissions: comms.filter((c) => c.status !== 'pending').slice(0, 30),
    pendingPayouts: payouts.filter((p) => p.status === 'requested'),
    recentPayouts: payouts.filter((p) => p.status !== 'requested').slice(0, 20),
    owedUsd: [...balances.values()].filter((v) => v > 0).reduce((a, v) => a + v, 0), // ta dette totale envers les parrains
    flagged: [...balances.entries()].filter(([, v]) => v < 0).map(([tg, v]) => ({ tg_id: tg, balance: v, username: byTg.get(tg)?.tg_username ?? null, member_no: byTg.get(tg)?.member_no ?? null })),
  };
  // dernier nom légal déclaré par membre (le kyc le plus récent gagne)
  const legalNames: Record<string, string> = {};
  for (const k of kycQ.data ?? []) {
    const t = String(k.tg_id);
    const n = String((k.detail as { broker_name?: string })?.broker_name ?? '').trim();
    if (n && !legalNames[t]) legalNames[t] = n;
  }
  return NextResponse.json({ whitelist: wl.data ?? [], members: members.data ?? [], actions: actions.data ?? [], affiliate, deposits: depositsQ.data ?? [], pushTgIds, nudges: nudgesQ.data ?? [], runnerLastSeen: heartQ.data?.[0]?.time != null ? Number(heartQ.data[0].time) : null, legalNames, extraAccounts: extraAccounts ?? [], botActivity: botActivity ?? [], tgInboxOn, joinSources, tgChats });
}

export async function POST(req: NextRequest) {
  const s = guard(req);
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    add?: string; remove?: string; done?: string; reveal?: string; liveAlert?: boolean;
    confirmCommission?: string; cancelCommission?: string; payoutPaid?: string; payoutReject?: string; reason?: string; tx?: string;
    rejectConnect?: string;
    addDeposit?: { tg_id: number; broker?: string; amount: number; commission?: number; date?: string; note?: string };
    updateDeposit?: { id: string; amount?: number; commission?: number; comStatus?: string; note?: string; broker?: string; date?: string; bookedYm?: string | null };
    deleteDeposit?: string;
    customPush?: { title: string; body: string; url?: string; audience: string; tg_id?: number };
    memberDetail?: number; addNote?: { tg_id: number; text: string }; deleteNote?: string;
    setLegalName?: { tg_id: number; name: string }; revealMember?: number; revealAccount?: string; offboard?: number; connectSth?: string; reconnectSth?: number; sthStatusCheck?: number; sthAudit?: string; moveSth?: string; dismiss?: string; nudged?: number;
    setupTgWebhook?: boolean; botDm?: { tg_id: number; text: string };
    setCountry?: { tg_id: number; country: string };
    editMember?: { tg_id: number; field: string; value: string | null };
    offerBlast?: { text?: string; title?: string; pushBody?: string; url?: string; dryRun?: boolean };
    ban?: { tg_id: number; reason?: string; undo?: boolean };
  };
  const db = sdb();
  const who = s.username ?? String(s.tgId);

  // ===== FICHE MEMBRE — l'historique complet d'un membre + notes privées du CRM =====
  if (body.memberDetail) {
    // toutes ses actions (connect/kyc/risk/pause/deposit/note…), tous statuts — la timeline de la fiche
    const { data: acts } = await db.from('member_actions').select('*').eq('tg_id', body.memberDetail).order('created_at', { ascending: false }).limit(100);
    return NextResponse.json({ actions: acts ?? [] });
  }
  if (body.addNote) {
    const text = String(body.addNote.text ?? '').trim().slice(0, 500);
    if (!text || !Number(body.addNote.tg_id)) return NextResponse.json({ error: 'text and tg_id required' }, { status: 400 });
    const { data: m } = await db.from('members').select('member_no').eq('tg_id', body.addNote.tg_id).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    // note PRIVÉE opérateur (kind='note', status='done' → jamais dans la file, jamais vue par le membre)
    const { error } = await db.from('member_actions').insert({ tg_id: body.addNote.tg_id, member_no: m[0].member_no, kind: 'note', status: 'done', done_by: who, detail: { text } as never });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.deleteNote) {
    // garde kind='note' : on ne peut effacer QUE des notes avec cette action
    const { error } = await db.from('member_actions').delete().eq('id', body.deleteNote).eq('kind', 'note');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ===== PUSH COMPOSER — le canal marketing de l'opérateur =====
  // Message libre vers un segment : all (tout le monde), prospects (pas encore activés), live (copie
  // active/en pause), self (test sur soi AVANT d'arroser), user (relance individuelle d'un lead).
  // Règle 70/30 inchangée : c'est l'humain qui écrit — jamais d'automatisme négatif ici.
  if (body.customPush) {
    const p = body.customPush;
    const title = String(p.title ?? '').trim().slice(0, 80);
    const text = String(p.body ?? '').trim().slice(0, 300);
    if (!title || !text) return NextResponse.json({ error: 'title and body required' }, { status: 400 });
    const rawUrl = String(p.url ?? '').trim();
    const url = rawUrl.startsWith('/') || rawUrl.startsWith('https://') ? rawUrl.slice(0, 300) : '/member';
    const payload = { title, body: text, url, tag: 'algoria-broadcast' };
    const push = await import('@/lib/push/send');
    let sent = 0;
    if (p.audience === 'all') sent = await push.pushToAll(payload);
    else if (p.audience === 'self') sent = await push.pushToUser(s.tgId, payload);
    else if (p.audience === 'user') {
      if (!Number(p.tg_id)) return NextResponse.json({ error: 'tg_id required' }, { status: 400 });
      sent = await push.pushToUser(Number(p.tg_id), payload);
    } else if (p.audience === 'prospects' || p.audience === 'live') {
      const statuses = p.audience === 'live' ? ['live', 'paused'] : ['onboarding', 'pending_copier'];
      const { data: seg } = await db.from('members').select('tg_id').in('status', statuses);
      sent = await push.pushToUsers((seg ?? []).map((m) => Number(m.tg_id)), payload);
    } else return NextResponse.json({ error: 'unknown audience' }, { status: 400 });
    return NextResponse.json({ sent });
  }

  // ===== REGISTRE DES DÉPÔTS — le bilan broker de fin de mois =====
  // Une ligne par dépôt constaté chez le broker partenaire : montant déposé + commission attendue.
  // Cycle de la com : pending (attendue) → received (encaissée) | canceled (sautée : retrait éclair, refus broker…).
  // Vit dans member_actions (kind='deposit', status='done' → jamais dans la file) — zéro migration.
  if (body.addDeposit) {
    const d = body.addDeposit;
    const amount = Number(d.amount);
    const commission = Number(d.commission ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'deposit amount required' }, { status: 400 });
    const { data: m } = await db.from('members').select('member_no,broker').eq('tg_id', d.tg_id).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    const depositedAt = d.date && !Number.isNaN(Date.parse(String(d.date))) ? new Date(String(d.date)).toISOString() : new Date().toISOString();
    const { error } = await db.from('member_actions').insert({
      tg_id: d.tg_id, member_no: m[0].member_no, kind: 'deposit', status: 'done', done_by: who,
      detail: {
        broker: String(d.broker ?? m[0].broker ?? '').trim().toLowerCase() || null,
        amount_usd: amount,
        commission_usd: Number.isFinite(commission) && commission > 0 ? commission : 0,
        commission_status: 'pending',
        note: String(d.note ?? '').slice(0, 300) || null,
        deposited_at: depositedAt,
      } as never,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // le montant validé fait foi : si ce membre a un parrain, sa commission s'aligne dessus
    await syncPendingReferralCommission(db, Number(d.tg_id), amount);
    return NextResponse.json({ ok: true });
  }
  if (body.updateDeposit) {
    const u = body.updateDeposit;
    const { data: rows } = await db.from('member_actions').select('id,detail').eq('id', u.id).eq('kind', 'deposit').limit(1);
    if (!rows?.length) return NextResponse.json({ error: 'deposit not found' }, { status: 404 });
    const det = { ...((rows[0].detail as Record<string, unknown>) ?? {}) };
    if (u.amount != null && Number.isFinite(Number(u.amount)) && Number(u.amount) > 0) det.amount_usd = Number(u.amount);
    if (u.commission != null && Number.isFinite(Number(u.commission)) && Number(u.commission) >= 0) det.commission_usd = Number(u.commission);
    if (u.comStatus) {
      if (!['pending', 'received', 'canceled'].includes(u.comStatus)) return NextResponse.json({ error: 'invalid commission status' }, { status: 400 });
      // received ↔ canceled ↔ pending librement : une com « reçue » peut sauter après coup (clawback broker)
      det.commission_status = u.comStatus;
      det.commission_decided_at = new Date().toISOString();
      det.commission_decided_by = who;
    }
    if (u.note !== undefined) det.note = String(u.note).slice(0, 300) || null;
    if (u.broker !== undefined) det.broker = String(u.broker).trim().toLowerCase() || null;
    if (u.date && !Number.isNaN(Date.parse(String(u.date)))) det.deposited_at = new Date(String(u.date)).toISOString();
    // REPORT COMPTABLE (01/08) — un dépôt dont la commission n'est pas encore validée (le membre n'a pas
    // tradé le lot minimum) pollue le bilan du mois : il y figure en « pending » et fausse le total. Le
    // support le reporte donc sur le mois suivant, où il sera validé.
    // On NE touche PAS à deposited_at : la date réelle du dépôt est un fait, elle ne se réécrit pas. On
    // ajoute un mois COMPTABLE à côté — le bilan groupe dessus, l'historique reste vrai, et le report est
    // réversible d'un clic. Effacer la date aurait rendu la ligne introuvable le jour d'un litige broker.
    if (u.bookedYm !== undefined) {
      if (u.bookedYm === null) { det.booked_ym = null; det.booked_moved_at = null; det.booked_moved_by = null; }
      else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(u.bookedYm))) {
        det.booked_ym = String(u.bookedYm);
        det.booked_moved_at = new Date().toISOString();
        det.booked_moved_by = who;
      } else return NextResponse.json({ error: 'booked month must be YYYY-MM' }, { status: 400 });
    }
    const { error } = await db.from('member_actions').update({ detail: det as never }).eq('id', u.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // montant corrigé → la commission de parrainage suit (elle avait pu naître sur le montant déclaré)
    if (u.amount != null) {
      const { data: owner } = await db.from('member_actions').select('tg_id').eq('id', u.id).limit(1);
      if (owner?.[0]?.tg_id) await syncPendingReferralCommission(db, Number(owner[0].tg_id), Number(det.amount_usd));
    }
    return NextResponse.json({ ok: true });
  }
  if (body.deleteDeposit) {
    // garde kind='deposit' : impossible d'effacer une action de la file par erreur avec un mauvais id
    const { error } = await db.from('member_actions').delete().eq('id', body.deleteDeposit).eq('kind', 'deposit');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ===== REFUSER une demande de connexion (vérification broker échouée) — SANS bloquer le membre :
  // il repasse en onboarding à l'étape MT5, voit la raison dans le wizard, corrige et re-soumet.
  if (body.rejectConnect) {
    const { data: rows } = await db.from('member_actions').select('*').eq('id', body.rejectConnect).eq('status', 'pending').limit(1);
    const act = rows?.[0];
    if (!act || act.kind !== 'connect') return NextResponse.json({ error: 'connect request not found (already processed?)' }, { status: 404 });
    const reason = String(body.reason ?? '').slice(0, 200) || 'verification failed';
    await db.from('member_actions').update({
      status: 'rejected',
      done_at: new Date().toISOString(),
      done_by: who,
      detail: { ...(act.detail as Record<string, unknown> | null ?? {}), reject_reason: reason } as never,
    }).eq('id', act.id);
    const rejAccountId = (act.detail as { account_id?: string } | null)?.account_id;
    if (rejAccountId) {
      // COMPTE SUPPLÉMENTAIRE refusé → seul le compte est marqué rejected, le membre reste live sur son principal.
      await (db as any).from('member_accounts').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', String(rejAccountId));
    } else {
      await db.from('members').update({ status: 'onboarding', onboarding_step: 1, updated_at: new Date().toISOString() })
        .eq('tg_id', act.tg_id).eq('status', 'pending_copier');
    }
    const { pushToUser } = await import('@/lib/push/send');
    void pushToUser(Number(act.tg_id), {
      title: 'Connection request declined',
      body: `${reason} — open the app to fix your details and resubmit.`,
      url: rejAccountId ? '/member/add-strategy' : '/member/onboarding',
      tag: 'algoria-connect',
    });
    return NextResponse.json({ ok: true });
  }

  // ===== AFFILIATION : cycle de vie des commissions + traitement des retraits =====
  if (body.confirmCommission || body.cancelCommission) {
    const id = body.confirmCommission ?? body.cancelCommission!;
    const confirm = !!body.confirmCommission;
    const { data: rows } = await db.from('referral_commissions').select('*').eq('id', id).limit(1);
    const c = rows?.[0];
    if (!c) return NextResponse.json({ error: 'commission not found' }, { status: 404 });
    // CANCEL possible même sur une confirmée (client retire son dépôt APRÈS coup) — la balance se re-débite
    // toute seule (elle est recalculée depuis les statuts) et peut passer en négatif → flag dans le GET.
    await db.from('referral_commissions').update({
      status: confirm ? 'confirmed' : 'canceled',
      reason: confirm ? null : String(body.reason ?? '').slice(0, 200) || 'canceled by admin',
      decided_at: new Date().toISOString(),
      decided_by: who,
    }).eq('id', id);
    if (confirm && c.kind === 'referral') {
      // PALIERS : atteint quand le nombre d'activations CONFIRMÉES croise le seuil → bonus auto-confirmé
      // (il dérive d'activations déjà validées). Doublon impossible : une ligne milestone par seuil.
      const [{ data: confirmed }, { data: milestones }] = await Promise.all([
        db.from('referral_commissions').select('id').eq('referrer_tg_id', c.referrer_tg_id).eq('kind', 'referral').eq('status', 'confirmed'),
        db.from('referral_commissions').select('detail').eq('referrer_tg_id', c.referrer_tg_id).eq('kind', 'milestone'),
      ]);
      const n = confirmed?.length ?? 0;
      const hit = MILESTONES.find((m) => m.at === n);
      const already = new Set((milestones ?? []).map((m) => Number((m.detail as { milestone_at?: number })?.milestone_at)));
      if (hit && !already.has(hit.at)) {
        await db.from('referral_commissions').insert({
          referrer_tg_id: c.referrer_tg_id, kind: 'milestone', amount: hit.bonus, status: 'confirmed',
          detail: { milestone_at: hit.at, label: hit.label } as never, decided_at: new Date().toISOString(), decided_by: who,
        });
        const { pushToUser } = await import('@/lib/push/send');
        void pushToUser(Number(c.referrer_tg_id), { title: `🏆 ${hit.label} unlocked!`, body: `${hit.at} activated referrals — $${hit.bonus} bonus just landed in your wallet.`, url: '/member/profile', tag: 'algoria-affiliate' });
      }
      const { pushToUser } = await import('@/lib/push/send');
      void pushToUser(Number(c.referrer_tg_id), { title: '💰 Commission confirmed', body: `+$${Number(c.amount)} is now withdrawable. Total activated: ${n}.`, url: '/member/profile', tag: 'algoria-affiliate' });
    }
    return NextResponse.json({ ok: true });
  }
  if (body.payoutPaid || body.payoutReject) {
    const id = body.payoutPaid ?? body.payoutReject!;
    const paid = !!body.payoutPaid;
    const { data: rows } = await db.from('referral_payouts').select('*').eq('id', id).eq('status', 'requested').limit(1);
    const p = rows?.[0];
    if (!p) return NextResponse.json({ error: 'payout not found (already processed?)' }, { status: 404 });
    if (paid && !String(body.tx ?? '').trim()) return NextResponse.json({ error: 'transaction hash required' }, { status: 400 });
    await db.from('referral_payouts').update({
      status: paid ? 'paid' : 'rejected',
      tx_hash: paid ? String(body.tx).trim().slice(0, 100) : null,
      reason: paid ? null : String(body.reason ?? '').slice(0, 200) || 'rejected by admin',
      decided_at: new Date().toISOString(),
      decided_by: who,
    }).eq('id', id);
    const { pushToUser } = await import('@/lib/push/send');
    void pushToUser(Number(p.tg_id), paid
      ? { title: '✅ Withdrawal sent', body: `$${Number(p.amount)} USDT is on its way to your TRC20 wallet.`, url: '/member/profile', tag: 'algoria-affiliate' }
      : { title: 'Withdrawal update', body: `Your $${Number(p.amount)} request was declined — check the app or message support.`, url: '/member/profile', tag: 'algoria-affiliate' });
    return NextResponse.json({ ok: true });
  }
  if (body.liveAlert) {
    // 📣 ALERTE LIVE : push à tous les membres abonnés — renvoie l'audience vers le stream.
    const { pushToAll } = await import('@/lib/push/send');
    const url = process.env.NEXT_PUBLIC_TIKTOK_URL ?? process.env.NEXT_PUBLIC_TELEGRAM_URL ?? '/member/live';
    const sent = await pushToAll({ title: '🔴 ALGORIA IS LIVE', body: 'The AI is trading live right now — come watch.', url, tag: 'algoria-live' });
    return NextResponse.json({ sent });
  }
  // ===== 📣 CAMPAGNE ONE-SHOT aux PROSPECTS (31/07 — opération dernier jour du mois) : DM du bot +
  // push, à tous les membres SANS aucun dépôt (onboarding / pending_copier). Les déposants sont exclus
  // d'office : une offre de premier dépôt ne les concerne pas et les spammer coûte de la confiance.
  // dryRun = compte l'audience sans rien envoyer (le bouton l'appelle AVANT de demander confirmation).
  // Chaque envoi est tracé en kind='nudge' → visible dans BOT ACTIVITY, et sert de garde anti-doublon
  // (une même campagne n'est pas renvoyée deux fois à la même personne le même jour).
  if (body.offerBlast) {
    const { text, title, pushBody, url, dryRun } = body.offerBlast;
    if (!dryRun && (!text || text.trim().length < 10)) return NextResponse.json({ error: 'message text required' }, { status: 400 });
    const [{ data: mem }, { data: dep }, { data: sent }] = await Promise.all([
      db.from('members').select('tg_id,member_no,status').in('status', ['onboarding', 'pending_copier']),
      db.from('member_actions').select('tg_id').eq('kind', 'deposit'),
      // déjà touchés par CETTE campagne aujourd'hui (anti double-envoi si l'admin reclique)
      db.from('member_actions').select('tg_id').eq('kind', 'nudge').eq('done_by', 'admin (offer blast)')
        .gte('created_at', new Date(Date.now() - 12 * 3_600_000).toISOString()),
    ]);
    const funded = new Set((dep ?? []).map((d) => Number(d.tg_id)));
    const already = new Set((sent ?? []).map((d) => Number(d.tg_id)));
    const targets = (mem ?? []).filter((m) => !funded.has(Number(m.tg_id)) && !already.has(Number(m.tg_id)));
    if (dryRun) return NextResponse.json({ audience: targets.length, alreadySent: already.size });

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const { pushToUser } = await import('@/lib/push/send');
    let dmOk = 0, pushOk = 0;
    for (const m of targets) {
      const tgId = Number(m.tg_id);
      let dm = false;
      if (token) {
        // le DM échoue (403) si la personne n'a jamais ouvert le chat du bot — normal, le push prend le relais
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000),
          body: JSON.stringify({ chat_id: tgId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        }).catch(() => null);
        dm = !!(r && ((await r.json().catch(() => ({}))) as { ok?: boolean }).ok);
      }
      const push = title ? await pushToUser(tgId, { title, body: pushBody ?? '', url: url ?? '/member/onboarding', tag: 'algoria-offer' }).catch(() => 0) : 0;
      if (dm) dmOk++;
      if (push) pushOk++;
      await db.from('member_actions').insert({
        tg_id: tgId, member_no: m.member_no ?? null, kind: 'nudge', status: 'done', done_by: 'admin (offer blast)',
        detail: { text, dm: dm ? 'ok' : 'no-chat', push: push ? 'ok' : 'none' } as never,
      });
    }
    return NextResponse.json({ audience: targets.length, dmOk, pushOk });
  }
  if (body.reveal) {
    // RÉVÉLATION des identifiants MT5 (admin uniquement) : nécessaire pour brancher le compte dans STH.
    // Déchiffré à la volée côté serveur, jamais stocké en clair ; la révélation est HORODATÉE sur l'action (audit).
    // Carte portant account_id (multi-comptes) → identifiants du COMPTE SUPPLÉMENTAIRE, pas de la fiche membre.
    const { data: act } = await db.from('member_actions').select('id,tg_id,detail').eq('id', body.reveal).limit(1);
    if (!act?.length) return NextResponse.json({ error: 'action not found' }, { status: 404 });
    const actAccountId = (act[0].detail as { account_id?: string } | null)?.account_id;
    let m: Array<{ mt5_login: unknown; mt5_server: unknown; mt5_password_enc: unknown }> | null;
    if (actAccountId) {
      const { data } = await (db as any).from('member_accounts').select('mt5_login,mt5_server,mt5_password_enc').eq('id', String(actAccountId)).limit(1) as { data: Array<{ mt5_login: unknown; mt5_server: unknown; mt5_password_enc: unknown }> | null };
      m = data;
    } else {
      const { data } = await db.from('members').select('mt5_login,mt5_server,mt5_password_enc').eq('tg_id', act[0].tg_id).limit(1);
      m = data;
    }
    if (!m?.[0]?.mt5_password_enc) return NextResponse.json({ error: 'no credentials on file' }, { status: 404 });
    let password: string;
    try {
      password = decryptSecret(m[0].mt5_password_enc as string);
    } catch {
      return NextResponse.json({ error: 'decryption failed (MEMBER_CREDS_KEY changed?)' }, { status: 500 });
    }
    const detail = { ...((act[0].detail as Record<string, unknown>) ?? {}), revealed_at: new Date().toISOString(), revealed_by: s.username ?? String(s.tgId) };
    await db.from('member_actions').update({ detail: detail as never }).eq('id', body.reveal);
    return NextResponse.json({ login: m[0].mt5_login, server: m[0].mt5_server, password });
  }
  if (body.revealMember) {
    // RÉVÉLATION des identifiants À TOUT MOMENT (par membre, pas seulement à la validation) : le support
    // en a besoin pour rebrancher le compte ailleurs sans redemander au client. Admin only, tracé en timeline.
    const { data: m } = await db.from('members').select('member_no,tg_id,mt5_login,mt5_server,mt5_password_enc').eq('tg_id', body.revealMember).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    if (!m[0].mt5_password_enc) return NextResponse.json({ error: 'no credentials on file' }, { status: 404 });
    let password: string;
    try {
      password = decryptSecret(m[0].mt5_password_enc as string);
    } catch {
      return NextResponse.json({ error: 'decryption failed (MEMBER_CREDS_KEY changed?)' }, { status: 500 });
    }
    await db.from('member_actions').insert({ tg_id: m[0].tg_id, member_no: m[0].member_no, kind: 'note', status: 'done', done_by: who, detail: { text: `🔑 credentials revealed by ${who}` } as never });
    return NextResponse.json({ login: m[0].mt5_login, server: m[0].mt5_server, password });
  }
  if (body.revealAccount) {
    // RÉVÉLATION des identifiants d'un COMPTE SUPPLÉMENTAIRE (multi-stratégies) — même contrat que revealMember.
    const { data: acc } = await (db as any).from('member_accounts').select('tg_id,member_no,account_no,mt5_login,mt5_server,mt5_password_enc').eq('id', String(body.revealAccount)).limit(1) as { data: Array<Record<string, unknown>> | null };
    if (!acc?.length) return NextResponse.json({ error: 'account not found' }, { status: 404 });
    if (!acc[0].mt5_password_enc) return NextResponse.json({ error: 'no credentials on file' }, { status: 404 });
    let password: string;
    try {
      password = decryptSecret(acc[0].mt5_password_enc as string);
    } catch {
      return NextResponse.json({ error: 'decryption failed (MEMBER_CREDS_KEY changed?)' }, { status: 500 });
    }
    await db.from('member_actions').insert({ tg_id: Number(acc[0].tg_id), member_no: acc[0].member_no != null ? Number(acc[0].member_no) : null, kind: 'note', status: 'done', done_by: who, detail: { text: `🔑 credentials revealed by ${who} (account #${acc[0].account_no})` } as never });
    return NextResponse.json({ login: acc[0].mt5_login, server: acc[0].mt5_server, password });
  }
  // ===== 🚫 BAN / UNBAN (31/07 — un concurrent s'était créé un compte pour capturer l'app et la copier).
  // Coupe TOUT : la session en cours (banned_at relu à chaque requête), la reconnexion (aucune session
  // n'est posée), et la copie côté STH. Retire aussi de la whitelist VIP — sinon un banni garderait
  // l'app déverrouillée. Réversible : `unban` remet tout à zéro sauf la copie (à rebrancher à la main).
  if (body.ban) {
    const { tg_id, reason, undo } = body.ban;
    const { data: m } = await db.from('members').select('member_no,tg_id,tg_username').eq('tg_id', tg_id).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    const uname = String(m[0].tg_username ?? '').trim().toLowerCase();
    if (undo) {
      await (db as any).from('members').update({ banned_at: null, banned_reason: null, updated_at: new Date().toISOString() }).eq('tg_id', tg_id);
      await db.from('member_actions').insert({ tg_id, member_no: m[0].member_no, kind: 'note', status: 'done', done_by: who, detail: { text: '✅ ban lifted — access restored (copy must be reconnected manually if needed)' } as never });
      return NextResponse.json({ ok: true, banned: false });
    }
    await (db as any).from('members').update({ banned_at: new Date().toISOString(), banned_reason: String(reason ?? '').slice(0, 300) || null, status: 'paused', updated_at: new Date().toISOString() }).eq('tg_id', tg_id);
    if (uname) await db.from('member_whitelist').delete().eq('username', uname); // sinon l'app resterait déverrouillée
    let discLine = 'no copier link to cut';
    if (sthReady()) {
      const d = await sthDisconnect(String(tg_id));
      discLine = d.ok ? 'copier disconnected via STH' : `STH disconnect failed (${d.errorMessage}) — check manually`;
    }
    await db.from('member_actions').insert({
      tg_id, member_no: m[0].member_no, kind: 'note', status: 'done', done_by: who,
      detail: { text: `🚫 BANNED${reason ? ` — ${String(reason).slice(0, 200)}` : ''} · ${discLine} · removed from VIP whitelist. Also kick them from the Telegram channel (manual).` } as never,
    });
    return NextResponse.json({ ok: true, banned: true });
  }
  if (body.offboard) {
    // OFF-BOARD : le client est parti (retrait). Statut → paused (sort du compte "actifs", fiche + creds conservés),
    // déconnexion copieur (via STH si configuré, sinon empilée dans la file support), et note timeline explicite.
    const { data: m } = await db.from('members').select('member_no,tg_id').eq('tg_id', body.offboard).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    await db.from('members').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('tg_id', body.offboard);
    let discLine = 'copier disconnect queued for STH';
    if (sthReady()) {
      const d = await sthDisconnect(String(m[0].tg_id));
      if (d.ok) discLine = 'copier disconnected via STH';
      else {
        discLine = `STH disconnect failed (${d.errorMessage}) — do it manually`;
        await db.from('member_actions').insert({ tg_id: m[0].tg_id, member_no: m[0].member_no, kind: 'disconnect', status: 'pending', done_by: who, detail: { reason: `off-board (STH failed: ${d.errorMessage})` } as never });
      }
    } else {
      await db.from('member_actions').insert({ tg_id: m[0].tg_id, member_no: m[0].member_no, kind: 'disconnect', status: 'pending', done_by: who, detail: { reason: 'off-board (client left)' } as never });
    }
    await db.from('member_actions').insert({ tg_id: m[0].tg_id, member_no: m[0].member_no, kind: 'note', status: 'done', done_by: who, detail: { text: `⛔ off-boarded — client left · ${discLine}. Also remove them from the VIP Telegram channel.` } as never });
    return NextResponse.json({ ok: true });
  }
  if (body.connectSth) {
    // CONNEXION AUTO via STH (option B) : le support clique « connect » sur la demande → on branche le compte
    // dans le copieur (connect + join master) SANS ressaisie. Succès → le front enchaîne `done` (passage LIVE).
    // MULTI-COMPTES : une carte portant account_id branche le compte SUPPLÉMENTAIRE (member_accounts) —
    // identifiants du compte, userId STH distinct "{tg_id}-{account_no}" (chaque compte est un client STH à part).
    if (!sthReady()) return NextResponse.json({ error: 'STH not configured — set STH_PARTNER_LICENSE (Vercel)' }, { status: 400 });
    const { data: act } = await db.from('member_actions').select('id,tg_id,detail').eq('id', body.connectSth).eq('kind', 'connect').limit(1);
    if (!act?.length) return NextResponse.json({ error: 'connect request not found (already processed?)' }, { status: 404 });
    const detail = (act[0].detail as Record<string, unknown>) ?? {};
    const accountId = detail.account_id ? String(detail.account_id) : null;
    let creds: { login: unknown; server: unknown; enc: unknown; sthUser: string; strategy: number; memberNo: number | null };
    if (accountId) {
      const { data: acc } = await (db as any).from('member_accounts').select('account_no,member_no,mt5_login,mt5_server,mt5_password_enc,strategy').eq('id', accountId).limit(1) as { data: Array<Record<string, unknown>> | null };
      if (!acc?.[0]?.mt5_password_enc) return NextResponse.json({ error: 'no credentials on file for this extra account' }, { status: 404 });
      creds = { login: acc[0].mt5_login, server: acc[0].mt5_server, enc: acc[0].mt5_password_enc, sthUser: `${act[0].tg_id}-${acc[0].account_no}`, strategy: Number(acc[0].strategy) || 2, memberNo: acc[0].member_no != null ? Number(acc[0].member_no) : null };
    } else {
      const { data: m } = await db.from('members').select('member_no,tg_id,mt5_login,mt5_server,mt5_password_enc,risk_tier,strategy').eq('tg_id', act[0].tg_id).limit(1);
      if (!m?.[0]?.mt5_password_enc) return NextResponse.json({ error: 'no credentials on file' }, { status: 404 });
      creds = { login: m[0].mt5_login, server: m[0].mt5_server, enc: m[0].mt5_password_enc, sthUser: String(m[0].tg_id), strategy: Number(detail.strategy ?? (m[0] as { strategy?: number }).strategy ?? 2) || 2, memberNo: m[0].member_no != null ? Number(m[0].member_no) : null };
    }
    if (!creds.login || !creds.server) return NextResponse.json({ error: 'missing MT5 login/server' }, { status: 400 });
    let password: string;
    try {
      password = decryptSecret(creds.enc as string);
    } catch {
      return NextResponse.json({ error: 'decryption failed (MEMBER_CREDS_KEY changed?)' }, { status: 500 });
    }
    const lots = Number(detail.lot ?? 0.01) || 0.01;
    const r = await sthConnectAndJoin({ userId: creds.sthUser, login: creds.login as number, password, server: String(creds.server), isMt4: Boolean(detail.is_mt4), lots, strategy: creds.strategy });
    if (!r.ok) return NextResponse.json({ error: `STH: ${r.error}` }, { status: 400 });
    await db.from('member_actions').insert({ tg_id: act[0].tg_id, member_no: creds.memberNo, kind: 'note', status: 'done', done_by: who, detail: { text: `🔗 copier connected via STH (lots ${lots} · S${creds.strategy}${accountId ? ` · account #${detail.account_no}` : ''})` } as never });
    return NextResponse.json({ ok: true });
  }
  if (body.reconnectSth) {
    // RE-CONNEXION directe depuis la FICHE MEMBRE (ex. déconnecté par erreur sur le dashboard STH) — pas
    // besoin d'une carte connect en file : identifiants déjà en base, lot/plateforme repris de sa dernière
    // carte connect (sinon kyc, sinon défauts). Ne touche PAS au statut du membre (déjà live en général).
    if (!sthReady()) return NextResponse.json({ error: 'STH not configured — set STH_PARTNER_LICENSE (Vercel)' }, { status: 400 });
    const { data: m } = await (db as any).from('members').select('member_no,tg_id,mt5_login,mt5_server,mt5_password_enc,risk_tier,strategy,lot').eq('tg_id', body.reconnectSth).limit(1) as { data: Array<Record<string, unknown>> | null };
    if (!m?.[0]?.mt5_password_enc) return NextResponse.json({ error: 'no credentials on file' }, { status: 404 });
    if (!m[0].mt5_login || !m[0].mt5_server) return NextResponse.json({ error: 'missing MT5 login/server' }, { status: 400 });
    let password: string;
    try {
      password = decryptSecret(m[0].mt5_password_enc as string);
    } catch {
      return NextResponse.json({ error: 'decryption failed (MEMBER_CREDS_KEY changed?)' }, { status: 500 });
    }
    const { data: acts } = await db.from('member_actions').select('kind,detail').eq('tg_id', body.reconnectSth).in('kind', ['connect', 'kyc']).order('created_at', { ascending: false }).limit(10);
    const detail = ((acts?.find((a) => a.kind === 'connect') ?? acts?.find((a) => a.kind === 'kyc'))?.detail as Record<string, unknown>) ?? {};
    // le lot CHOISI par le membre (colonne lot) prime sur la vieille carte connect — sinon une reconnexion
    // écraserait silencieusement une taille de copie changée depuis
    const lots = Number(m[0].lot ?? detail.lot ?? 0.01) || 0.01;
    const strategy = Number((m[0] as { strategy?: number }).strategy ?? 2) || 2;
    const r = await sthConnectAndJoin({ userId: String(m[0].tg_id), login: m[0].mt5_login as number, password, server: String(m[0].mt5_server), isMt4: Boolean(detail.is_mt4), lots, strategy });
    if (!r.ok) return NextResponse.json({ error: `STH: ${r.error}` }, { status: 400 });
    await db.from('member_actions').insert({ tg_id: m[0].tg_id, member_no: m[0].member_no, kind: 'note', status: 'done', done_by: who, detail: { text: `🔗 copier RE-connected via STH from the member sheet (lots ${lots} · S${strategy})` } as never });
    return NextResponse.json({ ok: true });
  }
  if (body.setCountry) {
    // PAYS du membre (compta fin de mois + ciblage pubs) — saisie manuelle, chaîne vide = effacer.
    const country = String(body.setCountry.country ?? '').trim().slice(0, 60) || null;
    if (!Number(body.setCountry.tg_id)) return NextResponse.json({ error: 'tg_id required' }, { status: 400 });
    const { error } = await db.from('members').update({ country, updated_at: new Date().toISOString() } as never).eq('tg_id', body.setCountry.tg_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.moveSth) {
    // CHANGEMENT DE STRATÉGIE en un clic : join-master-account déclaratif → le receiver passe sur le master
    // de sa nouvelle stratégie. Le front enchaîne `done` si OK. Membres connectés à la main → erreur explicite.
    if (!sthReady()) return NextResponse.json({ error: 'STH not configured — set STH_PARTNER_LICENSE (Vercel)' }, { status: 400 });
    const { data: act } = await db.from('member_actions').select('id,tg_id,member_no,detail').eq('id', body.moveSth).eq('kind', 'strategy_change').limit(1);
    if (!act?.length) return NextResponse.json({ error: 'strategy change request not found (already processed?)' }, { status: 404 });
    const to = Number((act[0].detail as Record<string, unknown>)?.to ?? 0);
    if (![1, 2, 3].includes(to)) return NextResponse.json({ error: 'invalid target strategy on the card' }, { status: 400 });
    // le lot CHOISI par le membre (colonne lot) prime sur la vieille carte connect
    const { data: mlot } = await (db as any).from('members').select('lot').eq('tg_id', act[0].tg_id).limit(1) as { data: Array<{ lot: number | null }> | null };
    const { data: lastConnect } = await db.from('member_actions').select('detail').eq('tg_id', act[0].tg_id).eq('kind', 'connect').order('created_at', { ascending: false }).limit(1);
    const lots = Number(mlot?.[0]?.lot ?? (lastConnect?.[0]?.detail as Record<string, unknown>)?.lot ?? 0.01) || 0.01;
    const r = await sthMoveMaster(String(act[0].tg_id), to, lots);
    if (!r.ok) return NextResponse.json({ error: `STH: ${r.error}` }, { status: 400 });
    await db.from('member_actions').insert({ tg_id: act[0].tg_id, member_no: act[0].member_no, kind: 'note', status: 'done', done_by: who, detail: { text: `🔀 moved to the S${to} master via STH (lots ${lots})` } as never });
    return NextResponse.json({ ok: true });
  }
  if (body.setLegalName) {
    // CORRIGER LE NOM DU TITULAIRE (03/08) — le membre le saisit lui-même au wizard, et il se trompe :
    // vu aujourd'hui un « VTMarkets » à la place du nom de la personne (#199). Ce champ n'est pas cosmétique,
    // c'est LE pont entre les trois identités d'un client — son pseudo Telegram, son nom sur le compte
    // broker, et la ligne du relevé de commissions. Un nom faux, et on ne retrouve plus son dépôt.
    // On n'écrase rien : on ajoute une nouvelle ligne kyc, et legalNames retient déjà la plus récente.
    // L'historique reste lisible, y compris la saisie d'origine — utile le jour où le broker conteste.
    const tg = Number(body.setLegalName.tg_id) || 0;
    const name = String(body.setLegalName.name ?? '').trim().slice(0, 80);
    if (!tg || name.length < 2) return NextResponse.json({ error: 'tg_id and a real name are required' }, { status: 400 });
    const { data: m } = await db.from('members').select('member_no').eq('tg_id', tg).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    const { error } = await db.from('member_actions').insert({
      tg_id: tg, member_no: m[0].member_no, kind: 'kyc', status: 'done', done_by: who,
      detail: { broker_name: name, corrected_by_support: true } as never,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  // ===== CORRIGER UNE FICHE MEMBRE (03/08) — « fais le tour complet » =====
  // La fiche affichait une dizaine de champs saisis PAR LE MEMBRE au wizard, et pas un seul n'était
  // rattrapable depuis l'admin : broker, login/serveur MT, mot de passe, adresse USDT, parrain, marché,
  // statut, lot, stratégie. Or c'est exactement là que les erreurs arrivent — le membre tape le nom de
  // son broker à la place du sien, se trompe d'un caractère sur le serveur MT (« PUPrime-Live2 » ≠
  // « PUPrime-Live 2 » → le copieur ne démarre jamais), colle une adresse USDT tronquée. Jusqu'ici la
  // seule issue était une requête SQL à la main. Un champ faux et non corrigeable, c'est un client bloqué.
  //
  // TRACE SYSTÉMATIQUE : chaque correction écrit une note de timeline « ancien → nouveau », signée.
  // Le mot de passe fait exception — il est chiffré, jamais journalisé en clair (la note dit juste qu'il
  // a changé). On ne perd donc jamais la saisie d'origine, y compris quand le broker conteste plus tard.
  if (body.editMember) {
    const tg = Number(body.editMember.tg_id) || 0;
    const field = String(body.editMember.field ?? '');
    const raw = body.editMember.value == null ? '' : String(body.editMember.value).trim();
    if (!tg) return NextResponse.json({ error: 'tg_id required' }, { status: 400 });
    const { data: m } = await (db as any).from('members')
      .select('member_no,tg_id,broker,mt5_login,mt5_server,mt5_password_enc,usdt_trc20,referred_by,locale,status,lot,strategy')
      .eq('tg_id', tg).limit(1) as { data: Array<Record<string, unknown>> | null };
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    const cur = m[0];

    const patch: Record<string, unknown> = {};
    let before = String(cur[field] ?? '—');
    let after = raw || '—';

    if (field === 'broker') {
      // clé de broker connue uniquement : c'est elle qui pilote le barème de commission et le message
      // « à vérifier » envoyé au staff. Une clé inventée casserait les deux en silence.
      if (raw && !BROKERS.some((b) => b.key === raw)) return NextResponse.json({ error: `unknown broker key "${raw}"` }, { status: 400 });
      patch.broker = raw || null;
    } else if (field === 'mt5_login') {
      if (raw && !/^\d{4,15}$/.test(raw)) return NextResponse.json({ error: 'MT login must be 4-15 digits' }, { status: 400 });
      patch.mt5_login = raw || null;
    } else if (field === 'mt5_server') {
      // AUCUNE normalisation (pas de trim interne, pas de casse forcée) : STH exige la chaîne EXACTE
      // telle qu'elle apparaît chez le broker. « Corriger » l'espace de « PUPrime-Live 2 » casserait
      // justement le compte qu'on essaie de réparer.
      patch.mt5_server = raw.slice(0, 80) || null;
    } else if (field === 'mt5_password') {
      if (raw.length < 4) return NextResponse.json({ error: 'password too short' }, { status: 400 });
      patch.mt5_password_enc = encryptSecret(raw);
      before = cur.mt5_password_enc ? '(set)' : '—';
      after = '(changed)'; // jamais le mot de passe en clair dans la timeline
    } else if (field === 'usdt_trc20') {
      // TRC20 : commence par T, 34 caractères. Une adresse fausse = un virement dans le vide, irréversible.
      if (raw && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw)) return NextResponse.json({ error: 'not a valid TRC20 address (starts with T, 34 chars)' }, { status: 400 });
      patch.usdt_trc20 = raw || null;
    } else if (field === 'referred_by') {
      // accepte un tg_id, un #numéro de membre ou un @pseudo — l'opérateur ne connaît que le dernier
      let ref: number | null = null;
      if (raw) {
        const key = raw.replace(/^[#@]/, '').toLowerCase();
        const { data: cand } = await db.from('members').select('tg_id,member_no,tg_username').limit(2000);
        const hit = (cand ?? []).find((c) => String(c.tg_id) === key || String(c.member_no) === key || String(c.tg_username ?? '').toLowerCase() === key);
        if (!hit) return NextResponse.json({ error: `no member matches "${raw}" (try #123, @username or the tg id)` }, { status: 400 });
        if (Number(hit.tg_id) === tg) return NextResponse.json({ error: 'a member cannot refer themselves' }, { status: 400 });
        ref = Number(hit.tg_id);
        after = `#${hit.member_no}${hit.tg_username ? ' @' + hit.tg_username : ''}`;
      }
      patch.referred_by = ref;
    } else if (field === 'locale') {
      if (!['en', 'it'].includes(raw)) return NextResponse.json({ error: 'locale must be en or it' }, { status: 400 });
      patch.locale = raw;
      before = String(cur.locale ?? 'en');
    } else if (field === 'status') {
      // Rattrapage MANUEL du statut. Volontairement limité aux 4 états du parcours : un membre coincé en
      // 'pending_copier' alors qu'il copie déjà, ou un 'paused' qui revient, n'avait aucune sortie.
      // Ne touche NI le copieur NI le bannissement (→ OFF-BOARD / BAN / RECONNECT, qui eux agissent chez STH).
      if (!['onboarding', 'pending_copier', 'live', 'paused'].includes(raw)) return NextResponse.json({ error: 'unknown status' }, { status: 400 });
      patch.status = raw;
    } else if (field === 'lot' || field === 'strategy') {
      const n = Number(raw);
      if (field === 'lot') {
        if (!isLotAllowed(n)) return NextResponse.json({ error: `lot must be between 0.01 and ${LOT_MAX.toFixed(2)}, in steps of 0.01` }, { status: 400 });
        patch.lot = n;
      } else {
        if (![1, 2, 3].includes(n)) return NextResponse.json({ error: 'strategy must be 1, 2 or 3' }, { status: 400 });
        patch.strategy = n;
      }
    } else {
      return NextResponse.json({ error: `field "${field}" is not editable` }, { status: 400 });
    }

    const { error } = await (db as any).from('members').update({ ...patch, updated_at: new Date().toISOString() }).eq('tg_id', tg);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // LOT / STRATÉGIE : la colonne n'est PAS la vérité, le copieur l'est. Les changer en base sans le dire
    // à STH créerait exactement le mensonge que l'audit du 03/08 vient de débusquer — une fiche qui affiche
    // S1 · 0.02 pendant que le compte copie toujours S2 · 0.01. On resynchronise donc dans la foulée pour
    // les membres réellement branchés ; l'échec est REMONTÉ, jamais avalé.
    let sync = '';
    if ((field === 'lot' || field === 'strategy') && ['live', 'pending_copier'].includes(String(cur.status)) && sthReady()) {
      const strategy = Number(field === 'strategy' ? patch.strategy : cur.strategy ?? 2) || 2;
      const lots = Number(field === 'lot' ? patch.lot : cur.lot ?? 0.01) || 0.01;
      const r = await sthMoveMaster(String(tg), strategy, lots);
      sync = r.ok ? ` · copier re-synced (S${strategy} · ${lots})` : ` · ⚠ STH sync FAILED (${r.error}) — reconnect from the card`;
    }
    await db.from('member_actions').insert({
      tg_id: tg, member_no: cur.member_no as number | null, kind: 'note', status: 'done', done_by: who,
      detail: { text: `✏️ ${field}: ${before} → ${after}${sync}` } as never,
    });
    return NextResponse.json({ ok: true, sync: sync || null });
  }
  if (body.sthAudit) {
    // AUDIT STH DE MASSE (03/08) — né du cas #7 : une cliente affichée LIVE chez nous, connectée chez STH,
    // mais abonnée à AUCUN master. Elle ne recevait plus un seul trade et personne ne pouvait le voir : rien
    // dans notre base ne distingue « copie active » de « connectée dans le vide ». Seul STH le sait.
    // Ce silence est le pire défaut possible pour un copieur — le membre croit trader, il regarde un écran
    // qui ne bouge plus, et c'est lui qui finit par nous prévenir.
    //
    // PÉRIMÈTRE VOLONTAIREMENT ÉTROIT : uniquement les membres 'live'. Un membre 'paused' est masterless
    // EXPRÈS — le rebrancher serait ouvrir des positions sur son compte contre sa volonté. On ne touche
    // jamais à ça, même en réparation de masse.
    if (!sthReady()) return NextResponse.json({ error: 'STH not configured — set STH_PARTNER_LICENSE (Vercel)' }, { status: 400 });
    const repair = body.sthAudit === 'repair';
    // 'pending_copier' inclus depuis le 03/08 : la cliente #7 etait exactement la — connectee chez STH,
    // abonnee a rien, et invisible du premier audit qui ne regardait que les 'live'. Quelqu'un qui essaie
    // de se (re)brancher est precisement celui qu'on doit rattraper. 'paused' reste hors perimetre.
    const { data: lives } = await (db as any).from('members')
      .select('tg_id,member_no,tg_username,tg_name,status,strategy,lot,mt5_login')
      .in('status', ['live', 'pending_copier']).not('mt5_login', 'is', null).limit(60) as {
        data: Array<{ tg_id: number; member_no: number | null; tg_username: string | null; tg_name: string | null; status: string; strategy: number | null; lot: number | null; mt5_login: string | null }> | null };
    const rows: Array<Record<string, unknown>> = [];
    for (const m of lives ?? []) {
      const st = await sthStatus(String(m.tg_id));
      if (!st.ok) { rows.push({ member_no: m.member_no, name: m.tg_username ? '@' + m.tg_username : m.tg_name, state: 'error', detail: st.errorMessage }); continue; }
      const masters = st.data.masterAccountsList ?? [];
      const connected = st.data.tradingAccountConnected === true;
      if (masters.length > 0) { rows.push({ member_no: m.member_no, name: m.tg_username ? '@' + m.tg_username : m.tg_name, state: 'ok', detail: `${masters.length} master(s)` }); continue; }
      // masterless : orphelin s'il est bel et bien connecté chez STH, inconnu sinon (rien à réparer d'ici)
      if (!connected) { rows.push({ member_no: m.member_no, name: m.tg_username ? '@' + m.tg_username : m.tg_name, state: 'unknown', detail: 'not connected at STH — reconnect from the member card' }); continue; }
      const strategy = Number(m.strategy ?? 2) || 2;
      const lots = Number(m.lot ?? 0.01) || 0.01;
      if (!repair) { rows.push({ member_no: m.member_no, name: m.tg_username ? '@' + m.tg_username : m.tg_name, state: 'orphan', detail: `connected but copying nothing → would rejoin S${strategy} (lots ${lots})` }); continue; }
      const r = await sthMoveMaster(String(m.tg_id), strategy, lots);
      rows.push({ member_no: m.member_no, name: m.tg_username ? '@' + m.tg_username : m.tg_name, state: r.ok ? 'repaired' : 'failed', detail: r.ok ? `rejoined S${strategy} (lots ${lots})` : r.error });
      if (r.ok) {
        // la copie tourne a nouveau : le statut doit dire la verite, sinon la fiche reste bloquee en
        // 'pending_copier' et la carte de la file laisse croire qu'il reste quelque chose a faire.
        if (m.status === 'pending_copier') await (db as any).from('members').update({ status: 'live', updated_at: new Date().toISOString() }).eq('tg_id', m.tg_id);
        await db.from('member_actions').insert({ tg_id: m.tg_id, member_no: m.member_no, kind: 'note', status: 'done', done_by: who, detail: { text: `🔧 STH audit: was connected but copying NO master → rejoined S${strategy} (lots ${lots})${m.status === 'pending_copier' ? ' · status → live' : ''}` } as never });
      }
    }
    const count = (s: string) => rows.filter((r) => r.state === s).length;
    return NextResponse.json({ rows, summary: { checked: rows.length, ok: count('ok'), orphan: count('orphan'), repaired: count('repaired'), failed: count('failed'), unknown: count('unknown'), error: count('error') } });
  }
  if (body.sthStatusCheck) {
    // DIAGNOSTIC STH — la vérité directement depuis leur API : compte MT connecté ? abonné à quels masters ?
    // (les comptes branchés via la Partner API ne s'affichent pas toujours dans le dashboard STH classique)
    if (!sthReady()) return NextResponse.json({ error: 'STH not configured — set STH_PARTNER_LICENSE (Vercel)' }, { status: 400 });
    const st = await sthStatus(String(body.sthStatusCheck));
    if (!st.ok) return NextResponse.json({ error: `STH: ${st.errorMessage}` }, { status: 400 });
    return NextResponse.json({ connected: st.data.tradingAccountConnected === true, masters: st.data.masterAccountsList ?? [], raw: st.data });
  }
  if (body.setupTgWebhook) {
    // 🤖 (RÉ)ENREGISTRER LE WEBHOOK UNIQUE du bot — /api/telegram, qui porte TOUT : login /start, waitlist
    // live (chat_join_request/chat_member) ET la boîte de réception (bot_reply). Telegram n'autorise qu'UN
    // webhook par bot : ce bouton ré-applique toujours la config COMPLÈTE (vécu 26/07 : une URL inbox
    // séparée avait écrasé le webhook et cassé la connexion des membres).
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    if (!token) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not configured (Vercel)' }, { status: 400 });
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.algoria.tech/api/telegram',
        ...(secret ? { secret_token: secret } : {}),
        allowed_updates: ['chat_join_request', 'chat_member', 'message', 'channel_post', 'my_chat_member'],
      }),
    });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!d.ok) return NextResponse.json({ error: `Telegram: ${d.description ?? 'setWebhook failed'}` }, { status: 400 });
    return NextResponse.json({ ok: true, description: d.description ?? 'webhook set' });
  }
  if (body.botDm) {
    // 💬 RÉPONDRE VIA LE BOT — depuis le fil BOT ACTIVITY : la réponse part DANS la conversation que la
    // personne a déjà ouverte avec le bot (le lien t.me/@username ne marche pas quand la personne n'a pas
    // de pseudo public — vécu 27/07 : Telegram s'ouvrait sur rien). Tracée comme message sortant du fil.
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not configured (Vercel)' }, { status: 400 });
    const text = String(body.botDm.text ?? '').trim().slice(0, 1500);
    const dmTg = Number(body.botDm.tg_id);
    if (!text || !dmTg) return NextResponse.json({ error: 'tg_id and text required' }, { status: 400 });
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: dmTg, text, disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { description?: string };
      return NextResponse.json({ error: `Telegram: ${err.description ?? `HTTP ${r.status}`}` }, { status: 400 });
    }
    const { data: mrow } = await db.from('members').select('member_no').eq('tg_id', dmTg).limit(1);
    await db.from('member_actions').insert({ tg_id: dmTg, member_no: mrow?.[0]?.member_no ?? null, kind: 'nudge', status: 'done', done_by: who, detail: { via: 'admin', note: `reply via bot by ${who}`, text } as never });
    return NextResponse.json({ ok: true });
  }
  if (body.nudged) {
    // « ✓ FAIT » de la file RELANCES : Mathieu a envoyé son message/vocal perso → on trace (kind='nudge',
    // via manual) pour sortir le lead de la file 3 jours et mesurer la conversion post-contact.
    const { data: m } = await db.from('members').select('member_no').eq('tg_id', body.nudged).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    await db.from('member_actions').insert({ tg_id: body.nudged, member_no: m[0].member_no, kind: 'nudge', status: 'done', done_by: who, detail: { via: 'manual', note: `personal DM/voice by ${who}` } as never });
    return NextResponse.json({ ok: true });
  }
  if (body.dismiss) {
    // ÉCARTER une carte obsolète (spam pause/resume, doublon…) SANS rien appliquer : contrairement à `done`,
    // aucun effet de bord (un connect dismissé ne passe PAS le membre en live). Tracé pour l'audit.
    const { data: act } = await db.from('member_actions').select('id').eq('id', body.dismiss).eq('status', 'pending').limit(1);
    if (!act?.length) return NextResponse.json({ error: 'action not found (already processed?)' }, { status: 404 });
    await db.from('member_actions').update({ status: 'dismissed', done_at: new Date().toISOString(), done_by: who }).eq('id', body.dismiss);
    return NextResponse.json({ ok: true });
  }
  if (body.done) {
    // Le support a appliqué l'action dans Social Trade Hub → on la clôt ; un 'connect' fait passer le membre en LIVE.
    const { data: act } = await db.from('member_actions').select('id,tg_id,kind,detail').eq('id', body.done).eq('status', 'pending').limit(1);
    if (!act?.length) return NextResponse.json({ error: 'action not found' }, { status: 404 });
    await db.from('member_actions').update({ status: 'done', done_at: new Date().toISOString(), done_by: s.username ?? String(s.tgId) }).eq('id', body.done);
    const doneAccountId = (act[0].detail as { account_id?: string } | null)?.account_id;
    if (act[0].kind === 'connect' && doneAccountId) {
      // COMPTE SUPPLÉMENTAIRE (multi-stratégies) → c'est le COMPTE qui passe live, le membre est déjà live.
      // Pas de commission parrainage ici : elle n'existe que pour la PREMIÈRE activation d'un filleul.
      await (db as any).from('member_accounts').update({ status: 'live', updated_at: new Date().toISOString() }).eq('id', String(doneAccountId));
      const { pushToUser: pushAcc } = await import('@/lib/push/send');
      const stratName = { 1: 'S1 STEADY', 2: 'S2 BALANCED', 3: 'S3 TURBO' }[Number((act[0].detail as { strategy?: number } | null)?.strategy ?? 0)] ?? 'your new strategy';
      void pushAcc(Number(act[0].tg_id), {
        title: `🎉 ${stratName} is LIVE on your second account`,
        body: 'Your new account is connected — you now run multiple Algoria strategies in parallel.',
        url: '/member',
        tag: 'algoria-connect',
      });
    } else if (act[0].kind === 'connect') {
      // .in et non .eq('pending_copier') : un membre repassé en onboarding (rejet puis DONE sur l'ancienne
      // demande) doit quand même passer LIVE — l'ancien garde-fou no-opait en silence et le membre restait
      // grisé alors que le support croyait l'avoir activé. live/paused restent intouchés.
      await db.from('members').update({ status: 'live', updated_at: new Date().toISOString() }).eq('tg_id', act[0].tg_id).in('status', ['pending_copier', 'onboarding']);
      // le passage en LIVE = le VIP : l'app complète se déverrouille toute seule (useMe re-poll) — on
      // prévient le membre pour qu'il ouvre l'app et voie le déblocage immédiatement.
      const { pushToUser: pushLive } = await import('@/lib/push/send');
      void pushLive(Number(act[0].tg_id), {
        title: '🎉 Access unlocked — you are LIVE',
        body: 'Your account is connected. Algoria now trades for you automatically — the full app is open.',
        url: '/member',
        tag: 'algoria-connect',
      });
      // PARRAINAGE : filleul approuvé → commission créée en PENDING (elle ne devient retirable que quand
      // TU confirmes avoir reçu la commission broker — c'est le verrou anti dépôt-retrait éclair).
      // Montant : 10% du dépôt plafonné à 200$, 15%/300$ après le palier 10 (lib/member/affiliate.ts).
      // À cet instant le dépôt VALIDÉ n'est en général pas encore saisi (le prompt vient juste après), on
      // part donc du montant DÉCLARÉ au wizard — et le registre des dépôts corrige le montant dès qu'il
      // connaît le vrai (syncPendingReferralCommission), tant que la commission est encore `pending`.
      const { data: mm } = await db.from('members').select('referred_by,member_no').eq('tg_id', act[0].tg_id).limit(1);
      const refBy = mm?.[0]?.referred_by ? Number(mm[0].referred_by) : null;
      if (refBy) {
        const { data: dupe } = await db.from('referral_commissions').select('id').eq('referred_tg_id', act[0].tg_id).eq('kind', 'referral').limit(1);
        if (!dupe?.length) {
          // le même filleul ne génère JAMAIS deux commissions (re-connect après pause, etc.)
          const { data: prior } = await db.from('referral_commissions').select('id').eq('referrer_tg_id', refBy).eq('kind', 'referral').neq('status', 'canceled');
          const deposit = await knownDepositFor(db, Number(act[0].tg_id));
          await db.from('referral_commissions').insert({
            referrer_tg_id: refBy,
            referred_tg_id: act[0].tg_id,
            kind: 'referral',
            amount: commissionForActivation(prior?.length ?? 0, deposit),
            detail: { referred_member_no: mm?.[0]?.member_no ?? null, deposit_usd: deposit || null } as never,
          });
        }
      }
    }
    const { data: actions } = await db.from('member_actions').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(100);
    return NextResponse.json({ actions: actions ?? [] });
  }
  if (body.add) {
    const username = body.add.replace(/^@/, '').trim().toLowerCase();
    if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
    const { error } = await db.from('member_whitelist').upsert({ username, added_by: s.username ?? String(s.tgId) });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.remove) {
    const { error } = await db.from('member_whitelist').delete().eq('username', body.remove.replace(/^@/, '').trim().toLowerCase());
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: 'add or remove required' }, { status: 400 });
  }
  const { data } = await db.from('member_whitelist').select('*').order('created_at', { ascending: false });
  return NextResponse.json({ whitelist: data ?? [] });
}
