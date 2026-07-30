'use client';
// PROFIL — identité (Member #N), Risk Studio, parrainage, notifications push, compte, déconnexion.
// Le Home reste focalisé sur le statut + les trades ; tout ce qui est "réglages du compte" vit ici.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useMe, StatusPill, StrategyPicker, Locked, UnlockSheet, type Member, type Referral } from '../ui';
import { TRC20_RE } from '@/lib/member/affiliate';
import { LOT_CHOICES } from '@/lib/member/lots';
import { pushState, enablePush, disablePush } from '@/lib/push/client';

// Alertes push : wins d'Algoria, recap du jour, annonce de live. Opt-in explicite (permission navigateur).
// Logique partagée avec la popup d'install (lib/push/client.ts) — ici c'est le réglage manuel dans Profile.
function PushCard() {
  const [state, setState] = useState<'unsupported' | 'off' | 'on' | 'denied' | 'busy'>('busy');
  useEffect(() => { void pushState().then(setState); }, []);
  const enable = async () => {
    setState('busy');
    const ok = await enablePush();
    setState(ok ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off');
  };
  const disable = async () => {
    setState('busy');
    try { await disablePush(); } finally { setState('off'); }
  };
  if (state === 'unsupported') return null;
  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>NOTIFICATIONS</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
        Get pinged when <strong style={{ color: 'var(--text)' }}>Algoria cashes a win</strong>, the daily recap drops, and when the live starts.
      </p>
      {state === 'denied' ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>Notifications are blocked in your browser settings — allow them for this site to enable alerts.</p>
      ) : (
        <button
          disabled={state === 'busy'}
          onClick={() => void (state === 'on' ? disable() : enable())}
          style={{
            padding: '11px 16px', borderRadius: 11, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.5, fontSize: 12.5,
            color: state === 'on' ? 'var(--up)' : '#0b0e14',
            background: state === 'on' ? 'rgba(31,216,176,.12)' : 'linear-gradient(90deg,#2be3f5,#2e8bf0)',
            outline: state === 'on' ? '1px solid rgba(31,216,176,.45)' : 'none',
          }}
        >
          {state === 'busy' ? '…' : state === 'on' ? '🔔 ALERTS ON — tap to disable' : '🔔 ENABLE PUSH ALERTS'}
        </button>
      )}
    </section>
  );
}

