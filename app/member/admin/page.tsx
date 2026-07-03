'use client';
// ADMIN (support) — gestion de la liste VIP (@ Telegram autorisés en plus des acceptés du canal) + vue membres.
// Accès : uniquement les @ de ADMIN_TG_USERNAMES (vérifié serveur — cette page n'est qu'une façade).
import { useEffect, useState } from 'react';
import { useMe } from '../ui';

interface WL { username: string; added_by: string | null; created_at: string }
interface Row { member_no: number; tg_username: string | null; tg_name: string | null; status: string; broker: string | null; risk_tier: string; created_at: string }
interface Action { id: string; member_no: number | null; kind: string; detail: Record<string, unknown> | null; created_at: string }

export default function MemberAdmin() {
  const { member, admin, loading } = useMe();
  const [wl, setWl] = useState<WL[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  // identifiants révélés (par action, en mémoire uniquement — disparaissent au DONE / rechargement).
  // IMPORTANT : déclaré AVANT les returns conditionnels (ordre des hooks stable, sinon crash client).
  const [creds, setCreds] = useState<Record<string, { login: string; server: string; password: string }>>({});
  const load = () =>
    void fetch('/api/member/admin').then(async (r) => {
      if (r.status === 403) return setForbidden(true);
      const d = (await r.json()) as { whitelist: WL[]; members: Row[]; actions: Action[] };
      setWl(d.whitelist);
      setRows(d.members);
      setActions(d.actions ?? []);
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
  const doneAction = (id: string) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: id }) })
      .then(async (r) => { const d = (await r.json()) as { actions?: Action[] }; if (d.actions) setActions(d.actions); setCreds((c) => { const n = { ...c }; delete n[id]; return n; }); })
      .finally(() => setBusy(false));
  };
  const reveal = (id: string) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reveal: id }) })
      .then(async (r) => { const d = (await r.json()) as { login?: string; server?: string; password?: string; error?: string }; if (d.password) setCreds((c) => ({ ...c, [id]: { login: d.login ?? '', server: d.server ?? '', password: d.password! } })); })
      .finally(() => setBusy(false));
  };
  const KIND_LABEL: Record<string, string> = { connect: '🔌 CONNECT ACCOUNT', risk_change: '⚖ RISK CHANGE', pause: '⏸ PAUSE COPY', resume: '▶ RESUME COPY', referral_reward: '💰 PAY REFERRAL REWARD' };
  const liveAlert = () => {
    if (!window.confirm('Send "🔴 ALGORIA IS LIVE" to every subscribed member?')) return;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ liveAlert: true }) })
      .then(async (r) => { const d = (await r.json()) as { sent?: number }; window.alert(`Live alert sent to ${d.sent ?? 0} device(s).`); })
      .finally(() => setBusy(false));
  };
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      {/* 📣 avant de lancer le stream : un tap → tous les téléphones membres vibrent → audience sur le live */}
      <button disabled={busy} onClick={liveAlert} style={{ padding: '13px 16px', borderRadius: 12, border: '1px solid rgba(255,90,60,.55)', background: 'rgba(255,90,60,.1)', color: '#ff8a5c', fontWeight: 800, letterSpacing: 0.8, fontSize: 13, cursor: 'pointer' }}>
        📣 SEND “ALGORIA IS LIVE” ALERT
      </button>
      {/* File STH : les intentions des membres à appliquer dans Social Trade Hub, dans l'ordre.
          Un 'connect' marqué done passe automatiquement le membre en ● LIVE. */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderColor: actions.length ? 'rgba(245,194,74,.4)' : undefined }}>
        <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: actions.length ? 'var(--gold)' : 'var(--muted)' }}>
          TO APPLY IN SOCIAL TRADE HUB {actions.length > 0 && `· ${actions.length}`}
        </h2>
        {actions.length === 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>Queue clear — nothing to apply.</p>}
        {actions.map((a) => (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '9px 11px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12, minWidth: 36 }}>#{a.member_no ?? '—'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6 }}>{KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}</div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.kind === 'connect' && `MT5 ${String(a.detail?.login ?? '?')} @ ${String(a.detail?.server ?? '?')} · lot ${String(a.detail?.lot ?? '?')}`}
                  {a.kind === 'risk_change' && `→ ${String(a.detail?.to ?? '?')} (lot ${String(a.detail?.lot ?? '?')})`}
                  {a.kind === 'referral_reward' && `$${String(a.detail?.amount ?? '?')} → ${a.detail?.referrer_username ? '@' + String(a.detail.referrer_username) : `member #${a.member_no ?? '?'}`} · referred #${String(a.detail?.referred_member_no ?? '?')}`}
                  {(a.kind === 'pause' || a.kind === 'resume') && new Date(a.created_at).toLocaleString('en-GB')}
                </div>
              </div>
              {a.kind === 'connect' && !creds[a.id] && (
                <button disabled={busy} onClick={() => reveal(a.id)} title="decrypt the member's MT5 password to add the account in STH (timestamped)" style={{ border: '1px solid rgba(245,194,74,.45)', background: 'rgba(245,194,74,.08)', color: 'var(--gold)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>🔑 REVEAL</button>
              )}
              <button disabled={busy} onClick={() => doneAction(a.id)} style={{ border: '1px solid rgba(31,216,176,.45)', background: 'rgba(31,216,176,.1)', color: 'var(--up)', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>✓ DONE</button>
            </div>
            {creds[a.id] && (
              <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.06)' }}>
                <span>login <b style={{ color: 'var(--text)' }}>{creds[a.id].login}</b></span>
                <span>server <b style={{ color: 'var(--text)' }}>{creds[a.id].server}</b></span>
                <span>password <b style={{ color: 'var(--gold)' }}>{creds[a.id].password}</b></span>
                <button onClick={() => void navigator.clipboard?.writeText(creds[a.id].password)} style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', borderRadius: 6, padding: '2px 8px', fontSize: 10.5, cursor: 'pointer' }}>copy</button>
              </div>
            )}
          </div>
        ))}
      </section>
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
