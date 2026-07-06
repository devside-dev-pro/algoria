'use client';
// BANDEAU DE STREAM (/strip) — source navigateur à poser dans la zone vide de la scène TikTok/OBS.
// Conçu pour un crop horizontal (~1080×350, s'adapte) : orbe vivante + prix live + défilé des WINS du jour
// + stats + CTA tournant + QR CODE scannable vers algoria.tech (funnel Telegram — canal et contact humain
// AVANT l'app : choix produit, le closing se fait en DM).
// Règle broadcast 70/30 : QUE du positif — wins uniquement, jamais une perte à l'antenne.
// Ouvrir dans le navigateur du stream (session opérateur déjà connectée sur /app).
import { useEffect, useMemo, useState } from 'react';
import { useTrades, usePrice } from '@/lib/cockpit/useRealtime';
import { AlgoriaOrb } from '@/components/Orb';

const CTAS = [
  '💯 ALGORIA IS COMPLETELY FREE — LINK IN BIO',
  '🤖 EVERY TRADE ON SCREEN IS REAL — LIVE ACCOUNT',
  '📲 SCAN THE CODE — JOIN FREE ON TELEGRAM',
  '🎁 EARN $50 FOR EVERY FRIEND YOU BRING',
];

function Px({ sym, label, dp }: { sym: string; label: string; dp: number }) {
  const px = usePrice(sym);
  return (
    <span className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
      <span style={{ fontSize: 11, letterSpacing: 1.4, color: 'var(--dim)' }}>{label}</span>
      <span style={{ fontSize: 19, fontWeight: 700, color: px ? (px.dir >= 0 ? 'var(--up)' : 'var(--down)') : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
        {px ? px.mid.toFixed(dp) : '—'}
      </span>
    </span>
  );
}

export default function StreamStrip() {
  const trades = useTrades(120);
  const [qr, setQr] = useState<string | null>(null);
  const [ctaIdx, setCtaIdx] = useState(0);
  useEffect(() => {
    // QR généré côté client (aucun asset à héberger) — pointe sur la fiche store
    void import('qrcode').then((m) =>
      m.toDataURL('https://algoria.tech', { margin: 1, width: 220, color: { dark: '#0b0e14', light: '#dce9ff' } }).then(setQr),
    );
    const iv = window.setInterval(() => setCtaIdx((i) => (i + 1) % CTAS.length), 8000);
    return () => window.clearInterval(iv);
  }, []);

  // WINS DU JOUR uniquement (≥5$ pour écarter les micro-scalps du show, hors NAS retiré) — le 70/30 à l'antenne
  const dayStartMs = new Date().setUTCHours(0, 0, 0, 0);
  const wins = useMemo(
    () =>
      (trades as any[])
        .filter((t) => t.closed_at && Number(t.pnl) >= 5 && t.symbol !== 'NAS100' && Date.parse(t.closed_at) >= dayStartMs)
        .slice(0, 20),
    [trades, dayStartMs],
  );
  const winTotal = wins.reduce((a, t) => a + Number(t.pnl), 0);
  const best = wins.reduce((m, t) => Math.max(m, Number(t.pnl)), 0);
  // marquee : liste doublée + translation -50% en boucle = défilement infini sans couture
  const reel = wins.length ? [...wins, ...wins] : [];

  return (
    <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'linear-gradient(180deg, #0c1830 0%, #070c18 100%)', padding: '14px 20px', gap: 10 }}>
      <style>{`@keyframes stripScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>

      {/* ligne 1 : identité vivante + prix live + stats du jour + CTA tournant */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AlgoriaOrb size={64} state="idle" />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.6, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA AI</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: 1.6, color: '#ff6b8a', fontWeight: 800 }}>
              <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff6b8a' }} /> LIVE · REAL ACCOUNT
            </div>
          </div>
        </div>
        <Px sym="XAUUSD" label="GOLD" dp={2} />
        <Px sym="BTCUSD" label="BTC" dp={0} />
        <span style={{ flex: 1 }} />
        {wins.length > 0 && (
          <div style={{ display: 'flex', gap: 20 }}>
            <Tile label="WINS TODAY" value={`✓ ${wins.length}`} color="var(--up)" />
            <Tile label="BANKED TODAY" value={`+${winTotal.toFixed(0)}$`} gold />
            <Tile label="BEST TRADE" value={`+${best.toFixed(0)}$`} color="var(--up)" />
          </div>
        )}
        <div key={ctaIdx} className="cardIn" style={{
          fontSize: 15, fontWeight: 800, letterSpacing: 0.5, color: 'var(--text)', whiteSpace: 'nowrap',
          padding: '12px 22px', borderRadius: 999, border: '1px solid rgba(245,194,74,.45)',
          background: 'linear-gradient(90deg, rgba(245,194,74,.13), rgba(43,227,245,.09))', boxShadow: '0 0 22px rgba(245,194,74,.1)',
        }}>
          {CTAS[ctaIdx]}
        </div>
        {qr && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 'none' }}>
            <img src={qr} alt="algoria.tech" width={92} height={92} style={{ borderRadius: 10, border: '2px solid rgba(43,227,245,.4)' }} />
            <span className="mono" style={{ fontSize: 8.5, letterSpacing: 1, color: 'var(--cyan)' }}>SCAN → JOIN FREE</span>
          </div>
        )}
      </div>

      {/* ligne 2 : le défilé des wins du jour (marquee infini) — la preuve sociale en mouvement */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        {reel.length ? (
          <div style={{ display: 'flex', gap: 12, animation: `stripScroll ${Math.max(18, reel.length * 3)}s linear infinite`, width: 'max-content' }}>
            {reel.map((t: any, i) => (
              <div key={`${t.ticket}-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap', padding: '9px 16px', borderRadius: 10,
                border: '1px solid rgba(34,224,166,.4)', background: 'rgba(34,224,166,.07)', boxShadow: '0 0 12px rgba(34,224,166,.08)',
              }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: t.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>{t.direction === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
                <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{String(t.symbol) === 'XAUUSD' ? 'GOLD' : 'BTC'}</span>
                <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: 'var(--up)' }}>✓ +{Number(t.pnl).toFixed(0)}$</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>{new Date(t.closed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 14, color: 'var(--dim)', letterSpacing: 0.5 }}>⚡ The AI is hunting — today&rsquo;s wins will parade here as they close.</span>
        )}
      </div>
    </main>
  );
}

function Tile({ label, value, color, gold }: { label: string; value: string; color?: string; gold?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9, letterSpacing: 1.4, color: 'var(--dim)' }}>{label}</div>
      <div className={gold ? 'mono goldText' : 'mono'} style={{ fontSize: 21, fontWeight: 800, ...(gold ? {} : { color: color ?? 'var(--text)' }) }}>{value}</div>
    </div>
  );
}
