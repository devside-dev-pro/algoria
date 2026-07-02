'use client';
import { usePrice, useFeedHealth } from '@/lib/cockpit/useRealtime';

// Funnel PUBLIC (domaine racine) : ce que voit un viewer qui tape algoria.tech (lien en bio TikTok).
// Objectif unique : convertir → rejoindre le canal Telegram gratuit. Le cockpit opérateur vit sur /app.
const TELEGRAM = process.env.NEXT_PUBLIC_TELEGRAM_URL || 'https://t.me/'; // à définir en env Vercel
const TIKTOK = process.env.NEXT_PUBLIC_TIKTOK_URL || '';

export default function Funnel() {
  const px = usePrice('XAUUSD');
  const { stale, hasData } = useFeedHealth();
  const live = hasData && !stale;

  return (
    <main
      style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 20px', textAlign: 'center', color: 'var(--text)', position: 'relative', overflow: 'hidden',
        background: 'radial-gradient(90% 60% at 50% -10%, #0e1c33 0%, var(--bg,#070b12) 60%)',
      }}
    >
      {/* halo décoratif */}
      <div aria-hidden style={{ position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)', width: 620, height: 620, borderRadius: '50%', background: 'radial-gradient(circle, rgba(43,227,245,.10), transparent 60%)', filter: 'blur(20px)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        {/* LIVE / logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#2be3f5,#1e40e5)', clipPath: 'polygon(50% 8%,92% 92%,8% 92%)' }} />
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</span>
          {live && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, letterSpacing: 1, color: '#fff', background: 'linear-gradient(90deg,#ff2d55,#ff5a3c)', padding: '3px 8px', borderRadius: 20 }}>
              <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} /> LIVE
            </span>
          )}
        </div>

        {/* Hero */}
        <h1 style={{ fontSize: 30, lineHeight: 1.15, fontWeight: 700, margin: 0 }}>
          The AI that trades <span style={{ color: 'var(--gold)' }}>gold</span> &amp; the <span style={{ color: 'var(--cyan)' }}>Nasdaq</span>,<br />live.
        </h1>
        <p style={{ fontSize: 15, color: 'var(--muted)', margin: 0, maxWidth: 380 }}>
          Real trades, executed autonomously 24/5. Analysis, signals and results — <b style={{ color: 'var(--text)' }}>free</b> in the Telegram channel.
        </p>

        {/* Live proof */}
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <Stat label="Win rate" value="86%" sub="backtested" accent="var(--up)" />
          <Stat label="Markets" value="XAU · NAS" accent="var(--cyan)" />
          <Stat label="XAU/USD" value={px ? px.mid.toFixed(1) : '—'} accent="var(--gold)" mono />
        </div>

        {/* Primary CTA */}
        <a
          href={TELEGRAM}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '16px 20px', borderRadius: 14, textDecoration: 'none', fontSize: 17, fontWeight: 800, letterSpacing: 0.3,
            color: '#04223a', background: 'linear-gradient(90deg,#2be3f5,#39a0ff)', boxShadow: '0 10px 30px rgba(43,227,245,.28)',
          }}
        >
          ✈️ JOIN ALGORIA — FREE
        </a>
        <span style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: -10 }}>Free Telegram channel · no payment · instant access</span>

        {/* Secondary TikTok CTA (if set) */}
        {TIKTOK && (
          <a href={TIKTOK} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
            🔴 Watch the live on TikTok
          </a>
        )}

        {/* disclaimer */}
        <p style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, maxWidth: 360, lineHeight: 1.4 }}>
          Trading involves risk of loss. Educational &amp; entertainment content — not financial advice.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value, accent, mono, sub }: { label: string; value: string; accent: string; mono?: boolean; sub?: string }) {
  return (
    <div style={{ flex: 1, background: 'rgba(255,255,255,.02)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 8px', borderTop: `2px solid ${accent}` }}>
      <div style={{ fontSize: 9, letterSpacing: 0.6, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div className={mono ? 'mono' : undefined} style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 8, color: 'var(--dim)', letterSpacing: 0.3, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
