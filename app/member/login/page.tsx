'use client';
// Connexion via TELEGRAM (Login Widget officiel) : zéro mot de passe, et l'identité est le @ du canal —
// le support gère l'accès par la liste VIP / les acceptés du live. Prérequis : BotFather /setdomain → app.algoria.tech.
import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginInner() {
  const box = useRef<HTMLDivElement>(null);
  const params = useSearchParams();
  const error = params.get('error');
  useEffect(() => {
    if (!box.current || box.current.childElementCount > 0) return;
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.setAttribute('data-telegram-login', process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '');
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '10');
    s.setAttribute('data-auth-url', '/api/member/auth');
    box.current.appendChild(s);
  }, []);
  return (
    <main style={{ minHeight: '92vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center', padding: '0 18px' }}>
      <img src="/brand/algoria-mark.svg" alt="Algoria" width={60} height={60} style={{ filter: 'drop-shadow(0 0 9px rgba(43,227,245,.45))' }} />
      <div>
        <h1 style={{ fontSize: 30, margin: 0, letterSpacing: 0.5 }}>
          ALGORIA <span className="goldText">MEMBERS</span>
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.6, maxWidth: 380, margin: '10px auto 0' }}>
          Your member dashboard — copying status, risk control and the live AI feed. Sign in with the Telegram account that joined the channel.
        </p>
      </div>
      <div ref={box} style={{ minHeight: 46 }} />
      {error && (
        <p style={{ fontSize: 12.5, color: 'rgba(210,150,165,.9)', border: '1px solid rgba(255,107,138,.3)', borderRadius: 9, padding: '9px 14px', background: 'rgba(255,107,138,.07)' }}>
          Sign-in failed: {error}. Try again.
        </p>
      )}
      <p className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', letterSpacing: 1 }}>ACCESS IS GRANTED LIVE ON STREAM · MEMBERS ONLY</p>
    </main>
  );
}

export default function MemberLogin() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
