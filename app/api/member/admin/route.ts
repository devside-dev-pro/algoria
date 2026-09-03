import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin, decryptSecret, encryptSecret } from '@/lib/member/server';
import { rejectMessage, rejectReasonOf } from '@/lib/member/rejectReasons';
import { MILESTONES, commissionForActivation } from '@/lib/member/affiliate';
import { sthReady, sthConnectAndJoin, sthDisconnect, sthStatus, sthMoveMaster } from '@/lib/member/sth';
import { BROKERS } from '@/lib/member/brokers';
import { LOT_MAX, isLotAllowed } from '@/lib/member/lots';
import { ctaKeyboard, asLocale } from '@/lib/member/i18n';
import { lotsCleared, ACTIVATION_LOTS } from '@/lib/member/activation';
import { OFFBOARDED, OFFBOARD_REASONS, isOffboardReason, winbackMessage, type OffboardReason } from '@/lib/member/winback';
import { isPermanentTelegramFailure } from '@/lib/member/telegramErrors';

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
let lastChatLookup = 0;
let tgInboxCache: { at: number; on: boolean } | null = null; // état du webhook Telegram, rafraîchi au plus toutes les 10 min
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
  const [wl, members, actions, commsQ, payoutsQ, depositsQ, pushQ, nudgesQ, heartQ, kycQ, spokeQ, rejectedQ, connectedQ, failedDmQ] = await Promise.all([
    db.from('member_whitelist').select('*').order('created_at', { ascending: false }),
    // cast : la colonne country n'est pas dans les types générés (comme edge_health) — le runtime est identique
    allMembers(db),
    db.from('member_actions').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(500), // 100 → 500 (audit 03/09 : la file se tronquait sans le dire) ; pendingTotal dit le vrai nombre
    db.from('referral_commissions').select('*').order('created_at', { ascending: false }).limit(300),
    db.from('referral_payouts').select('*').order('created_at', { ascending: false }).limit(200),
    // REGISTRE DES DÉPÔTS (bilan broker) : lignes saisies par l'admin, kind='deposit' status='done'
    // (jamais dans la file). Stockées dans member_actions — zéro migration, pattern du stash kyc.
    db.from('member_actions').select('*').eq('kind', 'deposit').order('created_at', { ascending: false }).limit(500),
    // ABONNEMENTS PUSH : qui a activé les alertes (au moins 1 appareil). Sert au tableau « qui relancer ».
    db.from('member_push_subs').select('tg_id'),
    // RELANCES (kind='nudge', auto + manuelles) : nourrit la file « RELANCES DU JOUR » (qui a été touché quand).
    // `status='done'` : un envoi ÉCHOUÉ n'est pas un contact. Sans cette garde, un membre que le bot
    // n'a pas pu joindre sortirait de la file pendant 3 jours — on masquerait la personne à rattraper.
    db.from('member_actions').select('tg_id,created_at,done_by').eq('kind', 'nudge').eq('status', 'done').order('created_at', { ascending: false }).limit(500),
    // HEARTBEAT runner : la dernière bougie écrite (BTC 24/7 → toujours attendue) — bandeau rouge si > 20 min.
    db.from('candles').select('time').order('time', { ascending: false }).limit(1),
    // NOMS LÉGAUX (kyc.broker_name, déclarés au wizard) : LE pont entre les 3 identités d'une personne
    // (nom Telegram ≠ @pseudo ≠ nom sur le compte broker) — affiché partout + cherchable dans l'admin.
    db.from('member_actions').select('tg_id,detail,created_at').eq('kind', 'kyc').order('created_at', { ascending: false }).limit(500),
    // QUI A DÉJÀ ÉCRIT AU BOT — sert à trancher « relance » vs « PREMIER CONTACT » dans la file du jour.
    // 196 des 219 personnes de cette file n'ont jamais écrit une ligne : leur envoyer un message de
    // relance (« alors, tu en es où ? ») n'a aucun sens, elles ne savent même pas qui écrit.
    // botActivity ne suffit pas : il est plafonné à 120 lignes et sert l'affichage du fil, pas un test.
    db.from('member_actions').select('tg_id').eq('kind', 'bot_reply').limit(5000),
    // CONNEXIONS REFUSÉES : ces gens-là ne sont pas à relancer mais à RATTRAPER — ils ont essayé.
    db.from('member_actions').select('tg_id').eq('kind', 'connect').eq('status', 'rejected').limit(2000),
    // NUMÉROS DE COMPTE PAR BROKER — l'HISTORIQUE des connexions validées, pas la fiche membre.
    // La fiche ne garde que le DERNIER compte : un membre qui a déposé chez RaiseFX en août puis rouvert
    // chez PU Prime n'a plus nulle part son numéro RaiseFX, alors que c'est lui qui porte la commission.
    // Mesuré : 4 dépôts sur ~59 sont dans ce cas. Sans cette requête, l'export sortait pour eux un numéro
    // appartenant à un AUTRE broker — pire qu'une case vide, puisqu'on part le chercher pour rien.
    db.from('member_actions').select('tg_id,detail').eq('kind', 'connect').eq('status', 'done').limit(2000),
    // ENVOIS REFUSÉS PAR TELEGRAM — sert à retirer de la file de relances les gens que le bot ne peut
    // plus joindre. On remonte l'erreur ET la date : un blocage n'est PAS éternel (on peut débloquer un
    // bot), donc c'est la chronologie qui tranche, pas la simple existence d'un échec passé.
    db.from('member_actions').select('tg_id,detail,created_at').eq('kind', 'nudge').eq('status', 'failed').limit(2000),
  ]);
  // COMPTES SUPPLÉMENTAIRES (multi-stratégies) — affichés sur la fiche membre (broker + stratégie + statut)
  const { data: extraAccounts } = await (db as any).from('member_accounts')
    .select('id,tg_id,member_no,account_no,broker,strategy,status,mt5_login,mt5_server,declared_deposit,holder_name,created_at')
    .order('created_at', { ascending: false }).limit(300) as { data: Array<Record<string, unknown>> | null };
  // 🤖 BOT ACTIVITY : fil unifié envoyé (nudge, avec le texte du DM) / reçu (bot_reply) — le plus récent d'abord
  // `status` remonte : le fil doit distinguer un DM PARTI d'un DM REFUSÉ par Telegram — sans lui,
  // une ligne « → auto-nudge sent » s'afficherait pour un message que personne n'a jamais reçu.
  const { data: botActivity } = await db.from('member_actions').select('id,tg_id,member_no,kind,detail,created_at,done_by,status')
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
  if (missing.length && process.env.TELEGRAM_BOT_TOKEN && Date.now() - lastChatLookup >= 10 * 60_000) {
    lastChatLookup = Date.now(); // un canal sans titre chez Telegram restait interrogé à CHAQUE GET (8 appels × 3,5 s)
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
  // MÉMORISÉ 10 MIN (audit 03/09 §3) : ce GET tourne toutes les 30 s et appelait Telegram à chaque fois, avec
  // jusqu'à 3 s d'attente bloquante — le webhook ne change pas toutes les 30 secondes.
  let tgInboxOn = tgInboxCache && Date.now() - tgInboxCache.at < 10 * 60_000 ? tgInboxCache.on : false;
  if (!tgInboxCache || Date.now() - tgInboxCache.at >= 10 * 60_000) {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token) {
        const wh = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(3000) });
        const wd = (await wh.json().catch(() => ({}))) as { result?: { url?: string } };
        tgInboxOn = String(wd.result?.url ?? '').includes('/api/telegram');
        tgInboxCache = { at: Date.now(), on: tgInboxOn };
      }
    } catch { /* Telegram injoignable → on laisse le bouton visible */ }
  }
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
  // (tg_id, broker) → numéro de compte, construit sur l'historique des connexions VALIDÉES. Les cartes
  // sont parcourues de la plus ancienne à la plus récente, donc la dernière connexion validée chez un
  // broker donné gagne — c'est celle qui correspond au compte encore ouvert là-bas.
  const brokerLogins: Record<string, string> = {};
  for (const c of (connectedQ.data ?? []) as Array<{ tg_id: number; detail: { broker?: string; login?: string } | null }>) {
    const b = String(c.detail?.broker ?? '');
    const login = String(c.detail?.login ?? '');
    if (b && login) brokerLogins[`${c.tg_id}|${b}`] = login;
  }
  // ── QUI EST INJOIGNABLE PAR LE BOT ──────────────────────────────────────────────────────────────────
  // Un blocage n'est pas irréversible : la personne peut débloquer le bot, ou taper START. La CHRONOLOGIE
  // tranche donc, jamais la simple existence d'un échec passé — un envoi réussi ou une réponse reçue APRÈS
  // le dernier refus prouve que le canal est rouvert, et la personne doit alors retrouver sa place dans la
  // file. Sans cette comparaison, un blocage d'un jour condamnait un prospect pour de bon.
  const lastPermanentFail = new Map<number, number>();
  for (const f of (failedDmQ.data ?? []) as Array<{ tg_id: number | null; detail: { error?: string } | null; created_at: string }>) {
    if (!isPermanentTelegramFailure(f.detail?.error)) continue; // un raté réseau ne condamne personne
    const t = Number(f.tg_id); const at = Date.parse(f.created_at);
    if (t && (lastPermanentFail.get(t) ?? 0) < at) lastPermanentFail.set(t, at);
  }
  const lastReachable = new Map<number, number>(); // dernière preuve que le canal fonctionne
  for (const n of (nudgesQ.data ?? []) as Array<{ tg_id: number | null; created_at: string }>) {
    const t = Number(n.tg_id); const at = Date.parse(n.created_at);
    if (t && (lastReachable.get(t) ?? 0) < at) lastReachable.set(t, at);
  }
  for (const r of (botActivity ?? []) as Array<{ tg_id: number | null; kind: string; created_at: string }>) {
    if (r.kind !== 'bot_reply') continue; // il nous a ÉCRIT : le canal est forcément ouvert
    const t = Number(r.tg_id); const at = Date.parse(r.created_at);
    if (t && (lastReachable.get(t) ?? 0) < at) lastReachable.set(t, at);
  }
  const botBlocked = [...lastPermanentFail.entries()]
    .filter(([tg, at]) => (lastReachable.get(tg) ?? 0) < at)
    .map(([tg]) => tg);
  const { count: pendingTotal } = await db.from('member_actions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  return NextResponse.json({ pendingTotal: pendingTotal ?? (actions.data ?? []).length, whitelist: wl.data ?? [], members: members.data ?? [], actions: actions.data ?? [], affiliate, deposits: depositsQ.data ?? [], pushTgIds, nudges: nudgesQ.data ?? [], brokerLogins, botBlocked, runnerLastSeen: heartQ.data?.[0]?.time != null ? Number(heartQ.data[0].time) : null, legalNames, extraAccounts: extraAccounts ?? [], botActivity: botActivity ?? [], tgInboxOn, joinSources, tgChats,
    // segmentation de la file du jour : qui a déjà écrit (→ vraie relance) et qui s'est fait refuser (→ rattrapage)
    spokeTgIds: [...new Set((spokeQ.data ?? []).map((r: { tg_id: number | null }) => Number(r.tg_id)).filter(Boolean))],
    rejectedTgIds: [...new Set((rejectedQ.data ?? []).map((r: { tg_id: number | null }) => Number(r.tg_id)).filter(Boolean))],
  });
}

