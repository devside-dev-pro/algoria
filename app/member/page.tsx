'use client';
// HOME membre : statut de copie en tête (la réassurance n°1), badge Member #N, Risk Studio, derniers trades d'Algoria.
import { useEffect, useState } from 'react';
import { useMe, StatusPill, RiskPicker, type Member } from './ui';

interface FeedTrade { ticket: string; symbol: string; direction: string; pnl: number; r: number | null; closed_at: string }

export default function MemberHome() {
  const { member, setMember, loading } = useMe({ requireOnboarded: true });
  const [trades, setTrades] = useState<FeedTrade[]>([]);
  const [busy, setBusy] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  useEffect(() => {
    void fetch('/api/member/feed').then(async (r) => (r.ok ? setTrades(((await r.json()) as { trades: FeedTrade[] }).trades.slice(0, 8)) : null));
  }, []);
  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;

  const act = (action: 'pause' | 'resume' | 'risk', tier?: string) => {
    setBusy(true);
    void fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(tier ? { tier } : {}) }) })
      .then(async (r) => { const d = (await r.json()) as { member?: Member }; if (d.member) setMember(d.member); })
      .finally(() => { setBusy(false); setRiskOpen(false); });
  };

  const wins = trades.filter((t) => Number(t.pnl) > 0);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      {/* identité + statut */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {member.photo_url
            ? <img src={member.photo_url} alt="" width={42} height={42} style={{ borderRadius: '50%', border: '2px solid rgba(245,194,74,.5)' }} />
            : <span style={{ width: 42, height: 42, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, background: 'linear-gradient(135deg,#2be3f5,#1e40e5)', color: '#0b0e14' }}>{(member.tg_name ?? '?').charAt(0).toUpperCase()}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 750, fontSize: 15.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.tg_name ?? member.tg_username}</div>
            <div className="mono goldText" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1 }}>MEMBER #{member.member_no}</div>
          </div>
          <form action="/api/member/logout" method="post"><button style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', borderRadius: 8, padding: '5px 9px', fontSize: 11, cursor: 'pointer' }}>sign out</button></form>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <StatusPill status={member.status} />
          {member.status === 'pending_copier' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>we&apos;re linking your account — you&apos;ll go live shortly</span>}
          {(member.status === 'live' || member.status === 'paused') && (
            <button disabled={busy} onClick={() => act(member.status === 'paused' ? 'resume' : 'pause')} style={{ marginLeft: 'auto', border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)', color: member.status === 'paused' ? 'var(--up)' : 'var(--muted)', borderRadius: 9, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {member.status === 'paused' ? '▶ RESUME COPYING' : '⏸ PAUSE COPYING'}
            </button>
          )}
        </div>
      </section>

      {/* Risk Studio */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>RISK PROFILE</h2>
          <button onClick={() => setRiskOpen((o) => !o)} style={{ border: 'none', background: 'transparent', color: 'var(--cyan)', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>{riskOpen ? 'close' : 'change'}</button>
        </div>
        {!riskOpen ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="mono" style={{ fontSize: 24, fontWeight: 800, color: member.risk_tier === 'high' ? 'var(--gold)' : 'var(--cyan)' }}>
              {member.risk_tier === 'low' ? '0.01' : member.risk_tier === 'high' ? '0.10' : '0.05'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>lot per Algoria trade · {member.risk_tier === 'low' ? 'cautious' : member.risk_tier === 'high' ? 'aggressive' : 'balanced'}</span>
          </div>
        ) : (
          <RiskPicker value={member.risk_tier} busy={busy} onPick={(t) => act('risk', t)} />
        )}
      </section>

      {/* Derniers trades d'Algoria (le moteur que tu copies) */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>ALGORIA — LATEST TRADES</h2>
          {wins.length > 0 && <span className="mono" style={{ fontSize: 11, color: 'var(--up)' }}>✓ {wins.length}/{trades.length} wins</span>}
        </div>
        {trades.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>The AI is hunting — trades appear here as they close.</p>}
        {trades.map((t) => {
          const win = Number(t.pnl) > 0;
          return (
            <div key={t.ticket} style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: win ? 1 : 0.55 }}>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', minWidth: 38 }}>{new Date(t.closed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: t.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>{t.direction === 'long' ? '▲' : '▼'}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.symbol}</span>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 12.5, fontWeight: win ? 800 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{win ? '✓ +' : ''}{Number(t.pnl).toFixed(0)}$</span>
            </div>
          );
        })}
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--dim)' }}>Master account results — your copies scale with your risk profile.</p>
      </section>
    </main>
  );
}
