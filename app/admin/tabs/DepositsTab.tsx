'use client';
// DEPOSITS — le registre des dépôts broker : la source du bilan de fin de mois
// Découpé depuis app/admin/page.tsx (03/09/2026) : un fichier par onglet, l’état et les handlers restent
// dans useAdminState (app/admin/_state.tsx) et arrivent ici par contexte.
import { BROKERS } from '@/lib/member/brokers';
import { useAdmin } from '../_state';
import { Kpi, dangerBtn, dimP, goldBtn, inp, miniBtn, okBtn, secH } from '../_shared';

export function DepositsTab() {
  const { addDeposit, busy, copyBrokerLink, countrySelect, deleteDeposit, depAmount, depBroker, depCom, depComAuto, depDate, depDateOf, depNote, depTg, depTotals, deposits, editDepositAmount, editDepositCom, exportCsv, input, legalOf, liveNoDeposit, monthDeps, monthLabel, nameOf, nextYm, planAmount, planCopied, planExcluded, planRanking, planTg, post, rows, setDepAmount, setDepBroker, setDepCom, setDepDate, setDepNote, setDepTg, setPlanAmount, setPlanTg, shiftMonth, ym } = useAdmin();
  return (
          <>
            {/* filet de sécurité : LIVE sans ligne de dépôt — cliquer pré-remplit le formulaire ci-dessous */}
            {liveNoDeposit.length > 0 && (
              <section className="panel" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid rgba(255,138,92,.45)' }}>
                <h2 style={{ ...secH, color: '#ff8a5c' }}>⚠ LIVE, NO DEPOSIT LOGGED · {liveNoDeposit.length}</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {liveNoDeposit.map((r) => (
                    <button
                      key={r.tg_id}
                      onClick={() => { setDepTg(String(r.tg_id)); if (r.broker) setDepBroker(r.broker); depComAuto.current = true; }}
                      title="prefills the form below — enter the validated amount and hit + ADD"
                      className="mono"
                      style={{ fontSize: 11, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', cursor: 'pointer' }}
                    >
                      #{r.member_no} {r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '')}{r.broker ? ` · ${r.broker.toUpperCase()}` : ''}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {/* saisie : une ligne dès qu'un dépôt est constaté chez le broker partenaire */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>LOG A DEPOSIT</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={depTg}
                  onChange={(e) => {
                    setDepTg(e.target.value);
                    const m = rows.find((r) => String(r.tg_id) === e.target.value);
                    if (m?.broker) setDepBroker(m.broker);
                  }}
                  style={{ ...inp, width: 210 }}
                >
                  <option value="">member…</option>
                  {[...rows].sort((a, b) => a.member_no - b.member_no).map((r) => (
                    <option key={r.tg_id} value={String(r.tg_id)}>#{r.member_no} {r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '')}</option>
                  ))}
                </select>
                {/* liste déroulante des 5 brokers partenaires (fini la saisie à la main) — pré-remplie avec le
                    broker principal du membre au choix du membre ; PENSER à la changer pour le dépôt d'un
                    2e compte (multi-stratégies). Valeur legacy hors liste conservée en option pour l'édition. */}
                <select value={depBroker} onChange={(e) => setDepBroker(e.target.value)} style={{ ...inp, width: 160 }}>
                  <option value="">broker…</option>
                  {BROKERS.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
                  {depBroker && !BROKERS.some((b) => b.key === depBroker) && <option value={depBroker}>{depBroker}</option>}
                </select>
                <input value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder="deposit $" inputMode="decimal" style={{ ...inp, width: 110 }} />
                <input value={depCom} onChange={(e) => { setDepCom(e.target.value); depComAuto.current = e.target.value === ''; }} placeholder="expected com $" title="pré-rempli depuis le barème du broker — modifiable, vider le champ pour réactiver l'auto" inputMode="decimal" style={{ ...inp, width: 140 }} />
                <input type="date" value={depDate} onChange={(e) => setDepDate(e.target.value)} style={{ ...inp, width: 150 }} />
                <input value={depNote} onChange={(e) => setDepNote(e.target.value)} placeholder="note (optional)" style={{ ...inp, flex: 1, minWidth: 160 }} />
                <button disabled={busy || !depTg || !Number(depAmount)} onClick={addDeposit} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: !depTg || !Number(depAmount) ? 0.5 : 1 }}>+ ADD</button>
              </div>
            </section>

            {/* ===== BEST LINK — le tunnel optimisé : budget annoncé → broker le plus rémunérateur.
                Demander au prospect combien il compte investir AVANT de lui envoyer un lien, saisir le
                montant ici, envoyer le lien du haut du classement. Prospect sélectionné → ses brokers
                existants sont retirés du classement (jamais renvoyer quelqu'un là où il a déjà un compte). */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>BEST LINK — WHERE TO SEND A DEPOSIT</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={planAmount} onChange={(e) => setPlanAmount(e.target.value)} placeholder="planned deposit $" inputMode="decimal" style={{ ...inp, width: 150 }} />
                <select value={planTg} onChange={(e) => setPlanTg(e.target.value)} title="optional — removes the brokers this member already uses" style={{ ...inp, width: 210 }}>
                  <option value="">prospect (optional)…</option>
                  {[...rows].sort((a, b) => a.member_no - b.member_no).map((r) => (
                    <option key={r.tg_id} value={String(r.tg_id)}>#{r.member_no} {r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '')}</option>
                  ))}
                </select>
                {planExcluded.size > 0 && <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>already at: {[...planExcluded].map((k) => (BROKERS.find((b) => b.key === k)?.name ?? k)).join(', ')}</span>}
              </div>
              {!Number(planAmount) && <p style={dimP}>Ask the prospect how much he plans to invest, type it above — the ranking tells you which broker link pays the most for that budget.</p>}
              {Number(planAmount) > 0 && planRanking.length === 0 && <p style={dimP}>No commission at this amount on any available broker{Number(planAmount) < 200 ? ' — only RaiseFX pays under $200 (from $100)' : ''}.</p>}
              {planRanking.map(({ key, usd }, i) => {
                const b = BROKERS.find((x) => x.key === key);
                if (!b) return null;
                const top = i === 0;
                const bonus = b.bonus; // capturé : le narrowing TS ne traverse pas les callbacks onClick
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${top ? 'color-mix(in srgb, var(--gold) 45%, transparent)' : 'var(--border)'}`, background: top ? 'rgba(240,200,80,.06)' : 'rgba(10,17,31,.55)' }}>
                    <span className="mono" style={{ fontSize: 11, color: top ? 'var(--gold)' : 'var(--dim)', minWidth: 18, fontWeight: 800 }}>{i + 1}.</span>
                    <span style={{ fontSize: 12.5, fontWeight: top ? 800 : 600, color: 'var(--text)' }}>{b.name}</span>
                    {top && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: 'var(--gold)', border: '1px solid color-mix(in srgb, var(--gold) 40%, transparent)', borderRadius: 6, padding: '2px 7px' }}>BEST</span>}
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--up)' }}>${usd}</span>
                    {/* code bonus (closing manuel) — clic = copie du CODE seul, à coller dans le DM avec le lien */}
                    {bonus && (
                      <button onClick={() => copyBrokerLink(key + ':code', bonus.code)} title={`${bonus.pct}% deposit bonus — click to copy the code`} className="mono" style={{ ...miniBtn, fontWeight: 800, color: 'var(--gold)' }}>
                        {planCopied === key + ':code' ? '✓ code copied' : `🎁 ${bonus.code}`}
                      </button>
                    )}
                    <span style={{ flex: 1 }} />
                    <button onClick={() => copyBrokerLink(key, b.url)} style={miniBtn}>{planCopied === key ? '✓ copied' : '⧉ copy link'}</button>
                  </div>
                );
              })}
            </section>

            {/* le bilan du mois : navigation ‹ › + totaux + export CSV (Google Sheets / Excel) */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => shiftMonth(-1)} style={miniBtn}>‹</button>
                <h2 style={{ ...secH, minWidth: 150, textAlign: 'center' }}>{monthLabel}</h2>
                <button onClick={() => shiftMonth(1)} style={miniBtn}>›</button>
                <span style={{ flex: 1 }} />
                <button disabled={monthDeps.length === 0} onClick={exportCsv} style={{ ...goldBtn, opacity: monthDeps.length === 0 ? 0.5 : 1 }}>⬇ EXPORT CSV</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <Kpi label="DEPOSITS" value={String(monthDeps.length)} accent="var(--cyan)" />
                <Kpi label="DEPOSITED" value={`$${Math.floor(depTotals.deposited)}`} accent="var(--cyan)" />
                <Kpi label="COM RECEIVED" value={`$${Math.floor(depTotals.received)}`} accent="var(--up)" />
                <Kpi label="COM PENDING" value={`$${Math.floor(depTotals.pending)}`} accent="var(--gold)" hot={depTotals.pending > 0} />
                <Kpi label="COM LOST" value={`$${Math.floor(depTotals.lost)}`} accent="#ff6b8a" />
              </div>
              {monthDeps.length === 0 && <p style={dimP}>No deposits logged for this month yet — add one above as soon as a member funds his broker account.</p>}
              {monthDeps.map((d) => {
                const st = String(d.detail?.commission_status ?? 'pending');
                const stC = st === 'received' ? 'var(--up)' : st === 'canceled' ? '#ff6b8a' : 'var(--gold)';
                return (
                  <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', minWidth: 70 }}>{depDateOf(d).slice(0, 10)}</span>
                      {/* la ligne vient d'un mois précédent : sans ce repère, un dépôt de juillet reporté
                          en août ressemble à un dépôt d'août et le bilan devient illisible à la relecture */}
                      {d.detail?.booked_ym && depDateOf(d).slice(0, 7) !== String(d.detail.booked_ym) && (
                        <span className="mono" title={`deposited in ${depDateOf(d).slice(0, 7)}, booked here because the commission was not validated yet`}
                          style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, color: 'var(--cyan)', border: '1px solid rgba(43,227,245,.4)', borderRadius: 6, padding: '2px 6px' }}>
                          ↪ FROM {depDateOf(d).slice(0, 7)}
                        </span>
                      )}
                      <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12 }}>#{d.member_no ?? '—'}</span>
                      {/* pas nameOf : sans @username il renvoie #no, déjà affiché juste avant → doublon */}
                      <span style={{ fontSize: 12, color: 'var(--text)' }}>{(() => { const m = rows.find((r) => Number(r.tg_id) === Number(d.tg_id)); return m?.tg_username ? '@' + m.tg_username : (m?.tg_name ?? '—'); })()}</span>
                      {legalOf(d.tg_id) && <span className="mono" style={{ fontSize: 10.5, color: 'var(--gold)' }} title="name on the broker account">🏦 {legalOf(d.tg_id)}</span>}
                      {/* pays : hérité du membre — éditable ICI pour rattraper les dépôts déjà saisis en 2 clics */}
                      {countrySelect(d.tg_id, rows.find((r) => Number(r.tg_id) === Number(d.tg_id))?.country ?? null, rows.find((r) => Number(r.tg_id) === Number(d.tg_id))?.source ?? null)}
                      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{(d.detail?.broker ?? '—').toUpperCase()}</span>
                      <button onClick={() => editDepositAmount(d)} title="edit deposit amount (e.g. member deposited in several chunks)" className="mono" style={{ ...miniBtn, fontSize: 12.5, fontWeight: 800, color: 'var(--cyan)' }}>${Number(d.detail?.amount_usd ?? 0)} ✎</button>
                      <span style={{ color: 'var(--dim)', fontSize: 11 }}>→ com</span>
                      <button onClick={() => editDepositCom(d)} title="edit expected commission" className="mono" style={{ ...miniBtn, fontSize: 12, fontWeight: 800, color: 'var(--gold)' }}>${Number(d.detail?.commission_usd ?? 0)} ✎</button>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: stC, border: `1px solid color-mix(in srgb, ${stC} 40%, transparent)`, borderRadius: 6, padding: '2px 7px' }}>{st === 'canceled' ? 'LOST' : st.toUpperCase()}</span>
                      <span style={{ flex: 1 }} />
                      {st !== 'received' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'received' } })} style={okBtn}>✓ RECEIVED</button>}
                      {st !== 'canceled' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'canceled' } })} title="commission fell through (flash withdrawal, broker refusal…)" style={dangerBtn}>✗ LOST</button>}
                      {st !== 'pending' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'pending' } })} title="back to pending" style={miniBtn}>↺</button>}
                      {/* REPORT AU MOIS SUIVANT — pour les dépôts dont la com n'est pas encore validée (lot
                          minimum pas atteint). La ligne quitte le bilan de ce mois et réapparaît au suivant,
                          SANS que la date du dépôt soit modifiée. Réversible : le bouton ↩ la ramène. */}
                      {d.detail?.booked_ym ? (
                        <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, bookedYm: null } })}
                          title={`reported to ${String(d.detail.booked_ym)} — click to put it back in its real month (${depDateOf(d).slice(0, 7)})`}
                          style={{ ...miniBtn, color: 'var(--gold)' }}>↩ UNDO MOVE</button>
                      ) : (
                        <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, bookedYm: nextYm(ym) } })}
                          title={`commission not validated yet (lot not traded) → move this line to ${nextYm(ym)}. The deposit date is NOT changed.`}
                          style={{ ...miniBtn, color: 'var(--cyan)' }}>→ {nextYm(ym)}</button>
                      )}
                      <button disabled={busy} onClick={() => deleteDeposit(d)} title="delete this line (typo)" style={miniBtn}>🗑</button>
                    </div>
                    {d.detail?.note && <div style={{ fontSize: 11, color: 'var(--dim)', paddingLeft: 80 }}>{String(d.detail.note)}</div>}
                  </div>
                );
              })}
            </section>
          </>
  );
}
