'use client';
// ALGORIA ADMIN — le back-office CRM de l'opérateur (admin.algoria.tech). Desktop-first, hors coque membre.
// 5 espaces : DASHBOARD (les chiffres qui comptent), QUEUE (à appliquer dans Social Trade Hub),
// MEMBERS (le CRM : recherche, statuts, comptes), AFFILIATE (l'argent des parrains), TOOLS (whitelist, push).
// Garde : l'API /api/member/admin renvoie 403 à quiconque n'est pas dans ADMIN_TG_USERNAMES — cette page
// n'est qu'une façade. Session : le même login Telegram que l'espace membre.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

interface WL { username: string; added_by: string | null; created_at: string }
interface Row {
  member_no: number; tg_id: number; tg_username: string | null; tg_name: string | null; status: string;
  broker: string | null; risk_tier: string; created_at: string; mt5_login: string | null; mt5_server: string | null;
  usdt_trc20: string | null; referred_by: number | null;
}
interface Action { id: string; member_no: number | null; kind: string; detail: Record<string, unknown> | null; created_at: string }
interface Comm { id: string; referrer_tg_id: number; referred_tg_id: number | null; kind: string; amount: number; status: string; reason: string | null; detail: Record<string, unknown> | null; created_at: string }
interface Payout { id: string; tg_id: number; amount: number; address: string; status: string; tx_hash: string | null; reason: string | null; created_at: string }
interface Affiliate { pendingCommissions: Comm[]; recentCommissions: Comm[]; pendingPayouts: Payout[]; recentPayouts: Payout[]; owedUsd: number; flagged: { tg_id: number; balance: number; username: string | null; member_no: number | null }[] }

type Tab = 'dashboard' | 'queue' | 'members' | 'affiliate' | 'tools';

