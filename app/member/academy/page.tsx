'use client';
// ACADEMY — la vidéo de bienvenue (placeholder en attendant le tournage) + les sections à venir.
// Brancher : NEXT_PUBLIC_WELCOME_VIDEO_URL (YouTube non répertorié ou fichier hébergé) dès que la vidéo est prête.
import { useMe } from '../ui';

const WELCOME = process.env.NEXT_PUBLIC_WELCOME_VIDEO_URL ?? '';

const svg = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const SECTIONS = [
  { icon: svg('M8 5.5v13l11-6.5L8 5.5z'), title: 'Welcome to Algoria', blurb: 'What you just joined, and what happens next.', ready: !!WELCOME },
  { icon: svg('M4 17l4-6 3 3.5L16 8l4 5M4 21h16'), title: 'How Algoria trades', blurb: 'Confluence, breakouts, and why the AI stands aside around news.', ready: false },
  { icon: svg('M12 3v18M12 6l6 2-2.5 6a4 4 0 0 1-7 0L6 8l6-2zM6 8l-2.5 6a4 4 0 0 0 7 0'), title: 'Choosing your risk', blurb: 'What 0.01 / 0.05 / 0.10 really change on your account.', ready: false },
  { icon: svg('M4 4h16v14H4zM4 22h16M8 12l2.5-3 2 2.5L16 8'), title: 'Reading your MT5', blurb: 'Follow your copies like a pro.', ready: false },
];

export default function Academy() {
  const { member, loading } = useMe({ requireOnboarded: true });
  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {WELCOME ? (
          <div style={{ position: 'relative', paddingTop: '56.25%' }}>
            <iframe src={WELCOME} title="Welcome to Algoria" allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }} />
          </div>
        ) : (
          <div style={{ aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'radial-gradient(80% 90% at 50% 20%, #12213e 0%, #0a1425 100%)' }}>
            <img src="/brand/algoria-mark.png" alt="Algoria" width={48} height={48} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 9px rgba(43,227,245,.45))' }} />
            <span style={{ fontWeight: 800, letterSpacing: 0.6 }}>WELCOME VIDEO — DROPPING SOON</span>
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>your founder is filming it right now</span>
          </div>
        )}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {SECTIONS.map((s) => (
          <div key={s.title} className="panel" style={{ padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 13, opacity: s.ready ? 1 : 0.65 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: 'var(--cyan)', background: 'rgba(43,227,245,.08)', border: '1px solid rgba(43,227,245,.25)' }}>{s.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 750 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{s.blurb}</div>
            </div>
            <span className="mono" style={{ fontSize: 9, letterSpacing: 1, color: s.ready ? 'var(--up)' : 'var(--dim)' }}>{s.ready ? 'WATCH' : 'SOON'}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