export async function POST(req: NextRequest) {
  const s = guard(req);
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    add?: string; remove?: string; done?: string; reveal?: string; liveAlert?: boolean;
    confirmCommission?: string; cancelCommission?: string; payoutPaid?: string; payoutReject?: string; reason?: string; tx?: string;
    rejectConnect?: string; code?: string;
    waitBroker?: string; // carte bloquée chez le broker (rattachement affilié) — bascule, voir plus bas
    addDeposit?: { tg_id: number; broker?: string; amount: number; commission?: number; date?: string; note?: string };
    updateDeposit?: { id: string; amount?: number; commission?: number; comStatus?: string; note?: string; broker?: string; date?: string; bookedYm?: string | null };
    deleteDeposit?: string;
    customPush?: { title: string; body: string; url?: string; audience: string; tg_id?: number };
    memberDetail?: number; addNote?: { tg_id: number; text: string }; deleteNote?: string;
    setLegalName?: { tg_id: number; name: string }; revealMember?: number; revealAccount?: string; offboard?: number; connectSth?: string; reconnectSth?: number; sthStatusCheck?: number; sthAudit?: string; moveSth?: string; dismiss?: string; nudged?: number; lotsOk?: string; lots?: number; notify?: boolean; channelPost?: { chatId: string; text: string; buttonText?: string; buttonUrl?: string };
    setupTgWebhook?: boolean; botDm?: { tg_id: number; text: string; cta?: boolean };
    botBroadcast?: { audience: 'ex_s1' | 'live'; text: string; tag: string; cta?: boolean };
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
    // Une push individuelle est une RELANCE : elle s'écrit comme telle (audit 03/09 §3.2 : le 🔔 NUDGE de
    // TOOLS n'écrivait rien, donc invisible du cooldown de 3 j et de BOT ACTIVITY — deux files, deux mémoires).
    if (p.audience === 'user' && sent) {
      const { data: mn } = await db.from('members').select('member_no').eq('tg_id', Number(p.tg_id)).limit(1);
      await db.from('member_actions').insert({ tg_id: Number(p.tg_id), member_no: mn?.[0]?.member_no ?? null, kind: 'nudge', status: 'done', done_by: `${who} (push)`, detail: { via: 'admin', note: `push from TOOLS: ${title}`, push: sent } as never });
    }
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

  // ===== EN ATTENTE DU BROKER (17/08/2026) ==============================================================
  // Un cas fréquent et lent : la personne avait DÉJÀ un compte chez le broker, a déposé dessus, mais son
  // compte n'est pas rattaché à notre numéro d'affilié — il n'apparaît donc pas dans le dashboard
  // partenaire. Seul le TITULAIRE peut demander le rattachement au support du broker. Le délai n'est ni
  // celui du membre ni le nôtre : il est chez le broker, et il dure des jours.
  //
  // La carte doit RESTER en attente (le travail n'est pas fait), mais elle ne doit plus se lire comme
  // « oubliée ». Sans cet état, une carte bloquée depuis cinq jours est indistinguable d'une carte jamais
  // regardée : la file perd son sens, et la surveillance a alerté Mathieu sur une carte qu'il avait déjà
  // traitée. On marque donc l'attente dans `detail` — pas de nouveau statut, pas de migration, et la carte
  // continue d'offrir CONNECT et REJECT quand la réponse du broker arrive.
  if (body.waitBroker) {
    const { data: rows } = await db.from('member_actions').select('*').eq('id', body.waitBroker).eq('status', 'pending').limit(1);
    const act = rows?.[0];
    if (!act) return NextResponse.json({ error: 'card not found (already processed?)' }, { status: 404 });
    const cur = (act.detail as Record<string, unknown> | null) ?? {};
    // second appel sur une carte déjà marquée = on lève l'attente (le broker a répondu)
    const already = (cur as { waiting_broker?: unknown }).waiting_broker != null;
    const note = String(body.reason ?? '').slice(0, 200);
    const next = { ...cur };
    if (already) delete (next as { waiting_broker?: unknown }).waiting_broker;
    else (next as { waiting_broker?: unknown }).waiting_broker = { since: new Date().toISOString(), by: who, note: note || null };
    const { error } = await db.from('member_actions').update({ detail: next as never }).eq('id', act.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, waiting: !already });
  }

  // ===== REFUSER une demande de connexion (vérification broker échouée) — SANS bloquer le membre :
  // il repasse en onboarding à l'étape MT5, voit la raison dans le wizard, corrige et re-soumet.
  if (body.rejectConnect) {
    const { data: rows } = await db.from('member_actions').select('*').eq('id', body.rejectConnect).eq('status', 'pending').limit(1);
    const act = rows?.[0];
    if (!act || act.kind !== 'connect') return NextResponse.json({ error: 'connect request not found (already processed?)' }, { status: 404 });
    // MOTIF CODÉ (03/09) : `code` vient de la liste fermée (lib/member/rejectReasons.ts) ; le texte libre ne
    // sert qu'à « other ». Le membre lit le motif dans sa langue, avec la correction attendue.
    const code = rejectReasonOf(String(body.code ?? '')) ? String(body.code) : 'other';
    const reason = rejectMessage(code, String(body.reason ?? '').slice(0, 200), 'en');
    await db.from('member_actions').update({
      status: 'rejected',
      done_at: new Date().toISOString(),
      done_by: who,
      detail: { ...(act.detail as Record<string, unknown> | null ?? {}), reject_code: code, reject_reason: reason } as never,
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
      db.from('members').select('tg_id,member_no,status,locale').in('status', ['onboarding', 'pending_copier']),
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
        // BOUTONS D'ACTION (24/08) : cette campagne est la plus commerciale de toutes — elle vante un code
        // bonus à des prospects qui n'ont pas déposé — et elle partait sans le moindre lien. On y met les
        // mêmes trois portes que sur les autres relances, dans la langue du destinataire. L'app pointe sur
        // l'onboarding, cohérent avec la cible du push juste en dessous.
        // ⚠️ `url` peut être ABSOLUE — le composer accepte '/chemin' comme 'https://…' (voir customPush).
        // ctaKeyboard attend un CHEMIN qu'elle préfixe par APP_URL : lui passer une URL absolue produirait
        // « https://app.algoria.tech/https://… », un bouton mort. On ne retient donc que la forme chemin.
        const offerPath = typeof url === 'string' && url.startsWith('/') ? url : '/member/onboarding';
        const offerMarkup = ctaKeyboard(asLocale((m as { locale?: string }).locale), offerPath);
        // le DM échoue (403) si la personne n'a jamais ouvert le chat du bot — normal, le push prend le relais
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000),
          body: JSON.stringify({ chat_id: tgId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: offerMarkup }),
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
    // OFF-BOARD : le client est parti (retrait). Statut → 'offboarded', déconnexion copieur (via STH si
    // configuré, sinon empilée dans la file support), note timeline, ET un message au membre avec sa porte
    // de retour.
    //
    // ── 'offboarded' ET NON PLUS 'paused' (25/08/2026) ────────────────────────────────────────────────
    // 'paused' est le statut d'un membre qui a mis SA copie en pause lui-même, et c'est exactement celui
    // qui affiche « ▶ RESUME COPYING » dans son app. Un membre off-boardé y voyait donc un bouton capable
    // de le rebrancher au copieur en un geste, sans redéposer un dollar. Le statut dédié sort de tous les
    // tests `['live','paused']` de l'app et de l'API : le verrou vient de la structure, pas d'une garde.
    //
    // ── ET ON LUI ÉCRIT ──────────────────────────────────────────────────────────────────────────────
    // Avant, off-boarder c'était perdre quelqu'un en silence : la personne découvrait son accès mort sans
    // savoir pourquoi et sans chemin de retour. Sur 15 off-boards, un seul membre est revenu — de sa
    // propre initiative. Le message ne reproche rien (retirer son argent est un droit), il explique la
    // mécanique et il ouvre la porte.
    const { data: m } = await db.from('members').select('member_no,tg_id,tg_name,locale').eq('tg_id', body.offboard).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    const reason: OffboardReason = isOffboardReason(body.reason) ? body.reason : 'withdrawal';
    await db.from('members').update({ status: OFFBOARDED, updated_at: new Date().toISOString() }).eq('tg_id', body.offboard);
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
    // MESSAGE AU MEMBRE — le cœur du process de récupération. L'échec d'envoi ne fait PAS échouer
    // l'off-board : le débranchement du copieur est la partie qui ne peut pas attendre, et un membre
    // injoignable (bot bloqué, compte supprimé) ne doit pas laisser un compte branché derrière lui. On
    // trace ce qui s'est passé dans les deux cas, pour que « prévenu ou pas » soit une question à laquelle
    // la fiche répond.
    let dmLine = 'member not notified (notify off)';
    if (body.notify !== false) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) dmLine = 'member NOT notified — TELEGRAM_BOT_TOKEN missing';
      else {
        const loc = asLocale((m[0] as { locale?: string }).locale);
        const text = winbackMessage(reason, (m[0] as { tg_name?: string }).tg_name ?? null, loc);
        try {
          const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            // le bouton app pointe sur l'écran de RÉCUPÉRATION, pas sur l'accueil : un membre off-boardé
            // qui atterrit sur un dashboard verrouillé n'y trouve aucune action, et repart.
            body: JSON.stringify({ chat_id: Number(m[0].tg_id), text, disable_web_page_preview: true, reply_markup: ctaKeyboard(loc, '/member/recover') }),
          });
          if (r.ok) {
            dmLine = 'member notified with a recovery link';
            await db.from('member_actions').insert({ tg_id: m[0].tg_id, member_no: m[0].member_no, kind: 'nudge', status: 'done', done_by: who, detail: { via: 'offboard', reason, text } as never });
          } else {
            const err = (await r.json().catch(() => ({}))) as { description?: string };
            dmLine = `member NOT notified (${err.description ?? `HTTP ${r.status}`})`;
            await db.from('member_actions').insert({ tg_id: m[0].tg_id, member_no: m[0].member_no, kind: 'nudge', status: 'failed', done_by: who, detail: { via: 'offboard', reason, error: err.description ?? `HTTP ${r.status}`, text } as never });
          }
        } catch (e) {
          dmLine = `member NOT notified (${(e as { message?: string })?.message ?? 'send failed'})`;
        }
      }
    }
    await db.from('member_actions').insert({ tg_id: m[0].tg_id, member_no: m[0].member_no, kind: 'note', status: 'done', done_by: who, detail: { text: `⛔ off-boarded — ${OFFBOARD_REASONS[reason].admin} · ${discLine} · ${dmLine}. Also remove them from the VIP Telegram channel.` } as never });
    return NextResponse.json({ ok: true, notified: dmLine });
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
    // ⚠️ LE VERROU DES LOTS — il est ICI, côté serveur, et pas seulement sur le bouton. Un bouton grisé
    // n'est qu'une suggestion : il suffit d'un onglet resté ouvert avant la validation pour le contourner.
    // Sans volume validé, le copieur ne se branche pas. C'est le seul moment du tunnel où le membre a une
    // raison forte de coopérer — il veut être connecté — donc c'est là que le contrôle doit vivre.
    if (!lotsCleared(detail)) {
      return NextResponse.json({ error: `activation lots not validated — check the partner dashboard for ${ACTIVATION_LOTS} lot traded, then hit ✓ LOTS (or force it with a written reason)` }, { status: 409 });
    }
    const accountId = detail.account_id ? String(detail.account_id) : null;
    let creds: { login: unknown; server: unknown; enc: unknown; sthUser: string; strategy: number; memberNo: number | null };
    let memberLot: number | null = null; // le lot CHOISI par le membre (fiche) — la carte porte un 0.01 écrit en dur à la soumission (audit 03/09 §2.9)
    if (accountId) {
      const { data: acc } = await (db as any).from('member_accounts').select('account_no,member_no,mt5_login,mt5_server,mt5_password_enc,strategy').eq('id', accountId).limit(1) as { data: Array<Record<string, unknown>> | null };
      if (!acc?.[0]?.mt5_password_enc) return NextResponse.json({ error: 'no credentials on file for this extra account' }, { status: 404 });
      creds = { login: acc[0].mt5_login, server: acc[0].mt5_server, enc: acc[0].mt5_password_enc, sthUser: `${act[0].tg_id}-${acc[0].account_no}`, strategy: Number(acc[0].strategy) || 2, memberNo: acc[0].member_no != null ? Number(acc[0].member_no) : null };
    } else {
      const { data: m } = await db.from('members').select('member_no,tg_id,mt5_login,mt5_server,mt5_password_enc,risk_tier,strategy,lot').eq('tg_id', act[0].tg_id).limit(1);
      if (!m?.[0]?.mt5_password_enc) return NextResponse.json({ error: 'no credentials on file' }, { status: 404 });
      memberLot = Number((m[0] as { lot?: number | string | null }).lot) || null;
      creds = { login: m[0].mt5_login, server: m[0].mt5_server, enc: m[0].mt5_password_enc, sthUser: String(m[0].tg_id), strategy: Number(detail.strategy ?? (m[0] as { strategy?: number }).strategy ?? 2) || 2, memberNo: m[0].member_no != null ? Number(m[0].member_no) : null };
    }
    if (!creds.login || !creds.server) return NextResponse.json({ error: 'missing MT5 login/server' }, { status: 400 });
    let password: string;
    try {
      password = decryptSecret(creds.enc as string);
    } catch {
      return NextResponse.json({ error: 'decryption failed (MEMBER_CREDS_KEY changed?)' }, { status: 500 });
    }
    const lots = memberLot ?? (Number(detail.lot ?? 0.01) || 0.01); // fiche d'abord, carte ensuite — cohérent avec reconnectSth et moveSth
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
      if (!['onboarding', 'pending_copier', 'live', 'paused', OFFBOARDED].includes(raw)) return NextResponse.json({ error: 'unknown status' }, { status: 400 });
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
      if (masters.length > 0) { rows.push({ member_no: m.member_no, name: m.tg_username ? '@' + m.tg_username : m.tg_name, state: 'ok', detail: `${masters.length} master(s)` }); continue; }
      // MASTERLESS → ORPHELIN, ET ON TENTE LA RÉPARATION (26/08). On triait avant sur
      // tradingAccountConnected pour séparer « connecté mais sans master » (réparable) de « inconnu de
      // STH » (rien à faire) — un drapeau faux pour tout le monde, donc TOUS les masterless tombaient dans
      // « inconnu » et la réparation ne se déclenchait JAMAIS. L'outil d'audit ne réparait rien.
      // Aucun signal fiable ne permet ce tri, alors on tente : un re-join sur un utilisateur réellement
      // inconnu échoue avec le message de STH, qui s'affiche. Une tentative qui échoue en le disant est
      // plus utile qu'un diagnostic qui se trompe en silence.
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
  // ===== PUBLIER SUR LES CANAUX, AVEC UN BOUTON (16/08/2026) ==========================================
  // Telegram ne permet PAS de poser un bouton inline à la main : un clavier ne peut venir que d'un bot,
  // par l'API. Mathieu ne pouvait donc pas publier un CTA cliquable — seulement un lien nu dans le texte.
  //
  // ⚠️ POURQUOI ON PUBLIE SUR LES TROIS CANAUX D'ICI, et pas seulement sur la source.
  // Première version : publier sur la source et laisser le fan-out habituel (miroir UK + pont italien)
  // faire le reste. Ça n'a RIEN envoyé ailleurs, et la raison est une règle de fond du Bot API :
  // UN BOT NE REÇOIT JAMAIS D'UPDATE POUR SES PROPRES MESSAGES. Le fan-out se déclenche sur
  // `channel_post` ; quand c'est le bot qui publie, cet update n'existe pas. Le relais fonctionne pour
  // les posts écrits À LA MAIN dans le canal, jamais pour ceux envoyés par l'API.
  // On diffuse donc explicitement : source telle quelle, miroir UK à l'identique (même langue), canal
  // italien avec le texte TRADUIT et le même bouton.
  //
  // ANTI-DOUBLON : on pose quand même les verrous dans channel_translations. Si un update arrivait
  // malgré tout, mirrorChannelPost et bridgeChannelPost verraient la ligne déjà là et s'arrêteraient —
  // c'est l'insert qui gagne la course dans leur logique, pas une lecture.
  if (body.channelPost) {
    const c = body.channelPost as { chatId?: unknown; text?: unknown; buttonText?: unknown; buttonUrl?: unknown };
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500 });
    const chatId = String(c.chatId ?? '').trim();
    const text = String(c.text ?? '').trim().slice(0, 4000);
    const btnText = String(c.buttonText ?? '').trim().slice(0, 60);
    const btnUrl = String(c.buttonUrl ?? '').trim().slice(0, 300);
    if (!chatId || !text) return NextResponse.json({ error: 'channel and text are required' }, { status: 400 });
    // Un bouton EXIGE une URL https — Telegram rejette le message ENTIER sinon, avec un motif opaque.
    if (btnText && !/^https:\/\/\S+$/.test(btnUrl))
      return NextResponse.json({ error: 'the button needs a valid https:// link' }, { status: 400 });
    const kb = btnText ? { reply_markup: { inline_keyboard: [[{ text: btnText, url: btnUrl }]] } } : {};
    const send = async (dst: string, body_: string): Promise<{ ok: boolean; messageId: number | null; error: string }> => {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ chat_id: dst, text: body_, parse_mode: 'HTML', disable_web_page_preview: true, ...kb }),
        });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
        return d.ok ? { ok: true, messageId: d.result?.message_id ?? null, error: '' } : { ok: false, messageId: null, error: d.description ?? 'unknown' };
      } catch (e) {
        return { ok: false, messageId: null, error: String((e as { message?: string })?.message ?? e) };
      }
    };

    const src = (process.env.TELEGRAM_CHANNEL_EN ?? '').trim();
    const mirror = (process.env.TELEGRAM_CHANNEL_MIRROR ?? '').trim();
    const it = (process.env.TELEGRAM_CHANNEL_IT ?? '').trim();
    const report: Array<{ channel: string; ok: boolean; error?: string }> = [];

    // 1) le canal demandé
    const main = await send(chatId, text);
    report.push({ channel: 'source', ok: main.ok, ...(main.ok ? {} : { error: main.error }) });
    if (!main.ok) return NextResponse.json({ error: `Telegram refused: ${main.error}`, report }, { status: 400 });

    // 2) les relais — UNIQUEMENT si on vient de publier sur la source (sinon on serait en train de
    //    rediffuser un post déjà destiné à un canal précis).
    if (chatId === src) {
      const lock = async (dst: string, messageId: number | null, kind: string, error?: string) => {
        try {
          await db.from('channel_translations').insert({
            src_chat_id: Number(chatId), src_message_id: Number(main.messageId ?? 0), dst_chat_id: Number(dst),
            dst_message_id: messageId, status: error ? 'failed' : 'sent', kind, error: error?.slice(0, 200) ?? null,
          } as never);
        } catch { /* le verrou est un confort, pas une condition */ }
      };
      if (mirror) {
        const m = await send(mirror, text); // même langue : le miroir UK reçoit le texte tel quel
        report.push({ channel: 'mirror UK', ok: m.ok, ...(m.ok ? {} : { error: m.error }) });
        await lock(mirror, m.messageId, 'mirror_api', m.ok ? undefined : m.error);
      }
      if (it) {
        // Le canal italien reçoit une TRADUCTION, avec le même bouton (son libellé reste en anglais :
        // le traduire demanderait un second appel au modèle pour deux mots, avec le risque de bavardage
        // documenté dans lib/member/translate.ts).
        const { translateToItalian } = await import('@/lib/member/translate');
        const translated = await translateToItalian(text);
        if (!translated) {
          report.push({ channel: 'canale IT', ok: false, error: 'translation rejected — post it by hand' });
          await lock(it, null, 'text_api', 'translation rejected');
        } else {
          const i = await send(it, translated);
          report.push({ channel: 'canale IT', ok: i.ok, ...(i.ok ? {} : { error: i.error }) });
          await lock(it, i.messageId, 'text_api', i.ok ? undefined : i.error);
        }
      }
    }

    await db.from('member_actions').insert({
      tg_id: s.tgId, member_no: null, kind: 'channel_post', status: 'done', done_by: who,
      detail: { chat_id: chatId, message_id: main.messageId, text: text.slice(0, 500), button: btnText || null, url: btnUrl || null, report } as never,
    });
    return NextResponse.json({ ok: true, messageId: main.messageId, report });
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
    // Fiche lue AVANT l'envoi : sa langue décide des libellés des boutons.
    const { data: mrow } = await db.from('members').select('member_no,locale').eq('tg_id', dmTg).limit(1);
    // CLAVIER D'ACTION, OPTIONNEL ET C'EST VOLONTAIRE. Un SCRIPT de relance doit toujours porter ses trois
    // portes (app / canal / Mathieu) : sans elles la personne lit « are you still interested ? » sans aucun
    // moyen de dire oui, et répondre au bot ne mène nulle part puisqu'il ne lit rien. Mais une RÉPONSE
    // conversationnelle depuis le fil BOT ACTIVITY ne doit PAS traîner trois boutons d'appel à l'action :
    // on répond à quelqu'un qui parle déjà. L'appelant tranche, et le défaut reste « pas de boutons ».
    const dmMarkup = body.botDm.cta ? ctaKeyboard(asLocale((mrow?.[0] as { locale?: string } | undefined)?.locale), '/member/onboarding') : undefined;
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: dmTg, text, disable_web_page_preview: true, ...(dmMarkup ? { reply_markup: dmMarkup } : {}) }),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { description?: string };
      const why = err.description ?? `HTTP ${r.status}`;
      // L'ÉCHEC S'ÉCRIT, ET C'EST TOUT L'INTÉRÊT. Jusqu'ici il ne vivait que dans l'alerte du navigateur :
      // la personne restait dans la file de relances, on recliquait le lendemain, on reprenait la même
      // erreur. Rien ne pouvait la retirer parce que rien ne savait qu'elle était injoignable.
      // `status='failed'` la sort des cooldowns (qui ne comptent que les 'done') ET alimente le filtre
      // « a bloqué le bot » de la file — c'est cette ligne qui rend la file capable de se vider.
      await db.from('member_actions').insert({ tg_id: dmTg, member_no: mrow?.[0]?.member_no ?? null, kind: 'nudge', status: 'failed', done_by: who, detail: { via: 'admin', error: why, text } as never });
      return NextResponse.json({ error: `Telegram: ${why}` }, { status: 400 });
    }
    await db.from('member_actions').insert({ tg_id: dmTg, member_no: mrow?.[0]?.member_no ?? null, kind: 'nudge', status: 'done', done_by: who, detail: { via: 'admin', note: `reply via bot by ${who}`, text } as never });
    return NextResponse.json({ ok: true });
  }
  // 📣 ENVOI GROUPÉ VIA LE BOT — annoncer un changement à un segment entier, en une fois.
  //
  // Né du basculement S1 → S2 du 20/08 : 17 membres branchés au copieur devaient être prévenus qu'on
  // avait mis leur stratégie en maintenance. Les prévenir un par un depuis le fil BOT ACTIVITY, c'est 17
  // clics et la certitude d'en oublier un.
  //
  // L'AUDIENCE EST CALCULÉE ICI, jamais fournie par le navigateur : une liste d'ids envoyée par le client
  // pourrait viser n'importe qui si l'écran a une vieille donnée en mémoire. On accepte un NOM de segment,
  // et le serveur résout qui il contient au moment de l'envoi.
  //
  // ANTI-DOUBLON PAR TAG : chaque envoi porte une étiquette, et quiconque a déjà reçu un message portant
  // cette étiquette est SAUTÉ. Un double clic, un rechargement de page ou une seconde tentative après une
  // erreur réseau ne peuvent pas envoyer deux fois la même annonce à la même personne.
  if (body.botBroadcast) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not configured (Vercel)' }, { status: 400 });
    const text = String(body.botBroadcast.text ?? '').trim().slice(0, 1500);
    const tag = String(body.botBroadcast.tag ?? '').trim().slice(0, 60);
    const audience = String(body.botBroadcast.audience ?? '');
    if (!text || !tag) return NextResponse.json({ error: 'text and tag required' }, { status: 400 });

    // ── qui reçoit ──────────────────────────────────────────────────────────────────────────────────
    let targets: Array<{ tg_id: number; member_no: number | null; tg_name: string | null; locale?: string | null }> = [];
    if (audience === 'ex_s1') {
      // Tous les membres qui portent une carte de mouvement DEPUIS S1 — quel que soit son statut.
      //
      // ⚠️ CORRIGÉ LE 20/08, ET C'ÉTAIT UN VRAI DÉFAUT. La première version ne prenait que les cartes
      // encore 'pending'. Or la marche à suivre que j'avais moi-même donnée à Mathieu était : faire les
      // mouvements STH D'ABORD, envoyer l'annonce ENSUITE — ce qui vidait l'audience au fur et à mesure.
      // Résultat en production : sur 17 destinataires, l'annonce n'est partie qu'aux 4 dont le mouvement
      // avait échoué. Les 13 correctement déplacés n'ont rien reçu, précisément parce que tout s'était
      // bien passé pour eux. Une audience ne doit pas dépendre de l'avancement d'une tâche.
      const { data } = await db.from('member_actions').select('tg_id').eq('kind', 'strategy_change').eq('detail->>from' as never, '1' as never);
      const ids = [...new Set((data ?? []).map((r) => Number(r.tg_id)).filter(Boolean))];
      if (ids.length) {
        const { data: ms } = await db.from('members').select('tg_id,member_no,tg_name,locale').in('tg_id', ids).is('banned_at', null);
        targets = (ms ?? []) as typeof targets;
      }
    } else if (audience === 'live') {
      const { data: ms } = await db.from('members').select('tg_id,member_no,tg_name,locale').in('status', ['live', 'paused']).is('banned_at', null);
      targets = (ms ?? []) as typeof targets;
    } else return NextResponse.json({ error: 'unknown audience' }, { status: 400 });

    // DÉJÀ PRÉVENUS SOUS CETTE ÉTIQUETTE → on les saute. `status='done'` est ESSENTIEL et non
    // décoratif : depuis qu'on trace aussi les ÉCHECS sous la même étiquette (ci-dessous), l'omettre
    // ferait sauter précisément les gens que la relance doit rattraper — un membre injoignable une
    // fois le resterait pour toujours, et le bouton « relancer » deviendrait un bouton « ne rien faire ».
    const { data: already } = await db.from('member_actions').select('tg_id').eq('kind', 'nudge').eq('status', 'done').contains('detail', { broadcast: tag } as never);
    const done = new Set((already ?? []).map((r) => Number(r.tg_id)));

    const report: Array<{ member_no: number | null; ok: boolean; error?: string; skipped?: boolean }> = [];
    // ÉCHEC D'ENVOI = un fait qui doit SURVIVRE à l'onglet. Avant le 21/08 il ne vivait que dans la
    // réponse HTTP : le 20/08, 2 membres sur 17 n'ont pas reçu l'annonce S1→S2 et le motif était
    // définitivement perdu — impossible de savoir s'ils avaient bloqué le bot, supprimé leur compte,
    // ou si c'était un simple raté réseau. On écrit donc une ligne `status='failed'` portant l'erreur
    // Telegram telle quelle. Elle n'entre dans AUCUNE file (la file support ne lit que 'pending') et
    // ne compte pas comme un contact (voir les deux gardes `status='done'` sur les cooldowns).
    const logFailure = async (m: { tg_id: number; member_no: number | null }, error: string, sent: string) => {
      try {
        await db.from('member_actions').insert({
          tg_id: Number(m.tg_id), member_no: m.member_no, kind: 'nudge', status: 'failed', done_by: who,
          detail: { via: 'broadcast', broadcast: tag, error, text: sent } as never,
        });
      } catch { /* le journal ne doit jamais faire échouer l'envoi des suivants */ }
    };
    for (const m of targets) {
      if (done.has(Number(m.tg_id))) { report.push({ member_no: m.member_no, ok: true, skipped: true }); continue; }
      // {name} → prénom quand on le connaît ; sinon la formule nue, jamais « Hey undefined »
      const first = String(m.tg_name ?? '').trim().split(/\s+/)[0] ?? '';
      const body_ = /^[\p{L}][\p{L}'-]{1,20}$/u.test(first) ? text.replace(/\{name\}/g, ' ' + first) : text.replace(/\{name\}/g, '');
      try {
        // Boutons d'action optionnels, dans la langue du destinataire. Une annonce vise des membres DÉJÀ
        // actifs → on les envoie sur l'accueil de l'app, pas sur l'onboarding qu'ils ont déjà franchi.
        const bMarkup = body.botBroadcast.cta ? ctaKeyboard(asLocale(m.locale), '/member') : undefined;
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: Number(m.tg_id), text: body_, parse_mode: 'HTML', disable_web_page_preview: true, ...(bMarkup ? { reply_markup: bMarkup } : {}) }),
        });
        if (!r.ok) {
          const err = (await r.json().catch(() => ({}))) as { description?: string };
          const why = err.description ?? `HTTP ${r.status}`;
          await logFailure(m, why, body_);
          report.push({ member_no: m.member_no, ok: false, error: why });
          continue;
        }
        await db.from('member_actions').insert({
          tg_id: Number(m.tg_id), member_no: m.member_no, kind: 'nudge', status: 'done', done_by: who,
          detail: { via: 'broadcast', broadcast: tag, text: body_ } as never,
        });
        report.push({ member_no: m.member_no, ok: true });
      } catch (e) {
        const why = (e as { message?: string })?.message ?? 'send failed';
        await logFailure(m, why, body_);
        report.push({ member_no: m.member_no, ok: false, error: why });
      }
      await new Promise((res) => setTimeout(res, 120)); // Telegram n'aime pas les rafales — 8 msg/s max
    }
    return NextResponse.json({ ok: true, sent: report.filter((r) => r.ok && !r.skipped).length, skipped: report.filter((r) => r.skipped).length, failed: report.filter((r) => !r.ok).length, report });
  }

  if (body.nudged) {
    // « ✓ FAIT » de la file RELANCES : Mathieu a envoyé son message/vocal perso → on trace (kind='nudge',
    // via manual) pour sortir le lead de la file 3 jours et mesurer la conversion post-contact.
    const { data: m } = await db.from('members').select('member_no').eq('tg_id', body.nudged).limit(1);
    if (!m?.length) return NextResponse.json({ error: 'member not found' }, { status: 404 });
    await db.from('member_actions').insert({ tg_id: body.nudged, member_no: m[0].member_no, kind: 'nudge', status: 'done', done_by: who, detail: { via: 'manual', note: `personal DM/voice by ${who}` } as never });
    return NextResponse.json({ ok: true });
  }
  if (body.lotsOk) {
    // VALIDATION DU VOLUME D'ACTIVATION — le geste qui déverrouille le copieur. Écrit qui a pointé, quand,
    // et le volume constaté ; ou un motif de passage en force.
    //
    // LE MOTIF EST OBLIGATOIRE POUR FORCER, et ce n'est pas de la paperasse. Un bouton « forcer » sans
    // justification redevient le comportement par défaut en une semaine — on l'a vu ailleurs : ce qui est
    // gratuit devient systématique. Écrire une phrase coûte assez pour qu'on ne le fasse que quand il le
    // faut, et laisse une trace lisible quand on relit le mois.
    const cardId = String(body.lotsOk);
    const force = String(body.reason ?? '').trim().slice(0, 200);
    const lotsSeen = Number(body.lots);
    const { data: act } = await db.from('member_actions').select('id,tg_id,member_no,kind,detail').eq('id', cardId).eq('kind', 'connect').limit(1);
    if (!act?.length) return NextResponse.json({ error: 'connect request not found' }, { status: 404 });
    const detail = (act[0].detail as Record<string, unknown>) ?? {};
    const patch: Record<string, unknown> = { ...detail, lots_ok_by: who, lots_ok_at: new Date().toISOString() };
    if (force) {
      patch.lots_override = force;
      patch.lots_ok = false; // un forçage n'est PAS une validation : les deux doivent rester distinguables au bilan
    } else {
      patch.lots_ok = true;
      if (Number.isFinite(lotsSeen) && lotsSeen > 0) patch.lots_traded = lotsSeen;
    }
    await db.from('member_actions').update({ detail: patch as never }).eq('id', cardId);
    await db.from('member_actions').insert({
      tg_id: act[0].tg_id, member_no: act[0].member_no, kind: 'note', status: 'done', done_by: who,
      detail: { text: force ? `⚠️ activation lots FORCED — ${force}` : `✅ activation lots validated${Number.isFinite(lotsSeen) && lotsSeen > 0 ? ` (${lotsSeen} lot)` : ''}` } as never,
    });
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
    // Le ✓ DONE manuel fait passer un membre LIVE exactement comme le branchement STH : il doit donc
    // passer par le MÊME verrou. Le laisser ouvert reviendrait à poser une porte blindée à côté d'une
    // fenêtre ouverte — et c'est le bouton le plus rapide de la file, donc celui qu'on utiliserait.
    if (act[0].kind === 'connect' && !lotsCleared(act[0].detail as Record<string, unknown>)) {
      return NextResponse.json({ error: `activation lots not validated — check the partner dashboard for ${ACTIVATION_LOTS} lot traded, then hit ✓ LOTS (or force it with a written reason)` }, { status: 409 });
    }
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
