'use client';
// DASHBOARD — les chiffres qui comptent, toujours en tête
// Découpé depuis app/admin/page.tsx (03/09/2026) : un fichier par onglet, l’état et les handlers restent
// dans useAdminState (app/admin/_state.tsx) et arrivent ici par contexte.
import { ask } from '@/components/admin/Dialog';
import { useAdmin } from '../_state';
import { Kpi, RowLine, SCRIPTS, dimP, goldBtn, inp, miniBtn, okBtn, personalise, secH, td, warnBox } from '../_shared';

export function DashboardTab() {
  const { KIND_LABEL, STEP_LABEL, actions, aff, blastBody, blastText, blastTitle, botActivity, botBlocked, botDrafts, busy, chatCopied, copiedScript, depPending, depTotals, deposits, input, joinSources, leads, legalOf, live, liveNoDeposit, load, monthLabel, nameOf, nudge, nudges, pendingRev, post, rejectedTgIds, relSeg, rows, sendBlast, sendViaBot, setBlastBody, setBlastText, setBlastTitle, setBotDrafts, setBusy, setChatCopied, setCopiedScript, setRelSeg, setTab, setTgInboxOn, spokeTgIds, tgChats, tgInboxOn, todo } = useAdmin();
  return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <Kpi label="MEMBERS" value={String(rows.length)} accent="var(--cyan)" />
              <Kpi label="COPYING LIVE" value={String(live)} accent="var(--up)" />
              <Kpi label="UNDER REVIEW" value={String(pendingRev)} accent="var(--gold)" hot={pendingRev > 0} />
              <Kpi label="TO PROCESS" value={String(todo)} accent="#ff8a5c" hot={todo > 0} />
              <Kpi label="OWED TO PARTNERS" value={`$${Math.floor(aff?.owedUsd ?? 0)}`} accent="var(--gold)" />
              {/* reçu = encaissé (✓ RECEIVED) ; le pending s'affiche en dessous — sinon $0 après une
                  saisie de dépôt semble être un bug alors que la com attend juste le paiement broker */}
              <Kpi label={`BROKER COM · ${monthLabel.split(' ')[0].slice(0, 3)}`} value={`$${Math.floor(depTotals.received)}`} accent="var(--up)" hot={depTotals.pending > 0}
                sub={depTotals.pending > 0 ? `+ $${Math.floor(depTotals.pending)} pending broker payout` : undefined} />
            </div>
            {(aff?.flagged.length ?? 0) > 0 && (
              <div style={{ ...warnBox }}>⚠ negative balances: {aff!.flagged.map((f) => `${f.username ? '@' + f.username : '#' + f.member_no} (${Math.floor(f.balance)}$)`).join(' · ')}</div>
            )}
            {/* ===== ENTONNOIR D'ACTIVATION — où fuit l'argent. Le levier n°1 : la plupart des inscrits ne
                financent jamais. On voit la marche qui saigne + la relance auto la travaille chaque jour. */}
            {(() => {
              const signups = rows.length;
              const depositors = new Set(deposits.map((d) => Number(d.tg_id))).size;
              const liveN = rows.filter((r) => r.status === 'live').length;
              const started = rows.filter((r) => !(r.status === 'onboarding' && (r.onboarding_step ?? 0) === 0)).length; // a dépassé l'écran broker
              const step0 = rows.filter((r) => r.status === 'onboarding' && (r.onboarding_step ?? 0) === 0).length;
              const step1 = rows.filter((r) => r.status === 'onboarding' && (r.onboarding_step ?? 0) >= 1).length;
              const stages: Array<{ label: string; n: number; col: string }> = [
                { label: 'signed up', n: signups, col: 'var(--cyan)' },
                { label: 'started setup', n: started, col: '#7aa2f7' },
                { label: 'funded', n: depositors, col: 'var(--gold)' },
                { label: 'copying live', n: liveN, col: 'var(--up)' },
              ];
              const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
              return (
                <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <h2 style={secH}>🎯 ACTIVATION FUNNEL — where the money leaks</h2>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    {stages.map((s, i) => (
                      <div key={s.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
                        <span className="mono" style={{ fontSize: 19, fontWeight: 800, color: s.col }}>{s.n}</span>
                        <div style={{ width: '100%', height: 8, borderRadius: 5, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct(s.n, signups)}%`, height: '100%', background: s.col }} />
                        </div>
                        <span style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: 0.4, textAlign: 'center' }}>{s.label}</span>
                        {i > 0 && <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{pct(s.n, stages[i - 1].n)}% of prev</span>}
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                    <span>🧱 stuck at <b style={{ color: 'var(--text)' }}>deposit wall</b> (step 0): <b style={{ color: '#ff8a5c' }}>{step0}</b></span>
                    <span>🔌 stuck at <b style={{ color: 'var(--text)' }}>MT5 connect</b> (step 1): <b style={{ color: 'var(--gold)' }}>{step1}</b></span>
                    <span style={{ color: 'var(--dim)' }}>· auto-sequence works these daily — your voice notes close them (see below)</span>
                  </div>
                  {/* 📡 PAR CANAL (attribution UTM au premier clic) — le juge de paix des ads : inscrits et
                      FINANCÉS par source. "organic / unknown" = pas de cookie (organique, ou flux cross-device
                      ads→Telegram→autre appareil : attribution partielle assumée). Croiser avec la dépense
                      hebdo du media buyer → CAC réel par financé, par canal (rituel du lundi). */}
                  {(() => {
                    const bySrc = new Map<string, { signups: number; funded: number; live: number }>();
                    const fundedSet = new Set(deposits.map((d) => Number(d.tg_id)));
                    for (const r of rows) {
                      const k = r.source ?? 'organic / unknown';
                      const e = bySrc.get(k) ?? { signups: 0, funded: 0, live: 0 };
                      e.signups++;
                      if (fundedSet.has(Number(r.tg_id))) e.funded++;
                      if (r.status === 'live') e.live++;
                      bySrc.set(k, e);
                    }
                    const srcRows = [...bySrc.entries()].sort((a, b) => b[1].signups - a[1].signups);
                    if (srcRows.length <= 1) return (
                      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)' }}>
                        📡 Per-channel attribution is live — tag your ad links with <b className="mono" style={{ color: 'var(--muted)' }}>?utm_source=meta&utm_campaign=uk</b> (or ?src=…) and new signups will break down by channel here.
                      </p>
                    );
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid rgba(130,152,190,.12)', paddingTop: 9 }}>
                        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.5, color: 'var(--dim)', fontWeight: 800 }}>📡 BY CHANNEL (first-click UTM)</span>
                        {srcRows.map(([src, v]) => (
                          <div key={src} className="mono" style={{ display: 'flex', gap: 14, fontSize: 11, alignItems: 'baseline' }}>
                            <span style={{ color: src === 'organic / unknown' ? 'var(--dim)' : 'var(--cyan)', fontWeight: 700, minWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src}</span>
                            <span style={{ color: 'var(--muted)' }}>{v.signups} signups</span>
                            <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{v.funded} funded</span>
                            <span style={{ color: 'var(--up)' }}>{v.live} live</span>
                            <span style={{ color: 'var(--dim)' }}>{v.signups > 0 ? Math.round((v.funded / v.signups) * 100) : 0}% conv</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </section>
              );
            })()}
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
                {depPending.slice(0, 5).map((d) => (
                  <RowLine key={d.id} onClick={() => setTab('deposits')} icon="🏦" text={`deposit com $${Number(d.detail?.commission_usd ?? 0)} · member #${d.member_no ?? '—'} (${(d.detail?.broker ?? '?').toUpperCase()})`} sub="mark ✓ RECEIVED once the broker paid you" gold />
                ))}
                {/* connectés mais dépôt jamais enregistré — le trou dans lequel les journées à 5 dépôts tombaient */}
                {liveNoDeposit.slice(0, 5).map((r) => (
                  <RowLine key={r.tg_id} onClick={() => setTab('deposits')} icon="⚠" text={`live, no deposit logged · #${r.member_no} ${r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '')}`} sub="click → DEPOSITS, the orange strip prefills the form" gold />
                ))}
              </section>
            ) : (
              <section className="panel" style={{ padding: 22, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>All clear — nothing waiting on you. 🎉</section>
            )}
            {/* ===== RELANCES DU JOUR — la file de leads à toucher EN PERSONNE (message/vocal Mathieu).
                Prospects en onboarding 1-21 j, pas touchés depuis 3 j (relances auto comprises). Le bot
                filet passe à 10h UTC derrière — mais TON vocal convertit mieux : déroule cette liste d'abord. */}
            {(() => {
              const now = Date.now();
              // LE BOT NE VIDE PLUS TA FILE (14/08). La règle « masqué 3 jours après une relance » ne
              // distinguait pas QUI avait relancé. Depuis que la relance automatique couvre 60 jours au
              // lieu de 21, le bot touche en permanence les mêmes gens — il aurait donc effacé de la file
              // manuelle, en continu, ceux que Mathieu voulait justement appeler. L'outil automatique
              // aurait saboté la session humaine qu'il est censé compléter.
              // Seul un contact HUMAIN masque désormais quelqu'un (done_by ≠ 'auto' : ✓ FAIT ou envoi par
              // le bot déclenché à la main). Le passage du bot reste AFFICHÉ sur la ligne — l'information
              // est utile, elle ne doit simplement pas décider à ta place.
              const lastNudge = new Map<number, number>(); // contacts HUMAINS uniquement
              const lastAuto = new Map<number, number>(); // dernier passage de la relance automatique
              for (const n of nudges) {
                const t = Number(n.tg_id); const at = Date.parse(n.created_at);
                const map = String(n.done_by ?? '') === 'auto' ? lastAuto : lastNudge;
                if ((map.get(t) ?? 0) < at) map.set(t, at);
              }
              // ═══ SEGMENTATION (14/08) ═══════════════════════════════════════════════════════════════
              // La file mélangeait des situations qui n'appellent PAS le même message. Mesuré sur les 219
              // personnes qu'elle contenait : 196 n'avaient JAMAIS écrit une ligne au bot. Leur envoyer une
              // relance (« alors, tu en es où ? ») n'avait aucun sens — elles ne savent même pas qui écrit,
              // et beaucoup ont quitté le canal depuis. Deux avaient déjà DÉPOSÉ sans finir : les plus
              // chaudes de toute la base, noyées au milieu. Douze s'étaient fait REFUSER leur connexion :
              // celles-là ont essayé, elles méritent un rattrapage, pas une relance.
              // Un ordre unique ne pouvait pas servir quatre conversations différentes. On sépare.
              const spoke = new Set(spokeTgIds);
              const blockedSet = new Set(botBlocked);
              const rejectedSet = new Set(rejectedTgIds);
              const depositedSet = new Set(deposits.map((d) => Number(d.tg_id)));
              type Seg = 'deposited' | 'rejected' | 'first' | 'followup';
              const segOf = (tg: number): Seg =>
                depositedSet.has(tg) ? 'deposited' : rejectedSet.has(tg) ? 'rejected' : spoke.has(tg) ? 'followup' : 'first';
              const all = rows
                .filter((r) => r.status === 'onboarding')
                .map((r) => ({ r, days: Math.floor((now - Date.parse(r.created_at)) / 86_400_000), touched: lastNudge.get(Number(r.tg_id)), autoTouched: lastAuto.get(Number(r.tg_id)), seg: segOf(Number(r.tg_id)) }))
                // FENÊTRE 21 → 60 JOURS (14/08). À 21 jours, 46 personnes inscrites entre 22 et 39 jours
                // n'apparaissaient NULLE PART : jamais contactées à la main, sorties de la file sans que
                // personne ne le décide. « Froid » n'est pas « perdu » quand on ne leur a jamais parlé.
                // La borne basse reste à 1 jour : quelqu'un qui vient de s'inscrire mérite quelques heures
                // avant qu'on lui saute dessus, et l'auto-nudge passe de toute façon.
                .filter((x) => x.days >= 1 && x.days <= 60 && (!x.touched || now - x.touched > 3 * 86_400_000))
                // ── INJOIGNABLES PAR LE BOT ────────────────────────────────────────────────────────
                // On ne raye QUE ceux qui n'ont PAS de @pseudo. Un blocage du bot ne rend pas quelqu'un
                // inatteignable : s'il a un pseudo, le DM personnel de Mathieu passe toujours — et c'est
                // justement celui qui convertit. Les rayer tous viderait la file de prospects encore
                // joignables, ce qui serait le même problème à l'envers.
                // Sans pseudo ET bot bloqué = aucune porte : la ligne ne porte plus aucune action
                // possible, elle n'a donc rien à faire dans une file de travail.
                .filter((x) => !(blockedSet.has(Number(x.r.tg_id)) && !x.r.tg_username))
                // le plus ancien d'abord : la session commence par la dette la plus vieille (12/08)
                .sort((a, b) => b.days - a.days);
              if (all.length === 0) return <section className="panel" style={{ padding: 16, color: 'var(--dim)', fontSize: 12.5 }}>📞 Relance queue clear — every recent lead was touched in the last 3 days.</section>;
              // ordre des onglets = ordre de PRIORITÉ commerciale, pas alphabétique : l'argent déjà déposé
              // d'abord, puis ceux qui ont essayé, puis la masse froide.
              const SEGS: Array<{ key: Seg; label: string; hint: string; color: string }> = [
                { key: 'deposited', label: '💰 DEPOSITED, NOT LIVE', hint: 'They already put money in and never finished. Nothing in this admin is more urgent — finish it for them, or call.', color: 'var(--up)' },
                { key: 'rejected', label: '🛠 REJECTED, TO RESCUE', hint: 'Their connection was declined. They tried. Tell them exactly what to fix — most think they were refused as a person.', color: '#ff8a5c' },
                { key: 'first', label: '👋 FIRST CONTACT', hint: 'They have NEVER written to us. This is not a follow-up — introduce yourself, say which channel this is, and give the invite back: many have left it since.', color: 'var(--cyan)' },
                { key: 'followup', label: '💬 REAL FOLLOW-UP', hint: 'You already have a conversation with them. Pick it back up where it stopped.', color: 'var(--gold)' },
              ];
              const counts = Object.fromEntries(SEGS.map((s) => [s.key, all.filter((x) => x.seg === s.key).length])) as Record<Seg, number>;
              const active = SEGS.find((s) => s.key === relSeg && counts[s.key] > 0) ?? SEGS.find((s) => counts[s.key] > 0) ?? SEGS[0];
              const queue = all.filter((x) => x.seg === active.key);
              return (
                <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <h2 style={secH}>📞 RELANCES DU JOUR · {all.length} — oldest first, your personal DM/voice beats any bot</h2>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SEGS.map((sg) => (
                      <button key={sg.key} onClick={() => setRelSeg(sg.key)} disabled={counts[sg.key] === 0}
                        style={{ padding: '6px 10px', borderRadius: 8, cursor: counts[sg.key] ? 'pointer' : 'default', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                          border: `1px solid ${active.key === sg.key ? sg.color : 'var(--border)'}`,
                          background: active.key === sg.key ? 'rgba(255,255,255,.06)' : 'transparent',
                          color: counts[sg.key] === 0 ? 'var(--dim)' : active.key === sg.key ? sg.color : 'var(--muted)', opacity: counts[sg.key] === 0 ? 0.45 : 1 }}>
                        {sg.label} · {counts[sg.key]}
                      </button>
                    ))}
                  </div>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>{active.hint}</p>
                  {/* SCRIPT PRÊT À COLLER, propre au segment. Le message de relance générique ne marche que
                      sur le dernier segment — sur les trois autres il tombe à côté, et ça se voit. */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55, whiteSpace: 'pre-wrap', flex: 1 }}>{SCRIPTS[active.key]}</span>
                    <button onClick={() => { void navigator.clipboard?.writeText(SCRIPTS[active.key]); setCopiedScript(active.key); window.setTimeout(() => setCopiedScript(null), 1800); }}
                      style={{ ...miniBtn, flex: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>
                      {copiedScript === active.key ? '✓ copied' : '⧉ copy'}
                    </button>
                  </div>
                  {queue.slice(0, 15).map(({ r, days, touched, autoTouched }) => (
                    <div key={r.tg_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)', flexWrap: 'wrap' }}>
                      <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12, minWidth: 36 }}>#{r.member_no}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</span>
                      {legalOf(r.tg_id) && <span className="mono" style={{ fontSize: 10, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }} title="name on the broker account">🏦 {legalOf(r.tg_id)}</span>}
                      <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: days >= 5 ? '#ff8a5c' : 'var(--gold)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px' }}>J+{days}</span>
                      {/* OÙ IL EN EST : sans ça, impossible de savoir quoi lui dire sans ouvrir sa fiche */}
                      <span style={{ fontSize: 10.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{STEP_LABEL[r.onboarding_step] ?? STEP_LABEL[0]}</span>
                      {touched && <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>you: {Math.floor((now - touched) / 86_400_000)}d ago</span>}
                      {/* passage du bot : affiché pour que tu ne doubles pas à quelques heures près, mais
                          il ne masque plus personne — c'est toi qui décides si un DM auto suffit. */}
                      {autoTouched && <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>🤖 {Math.floor((now - autoTouched) / 86_400_000)}d ago</span>}
                      <span style={{ flex: 1 }} />
                      {/* PAS DE @PSEUDO = PAS DE LIEN t.me. La moitié de la file est dans ce cas (109 sur 219),
                          et le bouton DM manquant donnait une ligne sans aucune action possible. Le bot, lui,
                          peut TOUJOURS écrire : tout le monde ici a tapé START pour se connecter à l'app. */}
                      {r.tg_username
                        ? <a href={`https://t.me/${r.tg_username}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>💬 DM</a>
                        : <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }} title="no @username — Telegram gives no direct link, use the bot">no @ · bot only</span>}
                      {/* BOT BLOQUÉ → le bouton disparaît et laisse un badge. Le garder proposerait une
                          action dont on sait déjà qu'elle échouera : un clic, une alerte d'erreur, rien.
                          Ces lignes-là ne restent visibles QUE parce qu'elles ont un @pseudo — le DM
                          personnel reste ouvert, et le badge dit où frapper. */}
                      {blockedSet.has(Number(r.tg_id))
                        ? <span title="Telegram refuse les envois du bot vers cette personne (bloqué / compte supprimé / jamais tapé START). Le DM personnel, lui, passe toujours." style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: 'var(--down)', border: '1px solid color-mix(in srgb, var(--down) 40%, transparent)', borderRadius: 6, padding: '3px 7px', whiteSpace: 'nowrap' }}>🚫 BOT BLOQUÉ</span>
                        : <button disabled={busy} onClick={() => sendViaBot(Number(r.tg_id), personalise(SCRIPTS[active.key], r.tg_name))} title="send this segment's script through the Algoria bot — works even without a @username" style={{ ...miniBtn, color: 'var(--gold)', borderColor: 'rgba(245,194,74,.45)' }}>🤖 BOT</button>}
                      <button disabled={busy} onClick={() => post({ nudged: r.tg_id })} title="I sent my personal message/voice note — remove from the queue for 3 days" style={okBtn}>✓ FAIT</button>
                    </div>
                  ))}
                  {queue.length > 15 && <p style={{ margin: 0, fontSize: 11, color: 'var(--dim)' }}>+{queue.length - 15} more in this segment, all newer than these — the 10:00 UTC auto-nudge catches whoever you don&rsquo;t reach.</p>}
                </section>
              );
            })()}
            {/* ===== 🎁 CAMPAGNE PROSPECTS — DM du bot + push à tous les membres SANS dépôt. Né de
                l'opération « dernier jour du mois » (31/07) : offre ALGORIA100 limitée dans le temps.
                Le texte est éditable AVANT envoi ; le compte exact de destinataires est demandé au
                serveur puis confirmé. Les déposants sont exclus d'office, et personne n'est touché
                deux fois en 12 h même si on reclique. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'rgba(245,194,74,.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ ...secH, color: 'var(--gold)' }}>🎁 CAMPAIGN — PROSPECTS ONLY</h2>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>bot DM + push to every member with no deposit yet (depositors excluded)</span>
              </div>
              <textarea value={blastText} onChange={(e) => setBlastText(e.target.value)} rows={9}
                placeholder="Message (HTML Telegram : <b>gras</b>, <i>italique</i>)"
                style={{ width: '100%', padding: 10, borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={blastTitle} onChange={(e) => setBlastTitle(e.target.value)} placeholder="push title (optional)" style={{ ...inp, flex: '1 1 180px' }} />
                <input value={blastBody} onChange={(e) => setBlastBody(e.target.value)} placeholder="push body (optional)" style={{ ...inp, flex: '1 1 220px' }} />
                <button disabled={busy || blastText.trim().length < 10} onClick={sendBlast}
                  title="asks the server how many prospects would receive this, then requires confirmation before sending"
                  style={{ padding: '10px 18px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#f5c24a,#e39a2b)', opacity: blastText.trim().length < 10 ? 0.5 : 1 }}>
                  📣 SEND CAMPAIGN
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5 }}>
                Telegram DM only reaches people who already opened a chat with the bot — the push notification covers part of the rest. Every send is logged in BOT ACTIVITY.
              </p>
            </section>
            {/* ===== 📣 SOURCES DES DEMANDES D'ADHÉSION — l'attribution enfin possible (30/07) : un lien
                d'invitation Telegram NOMMÉ par campagne (« META-UK-JUL ») apparaît ici avec ses demandes,
                ses acceptations et le taux de DM automatique délivré. Les ads pointent vers le canal, donc
                c'était le seul chaînon manquant entre le budget pub et les vrais entrants. */}
            {joinSources.length > 0 && (
              <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={secH}>📣 JOIN REQUESTS BY SOURCE</h2>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>name one Telegram invite link per campaign to see it split here</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
                        <th style={{ padding: '4px 8px 6px 0' }}>source</th>
                        <th style={{ padding: '4px 8px 6px 0', textAlign: 'right' }}>requests</th>
                        <th style={{ padding: '4px 8px 6px 0', textAlign: 'right' }}>accepted</th>
                        <th style={{ padding: '4px 8px 6px 0', textAlign: 'right' }}>auto-DM</th>
                        <th style={{ padding: '4px 0 6px 0' }}>last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {joinSources.map((j) => (
                        <tr key={j.source} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '5px 8px 5px 0', color: 'var(--text)', fontWeight: 700 }}>{j.source}</td>
                          <td style={{ padding: '5px 8px 5px 0', textAlign: 'right', color: 'var(--cyan)', fontWeight: 800 }}>{j.n}</td>
                          <td style={{ padding: '5px 8px 5px 0', textAlign: 'right' }}>{j.accepted}</td>
                          <td style={{ padding: '5px 8px 5px 0', textAlign: 'right', color: j.dmFailed > j.dmSent ? '#ff8a5c' : 'var(--up)' }}>{j.dmSent}{j.dmFailed ? ` (${j.dmFailed} ko)` : ''}</td>
                          <td style={{ padding: '5px 0', color: 'var(--dim)' }}>{new Date(j.last).toLocaleDateString('en-GB')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {/* ===== 📡 CANAUX TELEGRAM (01/08) — Telegram ne montre NULLE PART l'ID d'un canal, or c'est
                la seule chose que l'API accepte (un lien t.me ne marche pas pour un canal privé). Le bot
                est ajouté admin → la ligne apparaît ici → l'ID se copie dans les variables Vercel.
                La colonne ROLE dit à quoi chaque canal est branché : un « — » = variable manquante. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={secH}>📡 TELEGRAM CHANNELS</h2>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>click an ID to copy it — paste into the Vercel env vars</span>
                </div>
                {tgChats.length === 0 && <p style={dimP}>No channel seen yet — add the bot as an admin of the channel, then post anything in it.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tgChats.map((c) => (
                    <div key={c.chat_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 750, color: 'var(--text)' }}>{c.title ?? '(sans titre)'}</span>
                      {c.username && <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>@{c.username}</span>}
                      <span style={{ flex: 1 }} />
                      {c.role
                        ? <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: 'var(--up)', border: '1px solid rgba(31,216,176,.4)', borderRadius: 7, padding: '3px 8px' }}>{c.role}</span>
                        : <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: 'var(--dim)', border: '1px dashed var(--border)', borderRadius: 7, padding: '3px 8px' }}>not wired</span>}
                      <button
                        onClick={() => { void navigator.clipboard.writeText(String(c.chat_id)); setChatCopied(c.chat_id); setTimeout(() => setChatCopied(null), 1500); }}
                        className="mono" title="copier l'ID du canal"
                        style={{ fontSize: 11, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', background: 'transparent', color: chatCopied === c.chat_id ? 'var(--up)' : 'var(--cyan)' }}>
                        {chatCopied === c.chat_id ? '✓ copied' : c.chat_id}
                      </button>
                    </div>
                  ))}
                </div>
            </section>
            {/* ===== 🤖 BOT ACTIVITY — TOUT ce que le bot envoie (relances, texte complet) et reçoit
                (réponses des prospects, via le webhook Telegram). « Je veux voir ce que le bot fait » —
                le fil est là. Le bouton ENABLE INBOX branche le webhook (à cliquer UNE fois). */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={secH}>🤖 BOT ACTIVITY</h2>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>sent → and received ← by the Telegram bot</span>
                <span style={{ flex: 1 }} />
                {tgInboxOn ? (
                  <span className="mono" style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--up)', border: '1px solid rgba(31,216,176,.4)', borderRadius: 7, padding: '4px 9px' }}>✓ INBOX ON</span>
                ) : (
                  <button disabled={busy} onClick={() => { setBusy(true); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupTgWebhook: true }) }).then(async (r) => { const d = (await r.json()) as { error?: string }; if (d.error) void ask.alert(`⚠ ${d.error}`); else { setTgInboxOn(true); void ask.alert('✓ Bot inbox enabled — replies to the bot now land here.'); } }).finally(() => setBusy(false)); }}
                    title="one-time setup: point the Telegram webhook at the app so replies to the bot are recorded here (+ auto-acknowledgement routing people to you)" style={goldBtn}>🔌 ENABLE INBOX</button>
                )}
              </div>
              {botActivity.length === 0 && <p style={dimP}>No bot activity recorded yet — the 10:00 UTC auto-nudges will appear here with their full text.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
                {botActivity.slice(0, 60).map((b) => {
                  const d = b.detail ?? {};
                  const incoming = b.kind === 'bot_reply';
                  // NON DÉLIVRÉ — Telegram a refusé le message (bot bloqué, compte supprimé…). La ligne
                  // reste au fil : un DM qui n'arrive pas est une information, pas un blanc à cacher.
                  const failed = !incoming && String(b.status ?? '') === 'failed';
                  const failReason = failed ? String((d as { error?: string }).error ?? 'not delivered') : '';
                  const who = rows.find((r) => Number(r.tg_id) === Number(b.tg_id));
                  const label = who ? (who.tg_username ? '@' + who.tg_username : (who.tg_name ?? `#${who.member_no}`)) : String((d as { username?: string }).username ? '@' + (d as { username?: string }).username : ((d as { name?: string }).name ?? b.tg_id));
                  const text = String((d as { text?: string }).text ?? (d as { note?: string }).note ?? '');
                  return (
                    <div key={b.id} style={{ display: 'flex', gap: 9, padding: '8px 11px', borderRadius: 9, border: `1px solid ${failed ? 'rgba(255,90,90,.45)' : incoming ? 'rgba(245,194,74,.4)' : 'var(--border)'}`, background: failed ? 'rgba(255,90,90,.06)' : incoming ? 'rgba(245,194,74,.05)' : 'rgba(10,17,31,.5)' }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: failed ? '#ff5a5a' : incoming ? 'var(--gold)' : 'var(--cyan)', minWidth: 16 }}>{failed ? '⨯' : incoming ? '←' : '→'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 750, color: 'var(--text)' }}>{label}</span>
                          {who?.member_no != null && <span className="mono goldText" style={{ fontSize: 10, fontWeight: 800 }}>#{who.member_no}</span>}
                          <span className="mono" style={{ fontSize: 9.5, fontWeight: failed ? 800 : 400, color: failed ? '#ff5a5a' : 'var(--dim)' }}>{failed ? `NOT DELIVERED — ${failReason}` : incoming ? 'replied to the bot' : (d as { via?: string }).via === 'manual' ? '👤 your personal touch (logged)' : (d as { via?: string }).via === 'admin' ? '💬 you replied via the bot' : (d as { via?: string }).via === 'broadcast' ? '📣 broadcast sent' : 'auto-nudge sent'}</span>
                          <span style={{ flex: 1 }} />
                          <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{new Date(b.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: 11.5, color: incoming ? 'var(--text)' : 'var(--muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text || '—'}</p>
                        {/* RÉPONSE VIA LE BOT — part dans la conversation que la personne a DÉJÀ avec le bot
                            (le lien t.me échouait sans @username public). Enter ou SEND pour envoyer. */}
                        {incoming && (
                          <div style={{ display: 'flex', gap: 7, marginTop: 7 }}>
                            <input
                              value={botDrafts[b.id] ?? ''}
                              onChange={(e) => setBotDrafts((s) => ({ ...s, [b.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && (botDrafts[b.id] ?? '').trim()) { e.preventDefault(); const t = botDrafts[b.id].trim(); setBusy(true); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botDm: { tg_id: b.tg_id, text: t } }) }).then(async (r) => { const dd = (await r.json()) as { error?: string }; if (dd.error) void ask.alert(`⚠ ${dd.error}`); else { setBotDrafts((s) => ({ ...s, [b.id]: '' })); load(); } }).finally(() => setBusy(false)); } }}
                              placeholder="reply via the bot — lands in their existing chat…"
                              style={{ ...inp, flex: 1, fontSize: 12, padding: '8px 11px' }}
                            />
                            <button
                              disabled={busy || !(botDrafts[b.id] ?? '').trim()}
                              onClick={() => { const t = (botDrafts[b.id] ?? '').trim(); if (!t) return; setBusy(true); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botDm: { tg_id: b.tg_id, text: t } }) }).then(async (r) => { const dd = (await r.json()) as { error?: string }; if (dd.error) void ask.alert(`⚠ ${dd.error}`); else { setBotDrafts((s) => ({ ...s, [b.id]: '' })); load(); } }).finally(() => setBusy(false)); }}
                              style={{ padding: '8px 14px', borderRadius: 9, border: 'none', fontWeight: 800, fontSize: 11.5, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: (botDrafts[b.id] ?? '').trim() ? 1 : 0.5 }}
                            >SEND</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
  );
}
