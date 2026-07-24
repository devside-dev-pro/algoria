'use client';
import { useEffect, useState } from 'react';
import { usePrice, useFeedHealth } from '@/lib/cockpit/useRealtime';
import { tgHref } from '@/lib/telegram';

// Funnel PUBLIC (domaine racine) : ce que voit un viewer qui tape algoria.tech (lien en bio TikTok).
// VERSION CLOSING — une seule page qui déroule l'argumentaire complet : bannière live, hero, PREUVE
// (vrais gains via /api/public/proof, wins only), vidéo de bienvenue (env), how-it-works, FAQ
// anti-objections (honnête : on gagne via les brokers partenaires — la transparence close), CTA final.
// Objectif inchangé : rejoindre le canal Telegram gratuit — le closing humain se fait en DM.
const TELEGRAM = process.env.NEXT_PUBLIC_TELEGRAM_URL || 'https://t.me/'; // à définir en env Vercel
const TIKTOK = process.env.NEXT_PUBLIC_TIKTOK_URL || '';
const VIDEO = process.env.NEXT_PUBLIC_WELCOME_VIDEO_URL || ''; // vidéo de bienvenue (mp4 ou YouTube/Vimeo)

interface Proof {
  wins: { symbol: string; direction: string; pnl: number; closed_at: string }[];
  today: { count: number; total: number; best: number };
  week: { total: number };
}

