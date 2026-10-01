'use client';
import { tgHref } from '@/lib/telegram';

export default function InviteView({ name, signedIn }: { name: string | null; signedIn: boolean }) {
  const tg = process.env.NEXT_PUBLIC_TELEGRAM_URL ?? 'https://t.me';
  const who = name ?? 'A friend';
  return (
    <main style={{ minHeight: '92vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center', padding: '0 20px' }}>
      <img src="/brand/algoria-mark.png" alt="Algoria" width={76} height={76} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 14px rgba(43,227,245,.5))' }} />
      <div>
        <p className="mono goldText" style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, margin: '0 0 8px' }}>YOU&apos;VE BEEN INVITED</p>
        <h1 style={{ fontSize: 27, margin: 0, letterSpacing: 0.4 }}>
          {who} got you into <span className="goldText">ALGORIA</span>
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.65, maxWidth: 400, margin: '12px auto 0' }}>
          Algoria&apos;s AI trades gold live, and members&apos; accounts copy every trade automatically. Sign in to see it working, it takes 10 seconds.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
        {/* un lien, pas un bouton JS : la connexion vit sur /member/login, inchangée */}
        <a
          href={signedIn ? '/member' : '/member/login'}
          style={{ display: 'block', padding: '15px 20px', borderRadius: 13, textDecoration: 'none', fontWeight: 800, letterSpacing: 0.5, fontSize: 15, color: '#fff', background: 'linear-gradient(90deg,#2AABEE,#229ED9)', boxShadow: '0 0 26px rgba(42,171,238,.35)' }}
        >
          {signedIn ? 'OPEN ALGORIA →' : '✈️ SIGN IN WITH TELEGRAM'}
        </a>
        {!signedIn && <span style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: -4 }}>Free · no phone number · no password</span>}
        <div className="panel" style={{ padding: '13px 16px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)' }}>HOW IT WORKS</span>
          {['Sign in with your Telegram account', 'Watch the AI’s live wins and its full track record', 'Ready? Open your account, the AI copies its trades to it'].map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 800, color: 'var(--cyan)' }}>{i + 1}</span>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>{s}</span>
            </div>
          ))}
        </div>
        <a {...tgHref(tg)} style={{ fontSize: 12.5, color: 'var(--dim)', textDecoration: 'underline' }}>
          Prefer to look around first ? Join the Telegram channel
        </a>
      </div>
      <p className="mono" style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: 1, margin: 0 }}>
        {name ? `YOUR INVITATION STAYS LINKED TO ${name.toUpperCase()}` : 'YOUR INVITATION STAYS LINKED TO YOUR FRIEND'} · TRADING INVOLVES RISK
      </p>
    </main>
  );
}
