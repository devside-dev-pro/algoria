import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, encryptSecret, isAdmin, isVip } from '@/lib/member/server';
import { MIN_PAYOUT_USD, TRC20_RE, commissionForActivation, nextMilestone } from '@/lib/member/affiliate';

const TIER_LOT: Record<string, string> = { low: '0.01', balanced: '0.05', high: '0.10' };

/** Pousse une action dans la file copieur (appliquée dans STH par le support, puis par l'API quand elle arrivera). */
async function queueAction(tgId: number, kind: string, detail: Record<string, unknown>) {
  const db = sdb();
  const { data } = await db.from('members').select('member_no').eq('tg_id', tgId).limit(1);
  await db.from('member_actions').insert({ tg_id: tgId, member_no: data?.[0]?.member_no ?? null, kind, detail: detail as never });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Champs SÛRS renvoyés au client — jamais les identifiants MT5 (même chiffrés).
const SAFE = 'member_no,tg_username,tg_name,photo_url,status,broker,risk_tier,onboarding_step,created_at,mt5_login,mt5_server,referral_code,usdt_trc20';

async function me(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const { data } = await sdb().from('members').select(SAFE).eq('tg_id', s.tgId).limit(1);
  return data?.[0] ? { session: s, member: data[0] as Record<string, unknown> } : null;
}

/** État du membre connecté (Home + wizard) + WALLET d'affiliation (commissions, retraits, paliers).
 *  Balance retirable = Σ commissions confirmées − Σ retraits (demandés + payés) — calculée ICI, jamais côté client. */
export async function GET(req: NextRequest) {
  const ctx = await me(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sdb();
  const [refs, commsQ, payoutsQ, rejQ] = await Promise.all([
    db.from('members').select('status').eq('referred_by', ctx.session.tgId),
    db.from('referral_commissions').select('id,kind,amount,status,reason,detail,created_at').eq('referrer_tg_id', ctx.session.tgId).order('created_at', { ascending: false }),
    db.from('referral_payouts').select('id,amount,address,status,tx_hash,reason,created_at').eq('tg_id', ctx.session.tgId).order('created_at', { ascending: false }),
    // dernière connexion REFUSÉE (vérification broker) — affichée dans le wizard pour corriger et re-soumettre
    db.from('member_actions').select('detail,done_at').eq('tg_id', ctx.session.tgId).eq('kind', 'connect').eq('status', 'rejected').order('done_at', { ascending: false }).limit(1),
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
  return NextResponse.json({ member: ctx.member, admin, unlocked, referral, rejection });
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

  if (body.action === 'broker') {
    const broker = String(body.broker ?? '').slice(0, 40);
    if (!broker) return NextResponse.json({ error: 'broker required' }, { status: 400 });
    patch.broker = broker;
    patch.onboarding_step = 1;
  } else if (body.action === 'mt5') {
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
      detail: { broker_name: fullName, declared_deposit: deposit } as never,
    });
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
      await queueAction(s.tgId, 'risk_change', { to: tier, lot: TIER_LOT[tier] }); // → le support règle le lot dans STH
    }
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
  } else if (body.action === 'pause' || body.action === 'resume') {
    // GARDE-FOU : le statut gate maintenant le contenu (mode teaser) — un prospect ne doit pas pouvoir
    // s'auto-promouvoir en 'live' via un simple POST resume. Réservé aux comptes déjà activés.
    if (!['live', 'paused'].includes(cur.status)) return NextResponse.json({ error: 'copy not activated yet' }, { status: 403 });
    patch.status = body.action === 'pause' ? 'paused' : 'live';
    await queueAction(s.tgId, body.action, {}); // → le support (dés)active la copie dans STH
  } else {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  const { error } = await db.from('members').update(patch).eq('tg_id', s.tgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data } = await db.from('members').select(SAFE).eq('tg_id', s.tgId).limit(1);
  return NextResponse.json({ member: data?.[0] ?? null });
}