export default function Profile() {
  const router = useRouter();
  const { member, setMember, referral: refInit, unlocked, loading } = useMe();
  const [busy, setBusy] = useState(false);
  const [disc, setDisc] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  // copie locale du wallet : rafraîchie après un retrait / changement d'adresse (useMe ne charge qu'une fois)
  const [referral, setReferral] = useState<Referral | null>(null);
  useEffect(() => { if (refInit) setReferral(refInit); }, [refInit]);
  const reloadWallet = () =>
    void fetch('/api/member/me').then(async (r) => { const d = (await r.json()) as { referral?: Referral }; if (d.referral) setReferral(d.referral); });
  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;

  const act = (action: 'pause' | 'resume' | 'strategy', choice?: number) => {
    setBusy(true);
    void fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(choice ? { choice } : {}) }) })
      .then(async (r) => { const d = (await r.json()) as { member?: Member }; if (d.member) setMember(d.member); })
      .finally(() => setBusy(false));
  };
  const setLot = (lot: number) => {
    setBusy(true);
    void fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'lot', lot }) })
      .then(async (r) => { const d = (await r.json()) as { member?: Member; error?: string }; if (d.member) setMember(d.member); })
      .finally(() => setBusy(false));
  };
  // DÉCONNECTER le compte de trading : coupe la copie (queue une action pour STH) et repasse en onboarding
  // pour reconnecter / changer de broker. Confirmation obligatoire (destructif).
  const disconnect = () => {
    if (!window.confirm('Disconnect your trading account? This stops the copy and you’ll re-enter your MT5 details to reconnect.')) return;
    setDisc(true);
    void fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disconnect' }) })
      .then((r) => (r.ok ? router.push('/member/onboarding') : setDisc(false)))
      .catch(() => setDisc(false));
  };
  const since = member.created_at ? new Date(member.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      {/* identité */}
      <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
        {member.photo_url
          ? <img src={member.photo_url} alt="" width={72} height={72} style={{ borderRadius: '50%', border: '2.5px solid rgba(245,194,74,.55)', boxShadow: '0 0 18px rgba(245,194,74,.2)' }} />
          : <span style={{ width: 72, height: 72, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 26, background: 'linear-gradient(135deg,#2be3f5,#1e40e5)', color: '#0b0e14' }}>{(member.tg_name ?? '?').charAt(0).toUpperCase()}</span>}
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{member.tg_name ?? member.tg_username}</div>
          {member.tg_username && <div style={{ fontSize: 12, color: 'var(--dim)' }}>@{member.tg_username}</div>}
        </div>
        <div className="mono goldText" style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.5 }}>MEMBER #{member.member_no}</div>
        {since && <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: 1 }}>MEMBER SINCE {since.toUpperCase()}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <StatusPill status={member.status} />
          {(member.status === 'live' || member.status === 'paused') && (
            <button disabled={busy} onClick={() => act(member.status === 'paused' ? 'resume' : 'pause')} style={{ border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)', color: member.status === 'paused' ? 'var(--up)' : 'var(--muted)', borderRadius: 9, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              {member.status === 'paused' ? '▶ RESUME' : '⏸ PAUSE'}
            </button>
          )}
        </div>
      </section>

      {/* PARTNER HUB — le moteur de croissance : wallet retirable en USDT, paliers, historique */}
      {referral?.code && (
        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 13, borderColor: 'rgba(245,194,74,.35)' }}>
          <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2 }} className="goldText">REFER & EARN</h2>

          {/* wallet — le retirable en GROS : c'est lui qui donne envie de partager le lien */}
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)' }}>WITHDRAWABLE</span>
              <span className="mono goldText" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>${Math.max(0, Math.floor(referral.availableUsd))}</span>
            </div>
            {referral.pendingUsd > 0 && <RefStat label="ON THE WAY" value={`$${referral.pendingUsd}`} color="var(--cyan)" />}
            <RefStat label="TOTAL EARNED" value={`$${referral.totalEarnedUsd}`} color="var(--text)" />
            {referral.paidUsd > 0 && <RefStat label="PAID OUT" value={`$${referral.paidUsd}`} color="var(--up)" />}
          </div>
          <button
            disabled={referral.availableUsd < referral.minPayoutUsd}
            onClick={() => setWithdraw(true)}
            title={referral.availableUsd < referral.minPayoutUsd ? `minimum withdrawal: $${referral.minPayoutUsd}` : 'withdraw to your USDT TRC20 wallet'}
            style={{
              padding: '12px 16px', borderRadius: 12, border: 'none', fontWeight: 800, letterSpacing: 0.5, fontSize: 13,
              cursor: referral.availableUsd < referral.minPayoutUsd ? 'default' : 'pointer',
              color: referral.availableUsd < referral.minPayoutUsd ? 'var(--dim)' : '#0b0e14',
              background: referral.availableUsd < referral.minPayoutUsd ? 'rgba(130,152,190,.12)' : 'linear-gradient(90deg,#ffd166,#f5a623)',
              boxShadow: referral.availableUsd < referral.minPayoutUsd ? 'none' : '0 8px 24px rgba(245,166,35,.25)',
            }}
          >
            💸 WITHDRAW — USDT (TRC20)
          </button>
          {referral.payouts.some((p) => p.status === 'requested') && (
            <p style={{ margin: '-6px 0 0', fontSize: 11, color: 'var(--cyan)' }}>⧗ withdrawal request received — processed manually within 24 h</p>
          )}

          {/* palier suivant — la carotte : barre de progression + récompense teasée */}
          {referral.nextMilestone ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(10,17,31,.55)', border: '1px solid var(--border)', borderRadius: 11, padding: '11px 13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'var(--muted)' }}><b style={{ color: 'var(--text)' }}>{referral.activated}</b> activated</span>
                <span className="goldText" style={{ fontWeight: 800 }}>+${referral.nextMilestone.bonus} at {referral.nextMilestone.at} · {referral.nextMilestone.label}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.06)' }}>
                <div style={{ width: `${Math.min(100, (referral.activated / referral.nextMilestone.at) * 100)}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg,#ffd166,#f5a623)' }} />
              </div>
              <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
                {referral.nextMilestone.remaining} more activation{referral.nextMilestone.remaining > 1 ? 's' : ''} to unlock the bonus
                {referral.nextMilestone.at === 10 ? ' — $500 cash or an iPhone, your pick' : ''}
              </span>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--gold)' }}>🏆 PARTNER status — you earn ${referral.rewardUsd} per activated referral.</p>
          )}
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>
            You earn <b className="goldText">${referral.rewardUsd}</b> for every friend whose account is <b style={{ color: 'var(--text)' }}>activated</b> (minimum deposit verified). Paid in USDT, straight to your wallet.
          </p>

          {/* lien de partage */}
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="mono" style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', fontSize: 12.5, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              app.algoria.tech/r/{referral.code}
            </span>
            <button
              onClick={() => {
                const link = `https://app.algoria.tech/r/${referral.code}`;
                if (navigator.share) void navigator.share({ title: 'Join Algoria', text: 'The AI that trades gold & Bitcoin — get in with my link:', url: link }).catch(() => {});
                else { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); }
              }}
              style={{ padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 12, letterSpacing: 0.5, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }}
            >
              {copied ? '✓ COPIED' : 'SHARE'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <RefStat label="INVITED" value={String(referral.invited)} />
            <RefStat label="ACTIVATED" value={String(referral.activated)} color="var(--up)" />
          </div>

          {/* historique — chaque ligne raconte l'argent : confirmé, en route, annulé, retiré */}
          {(referral.commissions.length > 0 || referral.payouts.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(130,152,190,.12)', paddingTop: 10 }}>
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)' }}>ACTIVITY</span>
              {[...referral.payouts.map((p) => ({ t: p.created_at, el: (
                  <div key={`p${p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                    <span style={{ color: p.status === 'paid' ? 'var(--up)' : p.status === 'rejected' ? 'rgba(210,150,165,.85)' : 'var(--cyan)' }}>
                      {p.status === 'paid' ? '✓' : p.status === 'rejected' ? '✗' : '⧗'}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>withdrawal</span>
                    <span className="mono" style={{ color: 'var(--text)', fontWeight: 700 }}>−${Number(p.amount)}</span>
                    {p.tx_hash && <a href={`https://tronscan.org/#/transaction/${p.tx_hash}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 10, color: 'var(--cyan)', textDecoration: 'none' }}>tx ↗</a>}
                    {p.status === 'rejected' && p.reason && <span style={{ fontSize: 10, color: 'var(--dim)' }}>{p.reason}</span>}
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                  </div>
                ) })),
                ...referral.commissions.map((c) => ({ t: c.created_at, el: (
                  <div key={`c${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, opacity: c.status === 'canceled' ? 0.55 : 1 }}>
                    <span style={{ color: c.status === 'confirmed' ? 'var(--up)' : c.status === 'canceled' ? 'rgba(210,150,165,.85)' : 'var(--gold)' }}>
                      {c.status === 'confirmed' ? '✓' : c.status === 'canceled' ? '✗' : '⧗'}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>{c.kind === 'milestone' ? `🏆 ${String((c.detail as { label?: string })?.label ?? 'milestone')} bonus` : 'referral'}</span>
                    <span className="mono" style={{ color: c.status === 'canceled' ? 'var(--dim)' : 'var(--text)', fontWeight: 700, textDecoration: c.status === 'canceled' ? 'line-through' : 'none' }}>+${Number(c.amount)}</span>
                    <span style={{ fontSize: 10, color: 'var(--dim)' }}>{c.status === 'pending' ? 'on the way' : c.status === 'canceled' ? (c.reason ?? 'canceled') : ''}</span>
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                  </div>
                ) }))]
                .sort((a, b) => Date.parse(b.t) - Date.parse(a.t))
                .slice(0, 8)
                .map((r) => r.el)}
            </div>
          )}
        </section>
      )}
      {referral && (
        <WithdrawSheet
          open={withdraw}
          onClose={() => setWithdraw(false)}
          referral={referral}
          onDone={() => { setWithdraw(false); reloadWallet(); }}
        />
      )}

      {/* Strategy Studio — le levier de risque du membre (stratégie + taille de copie) */}
      <Locked unlocked={unlocked} onUnlock={() => setPaywall(true)} label="STRATEGY — MEMBERS ONLY">
        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>YOUR STRATEGY</h2>
          <StrategyPicker value={member.strategy ?? 2} busy={busy || !unlocked} onPick={(id) => act('strategy', id)} />
          {/* texte corrigé le 30/07 : depuis le passage en full-auto (STH), le changement est immédiat —
              la file support n'est plus qu'un repli si l'API refuse (receiver ajouté à la main). */}
          <p style={{ margin: 0, fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>Applied instantly — your account moves to the strategy&apos;s master right away.</p>
        </section>
      </Locked>

      {/* COPY SIZE — le VRAI lot copieur, choisi par le membre. Auto-appliqué via STH quand le compte est
          API-connecté ; sinon la demande part en file support. Recommandation affichée : 0.01 par ~$500. */}
      <Locked unlocked={unlocked} onUnlock={() => setPaywall(true)} label="COPY SIZE — MEMBERS ONLY">
        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>COPY SIZE</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LOT_CHOICES.map((l) => {
              const active = Number(member.lot ?? 0.01) === l;
              return (
                <button key={l} disabled={busy || !unlocked || active} onClick={() => setLot(l)}
                  style={{ flex: '1 1 56px', padding: '11px 8px', borderRadius: 10, cursor: active ? 'default' : 'pointer', fontWeight: 800, fontSize: 13,
                    border: `1px solid ${active ? 'rgba(43,227,245,.55)' : 'var(--border)'}`,
                    background: active ? 'rgba(43,227,245,.1)' : 'rgba(10,17,31,.55)',
                    color: active ? 'var(--cyan)' : 'var(--muted)' }}>
                  {l.toFixed(2)}
                </button>
              );
            })}
          </div>
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
            Every trade copies to your account at this fixed size. <b style={{ color: 'var(--text)' }}>Recommended: 0.01 per ~$500 of balance</b> — bigger moves both your wins <i>and</i> your losses up.
          </p>
          <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5 }}>Applied instantly when your account is API-connected — otherwise the team applies it within a few hours.</p>
        </section>
      </Locked>

      <PushCard />

      {/* SUPPORT direct — un membre (ou prospect) qui a une question doit toujours avoir une porte humaine */}
      <a href="https://t.me/mathieu_algoria" target="_blank" rel="noreferrer" className="panel"
        style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'var(--text)', borderColor: 'rgba(43,227,245,.28)' }}>
        <span style={{ fontSize: 20 }}>💬</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Need help? Talk to Mathieu</span>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--cyan)' }}>@mathieu_algoria — direct Telegram, real human</span>
        </span>
        <span style={{ color: 'var(--cyan)', fontSize: 18 }}>›</span>
      </a>

      {/* compte — grisé tant que l'accès n'est pas activé */}
      <Locked unlocked={unlocked} onUnlock={() => setPaywall(true)} label="TRADING ACCOUNT — MEMBERS ONLY">
        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>TRADING ACCOUNT</h2>
          <RowKV k="Broker" v={member.broker ? member.broker.toUpperCase() : '—'} />
          <RowKV k="MT5 login" v={member.mt5_login ?? '—'} />
          <RowKV k="Server" v={member.mt5_server ?? '—'} />
          <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5 }}>Your password is encrypted and never displayed. To revoke access, change it on your broker account.</p>
          <button onClick={disconnect} disabled={disc} style={{ alignSelf: 'flex-start', marginTop: 4, border: '1px solid rgba(255,107,138,.28)', background: 'transparent', color: 'rgba(210,150,165,.9)', borderRadius: 9, padding: '8px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
            {disc ? 'Disconnecting…' : 'Disconnect / change trading account'}
          </button>
        </section>
      </Locked>

      <form action="/api/member/logout" method="post" style={{ display: 'flex' }}>
        <button style={{ flex: 1, border: '1px solid rgba(255,107,138,.3)', background: 'rgba(255,107,138,.05)', color: 'rgba(210,150,165,.9)', borderRadius: 11, padding: '11px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>SIGN OUT</button>
      </form>
      {!unlocked && <UnlockSheet open={paywall} onClose={() => setPaywall(false)} status={member.status} />}
    </main>
  );
}

// SHEET DE RETRAIT — adresse TRC20 (validée, sauvegardée) + montant → demande traitée à la main dans l'admin.
// Portal vers <body> (même leçon que UnlockSheet : jamais de fixed DANS .appScroll sur iOS).
function WithdrawSheet({ open, onClose, referral, onDone }: { open: boolean; onClose: () => void; referral: Referral; onDone: () => void }) {
  const [address, setAddress] = useState(referral.address ?? '');
  const [amount, setAmount] = useState(String(Math.max(0, Math.floor(referral.availableUsd))));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setAddress(referral.address ?? '');
      setAmount(String(Math.max(0, Math.floor(referral.availableUsd))));
      setErr(null);
    }
  }, [open, referral.address, referral.availableUsd]);
  if (!open || typeof document === 'undefined') return null;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const addr = address.trim();
      if (!TRC20_RE.test(addr)) throw new Error('invalid TRC20 address — it starts with T and has 34 characters');
      const n = Math.floor(Number(amount));
      if (!Number.isFinite(n) || n < referral.minPayoutUsd) throw new Error(`minimum withdrawal is $${referral.minPayoutUsd}`);
      if (addr !== referral.address) {
        const r1 = await fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'trc20', address: addr }) });
        if (!r1.ok) throw new Error(((await r1.json()) as { error?: string }).error ?? 'could not save address');
      }
      const r2 = await fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'withdraw', amount: n }) });
      if (!r2.ok) throw new Error(((await r2.json()) as { error?: string }).error ?? 'withdrawal failed');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(3,7,15,.74)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div
        className="cardIn"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, borderRadius: '22px 22px 0 0', borderBottom: 'none',
          border: '1px solid rgba(245,194,74,.42)', background: 'linear-gradient(180deg, #132342 0%, #0a1425 100%)',
          boxShadow: '0 -18px 60px rgba(2,6,16,.8), 0 0 34px rgba(245,194,74,.1)',
          padding: '20px 20px max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12,
          maxHeight: '86dvh', overflowY: 'auto',
        }}
      >
        <span style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(130,152,190,.35)', margin: '0 auto' }} />
        <h2 style={{ margin: 0, fontSize: 19, textAlign: 'center' }}>💸 Withdraw your earnings</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, textAlign: 'center' }}>
          Sent in <b style={{ color: 'var(--text)' }}>USDT on the TRON network (TRC20)</b> — make sure your wallet supports it. Processed manually within 24 h; you&rsquo;ll get the transaction hash as proof.
        </p>
        <label style={wdLbl}>your USDT TRC20 address
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="T…" spellCheck={false} className="mono" style={wdInp} />
        </label>
        <label style={wdLbl}>amount (available: ${Math.max(0, Math.floor(referral.availableUsd))})
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" style={wdInp} />
        </label>
        {err && <p style={{ margin: 0, fontSize: 12, color: 'rgba(210,150,165,.9)' }}>⚠ {err}</p>}
        <button
          disabled={busy}
          onClick={() => void submit()}
          style={{ padding: '14px 16px', borderRadius: 13, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.6, fontSize: 14, color: '#0b0e14', background: 'linear-gradient(90deg,#ffd166,#f5a623)', boxShadow: '0 8px 26px rgba(245,166,35,.28)', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'SENDING…' : `REQUEST WITHDRAWAL — $${Math.floor(Number(amount) || 0)}`}
        </button>
        <p className="mono" style={{ margin: 0, fontSize: 9.5, color: 'var(--dim)', letterSpacing: 0.5, textAlign: 'center' }}>DOUBLE-CHECK YOUR ADDRESS — CRYPTO TRANSFERS CANNOT BE REVERSED</p>
      </div>
    </div>,
    document.body
  );
}
const wdLbl = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10.5, letterSpacing: 1, color: 'var(--dim)', textTransform: 'uppercase' } as const;
const wdInp = { padding: '12px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 14.5, outline: 'none' } as const;

function RefStat({ label, value, color, gold }: { label: string; value: string; color?: string; gold?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, letterSpacing: 1.2, color: 'var(--dim)' }}>{label}</span>
      <span className={gold ? 'mono goldText' : 'mono'} style={{ fontSize: 17, fontWeight: 800, ...(gold ? {} : { color: color ?? 'var(--text)' }) }}>{value}</span>
    </div>
  );
}

function RowKV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11.5, color: 'var(--dim)', minWidth: 90 }}>{k}</span>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{v}</span>
    </div>
  );
}
