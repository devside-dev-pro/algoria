'use client';
// Wizard d'adhésion en 3 étapes : broker (Raise en avant, minimum 500$) → connexion MT5 (chiffrée) → profil de risque.
// Chaque étape est persistée (onboarding_step) : on peut fermer l'app et reprendre où on en était.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, StrategyPicker } from '../ui';
import { BROKERS } from '@/lib/member/brokers';

const FEATURED = BROKERS.find((b) => b.featured) ?? BROKERS[0];
const OTHERS = BROKERS.filter((b) => !b.featured);

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? 'request failed');
  return r.json();
}

export default function Onboarding() {
  const { member, rejection, loading } = useMe();
  const router = useRouter();
  const [step, setStep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [login, setLogin] = useState('');
  const [server, setServer] = useState('');
  const [serverManual, setServerManual] = useState(false); // « mon serveur n'est pas listé » → saisie libre
  const [platform, setPlatform] = useState<'mt5' | 'mt4'>('mt5'); // MT5 par défaut ; le copieur STH a besoin du IsMT4
  const [password, setPassword] = useState('');
  // VÉRIFICATION : le support contrôle le compte chez le broker AVANT d'approuver — sans le nom du
  // titulaire et le dépôt déclaré, la file admin était aveugle (n'importe qui pouvait raconter n'importe quoi)
  const [fullName, setFullName] = useState('');
  const [deposit, setDeposit] = useState('');
  const [strategy, setStrategy] = useState(2); // 1=Steady · 2=Balanced (défaut) · 3=Turbo — lot copieur fixe 0.01
  const [brokerPick, setBrokerPick] = useState<string | null>(null); // broker cliqué (le lien ouvre un onglet, on retient le choix)
  const [showOthers, setShowOthers] = useState(false);

  if (loading || !member) return <Center>loading…</Center>;
  if (member.status !== 'onboarding') { router.replace('/member'); return <Center>redirecting…</Center>; }
  const cur = step ?? member.onboarding_step;
  // le choix broker N'EST JAMAIS verrouillé : on repart du broker déjà enregistré (fiche membre) et
  // chaque étape a un retour ← — un compte refusé peut re-choisir un autre broker au lieu de rester coincé
  const picked = brokerPick ?? member.broker ?? null;
  const brokerServers = BROKERS.find((b) => b.key === picked)?.servers ?? []; // serveurs MT5 exacts du broker choisi
  const othersOpen = showOthers || (picked != null && picked !== FEATURED.key);

  const run = (body: Record<string, unknown>, next: number | 'done') => {
    setBusy(true);
    setErr(null);
    post(body)
      .then(() => (next === 'done' ? router.replace('/member') : setStep(next)))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Activate your access</h1>
        <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>STEP {Math.min(cur + 1, 3)}/3</span>
      </header>
      <div style={{ display: 'flex', gap: 5 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= cur ? 'linear-gradient(90deg,#2be3f5,#2e8bf0)' : 'rgba(130,152,190,.2)' }} />
        ))}
      </div>

      {/* demande précédente REFUSÉE (vérification broker) : la raison s'affiche, on corrige, on re-soumet —
          jamais de blocage définitif (le membre qui s'est trompé — ou a tenté — garde une porte de sortie) */}
      {rejection && (
        <div className="cardIn" style={{ border: '1px solid rgba(245,194,74,.5)', background: 'rgba(245,194,74,.07)', borderRadius: 12, padding: '12px 15px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text)' }}>
            <b>Your previous request was declined:</b> {rejection.reason}
            <br /><span style={{ color: 'var(--muted)' }}>Fix your details below and resubmit — approvals are fast when everything checks out.</span>
          </div>
        </div>
      )}

      {cur === 0 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>1 · Open your broker account</h2>
          <p style={pMuted}>{FEATURED.note ?? 'Open your account with one of our partner brokers.'}</p>
          <a href={FEATURED.url} target="_blank" rel="noreferrer" onClick={() => setBrokerPick(FEATURED.key)} style={ctaGold}>▲ CREATE MY {FEATURED.name.toUpperCase()} ACCOUNT</a>
          <div style={{ borderLeft: '3px solid var(--gold)', background: 'rgba(245,194,74,.06)', borderRadius: 8, padding: '11px 13px' }}>
            <p style={{ ...pMuted, margin: 0, fontSize: 12.5 }}>
              <strong style={{ color: 'var(--gold)' }}>Minimum deposit: $500.</strong> Below that, position sizing doesn&apos;t work even at the lowest risk — trades simply won&apos;t run. Don&apos;t fund less.
            </p>
          </div>
          {!othersOpen ? (
            <button onClick={() => setShowOthers(true)} style={linkBtn}>I&apos;d rather use another broker</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: 1.2, color: 'var(--dim)' }}>OTHER PARTNER BROKERS — SAME $500 MINIMUM</span>
              {OTHERS.map((b) => (
                <a key={b.key} href={b.url} target="_blank" rel="noreferrer" onClick={() => setBrokerPick(b.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 11, textDecoration: 'none', color: 'var(--text)', border: `1px solid ${picked === b.key ? 'rgba(43,227,245,.5)' : 'var(--border)'}`, background: picked === b.key ? 'rgba(43,227,245,.07)' : 'rgba(10,17,31,.55)' }}>
                  <span style={{ fontWeight: 750, fontSize: 13.5 }}>{b.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: picked === b.key ? 'var(--cyan)' : 'var(--dim)' }}>{picked === b.key ? '✓ selected' : 'open account ↗'}</span>
                </a>
              ))}
            </div>
          )}
          <button disabled={busy} onClick={() => run({ action: 'broker', broker: picked ?? FEATURED.key }, 1)} style={ctaMain}>MY ACCOUNT IS READY →</button>
        </section>
      )}

      {cur === 1 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>2 · Connect your MetaTrader account</h2>
          <p style={pMuted}>Pick your broker &amp; platform, then enter the account it gave you. <strong style={{ color: 'var(--text)' }}>Encrypted end-to-end</strong>, never shown again.</p>

          {/* BLOC 1 — le compte : broker → plateforme → login → serveur → mdp, dans l'ordre, au même endroit
              (plus de « revenir en arrière » pour changer le serveur). */}
          <div style={grp}>
            <span style={grpLbl}>YOUR ACCOUNT</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...lbl, flex: '1 1 130px' }}>Broker
                <select value={picked ?? ''} onChange={(e) => { setBrokerPick(e.target.value || null); setServer(''); setServerManual(false); }} style={inp}>
                  <option value="">— choose —</option>
                  {BROKERS.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
                </select>
              </label>
              <label style={{ ...lbl, flex: '1 1 150px' }}>Platform
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['mt5', 'mt4'] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setPlatform(p)}
                      style={{ flex: 1, padding: '10px 6px', borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 12.5, letterSpacing: 0.3,
                        border: `1px solid ${platform === p ? 'rgba(43,227,245,.55)' : 'var(--border)'}`, background: platform === p ? 'rgba(43,227,245,.08)' : 'rgba(10,17,31,.55)', color: platform === p ? 'var(--cyan)' : 'var(--muted)' }}>
                      {p === 'mt5' ? 'MT5' : 'MT4'}
                    </button>
                  ))}
                </div>
              </label>
            </div>
            <label style={lbl}>{platform === 'mt4' ? 'MT4' : 'MT5'} login<input value={login} onChange={(e) => setLogin(e.target.value)} inputMode="numeric" placeholder="12345678" style={inp} /></label>
            <label style={lbl}>Server
              {brokerServers.length > 0 && !serverManual ? (
                <select value={server} onChange={(e) => { const v = e.target.value; if (v === '__other__') { setServerManual(true); setServer(''); } else setServer(v); }} style={inp}>
                  <option value="">— choose your server —</option>
                  {brokerServers.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value="__other__">My server isn&apos;t listed…</option>
                </select>
              ) : (
                <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="type it EXACTLY as MetaTrader shows it" style={inp} />
              )}
              <span style={hint}>Must match your broker&apos;s server <b style={{ color: 'var(--muted)' }}>exactly</b> — copy it from MetaTrader (caps &amp; spaces count).</span>
              {brokerServers.length > 0 && serverManual && <button type="button" onClick={() => { setServerManual(false); setServer(''); }} style={{ ...linkBtn, marginTop: 4, textAlign: 'left' }}>← Pick from the list instead</button>}
            </label>
            <label style={lbl}>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" style={inp} /><span style={hint}>Your <b style={{ color: 'var(--muted)' }}>main</b> password (the one you log in with) — <b style={{ color: 'var(--muted)' }}>not</b> the read-only &ldquo;investor&rdquo; one, or the copy can&apos;t trade.</span></label>
          </div>

          {/* BLOC 2 — vérification (nom + dépôt) : le support recoupe avec le broker avant d'activer la copie. */}
          <div style={grp}>
            <span style={grpLbl}>FOR VERIFICATION</span>
            <label style={lbl}>Full name on your broker account<input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Smith" autoComplete="name" style={inp} /></label>
            <label style={lbl}>Amount deposited ($ — min 500)<input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="numeric" placeholder="500" style={inp} /></label>
            <span style={hint}>Accurate name &amp; deposit = faster approval — the team checks them with the broker before switching the copy on.</span>
          </div>

          <button disabled={busy || !picked || !login || !server || !password || fullName.trim().length < 3 || !Number(deposit)} onClick={() => run({ action: 'mt5', broker: picked, platform, login, server, password, name: fullName, deposit }, 2)} style={ctaMain}>
            {busy ? 'ENCRYPTING…' : 'CONNECT MY ACCOUNT →'}
          </button>
          <button onClick={() => setStep(0)} style={linkBtn}>Don&apos;t have a broker account yet? Open one →</button>
          <p className="mono" style={{ fontSize: 10, color: 'var(--dim)', margin: 0, letterSpacing: 0.5 }}>AES-256 · STORED SERVER-SIDE ONLY · REVOKE ANYTIME BY CHANGING YOUR PASSWORD</p>
        </section>
      )}

      {cur === 2 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>3 · Choose your strategy</h2>
          <p style={pMuted}>Every strategy copies at the same fixed size — your risk lever is the strategy itself. You can switch anytime from your Profile.</p>
          <StrategyPicker value={strategy} onPick={setStrategy} busy={busy} />
          <button disabled={busy} onClick={() => run({ action: 'strategy', choice: strategy }, 'done')} style={ctaMain}>{busy ? 'SAVING…' : '⚡ START COPYING ALGORIA'}</button>
          <button onClick={() => setStep(1)} style={linkBtn}>← Back to MT5 details</button>
        </section>
      )}

      {err && <p style={{ fontSize: 12.5, color: 'rgba(210,150,165,.9)', margin: 0 }}>⚠ {err}</p>}

      {/* porte de sortie humaine — l'onboarding est LÀ où les gens bloquent (broker, dépôt, serveur…) */}
      <a href="https://t.me/mathieu_algoria" target="_blank" rel="noreferrer"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', borderRadius: 11, textDecoration: 'none', color: 'var(--text)', border: '1px solid rgba(43,227,245,.3)', background: 'rgba(43,227,245,.05)' }}>
        <span style={{ fontSize: 17 }}>💬</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800 }}>Stuck on a step? Message Mathieu directly</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>@mathieu_algoria — real human, fast answers</span>
        </span>
      </a>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>{children}</main>;
}
const pMuted = { color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.6, margin: 0 } as const;
const lbl = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, letterSpacing: 1, color: 'var(--dim)', textTransform: 'uppercase' } as const;
const inp = { padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 15, outline: 'none' } as const;
const ctaMain = { padding: '13px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.6, fontSize: 13.5, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' } as const;
const ctaGold = { padding: '13px 16px', borderRadius: 12, textAlign: 'center', textDecoration: 'none', fontWeight: 800, letterSpacing: 0.6, fontSize: 13.5, color: '#0b0e14', background: 'linear-gradient(90deg,#ffd166,#f5a623)', boxShadow: '0 0 20px rgba(245,194,74,.25)' } as const;
const linkBtn = { padding: 6, border: 'none', background: 'transparent', color: 'var(--dim)', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' } as const;
// blocs visuels du wizard de connexion (regroupent les champs → moins « mur de formulaire »)
const grp = { display: 'flex', flexDirection: 'column', gap: 11, padding: '13px 13px 15px', borderRadius: 13, border: '1px solid var(--border)', background: 'rgba(10,17,31,.35)' } as const;
const grpLbl = { fontSize: 9.5, letterSpacing: 1.8, color: 'var(--dim)', fontWeight: 800 } as const;
const hint = { fontSize: 10.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.4 } as const;
