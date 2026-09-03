'use client';
// AFFILIATE — l’argent des parrains
// Découpé depuis app/admin/page.tsx (03/09/2026) : un fichier par onglet, l’état et les handlers restent
// dans useAdminState (app/admin/_state.tsx) et arrivent ici par contexte.
import { useAdmin } from '../_state';
import { dangerBtn, dimP, miniBtn, okBtn, secH, warnBox } from '../_shared';

export function AffiliateTab() {
  const { aff, busy, cancelCommission, nameOf, payPayout, post, rejectPayout } = useAdmin();
  return (
    <>
      {aff && (
          <>
            {aff.flagged.length > 0 && <div style={warnBox}>⚠ negative balance: {aff.flagged.map((f) => `${f.username ? '@' + f.username : '#' + f.member_no} (${Math.floor(f.balance)}$)`).join(' · ')}</div>}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>PAYOUTS — WAITING {aff.pendingPayouts.length > 0 && `· ${aff.pendingPayouts.length}`}</h2>
              {aff.pendingPayouts.length === 0 && <p style={dimP}>No withdrawal requests.</p>}
              {aff.pendingPayouts.map((p) => (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)', flexWrap: 'wrap' }}>
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
    </>
  );
}
