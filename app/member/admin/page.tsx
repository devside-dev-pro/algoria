'use client';
// ADMIN (support) — gestion de la liste VIP (@ Telegram autorisés en plus des acceptés du canal) + vue membres.
// Accès : uniquement les @ de ADMIN_TG_USERNAMES (vérifié serveur — cette page n'est qu'une façade).
import { useEffect, useState } from 'react';
import { useMe } from '../ui';

interface WL { username: string; added_by: string | null; created_at: string }
interface Row { member_no: number; tg_username: string | null; tg_name: string | null; status: string; broker: string | null; risk_tier: string; created_at: string }

export default function MemberAdmin() {
  const { member, admin, loading } = useMe();
  const [wl, setWl] = useState<WL[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const load = () =>
    void fetch('/api/member/admin').then(async (r) => {
      if (r.status === 403) return setForbidden(true);
      const d = (await r.json()) as { whitelist: WL[]; members: Row[] };
      setWl(d.whitelist);
      setRows(d.members);
    });
  useEffect(() => { load(); }, []);
  if (loading || !member) return <Center>loading…</Center>;
  if (forbidden || !admin) return <Center>admin only</Center>;
  const post = (body: Record<string, string>) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (r) => { const d = (await r.json()) as { whitelist?: WL[] }; if (d.whitelist) setWl(d.whitelist); setInput(''); })
      .finally(() => setBusy(false));
  };
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11 }}>
        <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>VIP WHITELIST</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="@username" style={{ flex: 1, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 14, outline: 'none' }} />
          <button disabled={busy || !input.trim()} onClick={() => post({ add: input })} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }}>ADD</button>
        </div>
        {wl.map((w) => (
          <div key={w.username} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ color: 'var(--text)' }}>@{w.username}</span>
            <span style={{ fontSize: 10, color: 'var(--dim)' }}>by {w.added_by ?? '—'}</span>
            <span style={{ flex: 1 }} />
            <button disabled={busy} onClick={() => post({ remove: w.username })} style={{ border: '1px solid rgba(255,107,138,.35)', background: 'transparent', color: 'rgba(210,150,165,.85)', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>remove</button>
          </div>
        ))}
        {wl.length === 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>Empty — channel-accepted users get in automatically; add VIP handles here.</p>}
      </section>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>MEMBERS · {rows.length}</h2>
        {rows.map((r) => (
          <div key={r.member_no} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, borderBottom: '1px solid rgba(130,152,190,.08)', padding: '5px 0' }}>
            <span className="goldText" style={{ fontWeight: 800, minWidth: 36 }}>#{r.member_no}</span>
            <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{r.tg_username ? '@' + r.tg_username : r.tg_name}</span>
            <span style={{ color: 'var(--dim)' }}>{r.broker ?? '—'}</span>
            <span style={{ color: 'var(--dim)' }}>{r.risk_tier}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: r.status === 'live' ? 'var(--up)' : r.status === 'paused' ? 'var(--gold)' : 'var(--cyan)' }}>{r.status}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>{children}</main>;
}
