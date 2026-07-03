'use client';
// PROFIL — identité (Member #N), Risk Studio, compte broker/MT5, pause/reprise, déconnexion.
// Le Home reste focalisé sur le statut + les trades ; tout ce qui est "réglages du compte" vit ici.
import { useState } from 'react';
import { useMe, StatusPill, RiskPicker, type Member } from '../ui';

export default function Profile() {
  const { member, setMember, referral, loading } = useMe({ requireOnboarded: true });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;

  const act = (action: 'pause' | 'resume' | 'risk', tier?: string) => {
    setBusy(true);
    void fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(tier ? { tier } : {}) }) })
      .then(async (r) => { const d = (await r.json()) as { member?: Member }; if (d.member) setMember(d.member); })
      .finally(() => setBusy(false));
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

      {/* PARRAINAGE — le moteur de croissance : invite un ami, gagne du cash quand il active son compte */}
      {referral?.code && (
        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'rgba(245,194,74,.35)' }}>
          <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2 }} className="goldText">REFER & EARN</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            Invite a friend with your link. When their account is <strong style={{ color: 'var(--text)' }}>activated</strong> (min $500 deposit verified), you earn{' '}
            <strong className="goldText">${referral.rewardUsd}</strong>. No limit — refer 10 friends, earn ${referral.rewardUsd * 10}.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="mono" style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', fontSize: 12.5, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              app.algoria.tech/r/{referral.code}
            </span>
            <button
              onClick={() => {
                const link = `https://app.algoria.tech/r/${referral.code}`;
                if (navigator.share) void navigator.share({ title: 'Join Algoria', text: 'The AI that trades gold & the Nasdaq — get in with my link:', url: link }).catch(() => {});
                else { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); }
              }}
              style={{ padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 12, letterSpacing: 0.5, color: '#0b0e14', background: 'linear-gradient(90deg,#ffd166,#f5a623)' }}
            >
              {copied ? '✓ COPIED' : 'SHARE'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <RefStat label="INVITED" value={String(referral.invited)} />
            <RefStat label="ACTIVATED" value={String(referral.activated)} color="var(--up)" />
            <RefStat label="EARNED" value={`$${referral.earnedUsd}`} gold />
            {referral.pendingUsd > 0 && <RefStat label="ON THE WAY" value={`$${referral.pendingUsd}`} color="var(--cyan)" />}
          </div>
        </section>
      )}

      {/* Risk Studio */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>RISK PROFILE</h2>
        <RiskPicker value={member.risk_tier} busy={busy} onPick={(t) => act('risk', t)} />
        <p style={{ margin: 0, fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>Changes are applied by the team within a few hours — you&apos;ll see it reflected on your MT5.</p>
      </section>

      {/* compte */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>TRADING ACCOUNT</h2>
        <RowKV k="Broker" v={member.broker ? member.broker.toUpperCase() : '—'} />
        <RowKV k="MT5 login" v={member.mt5_login ?? '—'} />
        <RowKV k="Server" v={member.mt5_server ?? '—'} />
        <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5 }}>Your password is encrypted and never displayed. To revoke access, change it on your broker account.</p>
      </section>

      <form action="/api/member/logout" method="post" style={{ display: 'flex' }}>
        <button style={{ flex: 1, border: '1px solid rgba(255,107,138,.3)', background: 'rgba(255,107,138,.05)', color: 'rgba(210,150,165,.9)', borderRadius: 11, padding: '11px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>SIGN OUT</button>
      </form>
    </main>
  );
}

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
