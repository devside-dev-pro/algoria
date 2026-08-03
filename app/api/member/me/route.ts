import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, encryptSecret, isAdmin, isVip } from '@/lib/member/server';
import { MIN_PAYOUT_USD, TRC20_RE, commissionForActivation, nextMilestone } from '@/lib/member/affiliate';
import { minDepositFor } from '@/lib/member/minimums';
import { BROKERS } from '@/lib/member/brokers';

const TIER_LOT: Record<string, string> = { low: '0.01', balanced: '0.05', high: '0.10' };

// Familles d'actions dont seul le DERNIER état compte : une nouvelle demande REMPLACE les précédentes en attente.
// pause/resume/disconnect = même interrupteur (l'état de la copie) ; risk_change = le dernier tier demandé.
// Sans ça, un membre qui clique pause→resume→pause noie la file de cartes déjà obsolètes (spam constaté).
const SUPERSEDES: Record<string, string[]> = {
  pause: ['pause', 'resume'],
  resume: ['pause', 'resume'],
  disconnect: ['pause', 'resume', 'disconnect'],
  risk_change: ['risk_change'],
  strategy_change: ['strategy_change'],
};

/** Pousse une action dans la file copieur (appliquée dans STH par le support, puis par l'API quand elle arrivera). */
async function queueAction(tgId: number, kind: string, detail: Record<string, unknown>) {
  const db = sdb();
  const family = SUPERSEDES[kind];
  if (family) {
    await db.from('member_actions').update({ status: 'superseded', done_at: new Date().toISOString(), done_by: 'auto (newer request)' })
      .eq('tg_id', tgId).eq('status', 'pending').in('kind', family);
  }
  const { data } = await db.from('members').select('member_no').eq('tg_id', tgId).limit(1);
  await db.from('member_actions').insert({ tg_id: tgId, member_no: data?.[0]?.member_no ?? null, kind, detail: detail as never });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Champs SÛRS renvoyés au client — jamais les identifiants MT5 (même chiffrés).
const SAFE = 'member_no,tg_username,tg_name,photo_url,status,broker,risk_tier,strategy,lot,onboarding_step,created_at,mt5_login,mt5_server,referral_code,usdt_trc20';

async function me(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  // banned_at lu à CHAQUE requête : la session est un jeton signé sans état (valable 30 j), donc le seul
  // moyen de couper l'accès d'un banni déjà connecté est de le vérifier en base ici (31/07).
  const { data } = await (sdb() as any).from('members').select(`${SAFE},banned_at`).eq('tg_id', s.tgId).limit(1) as { data: Array<Record<string, unknown>> | null };
  const row = data?.[0];
  if (!row) return null;
  if (row.banned_at) return 'banned' as const;
  delete row.banned_at; // jamais renvoyé au client
  return { session: s, member: row };
}

/** État du membre connecté (Home + wizard) + WALLET d'affiliation (commissions, retraits, paliers).
 *  Balance retirable = Σ commissions confirmées − Σ retraits (demandés + payés) — calculée ICI, jamais côté client. */
export async function GET(req: NextRequest) {
  const ctx = await me(req);
  // banni : 403 explicite (pas 401 — inutile de le renvoyer vers un login qui le refusera aussi)
  if (ctx === 'banned') return NextResponse.json({ error: 'access revoked', banned: true }, { status: 403 });
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sdb();
  const [refs, commsQ, payoutsQ, rejQ, accountsQ] = await Promise.all([
    db.from('members').select('status').eq('referred_by', ctx.session.tgId),
    db.from('referral_commissions').select('id,kind,amount,status,reason,detail,created_at').eq('referrer_tg_id', ctx.session.tgId).order('created_at', { ascending: false }),
    db.from('referral_payouts').select('id,amount,address,status,tx_hash,reason,created_at').eq('tg_id', ctx.session.tgId).order('created_at', { ascending: false }),
    // dernière connexion REFUSÉE (vérification broker) — affichée dans le wizard pour corriger et re-soumettre
    db.from('member_actions').select('detail,done_at').eq('tg_id', ctx.session.tgId).eq('kind', 'connect').eq('status', 'rejected').order('done_at', { ascending: false }).limit(1),
    // comptes SUPPLÉMENTAIRES (multi-stratégies) — champs sûrs uniquement, jamais les identifiants
    (db as any).from('member_accounts').select('account_no,broker,strategy,status,mt5_login,created_at').eq('tg_id', ctx.session.tgId).order('account_no', { ascending: true }) as Promise<{ data: Array<Record<string, unknown>> | null }>,
  ]);
  const rejection = (ctx.member as { status?: string }).status === 'onboarding' && rejQ.data?.[0]
    ? { reason: String((rejQ.data[0].detail as { reject_reason?: string })?.reject_reason ?? 'verification failed'), at: rejQ.data[0].done_at }
    : null;
  const comms = commsQ.data ?? [];
  const payouts = payoutsQ.data ?? [];
  const sumC = (st: string) => comms.filter((c) => c.status === st).reduce((a, c) => a + Number(c.amount), 0);
  const held = payouts.filter((p) => ['requested', 'paid'].includes(String(p.status))).reduce((a, p) => a + Number(p.amount), 0);
  const activated = comms.filter((c) => c.kind === 'referral' && c.status === 'confirmed').length;
  const next = nextMilestone(activated);
  const referral = {
    code: (ctx.member as { referral_code?: string }).referral_code ?? null,
    invited: refs.data?.length ?? 0,
    activated,
    availableUsd: sumC('confirmed') - held, // retirable maintenant (peut être négatif si annulation après retrait → flag admin)
    pendingUsd: sumC('pending'), // filleuls activés, commission broker pas encore reçue
    paidUsd: payouts.filter((p) => p.status === 'paid').reduce((a, p) => a + Number(p.amount), 0),
    totalEarnedUsd: sumC('confirmed'),
    rewardUsd: commissionForActivation(activated), // la com ACTUELLE par filleul (monte à 75$ après le palier 10)
    minPayoutUsd: MIN_PAYOUT_USD,
    nextMilestone: next ? { at: next.at, bonus: next.bonus, label: next.label, remaining: next.at - activated } : null,
    address: (ctx.member as { usdt_trc20?: string | null }).usdt_trc20 ?? null,
    commissions: comms.slice(0, 20),
    payouts: payouts.slice(0, 10),
  };
  // unlocked calculé SERVEUR : admin OU copie activée OU whitelist VIP/équipe (CM, partenaires —
  // app complète sans connexion copieur). La whitelist TOOLS redevient un vrai levier.
  const admin = isAdmin(ctx.session.username);
  const status = String((ctx.member as { status?: string }).status ?? '');
  const unlocked = admin || ['live', 'paused'].includes(status) || (await isVip(ctx.session.username));
  return NextResponse.json({ member: ctx.member, admin, unlocked, referral, rejection, accounts: accountsQ.data ?? [] });
}

/** Progression de l'onboarding + réglages. body: { action: 'broker'|'mt5'|'risk'|'pause'|'resume', ... } */
export async function POST(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = sdb();
  const { data: curRows } = await db.from('members').select('status,onboarding_step').eq('tg_id', s.tgId).limit(1);
  const cur = curRows?.[0] as { status: string; onboarding_step: number } | undefined;
  if (!cur) return NextResponse.json({ error: 'member not found' }, { status: 404 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.action === 'locale') {
    // CHOIX DE LANGUE (03/08) — l'app est traduite à 100 % (95 clés EN/IT), mais la langue était
    // DÉDUITE du canal d'arrivée : un Italien venu d'Instagram ou d'un DM restait bloqué en anglais,
    // sans aucun moyen d'en sortir. Un prospect italien nous l'a signalé au moment de déposer.
    // locale_chosen_at fige le choix : la déduction automatique ne le touchera plus jamais (voir
    // tglogin). Un choix explicite doit toujours gagner sur une devinette.
    const loc = String(body.locale ?? '');
    if (!['en', 'it'].includes(loc)) return NextResponse.json({ error: 'unsupported locale' }, { status: 400 });
    patch.locale = loc;
    patch.locale_chosen_at = new Date().toISOString();
  } else if (body.action === 'broker') {
    const broker = String(body.broker ?? '').slice(0, 40);
    if (!broker) return NextResponse.json({ error: 'broker required' }, { status: 400 });
    patch.broker = broker;
    patch.onboarding_step = 1;
  } else if (body.action === 'mt5') {
    const broker = String(body.broker ?? '').trim().slice(0, 40);
    if (broker) patch.broker = broker; // broker choisi sur l'écran de connexion (menu déroulant)
    const platform = String(body.platform ?? 'mt5') === 'mt4' ? 'mt4' : 'mt5'; // MT4 vs MT5 → STH IsMT4
    const login = String(body.login ?? '').trim().slice(0, 40);
    const server = String(body.server ?? '').trim().slice(0, 80);
    const password = String(body.password ?? '');
    const fullName = String(body.name ?? '').trim().slice(0, 80);
    const deposit = Math.round(Number(body.deposit ?? 0));
    if (!login || !server || !password) return NextResponse.json({ error: 'login, server and password are required' }, { status: 400 });
    if (fullName.length < 3) return NextResponse.json({ error: 'full name on the broker account is required' }, { status: 400 });
    if (!Number.isFinite(deposit) || deposit <= 0) return NextResponse.json({ error: 'deposit amount is required' }, { status: 400 });
    patch.mt5_login = login;
    patch.mt5_server = server;
    patch.mt5_password_enc = encryptSecret(password); // AES-256-GCM — jamais en clair, jamais renvoyé
    patch.onboarding_step = 2;
    // STASH VÉRIFICATION (nom du titulaire + dépôt déclaré) : porté par la file d'actions (statut done →
    // jamais dans la queue), relu à la fin du wizard pour enrichir la carte CONNECT côté admin.
    const { data: mn } = await db.from('members').select('member_no').eq('tg_id', s.tgId).limit(1);
    await db.from('member_actions').insert({
      tg_id: s.tgId, member_no: mn?.[0]?.member_no ?? null, kind: 'kyc', status: 'done', done_by: 'member',
      // broker_label : nom saisi à la main quand le broker n'est PAS partenaire (résidents US, qui paient
      // l'accès directement). Porté jusqu'à la carte admin — sans lui, le support voit « other » et doit
      // demander au membre de quel broker il parle.
      detail: { broker_name: fullName, declared_deposit: deposit, platform, is_mt4: platform === 'mt4', ...(broker === 'other' ? { broker_label: String(body.brokerOther ?? '').trim().slice(0, 60) || null, manual_connect: true } : {}) } as never,
    });
  } else if (body.action === 'strategy') {
    // CHOIX DE STRATÉGIE (remplace le sélecteur de lot — le lot copieur est FIXE 0.01, le levier de risque
    // du membre est la stratégie). Fin du wizard OU changement depuis le profil (→ file : move de master STH).
    const choice = Number(body.choice ?? 0);
    if (![1, 2, 3].includes(choice)) return NextResponse.json({ error: 'invalid strategy' }, { status: 400 });
    patch.strategy = choice;
    if (cur.status === 'onboarding') {
      const [{ data: mrow }, { data: kyc }] = await Promise.all([
        db.from('members').select('mt5_login,mt5_server,broker,tg_username').eq('tg_id', s.tgId).limit(1),
        db.from('member_actions').select('detail').eq('tg_id', s.tgId).eq('kind', 'kyc').order('created_at', { ascending: false }).limit(1),
      ]);
      // MINIMUM PAR STRATÉGIE ($200/$500/$1000) : recoupé avec le dépôt déclaré au wizard — un membre à
      // $200 ne peut pas prendre TURBO ; le front grise déjà, ceci est le verrou serveur.
      const declared = Number((kyc?.[0]?.detail as { declared_deposit?: number })?.declared_deposit ?? 0);
      if (declared > 0 && declared < minDepositFor(choice))
        return NextResponse.json({ error: `this strategy needs a $${minDepositFor(choice)}+ deposit (you declared $${declared}) — pick another strategy or fund more` }, { status: 400 });
      patch.onboarding_step = 3;
      patch.status = 'pending_copier';
      await queueAction(s.tgId, 'connect', {
        login: mrow?.[0]?.mt5_login ?? null,
        server: mrow?.[0]?.mt5_server ?? null,
        strategy: choice,
        lot: '0.01', // lot copieur FIXE pour tous — plus de tier
        broker: mrow?.[0]?.broker ?? null,
        username: mrow?.[0]?.tg_username ?? null,
        ...(kyc?.[0]?.detail as Record<string, unknown> | undefined),
      });
    } else {
      // AUTO via STH (demande Mathieu 29/07 : il validait 100 % des cartes — la file ne sert plus qu'aux
      // connexions, où le dépôt se vérifie). join-master déclaratif = un appel déplace le receiver vers le
      // master de la nouvelle stratégie. Échec (receiver manuel, STH down…) → carte dans la file (backup).
      const { data: mrow } = await db.from('members').select('member_no,lot').eq('tg_id', s.tgId).limit(1);
      const lot = Number((mrow?.[0] as { lot?: number } | undefined)?.lot ?? 0.01) || 0.01;
      let applied = false;
      const { sthReady, sthMoveMaster } = await import('@/lib/member/sth');
      if (sthReady()) applied = (await sthMoveMaster(String(s.tgId), choice, lot)).ok;
      if (applied)
        await db.from('member_actions').insert({ tg_id: s.tgId, member_no: mrow?.[0]?.member_no ?? null, kind: 'note', status: 'done', done_by: 'member (auto STH)', detail: { text: `🎯 strategy switched to S${choice} — receiver moved automatically via STH` } as never });
      else await queueAction(s.tgId, 'strategy_change', { to: choice }); // backup : le support déplace à la main
    }
  } else if (body.action === 'lot') {
    // TAILLE DE COPIE (le vrai lot, fin du mapping risk_tier) : le membre choisit son lot parmi des paliers.
    // APPLICATION AUTO via STH quand le compte est connecté par l'API (join-master-account déclaratif avec le
    // nouveau lot) ; sinon carte risk_change dans la file → le support l'applique dans le dashboard STH.
    const { isLotAllowed } = await import('@/lib/member/lots'); // source unique partagée avec la page profil
    const newLot = Number(body.lot ?? 0);
    if (!isLotAllowed(newLot)) return NextResponse.json({ error: 'invalid lot size' }, { status: 400 });
    if (!['live', 'paused'].includes(cur.status)) return NextResponse.json({ error: 'copy not activated yet' }, { status: 403 });
    const { data: mrow } = await db.from('members').select('member_no,strategy').eq('tg_id', s.tgId).limit(1);
    const strat = Number((mrow?.[0] as { strategy?: number } | undefined)?.strategy ?? 2) || 2;
    let applied = false;
    const { sthReady, sthMoveMaster } = await import('@/lib/member/sth');
    if (sthReady()) {
      // même master, nouveau lot — join-master-account est déclaratif, un seul appel suffit
      const r = await sthMoveMaster(String(s.tgId), strat, newLot);
      applied = r.ok;
    }
    (patch as Record<string, unknown>).lot = newLot;
    if (applied) {
      await db.from('member_actions').insert({ tg_id: s.tgId, member_no: mrow?.[0]?.member_no ?? null, kind: 'note', status: 'done', done_by: 'member (auto STH)', detail: { text: `📏 copy size changed to ${newLot} lot — applied automatically via STH` } as never });
    } else {
      await queueAction(s.tgId, 'risk_change', { lot: String(newLot), to: `lot ${newLot}` }); // → le support règle le lot dans STH
    }
  } else if (body.action === 'risk') {
    const tier = String(body.tier ?? '');
    if (!['low', 'balanced', 'high'].includes(tier)) return NextResponse.json({ error: 'invalid tier' }, { status: 400 });
    patch.risk_tier = tier;
    if (cur.status === 'onboarding') {
      // fin du wizard : la copie doit être branchée côté copieur → pending_copier (un membre déjà live ne régresse pas).
      // UNE action 'connect' complète (compte + lot initial) part dans la file — PAS de mot de passe dedans.
      patch.onboarding_step = 3;
      patch.status = 'pending_copier';
      // la carte CONNECT porte TOUT ce qu'il faut pour VÉRIFIER avant d'approuver : broker choisi,
      // nom du titulaire, dépôt déclaré, @telegram — plus jamais une demande aveugle dans la file.
      const [{ data: mrow }, { data: kyc }] = await Promise.all([
        db.from('members').select('mt5_login,mt5_server,broker,tg_username').eq('tg_id', s.tgId).limit(1),
        db.from('member_actions').select('detail').eq('tg_id', s.tgId).eq('kind', 'kyc').order('created_at', { ascending: false }).limit(1),
      ]);
      await queueAction(s.tgId, 'connect', {
        login: mrow?.[0]?.mt5_login ?? null,
        server: mrow?.[0]?.mt5_server ?? null,
        tier,
        lot: TIER_LOT[tier],
        broker: mrow?.[0]?.broker ?? null,
        username: mrow?.[0]?.tg_username ?? null,
        ...(kyc?.[0]?.detail as Record<string, unknown> | undefined),
      });
    } else {
      // AUTO via STH (29/07) : même master, nouveau lot — join déclaratif. Échec → file (backup).
      const { data: mrow } = await db.from('members').select('member_no,strategy').eq('tg_id', s.tgId).limit(1);
      const strat = Number((mrow?.[0] as { strategy?: number } | undefined)?.strategy ?? 2) || 2;
      let applied = false;
      const { sthReady, sthMoveMaster } = await import('@/lib/member/sth');
      if (sthReady()) applied = (await sthMoveMaster(String(s.tgId), strat, Number(TIER_LOT[tier]))).ok;
      if (applied)
        await db.from('member_actions').insert({ tg_id: s.tgId, member_no: mrow?.[0]?.member_no ?? null, kind: 'note', status: 'done', done_by: 'member (auto STH)', detail: { text: `⚖ risk tier ${tier} (lot ${TIER_LOT[tier]}) — applied automatically via STH` } as never });
      else await queueAction(s.tgId, 'risk_change', { to: tier, lot: TIER_LOT[tier] }); // backup : le support règle le lot à la main
    }
  } else if (body.action === 'add_account') {
    // ➕ AJOUTER UNE STRATÉGIE (multi-comptes) — la CONTINUITÉ d'un VIP : un membre déjà live ajoute un
    // 2e/3e compte sur une stratégie qu'il n'a pas, chez un broker qu'il n'a pas (nouveau broker = nouvelle
    // commission). Le compte vit dans member_accounts, la fiche members reste le compte principal.
    if (!['live', 'paused'].includes(cur.status)) return NextResponse.json({ error: 'available once your first account is live' }, { status: 403 });
    const strat = Number(body.strategy ?? 0);
    if (![1, 2, 3].includes(strat)) return NextResponse.json({ error: 'invalid strategy' }, { status: 400 });
    const broker = String(body.broker ?? '').trim().slice(0, 40);
    if (!BROKERS.some((b) => b.key === broker)) return NextResponse.json({ error: 'pick a partner broker' }, { status: 400 });
    const platform = String(body.platform ?? 'mt5') === 'mt4' ? 'mt4' : 'mt5';
    const login = String(body.login ?? '').trim().slice(0, 40);
    const server = String(body.server ?? '').trim().slice(0, 80);
    const password = String(body.password ?? '');
    const fullName = String(body.name ?? '').trim().slice(0, 80);
    const deposit = Math.round(Number(body.deposit ?? 0));
    if (!login || !server || !password) return NextResponse.json({ error: 'login, server and password are required' }, { status: 400 });
    if (fullName.length < 3) return NextResponse.json({ error: 'full name on the broker account is required' }, { status: 400 });
    if (!Number.isFinite(deposit) || deposit < minDepositFor(strat))
      return NextResponse.json({ error: `this strategy needs a $${minDepositFor(strat)}+ deposit` }, { status: 400 });
    const raw = db as unknown as { from: (t: string) => any };
    const { data: mrow } = await db.from('members').select('member_no,broker,strategy,tg_username').eq('tg_id', s.tgId).limit(1);
    const { data: extras } = (await raw.from('member_accounts').select('account_no,broker,strategy,status').eq('tg_id', s.tgId)) as { data: Array<{ account_no: number; broker: string | null; strategy: number; status: string }> | null };
    const activeExtras = (extras ?? []).filter((a) => a.status !== 'rejected');
    // une stratégie = un seul compte ; un broker = un seul compte (le doublon broker ne génère pas de commission)
    const usedStrategies = new Set<number>([Number(mrow?.[0]?.strategy ?? 2), ...activeExtras.map((a) => a.strategy)]);
    const usedBrokers = new Set<string>([String(mrow?.[0]?.broker ?? ''), ...activeExtras.map((a) => String(a.broker ?? ''))].filter(Boolean));
    if (usedStrategies.has(strat)) return NextResponse.json({ error: 'you already run this strategy — pick another one' }, { status: 400 });
    if (usedBrokers.has(broker)) return NextResponse.json({ error: 'you already have an account with this broker — open one with a different partner broker' }, { status: 400 });
    const accountNo = Math.max(1, ...(extras ?? []).map((a) => a.account_no)) + 1;
    const { data: inserted, error: insErr } = (await raw.from('member_accounts').insert({
      tg_id: s.tgId, member_no: mrow?.[0]?.member_no ?? null, account_no: accountNo, broker, strategy: strat,
      platform, mt5_login: login, mt5_server: server, mt5_password_enc: encryptSecret(password),
      holder_name: fullName, declared_deposit: deposit,
    }).select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    // carte CONNECT dans la file admin — account_id à bord : le support voit que c'est un compte n°2/3,
    // le CONNECT STH utilisera les identifiants du COMPTE (userId STH = "{tg_id}-{account_no}").
    await queueAction(s.tgId, 'connect', {
      account_id: inserted?.[0]?.id ?? null,
      account_no: accountNo,
      login, server, strategy: strat, lot: '0.01', broker,
      username: mrow?.[0]?.tg_username ?? null,
      broker_name: fullName, declared_deposit: deposit, platform, is_mt4: platform === 'mt4',
      add_strategy: true, // affichage file : "compte supplémentaire", pas une premières connexion
    });
    const { data: fresh } = (await raw.from('member_accounts').select('account_no,broker,strategy,status,mt5_login,created_at').eq('tg_id', s.tgId).order('account_no', { ascending: true })) as { data: Array<Record<string, unknown>> | null };
    return NextResponse.json({ ok: true, accounts: fresh ?? [] });
  } else if (body.action === 'trc20') {
    // adresse de retrait USDT TRC20 — une seule par membre, format vérifié, changement horodaté (audit)
    const address = String(body.address ?? '').trim();
    if (!TRC20_RE.test(address)) return NextResponse.json({ error: 'invalid TRC20 address (starts with T, 34 characters)' }, { status: 400 });
    patch.usdt_trc20 = address;
  } else if (body.action === 'withdraw') {
    // DEMANDE DE RETRAIT — la balance est recalculée CÔTÉ SERVEUR à l'instant T (jamais confiée au client).
    // Ouvert aussi aux prospects (un apporteur d'affaires pas encore client a gagné son argent) — revue
    // humaine systématique : chaque paiement est traité à la main dans l'admin.
    const amount = Math.floor(Number(body.amount ?? 0));
    const { data: mrow } = await db.from('members').select('usdt_trc20,member_no').eq('tg_id', s.tgId).limit(1);
    const address = String(mrow?.[0]?.usdt_trc20 ?? '');
    if (!TRC20_RE.test(address)) return NextResponse.json({ error: 'save your USDT TRC20 address first' }, { status: 400 });
    if (!Number.isFinite(amount) || amount < MIN_PAYOUT_USD) return NextResponse.json({ error: `minimum withdrawal is $${MIN_PAYOUT_USD}` }, { status: 400 });
    const [commsQ, payoutsQ] = await Promise.all([
      db.from('referral_commissions').select('amount').eq('referrer_tg_id', s.tgId).eq('status', 'confirmed'),
      db.from('referral_payouts').select('amount,status').eq('tg_id', s.tgId).in('status', ['requested', 'paid']),
    ]);
    const available = (commsQ.data ?? []).reduce((a, c) => a + Number(c.amount), 0) - (payoutsQ.data ?? []).reduce((a, p) => a + Number(p.amount), 0);
    if (amount > available) return NextResponse.json({ error: `only $${Math.max(0, Math.floor(available))} available` }, { status: 400 });
    const { error: perr } = await db.from('referral_payouts').insert({ tg_id: s.tgId, amount, address });
    if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
  } else if (body.action === 'disconnect') {
    // DÉCONNECTER / changer de compte de trading : on efface les identifiants MT5 et on repasse le membre en
    // onboarding (broker gardé → il retombe sur l'étape « connexion MT5 »). Une action 'disconnect' part dans la
    // file pour que le support retire le copieur côté STH (jusqu'à ce que l'API STH le fasse automatiquement).
    patch.status = 'onboarding';
    patch.onboarding_step = 1;
    patch.mt5_login = null;
    patch.mt5_server = null;
    patch.mt5_password_enc = null;
    // AUTO via STH (29/07) : retrait immédiat du copieur — le membre n'attend plus le support pour
    // débrancher SON compte. Échec (receiver manuel, STH down…) → carte dans la file (backup).
    {
      let applied = false;
      const { sthReady, sthDisconnect } = await import('@/lib/member/sth');
      if (sthReady()) applied = (await sthDisconnect(String(s.tgId))).ok;
      if (applied) {
        const { data: mn } = await db.from('members').select('member_no').eq('tg_id', s.tgId).limit(1);
        await db.from('member_actions').insert({ tg_id: s.tgId, member_no: mn?.[0]?.member_no ?? null, kind: 'note', status: 'done', done_by: 'member (auto STH)', detail: { text: '⛔ disconnected from the copier — applied automatically via STH' } as never });
      } else await queueAction(s.tgId, 'disconnect', {}); // backup : le support retire le compte à la main
    }
  } else if (body.action === 'pause' || body.action === 'resume') {
    // GARDE-FOU : le statut gate maintenant le contenu (mode teaser) — un prospect ne doit pas pouvoir
    // s'auto-promouvoir en 'live' via un simple POST resume. Réservé aux comptes déjà activés.
    if (!['live', 'paused'].includes(cur.status)) return NextResponse.json({ error: 'copy not activated yet' }, { status: 403 });
    patch.status = body.action === 'pause' ? 'paused' : 'live';
    // AUTO via STH (29/07) : pause = join-master DÉCLARATIF avec liste vide (désabonné, compte MT toujours
    // branché) ; resume = re-join du master de SA stratégie avec SON lot. Échec → file (backup).
    {
      const { data: mrow } = await db.from('members').select('member_no,strategy,lot').eq('tg_id', s.tgId).limit(1);
      const strat = Number((mrow?.[0] as { strategy?: number } | undefined)?.strategy ?? 2) || 2;
      const lot = Number((mrow?.[0] as { lot?: number } | undefined)?.lot ?? 0.01) || 0.01;
      let applied = false;
      const { sthReady, sthMoveMaster, sthPauseCopy } = await import('@/lib/member/sth');
      if (sthReady()) applied = (body.action === 'pause' ? await sthPauseCopy(String(s.tgId)) : await sthMoveMaster(String(s.tgId), strat, lot)).ok;
      if (applied)
        await db.from('member_actions').insert({ tg_id: s.tgId, member_no: mrow?.[0]?.member_no ?? null, kind: 'note', status: 'done', done_by: 'member (auto STH)', detail: { text: body.action === 'pause' ? '⏸ copy paused — applied automatically via STH' : '▶ copy resumed — applied automatically via STH' } as never });
      else await queueAction(s.tgId, body.action, {}); // backup : le support (dés)active la copie à la main
    }
  } else {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  const { error } = await db.from('members').update(patch).eq('tg_id', s.tgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data } = await db.from('members').select(SAFE).eq('tg_id', s.tgId).limit(1);
  return NextResponse.json({ member: data?.[0] ?? null });
}
