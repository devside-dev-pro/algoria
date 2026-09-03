'use client';
// QUEUE — à appliquer dans Social Trade Hub
// Découpé depuis app/admin/page.tsx (03/09/2026) : un fichier par onglet, l’état et les handlers restent
// dans useAdminState (app/admin/_state.tsx) et arrivent ici par contexte.
import { lotsStateOf, lotsCleared, ACTIVATION_LOTS } from '@/lib/member/activation';
import { ask } from '@/components/admin/Dialog';
import { useAdmin } from '../_state';
import { dangerBtn, dimP, goldBtn, miniBtn, okBtn, secH } from '../_shared';

export function QueueTab() {
  const { KIND_LABEL, actions, busy, connectViaSth, copyDepositInfo, creds, depInfoCopied, legalOf, moveViaSth, nameOf, openMember, pendingTotal, post, recordDepositAfterConnect, rejectConnect, reveal, rows, setCreds, setTab, validateLots, waitBroker } = useAdmin();
  return (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={secH}>TO APPLY IN SOCIAL TRADE HUB {actions.length > 0 && `· ${pendingTotal ?? actions.length}`}{pendingTotal != null && pendingTotal > actions.length && ` (${actions.length} shown)`}</h2>
            {actions.length > 0 && (() => {
              const oldest = Math.max(...actions.map((a) => Date.now() - Date.parse(a.created_at)));
              const h = Math.floor(oldest / 3_600_000);
              return <p style={{ ...dimP, color: h >= 72 ? '#ff8a5c' : h >= 24 ? 'var(--gold)' : 'var(--dim)' }}>oldest card waiting {h >= 48 ? `${Math.floor(h / 24)} days` : `${h} h`} · sorted oldest first</p>;
            })()}
            {actions.length === 0 && <p style={dimP}>Queue clear — nothing to apply.</p>}
            {actions.map((a) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                {/* flexWrap : l'admin vit à 70% sur le téléphone de Mathieu — sans wrap, les boutons
                    débordaient sur le texte de la carte (vécu en screenshot). Les boutons passent
                    à la ligne proprement sur écran étroit. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {/* QUI : @username cliquable (ouvre la fiche) — un #numéro seul ne dit rien à personne */}
                  <button
                    onClick={() => { const m = rows.find((r) => Number(r.tg_id) === Number(a.tg_id)); if (m) { openMember(m); setTab('members'); } }}
                    title="open this member's card"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 96, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                  >
                    <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12 }}>#{a.member_no ?? '—'}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{nameOf(a.tg_id)}</span>
                    {legalOf(a.tg_id) && <span style={{ fontSize: 9.5, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }} title="name on the broker account">🏦 {legalOf(a.tg_id)}</span>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6 }}>{KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.kind === 'connect' && `MT5 ${String(a.detail?.login ?? '?')} @ ${String(a.detail?.server ?? '?')} · lot ${String(rows.find((r) => Number(r.tg_id) === Number(a.tg_id))?.lot ?? a.detail?.lot ?? '?')}${a.detail?.strategy ? ` · S${String(a.detail.strategy)}` : ''}${a.detail?.add_strategy ? ` · ➕ EXTRA ACCOUNT #${String(a.detail?.account_no ?? '?')} (STH id ${String(a.tg_id)}-${String(a.detail?.account_no ?? '?')})` : ''} · `}
                      {a.kind === 'risk_change' && `→ ${String(a.detail?.to ?? '?')} (lot ${String(a.detail?.lot ?? '?')}) · `}
                      {a.kind === 'strategy_change' && `→ S${String(a.detail?.to ?? '?')} · `}
                      {/* l'ID que STH affiche pour ce membre (UserID = tg_id) — pour le retrouver dans le dashboard STH */}
                      {['strategy_change', 'pause', 'resume', 'disconnect'].includes(a.kind) && `STH id ${String(a.tg_id)} · `}
                      {new Date(a.created_at).toLocaleString('en-GB')}
                      {(() => { const h = Math.floor((Date.now() - Date.parse(a.created_at)) / 3_600_000); return <b style={{ marginLeft: 6, color: h >= 72 ? '#ff8a5c' : h >= 24 ? 'var(--gold)' : 'var(--dim)' }}>⏱ {h >= 48 ? `${Math.floor(h / 24)} d` : `${h} h`}</b>; })()}
                    </div>
                    {/* la ligne VÉRIFICATION : tout ce qu'il faut contrôler chez le broker AVANT d'approuver.
                        Anciennes demandes (sans les nouveaux champs) : broker/@ récupérés de la fiche membre + ⚠ sur le manquant */}
                    {a.kind === 'connect' && (() => {
                      const m = rows.find((r) => r.member_no != null && r.member_no === a.member_no);
                      const broker = String(a.detail?.broker ?? m?.broker ?? '') || null;
                      const uname = String(a.detail?.username ?? m?.tg_username ?? '') || null;
                      const bname = String(a.detail?.broker_name ?? '') || null;
                      const dep = Number(a.detail?.declared_deposit ?? 0) || null;
                      // BROKER HORS PARTENAIRES : le membre a tapé le nom lui-même et le CONNECT auto échouera
                      // (serveur MT jamais exact du premier coup). On le dit AVANT que le support ne clique.
                      const label = String(a.detail?.broker_label ?? '') || null;
                      const manual = broker === 'other' || Boolean(a.detail?.manual_connect);
                      return (
                        <>
                          {manual && (
                            <div style={{ fontSize: 10.5, marginTop: 3, color: '#ff8a5c', fontWeight: 800, letterSpacing: 0.4 }}>
                              ⚠ NON-PARTNER BROKER{label ? ` · ${label.toUpperCase()}` : ''} — connect by hand in STH, the auto-connect will fail on the server name
                            </div>
                          )}
                          <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            VERIFY → {label ? label.toUpperCase() : broker ? broker.toUpperCase() : '⚠ broker ?'} · {bname ?? '⚠ no name — ask'} · {dep ? `$${dep} declared` : '⚠ no deposit declared — ask'}{uname ? <span style={{ color: 'var(--cyan)' }}> · @{uname}</span> : ''}
                          </div>
                          {/* CE QUE LE MEMBRE A JURÉ (14/08) : compte né du lien Algoria + compte financé.
                              Les demandes ANTÉRIEURES au formulaire n'ont pas ces champs — on affiche donc
                              « not asked » plutôt qu'une croix, pour ne pas faire porter au membre une
                              case qu'on ne lui a jamais montrée. */}
                          <div style={{ fontSize: 10, marginTop: 2, color: 'var(--dim)' }}>
                            {a.detail?.ack_link == null && a.detail?.ack_funded == null
                              ? 'claims: not asked (request predates the checkboxes)'
                              : <>claims: <b style={{ color: a.detail?.ack_link ? 'var(--up)' : '#ff8a5c' }}>{a.detail?.ack_link ? '✓ opened via our link' : '✗ NOT via our link'}</b> · <b style={{ color: a.detail?.ack_funded ? 'var(--up)' : '#ff8a5c' }}>{a.detail?.ack_funded ? '✓ funded' : '✗ not funded'}</b></>}
                          </div>
                          {/* IDENTIFIANTS DÉJÀ TESTÉS À L'INSCRIPTION : 'ok' = STH a réellement joint ce
                              compte MetaTrader. Inutile de le refuser pour « invalid account » — s'il y a
                              un problème il est ailleurs (rattachement, dépôt). Ça enlève le premier motif
                              de refus du champ des hypothèses avant même d'ouvrir le dashboard broker. */}
                          {a.detail?.verify === 'ok' && (
                            <div style={{ fontSize: 10, marginTop: 2, color: 'var(--up)', fontWeight: 700 }}>🔐 credentials verified at signup — MetaTrader login/password/server all work</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {a.kind === 'connect' && (
                    <button onClick={() => copyDepositInfo(a)} title="copie « nouveau dépôt à vérifier » (nom, login, broker, montant) — à coller dans le groupe WhatsApp du staff" style={depInfoCopied === a.id ? { ...goldBtn, color: 'var(--up)' } : goldBtn}>{depInfoCopied === a.id ? '✓ COPIÉ' : '📋 COPY FOR STAFF'}</button>
                  )}
                  {a.kind === 'connect' && !creds[a.id] && (
                    <button disabled={busy} onClick={() => reveal(a.id)} title="decrypt the member's MT5 password (timestamped)" style={goldBtn}>🔑 REVEAL</button>
                  )}
                  {/* ✓ LOTS AVANT CONNECT — l'ordre des boutons raconte l'ordre du process. Le CONNECT et le
                      DONE sont grisés tant que le volume n'est pas validé ; le serveur refuse de toute
                      façon (409), le grisage n'est là que pour éviter le clic inutile. */}
                  {a.kind === 'connect' && (() => {
                    const L = lotsStateOf(a.detail as Record<string, unknown>);
                    if (L.ok || L.override) {
                      return <span className="mono" title={L.override ? `forcé : ${L.override}` : `validé par ${L.okBy ?? '?'}`} style={{ fontSize: 10.5, fontWeight: 800, color: L.override ? 'var(--gold)' : 'var(--up)', alignSelf: 'center' }}>{L.override ? '⚠ LOTS FORCÉS' : `✓ LOTS${L.lots ? ` ${L.lots}` : ''}`}</span>;
                    }
                    return <button disabled={busy} onClick={() => validateLots(a)} title={`pointe le dashboard partenaire : ${ACTIVATION_LOTS} lot tradé ? Puis valide ici — c'est ce qui déverrouille le CONNECT.`} style={{ ...goldBtn, fontWeight: 800, color: 'var(--gold)' }}>{L.claimedAt ? '🙋 LOTS ? (déclaré)' : '✓ LOTS ?'}</button>;
                  })()}
                  {a.kind === 'connect' && (
                    <button disabled={busy || !lotsCleared(a.detail as Record<string, unknown>)} onClick={() => connectViaSth(a)} title={lotsCleared(a.detail as Record<string, unknown>) ? 'connect this account to the copier via STH now, then go LIVE + log the deposit (one click, no manual STH entry)' : 'volume d\u2019activation pas encore validé — pointe le dashboard partenaire et clique ✓ LOTS'} style={{ ...okBtn, color: '#06121f', background: lotsCleared(a.detail as Record<string, unknown>) ? 'linear-gradient(90deg,#2be3f5,#2e8bf0)' : 'rgba(130,152,190,.2)', border: 'none', opacity: lotsCleared(a.detail as Record<string, unknown>) ? 1 : 0.5 }}>🔗 CONNECT (STH)</button>
                  )}
                  {a.kind === 'strategy_change' && (
                    <button disabled={busy} onClick={() => moveViaSth(a.id)} title="move this member's receiver to their new strategy's master via the STH API (API-connected members only — manually-added receivers must be moved in the STH dashboard)" style={{ ...okBtn, color: '#06121f', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', border: 'none' }}>🔀 MOVE (STH)</button>
                  )}
                  <button disabled={busy || (a.kind === 'connect' && !lotsCleared(a.detail as Record<string, unknown>))} onClick={() => post({ done: a.id }, () => { setCreds((c) => { const n = { ...c }; delete n[a.id]; return n; }); if (a.kind === 'connect') recordDepositAfterConnect(a); })} title="mark CONNECTED without calling STH: member goes LIVE, gets a push, referral commission is created — use only if the copier was connected by hand (if you connected the account in STH yourself) — connect cards also offer to log the deposit" style={a.kind === 'connect' && !lotsCleared(a.detail as Record<string, unknown>) ? { ...okBtn, opacity: 0.4 } : okBtn}>✓ DONE</button>
                  {a.kind === 'connect' && (
                    <button disabled={busy} onClick={() => waitBroker(a)} title="account not attached to your affiliate ID — the member must ask the broker's support to attach it. Marks the card as blocked upstream so it stops reading as forgotten. Click again once the broker replied." style={a.detail?.waiting_broker ? { ...goldBtn, color: 'var(--gold)', fontWeight: 800 } : miniBtn}>{a.detail?.waiting_broker ? '⏳ WAITING' : '⏳ BROKER'}</button>
                  )}
                  {a.kind === 'connect' && (
                    <button disabled={busy} onClick={() => rejectConnect(a.id)} title="verification failed → member goes back to the wizard with your reason, can resubmit" style={dangerBtn}>REJECT</button>
                  )}
                  <button disabled={busy} onClick={() => post({ dismiss: a.id })} title="dismiss without applying anything (stale/spam card — no side effects)" style={miniBtn}>✕ DISMISS</button>
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
  );
}
