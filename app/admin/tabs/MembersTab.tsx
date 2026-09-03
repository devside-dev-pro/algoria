'use client';
// MEMBERS — le CRM : recherche + table complète + FICHE au clic
// Découpé depuis app/admin/page.tsx (03/09/2026) : un fichier par onglet, l’état et les handlers restent
// dans useAdminState (app/admin/_state.tsx) et arrivent ici par contexte.
import { BROKERS } from '@/lib/member/brokers';
import { ask } from '@/components/admin/Dialog';
import { useAdmin } from '../_state';
import { StatusChip, dangerBtn, dimP, goldBtn, inp, miniBtn, secH, td } from '../_shared';

export function MembersTab() {
  const { KIND_LABEL, actSummary, actions, addNote, alertsOn, banMember, busy, countrySelect, delNote, deposits, editLegalName, editPassword, editPick, editText, extraAccounts, filtered, input, legalOf, live, lotPick, market, nameOf, noteText, nudges, offboard, openMember, reconnectSth, rows, search, sel, selActs, selCreds, serverPick, setNoteText, setSearch, setSel, setSelActs, setSelCreds, showCreds, sthCheck } = useAdmin();
  return (
    <>
      {sel && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'rgba(43,227,245,.35)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono goldText" style={{ fontWeight: 800, fontSize: 15 }}>#{sel.member_no}</span>
              {/* marché du membre : pilote la langue de l'app, des DM et des relances. Corrigeable : un Italien
                  entré par une pub anglaise recevait des DM en anglais à vie, sans aucun moyen de le basculer. */}
              {editPick(sel.tg_id, 'locale', String(sel.locale ?? 'en'), [{ v: 'en', label: '🇬🇧 EN' }, { v: 'it', label: '🇮🇹 IT' }], "member's market — drives the app language, the bot DMs and the nudges")}
              <span style={{ fontSize: 15, fontWeight: 800 }}>{sel.tg_username ? '@' + sel.tg_username : (sel.tg_name ?? '—')}</span>
              {sel.tg_username && sel.tg_name && <span style={{ fontSize: 12, color: 'var(--dim)' }}>{sel.tg_name}</span>}
              <button onClick={() => editLegalName(sel.tg_id, legalOf(sel.tg_id))} className="mono"
                title="name on the broker account — click to fix it (members often type the broker's name here by mistake)"
                style={{ fontSize: 11, cursor: 'pointer', color: legalOf(sel.tg_id) ? 'var(--gold)' : 'var(--dim)', border: `1px ${legalOf(sel.tg_id) ? 'solid rgba(245,194,74,.35)' : 'dashed var(--border)'}`, background: 'transparent', borderRadius: 6, padding: '2px 8px' }}>
                🏦 {legalOf(sel.tg_id) ?? 'no holder name — add'} ✎
              </button>
              <StatusChip status={sel.status} />
              {/* rattrapage MANUEL du statut : un membre coincé en « pending_copier » alors qu'il copie déjà
                  n'avait aucune sortie. Ne touche ni au copieur ni au bannissement (→ RECONNECT / BAN). */}
              {editPick(sel.tg_id, 'status', sel.status, [
                { v: 'onboarding', label: 'onboarding' }, { v: 'pending_copier', label: 'pending_copier' },
                { v: 'live', label: 'live' }, { v: 'paused', label: 'paused' },
                { v: 'offboarded', label: 'offboarded' },
              ], 'fix the status by hand — does NOT touch the copier (use RECONNECT / OFF-BOARD for that)',
                (v) => `Set the status to "${v}" by hand?\n\nThis only changes the label in our database — the copier is NOT touched.`)}
              {sel.tg_username && <a href={`https://t.me/${sel.tg_username}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>💬 DM</a>}
              <span style={{ flex: 1 }} />
              <button onClick={() => { setSel(null); setSelActs(null); setSelCreds(null); }} style={miniBtn}>✕ close</button>
            </div>
            {/* actions fiche : voir les identifiants à tout moment + off-board d'un client parti */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {sel.mt5_login && <button disabled={busy} onClick={() => showCreds(sel.tg_id)} title="decrypt this member's MT5 login/server/password (timestamped)" style={goldBtn}>🔑 SHOW CREDENTIALS</button>}
              {sel.mt5_login && <button disabled={busy} onClick={() => reconnectSth(sel)} title="re-connect this member to the STH copier with the credentials on file (e.g. after an accidental disconnect on the STH dashboard)" style={goldBtn}>🔗 RECONNECT STH</button>}
              {sel.mt5_login && <button disabled={busy} onClick={() => sthCheck(sel.tg_id)} title="ask the STH API directly: is this member's MT account connected to the copier, and which masters does it see?" style={goldBtn}>🔍 STH STATUS</button>}
              {/* TOUJOURS visible : « paused » peut venir du membre lui-même (bouton pause copy) — masquer
                  l'off-board sur un membre en pause bloquait pile le cas « il a retiré, je veux le sortir » */}
              <button disabled={busy} onClick={() => offboard(sel)} title="client left → status offboarded (win-back DM sent) + copier disconnect (STH or queued) + timeline note (remove from the VIP Telegram channel manually)" style={dangerBtn}>⛔ OFF-BOARD</button>
              {/* 🚫 BAN — coupe l'accès à l'app : session en cours ET reconnexion. Pour les concurrents /
                  abus, pas pour un client qui part (→ OFF-BOARD). Réversible. */}
              {sel.banned_at ? (
                <button disabled={busy} onClick={() => banMember(sel, true)} title="lift the ban — this account can sign in again" style={{ ...goldBtn, color: 'var(--up)', borderColor: 'rgba(31,216,176,.45)' }}>✅ UNBAN</button>
              ) : (
                <button disabled={busy} onClick={() => banMember(sel, false)} title="revoke access: kills the live session AND blocks any new sign-in, cuts the copier, removes from the VIP whitelist" style={{ ...dangerBtn, fontWeight: 800 }}>🚫 BAN</button>
              )}
              {selCreds && (
                <span className="mono" style={{ display: 'inline-flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)' }}>
                  <span>login <b style={{ color: 'var(--text)' }}>{selCreds.login}</b></span>
                  <span>server <b style={{ color: 'var(--text)' }}>{selCreds.server}</b></span>
                  <span>password <b style={{ color: 'var(--gold)' }}>{selCreds.password}</b></span>
                  <button onClick={() => void navigator.clipboard?.writeText(selCreds.password)} style={miniBtn}>copy pwd</button>
                </span>
              )}
            </div>
            {/* identité + compte — tout ce qu'il faut savoir avant un appel */}
            <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 11.5, color: 'var(--muted)' }}>
              {/* le broker pilote le barème de commission ET le message « à vérifier » envoyé au staff :
                  faux, la com n'est pas réclamée au bon endroit. Les dépôts DÉJÀ saisis gardent le leur
                  (ils ont leur propre édition dans DEPOSITS) — on ne réécrit pas une compta passée. */}
              <span>broker {editPick(sel.tg_id, 'broker', sel.broker ?? '', BROKERS.map((b) => ({ v: b.key, label: b.name })), "member's broker — drives the commission schedule and the staff verification message")}</span>
              {/* STRATÉGIE + LOT : la colonne n'est pas la vérité, le copieur l'est → changer ici resynchronise
                  STH dans la foulée (et remonte l'échec au lieu de l'avaler). C'est le geste « passe-le en S1 ». */}
              <span>strategy {editPick(sel.tg_id, 'strategy', String(sel.strategy ?? ''), [{ v: '1', label: 'S1' }, { v: '2', label: 'S2' }, { v: '3', label: 'S3' }], 'strategy — also moves the copier to that master via STH',
                (v) => `Move this member to S${v}?\n\nIf they are connected, the copier is switched to the S${v} master right away.`)}</span>
              <span>lot {lotPick(sel)}</span>
              <span title="legacy label derived from the lot — the lot above is the real copy size">risk <b style={{ color: 'var(--dim)' }}>{sel.risk_tier}</b></span>
              {/* un seul caractère d'écart sur le serveur et la copie ne démarre jamais — c'est LA panne
                  la plus fréquente, et elle était invisible autant qu'incorrigeable depuis ici. */}
              <span>MT5 {editText(sel.tg_id, 'mt5_login', 'MT account number (login)', sel.mt5_login)} @ {serverPick(sel)}</span>
              <span>MT pwd <button disabled={busy} onClick={() => editPassword(sel)} className="mono" title="replace the stored MT password (the member changed it at the broker → the copy drops)" style={{ fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: 'transparent', border: 'none', borderBottom: '1px dashed rgba(130,152,190,.5)', padding: '0 1px', color: 'var(--text)' }}>replace ✎</button></span>
              {/* l'ID que STH affiche pour les receivers connectés via l'API (UserID = tg_id) — la clé pour
                  rapprocher « 7557770646 » vu dans STH ↔ le bon membre ici. Copiable en un clic. */}
              <span>STH id <b style={{ color: 'var(--gold)' }}>{sel.tg_id}</b> <button onClick={() => void navigator.clipboard?.writeText(String(sel.tg_id))} style={miniBtn}>copy</button></span>
              <span>country {countrySelect(sel.tg_id, sel.country, sel.source)}</span>
              {/* adresse de retrait du parrain : une adresse fausse, et le virement part dans le vide sans
                  retour possible. Affichée en ENTIER ici (elle était tronquée à 8 caractères, donc invérifiable). */}
              <span>USDT {editText(sel.tg_id, 'usdt_trc20', 'USDT TRC20 payout address', sel.usdt_trc20, sel.usdt_trc20 ?? '—', 'Paste the full TRC20 address (starts with T, 34 characters). Empty = clear it.')}</span>
              <span>since <b style={{ color: 'var(--text)' }}>{new Date(sel.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</b></span>
              {/* attribution de parrainage : elle décide qui touche la commission — donc elle se conteste,
                  donc elle doit se corriger. Accepte #numéro, @pseudo ou tg id ; vide = plus de parrain. */}
              <span>referred by {editText(sel.tg_id, 'referred_by', 'Referred by', sel.referred_by ? String(sel.referred_by) : null, sel.referred_by ? nameOf(sel.referred_by) : '—', 'Enter #member number, @username or the Telegram id. Empty = no referrer.')}</span>
              <span>invited <b style={{ color: 'var(--text)' }}>{rows.filter((r) => Number(r.referred_by) === Number(sel.tg_id)).length}</b></span>
              {/* VOLONTAIREMENT non éditable : le canal d'acquisition est une mesure, pas une donnée client.
                  Le réécrire à la main fausserait pile la répartition par source qui sert au bilan hebdo. */}
              <span title="acquisition channel, captured at the first click — read-only on purpose: editing it would falsify the weekly per-source funnel">source <b style={{ color: sel.source ? 'var(--cyan)' : 'var(--dim)' }}>{sel.source ?? 'organic / unknown'}</b></span>
            </div>
            {/* ➕ COMPTES SUPPLÉMENTAIRES (multi-stratégies) — chaque compte a SON STH id ({tg_id}-{n}) */}
            {extraAccounts.filter((a) => Number(a.tg_id) === Number(sel.tg_id)).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid rgba(43,227,245,.25)', borderRadius: 10, padding: '10px 12px', background: 'rgba(43,227,245,.04)' }}>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--cyan)', fontWeight: 800 }}>➕ EXTRA ACCOUNTS (MULTI-STRATEGY)</span>
                {extraAccounts.filter((a) => Number(a.tg_id) === Number(sel.tg_id)).map((a) => (
                  <div key={a.id} className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, color: 'var(--muted)', alignItems: 'center' }}>
                    <b style={{ color: a.status === 'live' ? 'var(--up)' : a.status === 'pending' ? 'var(--gold)' : 'var(--dim)' }}>S{a.strategy} · {a.status}</b>
                    <span>{a.broker ?? '—'}</span>
                    <span>MT {a.mt5_login ?? '—'}</span>
                    {a.declared_deposit != null && <span>${Number(a.declared_deposit)}</span>}
                    <span>STH id <b style={{ color: 'var(--gold)' }}>{sel.tg_id}-{a.account_no}</b> <button onClick={() => void navigator.clipboard?.writeText(`${sel.tg_id}-${a.account_no}`)} style={miniBtn}>copy</button></span>
                  </div>
                ))}
              </div>
            )}
            {/* notes privées — le réflexe CRM avant/après chaque appel */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} placeholder="private note — e.g. called on the 12th, waiting for his salary…" style={{ ...inp, flex: 1 }} />
              <button disabled={busy || !noteText.trim()} onClick={addNote} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: noteText.trim() ? 1 : 0.5 }}>+ NOTE</button>
            </div>
            {/* timeline — toutes ses actions (connect, kyc, dépôts, notes…), la plus récente en premier */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
              {selActs == null && <p style={dimP}>loading history…</p>}
              {selActs?.length === 0 && <p style={dimP}>No activity yet — this member signed up and stopped there.</p>}
              {selActs?.map((a) => {
                const stC = a.status === 'pending' ? 'var(--gold)' : a.status === 'rejected' ? '#ff6b8a' : (a.status === 'superseded' || a.status === 'dismissed') ? 'var(--dim)' : 'var(--up)';
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', background: a.kind === 'note' ? 'rgba(245,194,74,.05)' : 'rgba(10,17,31,.5)' }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', flex: 1, minWidth: 120, overflowWrap: 'anywhere' }}>{actSummary(a)}</span>
                    {a.kind !== 'note' && a.status && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, color: stC, whiteSpace: 'nowrap' }}>{a.status.toUpperCase()}</span>}
                    {a.kind === 'note' && <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap' }}>by {a.done_by ?? '—'}</span>}
                    {a.kind === 'note' && <button disabled={busy} onClick={() => delNote(a.id)} style={miniBtn}>🗑</button>}
                  </div>
                );
              })}
            </div>
          </section>
      )}
      {(
          <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 4px', fontSize: 11.5, color: 'var(--muted)' }}>
            <span>🔔</span>
            <b style={{ color: alertsOn > 0 ? 'var(--up)' : 'var(--dim)', fontSize: 13 }}>{alertsOn}</b>
            <span>/ {rows.length} have push alerts on</span>
          </div>
      )}
      {(
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
                    <tr key={r.member_no} onClick={() => openMember(r)} title="open member file"
                      style={{ borderBottom: '1px solid rgba(130,152,190,.08)', cursor: 'pointer', background: sel?.member_no === r.member_no ? 'rgba(43,227,245,.06)' : undefined }}>
                      <td style={td}><span className="goldText" style={{ fontWeight: 800 }}>#{r.member_no}</span></td>
                      <td style={{ ...td, maxWidth: 190 }}>
                        <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</div>
                        {r.tg_username && r.tg_name && <div style={{ fontSize: 9.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tg_name}</div>}
                        {legalOf(r.tg_id) && <div style={{ fontSize: 9.5, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="name on the broker account (what you see in STH / deposits)">🏦 {legalOf(r.tg_id)}</div>}
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
    </>
  );
}
