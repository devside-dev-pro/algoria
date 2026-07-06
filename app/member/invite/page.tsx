'use client';
// PAGE D'INVITATION (arrivée des liens de parrainage) — le canal Telegram D'ABORD : c'est là que le prospect
// voit le process, les lives, parle au support (le closing). L'app ne vient qu'après, quand il est décidé.
import { tgHref } from '@/lib/telegram';
// Le cookie d'attribution est déjà posé (30 j) : peu importe le détour, le parrain garde son filleul.
export default function Invite() {
  const tg = process.env.NEXT_PUBLIC_TELEGRAM_URL ?? 'https://t.me';
  return (
    <main style={{ minHeight: '92vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center', padding: '0 20px' }}>
      <img src="/brand/algoria-mark.png" alt="Algoria" width={76} height={76} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 14px rgba(43,227,245,.5))' }} />
      <div>
        <p className="mono goldText" style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, margin: '0 0 8px' }}>YOU&apos;VE BEEN INVITED</p>
        <h1 style={{ fontSize: 27, margin: 0, letterSpacing: 0.4 }}>
          A friend got you into <span className="goldText">ALGORIA</span>
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.65, maxWidth: 400, margin: '12px auto 0' }}>
          Algoria is an AI that trades gold &amp; Bitcoin, live. Start in the Telegram channel — watch it work in real time, see the results, and talk to the team.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
        <a
          {...tgHref(tg)}
          style={{ display: 'block', padding: '15px 20px', borderRadius: 13, textDecoration: 'none', fontWeight: 800, letterSpacing: 0.5, fontSize: 15, color: '#fff', background: 'linear-gradient(90deg,#2AABEE,#229ED9)', boxShadow: '0 0 26px rgba(42,171,238,.35)' }}
        >
          ✈️ JOIN THE ALGORIA CHANNEL
        </a>
        <div className="panel" style={{ padding: '13px 16px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)' }}>HOW IT WORKS</span>
          {['Watch the AI trade live in the channel', 'Talk to the team, get your questions answered', 'Ready? Activate your access in the app'].map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 800, color: 'var(--cyan)' }}>{i + 1}</span>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>{s}</span>
            </div>
          ))}
        </div>
        <a href="/member/login" style={{ fontSize: 12.5, color: 'var(--dim)', textDecoration: 'underline' }}>
          Already talked to the team? Sign in to activate →
        </a>
      </div>
      <p className="mono" style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: 1, margin: 0 }}>YOUR INVITATION STAYS LINKED TO YOUR FRIEND — TAKE YOUR TIME</p>
    </main>
  );
}
