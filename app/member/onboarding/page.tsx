'use client';
// Wizard d'adhésion en 3 étapes : broker (Raise en avant, minimum 500$) → connexion MT5 (chiffrée) → profil de risque.
// Chaque étape est persistée (onboarding_step) : on peut fermer l'app et reprendre où on en était.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, RiskPicker } from '../ui';

const RAISE_URL = process.env.NEXT_PUBLIC_RAISE_URL ?? '#';

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? 'request failed');
  return r.json();
}

export default function Onboarding() {
  const { member, loading } = useMe();
  const router = useRouter();
  const [step, setStep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [login, setLogin] = useState('');
  const [server, setServer] = useState('');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState<'low' | 'balanced' | 'high'>('balanced');

  if (loading || !member) return <Center>loading…</Center>;
  if (member.status !== 'onboarding') { router.replace('/member'); return <Center>redirecting…</Center>; }
  const cur = step ?? member.onboarding_step;

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

      {cur === 0 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>1 · Open your broker account</h2>
          <p style={pMuted}>Algoria trades on Raise — same broker means <strong style={{ color: 'var(--text)' }}>the exact same spreads and conditions</strong> as the AI you watch live.</p>
          <a href={RAISE_URL} target="_blank" rel="noreferrer" style={ctaGold}>▲ CREATE MY RAISE ACCOUNT</a>
          <div style={{ borderLeft: '3px solid var(--gold)', background: 'rgba(245,194,74,.06)', borderRadius: 8, padding: '11px 13px' }}>
            <p style={{ ...pMuted, margin: 0, fontSize: 12.5 }}>
              <strong style={{ color: 'var(--gold)' }}>Minimum deposit: $500.</strong> Below that, position sizing doesn&apos;t work even at the lowest risk — trades simply won&apos;t run. Don&apos;t fund less.
            </p>
          </div>
          <button disabled={busy} onClick={() => run({ action: 'broker', broker: 'raise' }, 1)} style={ctaMain}>MY ACCOUNT IS READY →</button>
          <button disabled={busy} onClick={() => run({ action: 'broker', broker: 'other' }, 1)} style={linkBtn}>I already trade with another broker</button>
        </section>
      )}

      {cur === 1 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>2 · Connect your MT5 account</h2>
          <p style={pMuted}>These credentials link your account to the copier. They are <strong style={{ color: 'var(--text)' }}>encrypted end-to-end</strong> and never displayed again — not even to you.</p>
          <label style={lbl}>MT5 login<input value={login} onChange={(e) => setLogin(e.target.value)} inputMode="numeric" placeholder="12345678" style={inp} /></label>
          <label style={lbl}>Server<input value={server} onChange={(e) => setServer(e.target.value)} placeholder="Raise-Live" style={inp} /></label>
          <label style={lbl}>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" style={inp} /></label>
          <button disabled={busy || !login || !server || !password} onClick={() => run({ action: 'mt5', login, server, password }, 2)} style={ctaMain}>
            {busy ? 'ENCRYPTING…' : 'CONNECT MY ACCOUNT →'}
          </button>
          <p className="mono" style={{ fontSize: 10, color: 'var(--dim)', margin: 0, letterSpacing: 0.5 }}>AES-256 · STORED SERVER-SIDE ONLY · YOU CAN REVOKE ANYTIME BY CHANGING YOUR PASSWORD</p>
        </section>
      )}

      {cur === 2 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>3 · Choose your risk profile</h2>
          <p style={pMuted}>This sets the lot size copied to your account for every Algoria trade. You can change it anytime from Home.</p>
          <RiskPicker value={tier} onPick={setTier} busy={busy} />
          <button disabled={busy} onClick={() => run({ action: 'risk', tier }, 'done')} style={ctaMain}>{busy ? 'SAVING…' : '⚡ START COPYING ALGORIA'}</button>
        </section>
      )}

      {err && <p style={{ fontSize: 12.5, color: 'rgba(210,150,165,.9)', margin: 0 }}>⚠ {err}</p>}
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
