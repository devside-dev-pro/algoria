'use client';
// TOOLS — la boîte à outils de l’opérateur : push composer, relance des leads, legacy
// Découpé depuis app/admin/page.tsx (03/09/2026) : un fichier par onglet, l’état et les handlers restent
// dans useAdminState (app/admin/_state.tsx) et arrivent ici par contexte.
import { ask } from '@/components/admin/Dialog';
import { useAdmin } from '../_state';
import { CTA_TEMPLATES, dangerBtn, dimP, goldBtn, inp, miniBtn, secH } from '../_shared';

export function ToolsTab() {
  const { STEP_LABEL, bcAudience, bcReport, bcTag, bcText, busy, carding, composerSend, cpBtn, cpChat, cpReport, cpText, cpUrl, daysStuck, downloadCard, downloadRecap, feedWins, input, leads, live, nudge, post, proof, pushAud, pushBody, pushResult, pushTitle, pushUrl, rows, sendBroadcast, sendChannelPost, setBcAudience, setBcTag, setBcText, setBusy, setCpBtn, setCpChat, setCpReport, setCpText, setCpUrl, setInput, setPushAud, setPushBody, setPushTitle, setPushUrl, setSthAudit, state, sthAudit, tgChats, wl } = useAdmin();
  return (
          <>
            {/* 📣 ANNONCE GROUPÉE — née du basculement S1 → S2 : prévenir 17 membres un par un depuis le
                fil BOT ACTIVITY, c'est 17 clics et la certitude d'en oublier un. L'audience est résolue
                CÔTÉ SERVEUR (le navigateur n'envoie qu'un nom de segment), et l'étiquette empêche qu'un
                double clic renvoie le même message à quelqu'un qui l'a déjà reçu. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
              <h2 style={secH}>📣 ANNOUNCE TO A SEGMENT (bot DM)</h2>
              <p style={dimP}>One message, sent through the Algoria bot to a whole segment. The tag below is the anti-duplicate lock: anyone who already received it is skipped, so clicking twice is safe.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={bcAudience} onChange={(e) => setBcAudience(e.target.value as 'pending' | 'live')} className="mono" style={{ fontSize: 11.5, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)' }}>
                  <option value="pending">members waiting in the queue (pending)</option>
                  <option value="live">all live + paused members</option>
                </select>
                <input value={bcTag} onChange={(e) => setBcTag(e.target.value)} placeholder="anti-duplicate tag" className="mono" style={{ fontSize: 11.5, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', flex: '1 1 190px' }} />
              </div>
              <textarea value={bcText} onChange={(e) => setBcText(e.target.value)} rows={13}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }} />
              <p style={{ ...dimP, margin: 0 }}>{'{name}'} becomes the member&rsquo;s first name when we know it, and disappears cleanly when we don&rsquo;t. Basic HTML (&lt;b&gt;, &lt;i&gt;) is supported.</p>
              <button disabled={busy || !bcText.trim()} onClick={sendBroadcast} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: busy ? 0.5 : 1, alignSelf: 'flex-start' }}>📣 SEND</button>
              {bcReport && (
                <div className="mono" style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 9 }}>
                  <span><b style={{ color: 'var(--up)' }}>{bcReport.sent} sent</b>{bcReport.skipped > 0 && <> · {bcReport.skipped} already had it</>}{bcReport.failed > 0 && <> · <b style={{ color: '#ff6b8a' }}>{bcReport.failed} failed</b></>}</span>
                  {bcReport.report.filter((r) => !r.ok).map((r, i) => (
                    <span key={i} style={{ color: '#ff6b8a' }}>#{r.member_no ?? '?'} — {r.error}</span>
                  ))}
                </div>
              )}
            </section>

            {/* AUDIT STH (03/08) — ne dans le cas #7 : une cliente affichee LIVE chez nous, connectee chez
                STH, mais abonnee a AUCUN master. Elle ne recevait plus un seul trade, et RIEN dans notre
                base ne permettait de le voir — seul STH connait cet etat. C'est le pire defaut possible
                pour un copieur : le membre croit trader, regarde un ecran qui ne bouge plus, et c'est lui
                qui finit par nous prevenir. Ce bouton pose la question a STH pour chaque membre live.
                Les membres EN PAUSE ne sont jamais touches : leur absence de master est volontaire. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
              <h2 style={secH}>🩺 STH AUDIT — who is actually copying?</h2>
              <p style={dimP}>Asks STH, member by member, whether each LIVE account is really subscribed to a master. Paused members are never touched — their empty subscription is deliberate.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={() => { setBusy(true); setSthAudit(null); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sthAudit: 'check' }) }).then(async (r) => { const d = await r.json(); if (d.error) void ask.alert(`⚠ ${d.error}`); else setSthAudit(d); }).finally(() => setBusy(false)); }}
                  style={goldBtn}>🔍 CHECK ONLY</button>
                <button disabled={busy || !sthAudit || !(sthAudit.summary.orphan > 0)} onClick={async () => { if (!await ask.confirm(`Reconnect ${sthAudit?.summary.orphan} member(s) to their strategy? This resumes copying on their live account.`)) return; setBusy(true); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sthAudit: 'repair' }) }).then(async (r) => { const d = await r.json(); if (d.error) void ask.alert(`⚠ ${d.error}`); else setSthAudit(d); }).finally(() => setBusy(false)); }}
                  style={{ ...goldBtn, opacity: sthAudit && sthAudit.summary.orphan > 0 ? 1 : 0.45 }}>🔧 REPAIR ORPHANS</button>
              </div>
              {sthAudit && (
                <>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {sthAudit.summary.checked} checked · <b style={{ color: 'var(--up)' }}>{sthAudit.summary.ok} ok</b>
                    {sthAudit.summary.orphan > 0 && <> · <b style={{ color: '#ff8a5c' }}>{sthAudit.summary.orphan} copying nothing</b></>}
                    {sthAudit.summary.repaired > 0 && <> · <b style={{ color: 'var(--up)' }}>{sthAudit.summary.repaired} repaired</b></>}
                    {sthAudit.summary.failed > 0 && <> · <b style={{ color: '#ff6b8a' }}>{sthAudit.summary.failed} failed</b></>}
                    {sthAudit.summary.unknown > 0 && <> · {sthAudit.summary.unknown} not connected</>}
                    {sthAudit.summary.error > 0 && <> · {sthAudit.summary.error} STH error</>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 360, overflowY: 'auto' }}>
                    {sthAudit.rows.filter((r) => r.state !== 'ok').map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)' }}>
                        <span className="mono goldText" style={{ fontSize: 11, fontWeight: 800 }}>#{r.member_no ?? '—'}</span>
                        <span style={{ fontSize: 12, color: 'var(--text)' }}>{r.name}</span>
                        <span className="mono" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, color: r.state === 'repaired' ? 'var(--up)' : r.state === 'orphan' ? '#ff8a5c' : '#ff6b8a' }}>{r.state.toUpperCase()}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 11, color: 'var(--dim)' }}>{r.detail}</span>
                      </div>
                    ))}
                    {sthAudit.rows.every((r) => r.state === 'ok') && <p style={dimP}>Everyone live is really copying. Nothing to fix.</p>}
                  </div>
                </>
              )}
            </section>

            {/* PUSH COMPOSER — le canal marketing gratuit : message libre vers un segment, test sur soi d'abord */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
              <h2 style={secH}>📣 PUSH COMPOSER</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {([['self', '🧪 ONLY ME — TEST'], ['prospects', `PROSPECTS · ${rows.filter((r) => ['onboarding', 'pending_copier'].includes(r.status)).length}`], ['live', `LIVE MEMBERS · ${rows.filter((r) => ['live', 'paused'].includes(r.status)).length}`], ['all', `EVERYONE · ${rows.length}`]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setPushAud(k)} style={{
                    padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8,
                    border: `1px solid ${pushAud === k ? 'rgba(43,227,245,.5)' : 'var(--border)'}`,
                    background: pushAud === k ? 'rgba(43,227,245,.08)' : 'transparent',
                    color: pushAud === k ? 'var(--cyan)' : 'var(--muted)',
                  }}>{label}</button>
                ))}
              </div>
              <input value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} placeholder="title — e.g. 🔥 +1,896$ banked today" maxLength={80} style={inp} />
              <textarea value={pushBody} onChange={(e) => setPushBody(e.target.value)} placeholder="message — e.g. The AI closed 25 winning trades today. Come see the recap live." maxLength={300} rows={3} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="/member or https://…" style={{ ...inp, flex: 1, minWidth: 200 }} />
                <button disabled={busy || !pushTitle.trim() || !pushBody.trim()} onClick={composerSend} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: !pushTitle.trim() || !pushBody.trim() ? 0.5 : 1 }}>
                  {pushAud === 'self' ? '🧪 SEND TEST' : '📣 SEND'}
                </button>
              </div>
              {pushResult && <p style={{ ...dimP, color: 'var(--up)' }}>✓ {pushResult}</p>}
              <p style={dimP}>Only members who enabled notifications receive it — always 🧪 test on yourself before blasting a segment.</p>
            </section>

            {/* WIN CARD STUDIO — les stories façon Binance pour la CM : P&L en énorme + QR algoria.tech,
                format 1080×1920 prêt à poster (canal, stories, TikTok) — à déposer dans le Drive */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 680 }}>
              <h2 style={secH}>🎨 WIN CARDS — STORY 9:16 · WIDE 16:9</h2>
              {/* les RÉCAPS — le post de fin de session et le bilan hebdo, wins only (règle 70/30) */}
              {([
                ['day', '📅 DAY RECAP', proof?.today] as const,
                ['week', '🗓 WEEK RECAP', proof?.week] as const,
              ]).map(([period, label, s]) => (
                <div key={period} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.05)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 800 }}>{label}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: s?.count ? 'var(--up)' : 'var(--dim)' }}>
                    {s ? (s.count ? `✓ ${s.count} wins · +$${Math.round(s.total)} · best +$${Math.round(s.best)}` : 'no wins yet') : '…'}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button disabled={!s?.count || carding === `${period}-story`} onClick={() => void downloadRecap(period, 'story')} style={{ ...goldBtn, opacity: s?.count ? 1 : 0.45 }}>{carding === `${period}-story` ? '…' : '⬇ STORY'}</button>
                  <button disabled={!s?.count || carding === `${period}-landscape`} onClick={() => void downloadRecap(period, 'landscape')} style={{ ...goldBtn, opacity: s?.count ? 1 : 0.45 }}>{carding === `${period}-landscape` ? '…' : '⬇ WIDE'}</button>
                </div>
              ))}
              {feedWins.length === 0 && <p style={dimP}>Recent wins appear here as trades close — each downloads as a ready-to-post story card.</p>}
              {feedWins.map((t) => (
                <div key={t.ticket} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: t.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>{t.direction === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.symbol === 'XAUUSD' ? 'GOLD' : 'BTC'}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--up)' }}>+${Number(t.pnl).toFixed(0)}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{new Date(t.closed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span style={{ flex: 1 }} />
                  <button disabled={carding === `${t.ticket}-story`} onClick={() => void downloadCard(t, 'story')} style={goldBtn}>{carding === `${t.ticket}-story` ? '…' : '⬇ STORY'}</button>
                  <button disabled={carding === `${t.ticket}-landscape`} onClick={() => void downloadCard(t, 'landscape')} style={goldBtn}>{carding === `${t.ticket}-landscape` ? '…' : '⬇ WIDE'}</button>
                </div>
              ))}
            </section>

            {/* ===== POST DE CANAL AVEC BOUTON (16/08/2026) =====================================
                Telegram n'autorise un clavier inline QUE via un bot : impossible de poser un bouton à la
                main depuis l'app Telegram. Mathieu devait donc se contenter d'un lien nu dans le texte,
                qui convertit nettement moins bien qu'un bouton.
                On publie sur UN canal — le source — et le fan-out existant s'occupe du reste : le miroir
                UK et le pont italien transportent maintenant le clavier. Publier sur les trois d'ici
                créerait des doublons, puisque le fan-out se déclenche sur le post source. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
              <h2 style={secH}>📣 POST A CTA TO A CHANNEL — with a real button</h2>
              <p style={dimP}>
                Telegram only lets a <b>bot</b> attach a button, which is why you can&rsquo;t do it by hand. Pick the
                <b> source channel</b> and this posts to <b>all three</b> in one go: source and UK mirror as written,
                IT channel translated — same button everywhere. The button label itself stays in English, as you type it.
              </p>
              {/* MODÈLES — deux familles, parce qu'elles ne servent pas au même moment : « → app » pour
                  ceux qui avanceront seuls, « → toi » pour ceux qui ne bougeront que si un humain leur
                  parle. Un clic pré-remplit tout, et tout reste modifiable ensuite. */}
              {(['app', 'mathieu'] as const).map((fam) => (
                <div key={fam} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span className="mono" style={{ fontSize: 9, letterSpacing: 1.4, color: 'var(--dim)', fontWeight: 800 }}>
                    {fam === 'app' ? '→ VERS L’APP · ils avancent seuls' : '→ VERS TOI · ils ont besoin de te parler'}
                  </span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {CTA_TEMPLATES.filter((t) => t.target === fam).map((t) => (
                      <button key={t.id} onClick={() => { setCpText(t.text.replace(/\\n/g, '\n')); setCpBtn(t.btn); setCpUrl(t.url); setCpReport(null); }}
                        style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                          border: `1px solid ${cpBtn === t.btn ? 'rgba(43,227,245,.55)' : 'var(--border)'}`,
                          background: cpBtn === t.btn ? 'rgba(43,227,245,.08)' : 'transparent',
                          color: cpBtn === t.btn ? 'var(--cyan)' : 'var(--muted)' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <select value={cpChat} onChange={(e) => setCpChat(e.target.value)} style={{ ...inp, maxWidth: 380 }}>
                <option value="">Choose the channel…</option>
                {tgChats.map((c) => (
                  <option key={c.chat_id} value={String(c.chat_id)}>{c.title ?? c.chat_id}{c.role ? ` · ${c.role}` : ''}</option>
                ))}
              </select>
              <textarea
                value={cpText} onChange={(e) => setCpText(e.target.value)} rows={5}
                placeholder={'Your message. HTML allowed: <b>bold</b>, <i>italic</i>, <a href="...">link</a>'}
                style={{ ...inp, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={cpBtn} onChange={(e) => setCpBtn(e.target.value)} placeholder="Button label" style={{ ...inp, flex: '1 1 170px' }} />
                <input value={cpUrl} onChange={(e) => setCpUrl(e.target.value)} placeholder="https://…" style={{ ...inp, flex: '2 1 240px' }} />
              </div>
              {/* APERÇU : ce qui part est définitif et public — on le montre avant, pas après. */}
              {cpText.trim() && (
                <div style={{ border: '1px solid rgba(43,227,245,.3)', background: 'rgba(43,227,245,.05)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{cpText}</div>
                  {cpBtn.trim() && (
                    <div style={{ textAlign: 'center', padding: '9px 12px', borderRadius: 9, background: 'rgba(43,227,245,.14)', border: '1px solid rgba(43,227,245,.4)', color: 'var(--cyan)', fontWeight: 700, fontSize: 12.5 }}>{cpBtn}</div>
                  )}
                </div>
              )}
              <button disabled={busy || !cpText.trim() || !cpChat} onClick={sendChannelPost}
                style={{ padding: '12px 18px', borderRadius: 11, border: 'none', cursor: cpText.trim() && cpChat ? 'pointer' : 'default', fontWeight: 800, fontSize: 13, letterSpacing: 0.5,
                  color: '#04223a', background: cpText.trim() && cpChat ? 'linear-gradient(90deg,#2be3f5,#39a0ff)' : 'rgba(130,152,190,.25)' }}>
                {busy ? 'POSTING…' : '📣 POST TO CHANNEL'}
              </button>
              {cpReport && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {cpReport.map((r) => (
                    <p key={r.channel} style={{ margin: 0, fontSize: 12, color: r.ok ? 'var(--up)' : 'rgba(210,150,165,.9)' }}>
                      {r.ok ? '✓' : '✗'} {r.channel}{r.error ? ` — ${r.error}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </section>

            {/* RELANCE — les leads coincés dans le funnel, du plus ancien au plus récent : ta liste de closing */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 680 }}>
              <h2 style={secH}>🎯 FOLLOW-UP — STUCK IN THE FUNNEL {leads.length > 0 && `· ${leads.length}`}</h2>
              {leads.length === 0 && <p style={dimP}>Nobody stuck — every signup either finished the wizard or is waiting in the QUEUE.</p>}
              {leads.map((r) => (
                <div key={r.member_no} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)', flexWrap: 'wrap' }}>
                  <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12, minWidth: 34 }}>#{r.member_no}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, minWidth: 150 }}>{STEP_LABEL[r.onboarding_step] ?? STEP_LABEL[0]}</span>
                  <span className="mono" style={{ fontSize: 10, color: daysStuck(r) >= 3 ? 'var(--gold)' : 'var(--dim)', whiteSpace: 'nowrap' }}>{daysStuck(r) === 0 ? 'today' : `${daysStuck(r)}d stuck`}</span>
                  {r.tg_username && <a href={`https://t.me/${r.tg_username}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>💬 DM</a>}
                  <button disabled={busy} onClick={() => nudge(r)} title="push: 'Need a hand finishing your setup?' → opens the wizard" style={goldBtn}>🔔 NUDGE</button>
                </div>
              ))}
              {pushResult && leads.length > 0 && <p style={{ ...dimP, color: 'var(--up)' }}>✓ {pushResult}</p>}
            </section>

            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11, maxWidth: 680 }}>
            <h2 style={secH}>👑 VIP / TEAM ACCESS</h2>
            {/* whitelist RESSUSCITÉE : un @ ici voit l'app COMPLÈTE (zéro mode teaser) sans connexion
                copieur — CM (screens vue utilisateur), partenaires, invités. Ne touche pas au statut. */}
            <p style={dimP}>Handles here see the FULL app (no teaser mode) without connecting a broker account — for your CM, partners and trusted guests. Members still unlock automatically when they go LIVE.</p>
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
            {wl.length === 0 && <p style={dimP}>Empty — add your CM&rsquo;s @ to give her the full member view.</p>}
            </section>
          </>
  );
}
