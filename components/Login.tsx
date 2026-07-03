'use client';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase/client';

export function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={submit} className="panel" style={{ width: 320, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <img src="/brand/algoria-mark.png" alt="Algoria" width={26} height={26} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 9px rgba(43,227,245,.45))' }} />
          <strong style={{ fontSize: 18, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</strong>
        </div>
        <input type="email" required placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
        <input type="password" required placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} />
        {err && <div style={{ color: 'var(--down)', fontSize: 12 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...field, cursor: 'pointer', color: '#06101f', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', border: 'none', fontWeight: 600 }}>
          {busy ? '…' : 'Sign in'}
        </button>
        <p style={{ fontSize: 11, color: 'var(--dim)', margin: 0, lineHeight: 1.5 }}>Create your account once: Supabase → Authentication → Users → Add user.</p>
      </form>
    </main>
  );
}

const field: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--panel-2)',
  color: 'var(--text)',
  fontSize: 14,
  outline: 'none',
};
