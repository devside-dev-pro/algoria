'use client';
// ACADEMY — les vidéos du fondateur, OUVERTES AU PUBLIC (pas de login requis) : c'est la page de closing.
// Le lien partageable est algoria.tech/academy → un prospect regarde sans friction ; dès qu'il touche
// Home/History/…, le useMe de CES pages le renvoie au login Telegram. Ici : pas de redirect sur 401.
// Vidéos : NEXT_PUBLIC_WELCOME_VIDEO_URL + NEXT_PUBLIC_STRATEGY_VIDEO_URL (Vercel). Fichier .mp4/.webm
// (bucket Supabase « academy » public) → lecteur natif PORTRAIT (tournage vertical) ; sinon iframe 16:9.
import { useEffect, useState } from 'react';

const WELCOME = process.env.NEXT_PUBLIC_WELCOME_VIDEO_URL ?? '';
const STRATEGY = process.env.NEXT_PUBLIC_STRATEGY_VIDEO_URL ?? '';
const isFile = (u: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);

const svg = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const SECTIONS = [
  { key: 'welcome', icon: svg('M8 5.5v13l11-6.5L8 5.5z'), title: 'Welcome to Algoria', blurb: 'What you just joined, and what happens next.', url: WELCOME },
  { key: 'strategy', icon: svg('M12 3v18M12 6l6 2-2.5 6a4 4 0 0 1-7 0L6 8l6-2zM6 8l-2.5 6a4 4 0 0 0 7 0'), title: 'Choosing your strategy', blurb: '🌱 Steady, ⚖️ Balanced or 🚀 Turbo — which profile fits you.', url: STRATEGY },
  { key: 'how', icon: svg('M4 17l4-6 3 3.5L16 8l4 5M4 21h16'), title: 'How Algoria trades', blurb: 'Confluence, breakouts, and why the AI stands aside around news.', url: '' },
  { key: 'mt5', icon: svg('M4 4h16v14H4zM4 22h16M8 12l2.5-3 2 2.5L16 8'), title: 'Reading your MT5', blurb: 'Follow your copies like a pro.', url: '' },
];

export default function Academy() {
  // Auth TOLÉRANTE : on veut juste savoir si la personne est connectée (pour le CTA), jamais la rediriger.
  const [anon, setAnon] = useState<boolean | null>(null);
  const [active, setActive] = useState(SECTIONS.find((s) => s.url)?.key ?? 'welcome');
  useEffect(() => {
    void fetch('/api/member/me').then((r) => setAnon(r.status === 401)).catch(() => setAnon(true));
  }, []);
  const current = SECTIONS.find((s) => s.key === active && s.url) ?? SECTIONS.find((s) => s.url) ?? SECTIONS[0];

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {current.url ? (
          isFile(current.url) ? (
            // Tournage PORTRAIT : lecteur natif centré, hauteur bornée — pas de barres noires plein écran.
            <div style={{ display: 'flex', justifyContent: 'center', background: 'radial-gradient(80% 90% at 50% 20%, #12213e 0%, #0a1425 100%)' }}>
              <video key={current.key} src={current.url} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 430, maxHeight: '74vh', objectFit: 'contain', display: 'block' }} />
            </div>
          ) : (
            <div style={{ position: 'relative', paddingTop: '56.25%' }}>
              <iframe key={current.key} src={current.url} title={current.title} allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }} />
            </div>
          )
        ) : (
          <div style={{ aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'radial-gradient(80% 90% at 50% 20%, #12213e 0%, #0a1425 100%)' }}>
            <img src="/brand/algoria-mark.png" alt="Algoria" width={48} height={48} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 9px rgba(43,227,245,.45))' }} />
            <span style={{ fontWeight: 800, letterSpacing: 0.6 }}>WELCOME VIDEO — DROPPING SOON</span>
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>your founder is filming it right now</span>
          </div>
        )}
      </section>
      {/* CTA prospect : visible UNIQUEMENT hors connexion — la vidéo vend, le bouton encaisse. */}
      {anon === true && (
        <a href="/member/login" className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 15px', textDecoration: 'none', fontWeight: 800, letterSpacing: 0.4, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', border: 'none' }}>
          🚀 Ready? Continue with Telegram — 2 minutes to set up
        </a>
      )}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => s.url && setActive(s.key)}
            className="panel"
            style={{ textAlign: 'left', cursor: s.url ? 'pointer' : 'default', padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 13, opacity: s.url ? 1 : 0.65, border: active === s.key && s.url ? '1px solid rgba(43,227,245,.5)' : undefined }}
          >
            <span style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: 'var(--cyan)', background: 'rgba(43,227,245,.08)', border: '1px solid rgba(43,227,245,.25)' }}>{s.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 750 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{s.blurb}</div>
            </div>
            <span className="mono" style={{ fontSize: 9, letterSpacing: 1, color: s.url ? 'var(--up)' : 'var(--dim)' }}>{s.url ? (active === s.key ? 'PLAYING' : 'WATCH') : 'SOON'}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