export default function AdminCRM() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [wl, setWl] = useState<WL[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [aff, setAff] = useState<Affiliate | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden'>('loading');
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [creds, setCreds] = useState<Record<string, { login: string; server: string; password: string }>>({});

  const load = () =>
    void fetch('/api/member/admin').then(async (r) => {
      if (r.status === 401) { router.replace('/member/login'); return; }
      if (r.status === 403) return setState('forbidden');
      const d = (await r.json()) as { whitelist: WL[]; members: Row[]; actions: Action[]; affiliate?: Affiliate };
      setWl(d.whitelist);
      setRows(d.members);
      setActions(d.actions ?? []);
      setAff(d.affiliate ?? null);
      setState('ok');
    });
  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const post = (body: Record<string, unknown>, cb?: () => void) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (r) => { const d = (await r.json()) as { error?: string }; if (d.error) window.alert(d.error); cb?.(); load(); })
      .finally(() => setBusy(false));
  };
  const reveal = (id: string) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reveal: id }) })
      .then(async (r) => { const d = (await r.json()) as { login?: string; server?: string; password?: string }; if (d.password) setCreds((c) => ({ ...c, [id]: { login: d.login ?? '', server: d.server ?? '', password: d.password! } })); })
      .finally(() => setBusy(false));
  };
  const cancelCommission = (id: string) => { const reason = window.prompt('Cancel reason (e.g. "client withdrew deposit"):'); if (reason !== null) post({ cancelCommission: id, reason }); };
  const payPayout = (id: string) => { const tx = window.prompt('USDT sent? Paste the TRC20 transaction hash:'); if (tx?.trim()) post({ payoutPaid: id, tx: tx.trim() }); };
  const rejectPayout = (id: string) => { const reason = window.prompt('Reject reason (shown to the member):'); if (reason !== null) post({ payoutReject: id, reason }); };
  const liveAlert = () => { if (window.confirm('Send "🔴 ALGORIA IS LIVE" to every subscribed member?')) post({ liveAlert: true }); };

  const nameOf = (tg: number | null | undefined) => {
    const m = rows.find((r) => Number(r.tg_id) === Number(tg));
    return m ? (m.tg_username ? '@' + m.tg_username : `#${m.member_no}`) : tg == null ? '—' : String(tg);
  };
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.tg_username, r.tg_name, r.broker, r.mt5_login, String(r.member_no), r.status].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  if (state === 'loading') return <Center>loading…</Center>;
  if (state === 'forbidden') return <Center>admin only</Center>;

  const live = rows.filter((r) => r.status === 'live').length;
  const pendingRev = rows.filter((r) => r.status === 'pending_copier').length;
  const todo = actions.length + (aff?.pendingCommissions.length ?? 0) + (aff?.pendingPayouts.length ?? 0);
  const KIND_LABEL: Record<string, string> = { connect: '🔌 CONNECT ACCOUNT', risk_change: '⚖ RISK CHANGE', pause: '⏸ PAUSE COPY', resume: '▶ RESUME COPY', referral_reward: '💰 PAY REFERRAL REWARD (legacy)' };
  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'dashboard', label: 'DASHBOARD' },
    { key: 'queue', label: 'QUEUE', badge: actions.length },
    { key: 'members', label: 'MEMBERS', badge: rows.length },
    { key: 'affiliate', label: 'AFFILIATE', badge: (aff?.pendingCommissions.length ?? 0) + (aff?.pendingPayouts.length ?? 0) },
    { key: 'tools', label: 'TOOLS' },
  ];

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* ===== barre haute : marque + navigation + actions globales ===== */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '12px 22px', borderBottom: '1px solid var(--border)', background: 'rgba(8,16,31,.6)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/brand/algoria-mark.png" alt="" width={24} height={24} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(43,227,245,.4))' }} />
          <strong style={{ fontSize: 15, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA</strong>
          <span className="mono goldText" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>ADMIN</span>
        </div>
        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
              fontSize: 11, fontWeight: 800, letterSpacing: 1,
              border: `1px solid ${tab === t.key ? 'rgba(43,227,245,.5)' : 'transparent'}`,
              background: tab === t.key ? 'rgba(43,227,245,.08)' : 'transparent',
              color: tab === t.key ? 'var(--cyan)' : 'var(--muted)',
            }}>
              {t.label}
              {!!t.badge && <span className="mono" style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 6px', borderRadius: 8, background: tab === t.key ? 'rgba(43,227,245,.15)' : 'rgba(245,194,74,.14)', color: tab === t.key ? 'var(--cyan)' : 'var(--gold)' }}>{t.badge}</span>}
            </button>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        <button disabled={busy} onClick={liveAlert} style={{ padding: '7px 13px', borderRadius: 9, border: '1px solid rgba(255,90,60,.5)', background: 'rgba(255,90,60,.08)', color: '#ff8a5c', fontWeight: 800, letterSpacing: 0.6, fontSize: 11, cursor: 'pointer' }}>📣 LIVE ALERT</button>
        <form action="/api/member/logout" method="post" style={{ display: 'flex' }}>
          <button style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer' }}>sign out</button>
        </form>
      </header>

      <div style={{ flex: 1, width: '100%', maxWidth: 1240, margin: '0 auto', padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ===== DASHBOARD — les chiffres qui comptent, toujours en tête ===== */}
        {tab === 'dashboard' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <Kpi label="MEMBERS" value={String(rows.length)} accent="var(--cyan)" />
              <Kpi label="COPYING LIVE" value={String(live)} accent="var(--up)" />
              <Kpi label="UNDER REVIEW" value={String(pendingRev)} accent="var(--gold)" hot={pendingRev > 0} />
              <Kpi label="TO PROCESS" value={String(todo)} accent="#ff8a5c" hot={todo > 0} />
              <Kpi label="OWED TO PARTNERS" value={`$${Math.floor(aff?.owedUsd ?? 0)}`} accent="var(--gold)" />
            </div>
            {(aff?.flagged.length ?? 0) > 0 && (
              <div style={{ ...warnBox }}>⚠ negative balances: {aff!.flagged.map((f) => `${f.username ? '@' + f.username : '#' + f.member_no} (${Math.floor(f.balance)}$)`).join(' · ')}</div>
            )}
            {/* le travail en attente, cliquable — le dashboard est un cockpit, pas un tableau mort */}
            {todo > 0 ? (
              <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
                <h2 style={secH}>NEEDS YOU NOW</h2>
                {actions.slice(0, 5).map((a) => (
                  <RowLine key={a.id} onClick={() => setTab('queue')} icon="🔌" text={`${(KIND_LABEL[a.kind] ?? a.kind).replace(/^[^\p{L}]+\s*/u, '')} · member #${a.member_no ?? '—'}`} sub={new Date(a.created_at).toLocaleString('en-GB')} />
                ))}
                {(aff?.pendingPayouts ?? []).map((p) => (
                  <RowLine key={p.id} onClick={() => setTab('affiliate')} icon="💸" text={`payout $${Number(p.amount)} → ${nameOf(p.tg_id)}`} sub="waiting for USDT transfer" gold />
                ))}
                {(aff?.pendingCommissions ?? []).slice(0, 5).map((c) => (
                  <RowLine key={c.id} onClick={() => setTab('affiliate')} icon="💰" text={`commission $${Number(c.amount)} → ${nameOf(c.referrer_tg_id)}`} sub="confirm once the broker paid you" />
                ))}
              </section>
            ) : (
              <section className="panel" style={{ padding: 22, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>All clear — nothing waiting on you. 🎉</section>
            )}
          </>
        )}

        {/* ===== QUEUE — à appliquer dans Social Trade Hub ===== */}
        {tab === 'queue' && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={secH}>TO APPLY IN SOCIAL TRADE HUB {actions.length > 0 && `· ${actions.length}`}</h2>
            {actions.length === 0 && <p style={dimP}>Queue clear — nothing to apply.</p>}
            {actions.map((a) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12, minWidth: 40 }}>#{a.member_no ?? '—'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6 }}>{KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.kind === 'connect' && `MT5 ${String(a.detail?.login ?? '?')} @ ${String(a.detail?.server ?? '?')} · lot ${String(a.detail?.lot ?? '?')}`}
                      {a.kind === 'risk_change' && `→ ${String(a.detail?.to ?? '?')} (lot ${String(a.detail?.lot ?? '?')})`}
                      {(a.kind === 'pause' || a.kind === 'resume') && new Date(a.created_at).toLocaleString('en-GB')}
                    </div>
                    {/* la ligne VÉRIFICATION : tout ce qu'il faut contrôler chez le broker AVANT d'approuver.
                        Anciennes demandes (sans les nouveaux champs) : broker/@ récupérés de la fiche membre + ⚠ sur le manquant */}
                    {a.kind === 'connect' && (() => {
                      const m = rows.find((r) => r.member_no != null && r.member_no === a.member_no);
                      const broker = String(a.detail?.broker ?? m?.broker ?? '') || null;
                      const uname = String(a.detail?.username ?? m?.tg_username ?? '') || null;
                      const bname = String(a.detail?.broker_name ?? '') || null;
                      const dep = Number(a.detail?.declared_deposit ?? 0) || null;
                      return (
                        <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          VERIFY → {broker ? broker.toUpperCase() : '⚠ broker ?'} · {bname ?? '⚠ no name — ask'} · {dep ? `$${dep} declared` : '⚠ no deposit declared — ask'}{uname ? <span style={{ color: 'var(--cyan)' }}> · @{uname}</span> : ''}
                        </div>
                      );
                    })()}
                  </div>
                  {a.kind === 'connect' && !creds[a.id] && (
                    <button disabled={busy} onClick={() => reveal(a.id)} title="decrypt the member's MT5 password (timestamped)" style={goldBtn}>🔑 REVEAL</button>
                  )}
                  <button disabled={busy} onClick={() => post({ done: a.id }, () => setCreds((c) => { const n = { ...c }; delete n[a.id]; return n; }))} style={okBtn}>✓ DONE</button>
                </div>
                {creds[a.id] && (
                  <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.06)' }}>
                    <span>login <b style={{ color: 'var(--text)' }}>{creds[a.id].login}</b></span>
                    <span>server <b style={{ color: 'var(--text)' }}>{creds[a.id].server}</b></span>
                    <span>password <b style={{ color: 'var(--gold)' }}>{creds[a.id].password}</b></span>
                    <button onClick={() => void navigator.clipboard?.writeText(creds[a.id].password)} style={miniBtn}>copy</button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* ===== MEMBERS — le CRM : recherche + table complète ===== */}
        {tab === 'members' && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={secH}>MEMBERS · {filtered.length}</h2>
              <span style={{ flex: 1 }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search @, name, broker, MT5, status…" style={{ ...inp, width: 280 }} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 860 }}>
                <thead>
                  <tr>
                    {['#', 'MEMBER', 'STATUS', 'BROKER', 'RISK', 'MT5', 'USDT', 'REFERRED BY', 'SINCE'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '7px 10px', fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.member_no} style={{ borderBottom: '1px solid rgba(130,152,190,.08)' }}>
                      <td style={td}><span className="goldText" style={{ fontWeight: 800 }}>#{r.member_no}</span></td>
                      <td style={{ ...td, maxWidth: 190 }}>
                        <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</div>
                        {r.tg_username && r.tg_name && <div style={{ fontSize: 9.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tg_name}</div>}
                      </td>
                      <td style={td}><StatusChip status={r.status} /></td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{r.broker ?? '—'}</td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{r.risk_tier}</td>
                      <td style={{ ...td, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.mt5_login ? `${r.mt5_login} @ ${r.mt5_server ?? '?'}` : '—'}</td>
                      <td style={{ ...td, color: r.usdt_trc20 ? 'var(--cyan)' : 'var(--dim)' }} title={r.usdt_trc20 ?? undefined}>{r.usdt_trc20 ? r.usdt_trc20.slice(0, 6) + '…' : '—'}</td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{r.referred_by ? nameOf(r.referred_by) : '—'}</td>
                      <td style={{ ...td, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p style={{ ...dimP, padding: 10 }}>No member matches “{search}”.</p>}
            </div>
          </section>
        )}

        {/* ===== AFFILIATE — l'argent des parrains ===== */}
        {tab === 'affiliate' && aff && (
          <>
            {aff.flagged.length > 0 && <div style={warnBox}>⚠ negative balance: {aff.flagged.map((f) => `${f.username ? '@' + f.username : '#' + f.member_no} (${Math.floor(f.balance)}$)`).join(' · ')}</div>}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>PAYOUTS — WAITING {aff.pendingPayouts.length > 0 && `· ${aff.pendingPayouts.length}`}</h2>
              {aff.pendingPayouts.length === 0 && <p style={dimP}>No withdrawal requests.</p>}
              {aff.pendingPayouts.map((p) => (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800 }}>💸 <span className="goldText">${Number(p.amount)}</span> → {nameOf(p.tg_id)}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{new Date(p.created_at).toLocaleString('en-GB')}</span>
                    <span style={{ flex: 1 }} />
                    <button disabled={busy} onClick={() => payPayout(p.id)} style={okBtn}>✓ PAID</button>
                    <button disabled={busy} onClick={() => rejectPayout(p.id)} style={dangerBtn}>REJECT</button>
                  </div>
                  <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                    <span>{p.address}</span>
                    <button onClick={() => void navigator.clipboard?.writeText(p.address)} style={miniBtn}>copy</button>
                  </div>
                </div>
              ))}
            </section>
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>COMMISSIONS — CONFIRM WHEN THE BROKER PAID YOU {aff.pendingCommissions.length > 0 && `· ${aff.pendingCommissions.length}`}</h2>
              {aff.pendingCommissions.length === 0 && <p style={dimP}>Nothing pending — commissions appear when a referred member is approved.</p>}
              {aff.pendingCommissions.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                  <span style={{ fontSize: 12 }}>
                    💰 <b className="goldText">${Number(c.amount)}</b> → {nameOf(c.referrer_tg_id)}
                    <span style={{ color: 'var(--dim)', fontSize: 10.5 }}> · referred {c.detail?.referred_member_no ? `#${String(c.detail.referred_member_no)}` : nameOf(c.referred_tg_id)}</span>
                  </span>
                  <span style={{ flex: 1 }} />
                  <button disabled={busy} onClick={() => post({ confirmCommission: c.id })} style={okBtn}>✓ CONFIRM</button>
                  <button disabled={busy} onClick={() => cancelCommission(c.id)} style={dangerBtn}>CANCEL</button>
                </div>
              ))}
              {aff.recentCommissions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, borderTop: '1px solid rgba(130,152,190,.12)', paddingTop: 9 }}>
                  <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)' }}>RECENT DECISIONS</span>
                  {aff.recentCommissions.slice(0, 10).map((c) => (
                    <div key={c.id} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--dim)' }}>
                      <span style={{ color: c.status === 'confirmed' ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{c.status === 'confirmed' ? '✓' : '✗'}</span>
                      <span>${Number(c.amount)} → {nameOf(c.referrer_tg_id)}{c.kind === 'milestone' ? ' (milestone)' : ''}{c.reason ? ` · ${c.reason}` : ''}</span>
                      <span style={{ flex: 1 }} />
                      {c.status === 'confirmed' && <button disabled={busy} onClick={() => cancelCommission(c.id)} title="client withdrew his deposit → claw back" style={miniBtn}>claw back</button>}
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 style={secH}>PAYOUT HISTORY</h2>
              {aff.recentPayouts.length === 0 && <p style={dimP}>No processed payouts yet.</p>}
              {aff.recentPayouts.map((p) => (
                <div key={p.id} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--dim)' }}>
                  <span style={{ color: p.status === 'paid' ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{p.status === 'paid' ? '✓' : '✗'}</span>
                  <span>${Number(p.amount)} → {nameOf(p.tg_id)}{p.reason ? ` · ${p.reason}` : ''}</span>
                  {p.tx_hash && <a href={`https://tronscan.org/#/transaction/${p.tx_hash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'none', fontSize: 10 }}>tx ↗</a>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 9.5 }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                </div>
              ))}
            </section>
          </>
        )}

        {/* ===== TOOLS — whitelist VIP + utilitaires ===== */}
        {tab === 'tools' && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11, maxWidth: 560 }}>
            <h2 style={secH}>VIP WHITELIST</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="@username" style={{ ...inp, flex: 1 }} />
              <button disabled={busy || !input.trim()} onClick={() => post({ add: input }, () => setInput(''))} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }}>ADD</button>
            </div>
            {wl.map((w) => (
              <div key={w.username} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span style={{ color: 'var(--text)' }}>@{w.username}</span>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>by {w.added_by ?? '—'}</span>
                <span style={{ flex: 1 }} />
                <button disabled={busy} onClick={() => post({ remove: w.username })} style={dangerBtn}>remove</button>
              </div>
            ))}
            {wl.length === 0 && <p style={dimP}>Empty — channel-accepted users get in automatically; add VIP handles here.</p>}
          </section>
        )}
      </div>
    </main>
  );
}

// ===== briques UI du CRM =====
function Kpi({ label, value, accent, hot }: { label: string; value: string; accent: string; hot?: boolean }) {
  return (
    <div className="panel" style={{ padding: '13px 15px', borderTop: `2px solid ${accent}`, boxShadow: hot ? `0 0 18px ${accent}22` : undefined }}>
      <div style={{ fontSize: 9.5, letterSpacing: 1.3, color: 'var(--dim)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 23, fontWeight: 800, marginTop: 3, color: hot ? accent : 'var(--text)' }}>{value}</div>
    </div>
  );
}
function StatusChip({ status }: { status: string }) {
  const c = status === 'live' ? 'var(--up)' : status === 'paused' ? 'var(--gold)' : status === 'pending_copier' ? 'var(--cyan)' : 'var(--muted)';
  return <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: c, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{status.toUpperCase()}</span>;
}
function RowLine({ icon, text, sub, onClick, gold }: { icon: string; text: string; sub?: string; onClick: () => void; gold?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: `1px solid ${gold ? 'rgba(245,194,74,.35)' : 'var(--border)'}`, background: gold ? 'rgba(245,194,74,.05)' : 'rgba(10,17,31,.55)', color: 'var(--text)' }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700 }}>{text}</span>
      <span style={{ flex: 1 }} />
      {sub && <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{sub}</span>}
      <span style={{ color: 'var(--dim)' }}>→</span>
    </button>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>{children}</main>;
}
const secH: CSSProperties = { fontSize: 12, margin: 0, letterSpacing: 1.4, color: 'var(--muted)' };
const warnBox: CSSProperties = { border: '1px solid rgba(255,107,138,.45)', background: 'rgba(255,107,138,.08)', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: 'rgba(210,150,165,.95)' };
const dimP: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dim)' };
const td: CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };
const inp: CSSProperties = { padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 13, outline: 'none' };
const okBtn: CSSProperties = { border: '1px solid rgba(31,216,176,.45)', background: 'rgba(31,216,176,.1)', color: 'var(--up)', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
const goldBtn: CSSProperties = { border: '1px solid rgba(245,194,74,.45)', background: 'rgba(245,194,74,.08)', color: 'var(--gold)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
const dangerBtn: CSSProperties = { border: '1px solid rgba(255,107,138,.4)', background: 'transparent', color: 'rgba(210,150,165,.85)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const miniBtn: CSSProperties = { border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', borderRadius: 6, padding: '1px 8px', fontSize: 10, cursor: 'pointer' };