export default function Funnel() {
  const px = usePrice('XAUUSD');
  const { stale, hasData } = useFeedHealth();
  const live = hasData && !stale;
  const [proof, setProof] = useState<Proof | null>(null);
  useEffect(() => {
    void fetch('/api/public/proof').then((r) => (r.ok ? r.json() : null)).then((d) => d && setProof(d as Proof)).catch(() => {});
  }, []);
  const hasToday = (proof?.today.count ?? 0) > 0;

  return (
    <main style={{ minHeight: '100dvh', color: 'var(--text)', position: 'relative', overflowX: 'hidden', background: 'radial-gradient(90% 60% at 50% -10%, #0e1c33 0%, var(--bg,#070b12) 60%)' }}>
      <style>{`@keyframes proofScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
      <div aria-hidden style={{ position: 'absolute', top: '-16%', left: '50%', transform: 'translateX(-50%)', width: 620, height: 620, borderRadius: '50%', background: 'radial-gradient(circle, rgba(43,227,245,.10), transparent 60%)', filter: 'blur(20px)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', padding: '28px 20px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, textAlign: 'center' }}>

        {/* ===== logo + statut ===== */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/brand/algoria-mark.png" alt="Algoria" width={30} height={30} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 9px rgba(43,227,245,.45))' }} />
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</span>
        </div>

        {/* ===== bannière EN CE MOMENT — l'urgence honnête : l'IA tourne vraiment ===== */}
        {live && (
          <a href={TIKTOK || undefined} target={TIKTOK ? '_blank' : undefined} rel="noreferrer" style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, textDecoration: 'none',
            padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(255,45,85,.5)', background: 'linear-gradient(90deg, rgba(255,45,85,.14), rgba(255,90,60,.08))',
            fontSize: 13, fontWeight: 800, letterSpacing: 0.5, color: '#ff8a9a', cursor: TIKTOK ? 'pointer' : 'default',
          }}>
            <span className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff2d55' }} />
            THE AI IS TRADING RIGHT NOW{TIKTOK ? ' — WATCH THE LIVE →' : ''}
          </a>
        )}

        {/* ===== hero ===== */}
        <h1 style={{ fontSize: 30, lineHeight: 1.15, fontWeight: 700, margin: 0 }}>
          The AI that trades <span style={{ color: 'var(--gold)' }}>gold</span> &amp; <span style={{ color: '#f7931a' }}>Bitcoin</span>,<br />live.
        </h1>
        <p style={{ fontSize: 15, color: 'var(--muted)', margin: 0, maxWidth: 390 }}>
          Real money, real trades, executed autonomously around the clock — streamed with nothing to hide.
          Analysis, signals and results are <b style={{ color: 'var(--text)' }}>free</b> in the Telegram channel.
        </p>

        {/* ===== CTA principal ===== */}
        <a {...tgHref(TELEGRAM)} rel="noopener noreferrer" style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '16px 20px', borderRadius: 14, textDecoration: 'none', fontSize: 17, fontWeight: 800, letterSpacing: 0.3,
          color: '#04223a', background: 'linear-gradient(90deg,#2be3f5,#39a0ff)', boxShadow: '0 10px 30px rgba(43,227,245,.28)',
        }}>
          ✈️ JOIN ALGORIA — FREE
        </a>
        <span style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: -12 }}>Free Telegram channel · no payment · instant access</span>

        {/* ===== LA PREUVE — les vrais gains, en direct (wins only : la même règle que l'antenne) ===== */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {hasToday ? (
              <>
                <Stat label="Wins today" value={`✓ ${proof!.today.count}`} accent="var(--up)" />
                <Stat label="Banked today" value={`+$${proof!.today.total}`} accent="var(--gold)" mono />
                <Stat label="Best trade" value={`+$${proof!.today.best}`} accent="var(--up)" mono />
              </>
            ) : (
              <>
                <Stat label="Banked · 7 days" value={proof ? `+$${proof.week.total}` : '—'} accent="var(--gold)" mono />
                <Stat label="Markets" value="GOLD · BTC" accent="var(--cyan)" />
                <Stat label="XAU/USD" value={px ? px.mid.toFixed(1) : '—'} accent="var(--gold)" mono />
              </>
            )}
          </div>
          {(proof?.wins.length ?? 0) > 0 && (
            <div style={{ overflow: 'hidden', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)', padding: '10px 0' }}>
              <div style={{ display: 'flex', gap: 10, width: 'max-content', animation: `proofScroll ${Math.max(16, proof!.wins.length * 3)}s linear infinite` }}>
                {[...proof!.wins, ...proof!.wins].map((t, i) => (
                  <span key={i} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', fontSize: 12, padding: '6px 12px', borderRadius: 9, border: '1px solid rgba(34,224,166,.35)', background: 'rgba(34,224,166,.06)' }}>
                    <span style={{ color: t.direction === 'long' ? 'var(--up)' : 'var(--down)', fontWeight: 800 }}>{t.direction === 'long' ? '▲' : '▼'}</span>
                    <span style={{ color: 'var(--muted)' }}>{t.symbol === 'XAUUSD' ? 'GOLD' : 'BTC'}</span>
                    <span style={{ color: 'var(--up)', fontWeight: 800 }}>+${t.pnl}</span>
                  </span>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 10, letterSpacing: 1, color: 'var(--dim)' }}>LATEST WINS — CLOSED ON A REAL ACCOUNT</p>
            </div>
          )}
        </section>

        {/* ===== vidéo de bienvenue (activée via NEXT_PUBLIC_WELCOME_VIDEO_URL) ===== */}
        {VIDEO && (
          <section style={{ width: '100%', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', background: '#000' }}>
            {/youtube\.com|youtu\.be|vimeo\.com/.test(VIDEO) ? (
              <iframe src={VIDEO} title="Welcome to Algoria" style={{ width: '100%', aspectRatio: '16/9', border: 'none', display: 'block' }} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
            ) : (
              <video src={VIDEO} controls playsInline style={{ width: '100%', display: 'block' }} />
            )}
          </section>
        )}

        {/* ===== how it works — le funnel assumé en 3 pas ===== */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 9, textAlign: 'left' }}>
          <h2 style={{ fontSize: 12, letterSpacing: 1.6, color: 'var(--muted)', margin: '0 0 2px', textAlign: 'center' }}>HOW IT WORKS</h2>
          {[
            ['1', 'Watch the AI trade — free', 'The Telegram channel and the app show every analysis and every result, live. No payment, no card, ever.'],
            ['2', 'Open your account when ready', 'One account with a partner broker (from $200 — your money stays yours, in your name). That single step unlocks everything.'],
            ['3', 'The AI trades for you, automatically', 'Every trade you watch live is copied to your account with strict risk control. Watch your balance from the app — pause anytime.'],
          ].map(([n, t, d]) => (
            <div key={n} style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)' }}>
              <span className="mono goldText" style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>{n}</span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 750 }}>{t}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 }}>{d}</div>
              </div>
            </div>
          ))}
        </section>

        {/* ===== FAQ anti-objections — l'honnêteté qui close ===== */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7, textAlign: 'left' }}>
          <h2 style={{ fontSize: 12, letterSpacing: 1.6, color: 'var(--muted)', margin: '0 0 2px', textAlign: 'center' }}>QUESTIONS EVERYONE ASKS</h2>
          {[
            ['Is it really free? What’s the catch?', 'Yes — the channel, the app and the live are 100% free. Algoria is paid by its partner brokers when members open accounts. You never pay us anything; that’s the whole model, in the open.'],
            ['Where does my money sit?', 'In YOUR broker account, under YOUR name. We never hold or touch your funds — the copier only mirrors trades onto your account. You can pause the copy or withdraw from your broker anytime.'],
            ['How do I actually start?', 'Join the Telegram channel (free), talk to us, then open an account with a partner broker — from $200 depending on the strategy you pick. Once verified, every AI trade copies to your account automatically.'],
            ['What are the risks?', 'Trading is risky — period. Every trade has a stop-loss and the AI enforces a daily loss kill-switch, but losing days exist. Never fund with money you can’t afford to lose.'],
            ['Can I see the results before joining?', 'Yes. Everything runs in public: the TikTok lives, the channel, and the app in free mode show the wins as they happen, on a real account.'],
          ].map(([q, a]) => (
            <details key={q} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)', padding: '12px 14px' }}>
              <summary style={{ fontSize: 13.5, fontWeight: 750, cursor: 'pointer', listStyle: 'none' }}>{q}</summary>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, margin: '8px 0 0' }}>{a}</p>
            </details>
          ))}
        </section>

        {/* ===== CTA final ===== */}
        <a {...tgHref(TELEGRAM)} rel="noopener noreferrer" style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '16px 20px', borderRadius: 14, textDecoration: 'none', fontSize: 16, fontWeight: 800, letterSpacing: 0.3,
          color: '#0b0e14', background: 'linear-gradient(90deg,#ffd166,#f5a623)', boxShadow: '0 10px 30px rgba(245,194,74,.22)',
        }}>
          🚀 GET IN — IT&rsquo;S FREE
        </a>
        {TIKTOK && (
          <a href={TIKTOK} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', borderBottom: '1px solid var(--border)', paddingBottom: 2, marginTop: -8 }}>
            🔴 Watch the live on TikTok
          </a>
        )}

        <p style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 4, maxWidth: 380, lineHeight: 1.4 }}>
          Trading involves risk of loss. Past performance does not guarantee future results. Educational &amp; entertainment content — not financial advice.
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
