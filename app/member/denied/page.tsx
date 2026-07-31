'use client';
// Telegram OK mais pas (encore) membre : ni accepté dans le canal, ni sur la liste VIP.
import { tgHref } from '@/lib/telegram';

export default function Denied() {
  const tg = process.env.NEXT_PUBLIC_TELEGRAM_URL ?? 'https://t.me';
  return (
    <main style={{ minHeight: '92vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, textAlign: 'center', padding: '0 20px' }}>
      <span style={{ fontSize: 40 }}>🔒</span>
      <h1 style={{ fontSize: 24, margin: 0 }}>Access unavailable</h1>
      {/* Volontairement neutre : cette page sert AUSSI aux comptes révoqués (31/07 — concurrent qui copiait
          l'app). On ne détaille ni le motif ni la mécanique — juste une porte humaine pour les vrais cas. */}
      <p style={{ color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.65, maxWidth: 400, margin: 0 }}>
        This account can&apos;t access Algoria Members right now. If you think that&apos;s a mistake, message us and we&apos;ll sort it out.
      </p>
      <a
        {...tgHref(tg)}
        style={{ display: 'inline-block', padding: '13px 26px', borderRadius: 12, fontWeight: 800, letterSpacing: 0.5, textDecoration: 'none', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', boxShadow: '0 0 22px rgba(43,227,245,.3)' }}
      >
        ✈️ JOIN THE WAITLIST
      </a>
      <a href="/member/login" style={{ fontSize: 12, color: 'var(--dim)' }}>already accepted? sign in again</a>
    </main>
  );
}
