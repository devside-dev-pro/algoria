'use client';
// Connexion Telegram NATIVE : un clic → Telegram s'ouvre (app mobile/desktop) → START → connecté.
// Sous le capot : code à usage unique + deep-link t.me, confirmé par le webhook du bot, pollé ici (2 s).
// Zéro numéro de téléphone, zéro widget, zéro mot de passe. (Le /setdomain BotFather n'est plus nécessaire.)
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'idle' | 'waiting' | 'expired' | 'error';

export default function MemberLogin() {
  const [phase, setPhase] = useState<Phase>('idle');
  const router = useRouter();
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const start = async () => {
    try {
      const r = await fetch('/api/member/tglogin', { method: 'POST' });
      const d = (await r.json()) as { code?: string; link?: string };
      if (!d.code || !d.link) { setPhase('error'); return; }
      setPhase('waiting');
      window.open(d.link, '_blank'); // ouvre l'app Telegram (mobile) / Telegram Desktop
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const p = (await fetch(`/api/member/tglogin?code=${d.code}`).then((x) => x.json()).catch(() => null)) as { ok?: boolean; denied?: boolean; expired?: boolean } | null;
        // sur le sous-domaine ADMIN, on atterrit directement sur le back-office (pas sur le Home membre)
        const dest = typeof window !== 'undefined' && window.location.hostname.startsWith('admin.') ? '/member/admin' : '/member';
        if (p?.ok) { if (poll.current) clearInterval(poll.current); router.replace(dest); }
        else if (p?.denied) { if (poll.current) clearInterval(poll.current); router.replace('/member/denied'); }
        else if (p?.expired) { if (poll.current) clearInterval(poll.current); setPhase('expired'); }
      }, 2000);
    } catch {
      setPhase('error');
    }
  };

  return (
    <main style={{ minHeight: '92vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center', padding: '0 18px' }}>
      <img src="/brand/algoria-mark.png" alt="Algoria" width={72} height={72} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(43,227,245,.45))' }} />
      <div>
        <h1 style={{ fontSize: 30, margin: 0, letterSpacing: 0.5 }}>
          ALGORIA <span className="goldText">MEMBERS</span>
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.6, maxWidth: 380, margin: '10px auto 0' }}>
          Your member dashboard — copying status, risk control and the live AI feed. Sign in with the Telegram account that joined the channel.
        </p>
      </div>

      {phase !== 'waiting' ? (
        <button
          onClick={() => void start()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '14px 28px', borderRadius: 13, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.5, fontSize: 15, color: '#fff', background: 'linear-gradient(90deg,#2AABEE,#229ED9)', boxShadow: '0 0 24px rgba(42,171,238,.35)' }}
        >
          ✈️ LOG IN WITH TELEGRAM
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span className="pulse" style={{ fontSize: 13.5, color: 'var(--cyan)', fontWeight: 700 }}>● waiting for Telegram…</span>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.55 }}>
            Telegram just opened — tap <strong style={{ color: 'var(--text)' }}>START</strong> in the bot chat and you&apos;ll be signed in here automatically.
          </p>
          <button onClick={() => void start()} style={{ border: 'none', background: 'transparent', color: 'var(--dim)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
            Telegram didn&apos;t open? Tap to retry
          </button>
        </div>
      )}

      {phase === 'expired' && <Err>Link expired — try again.</Err>}
      {phase === 'error' && <Err>Something went wrong — try again.</Err>}
      <p className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', letterSpacing: 1 }}>ACCESS IS GRANTED LIVE ON STREAM · MEMBERS ONLY</p>
    </main>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12.5, color: 'rgba(210,150,165,.9)', border: '1px solid rgba(255,107,138,.3)', borderRadius: 9, padding: '9px 14px', background: 'rgba(255,107,138,.07)', margin: 0 }}>
      {children}
    </p>
  );
}
