import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin, decryptSecret } from '@/lib/member/server';
import { MILESTONES, commissionForActivation } from '@/lib/member/affiliate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Gestion de la liste VIP (support) : seuls les @ de ADMIN_TG_USERNAMES passent.
function guard(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s || !isAdmin(s.username)) return null;
  return s;
}

export async function GET(req: NextRequest) {
  const s = guard(req);
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const db = sdb();
  const [wl, members, actions, commsQ, payoutsQ, depositsQ] = await Promise.all([
    db.from('member_whitelist').select('*').order('created_at', { ascending: false }),
    db.from('members').select('member_no,tg_id,tg_username,tg_name,status,broker,risk_tier,created_at,mt5_login,mt5_server,usdt_trc20,referred_by').order('member_no', { ascending: false }).limit(200),
    db.from('member_actions').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(100),
    db.from('referral_commissions').select('*').order('created_at', { ascending: false }).limit(300),
    db.from('referral_payouts').select('*').order('created_at', { ascending: false }).limit(200),
    // REGISTRE DES DÉPÔTS (bilan broker) : lignes saisies par l'admin, kind='deposit' status='done'
    // (jamais dans la file). Stockées dans member_actions — zéro migration, pattern du stash kyc.
    db.from('member_actions').select('*').eq('kind', 'deposit').order('created_at', { ascending: false }).limit(500),
  ]);
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
  return NextResponse.json({ whitelist: wl.data ?? [], members: members.data ?? [], actions: actions.data ?? [], affiliate, deposits: depositsQ.data ?? [] });
}

export async function POST(req: NextRequest) {
  const s = guard(req);
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    add?: string; remove?: string; done?: string; reveal?: string; liveAlert?: boolean;
    confirmCommission?: string; cancelCommission?: string; payoutPaid?: string; payoutReject?: string; reason?: string; tx?: string;
    rejectConnect?: string;
    addDeposit?: { tg_id: number; broker?: string; amount: number; commission?: number; date?: string; note?: string };
    updateDeposit?: { id: string; amount?: number; commission?: number; comStatus?: string; note?: string; broker?: string; date?: string };
    deleteDeposit?: string;
  };
  const db = sdb();
  const who = s.username ?? String(s.tgId);

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
    const { error } = await db.from('member_actions').update({ detail: det as never }).eq('id', u.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    await db.from('members').update({ status: 'onboarding', onboarding_step: 1, updated_at: new Date().toISOString() })
      .eq('tg_id', act.tg_id).eq('status', 'pending_copier');
    const { pushToUser } = await import('@/lib/push/send');
    void pushToUser(Number(act.tg_id), {
      title: 'Connection request declined',
      body: `${reason} — open the app to fix your details and resubmit.`,
      url: '/member/onboarding',
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
  if (body.reveal) {
    // RÉVÉLATION des identifiants MT5 (admin uniquement) : nécessaire pour brancher le compte dans STH.
    // Déchiffré à la volée côté serveur, jamais stocké en clair ; la révélation est HORODATÉE sur l'action (audit).
    const { data: act } = await db.from('member_actions').select('id,tg_id,detail').eq('id', body.reveal).limit(1);
    if (!act?.length) return NextResponse.json({ error: 'action not found' }, { status: 404 });
    const { data: m } = await db.from('members').select('mt5_login,mt5_server,mt5_password_enc').eq('tg_id', act[0].tg_id).limit(1);
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
  if (body.done) {
    // Le support a appliqué l'action dans Social Trade Hub → on la clôt ; un 'connect' fait passer le membre en LIVE.
    const { data: act } = await db.from('member_actions').select('id,tg_id,kind').eq('id', body.done).eq('status', 'pending').limit(1);
    if (!act?.length) return NextResponse.json({ error: 'action not found' }, { status: 404 });
    await db.from('member_actions').update({ status: 'done', done_at: new Date().toISOString(), done_by: s.username ?? String(s.tgId) }).eq('id', body.done);
    if (act[0].kind === 'connect') {
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
      // Montant : 50$, puis 75$ à partir du palier 10 (grille dans lib/member/affiliate.ts).
      const { data: mm } = await db.from('members').select('referred_by,member_no').eq('tg_id', act[0].tg_id).limit(1);
      const refBy = mm?.[0]?.referred_by ? Number(mm[0].referred_by) : null;
      if (refBy) {
        const { data: dupe } = await db.from('referral_commissions').select('id').eq('referred_tg_id', act[0].tg_id).eq('kind', 'referral').limit(1);
        if (!dupe?.length) {
          // le même filleul ne génère JAMAIS deux commissions (re-connect après pause, etc.)
          const { data: prior } = await db.from('referral_commissions').select('id').eq('referrer_tg_id', refBy).eq('kind', 'referral').neq('status', 'canceled');
          await db.from('referral_commissions').insert({
            referrer_tg_id: refBy,
            referred_tg_id: act[0].tg_id,
            kind: 'referral',
            amount: commissionForActivation(prior?.length ?? 0),
            detail: { referred_member_no: mm?.[0]?.member_no ?? null } as never,
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
