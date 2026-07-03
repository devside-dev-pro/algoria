'use client';
// HISTORY — les trades clôturés d'Algoria (compte maître). L'historique PERSONNEL (son compte, son lot)
// arrive avec le branchement de l'API du copieur — bannière honnête en attendant.
import { useEffect, useState } from 'react';
import { useMe } from '../ui';

interface FeedTrade { ticket: string; symbol: string; direction: string; entry: number; exit: number; pnl: number; r: number | null; reason: string; closed_at: string }

export default function MemberHistory() {
  const { member, loading } = useMe({ requireOnboarded: true });
  const [trades, setTrades] = useState<FeedTrade[]>([]);
  useEffect(() => {
    void fetch('/api/member/feed').then(async (r) => (r.ok ? setTrades(((await r.json()) as { trades: FeedTrade[] }).trades) : null));
  }, []);
  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;
  const wins = trades.filter((t) => Number(t.pnl) > 0).length;
  const net = trades.reduce((a, t) => a + Number(t.pnl), 0);
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      <section className="panel" style={{ padding: 16, display: 'flex', gap: 18 }}>
        <Stat label="TRADES" value={String(trades.length)} />
        <Stat label="WINS" value={trades.length ? `${Math.round((wins / trades.length) * 100)}%` : '—'} color="var(--up)" />
        <Stat label="NET (MASTER)" value={net > 0 ? `+${net.toFixed(0)}$` : '—'} gold={net > 0} />
      </section>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {trades.map((t) => {
          const win = Number(t.pnl) > 0;
          return (
            <div key={t.ticket} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderBottom: '1px solid rgba(130,152,190,.1)', opacity: win ? 1 : 0.55 }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', minWidth: 60 }}>{new Date(t.closed_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} {new Date(t.closed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: t.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>{t.direction === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.symbol}</span>
              <span style={{ flex: 1 }} />
              {t.reason === 'be' && <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>BE</span>}
              <span className="mono" style={{ fontSize: 13, fontWeight: win ? 800 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)', minWidth: 58, textAlign: 'right' }}>{win ? '✓ +' : ''}{Number(t.pnl).toFixed(0)}$</span>
            </div>
          );
        })}
        {trades.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>No closed trades yet today.</p>}
      </section>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.55 }}>
        Master account results. Your personal history — your account, your lot size — lands here once your copier link is live.
      </p>
    </main>
  );
}

function Stat({ label, value, color, gold }: { label: string; value: string; color?: string; gold?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)' }}>{label}</span>
      <span className={gold ? 'mono goldText' : 'mono'} style={{ fontSize: 19, fontWeight: 800, ...(gold ? {} : { color: color ?? 'var(--text)' }) }}>{value}</span>
    </div>
  );
}
