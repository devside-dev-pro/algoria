'use client';
// HISTORY — les trades clôturés d'Algoria (compte maître). L'historique PERSONNEL (son compte, son lot)
// arrive avec le branchement de l'API du copieur — bannière honnête en attendant.
import { useEffect, useState } from 'react';
import { useMe, UnlockSheet } from '../ui';
import { drawWinCard, shareOrDownloadCard } from '@/lib/cards/winCard';

interface FeedTrade { ticket: string; symbol: string; direction: string; entry: number; exit: number; pnl: number; r: number | null; reason: string; closed_at: string }

export default function MemberHistory() {
  const { member, unlocked, loading, referral } = useMe();
  const [trades, setTrades] = useState<FeedTrade[]>([]);
  const [paywall, setPaywall] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  useEffect(() => {
    void fetch('/api/member/feed').then(async (r) => (r.ok ? setTrades(((await r.json()) as { trades: FeedTrade[] }).trades) : null));
  }, []);
  // WIN CARD — le flex viral : la carte façon Binance avec le QR du lien de PARRAINAGE du membre.
  // Il frime avec son gain → ses viewers scannent → il touche 50$ par activation. Tout le monde gagne.
  // Deux formats : story 9:16 (Insta/TikTok) et paysage 16:9 (posts, statuts, X).
  const shareWin = async (t: FeedTrade, format: 'story' | 'landscape') => {
    setSharing(`${t.ticket}-${format}`);
    try {
      const code = referral?.code;
      const blob = await drawWinCard({
        symbol: t.symbol, direction: t.direction, pnl: Number(t.pnl), closedAt: t.closed_at, format,
        qrUrl: code ? `https://app.algoria.tech/r/${code}` : 'https://algoria.tech',
        qrLabel: code ? `app.algoria.tech/r/${code}` : 'algoria.tech',
      });
      await shareOrDownloadCard(blob, `algoria-win-${t.ticket}-${format === 'landscape' ? 'wide' : 'story'}.png`);
    } finally {
      setSharing(null);
    }
  };
  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;
  const wins = trades.filter((t) => Number(t.pnl) > 0).length;
  const net = trades.reduce((a, t) => a + Number(t.pnl), 0);
  const winSum = trades.filter((t) => Number(t.pnl) > 0).reduce((a, t) => a + Number(t.pnl), 0);
  const best = trades.reduce((m, t) => Math.max(m, Number(t.pnl) || 0), 0);
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      {/* prospect : le serveur n'envoie que les gains → on l'ASSUME (highlight reel) au lieu d'afficher
          un win rate 100% qui sentirait le faux. L'historique complet arrive avec l'accès. */}
      {unlocked ? (
        <section className="panel" style={{ padding: 16, display: 'flex', gap: 18 }}>
          <Stat label="TRADES" value={String(trades.length)} />
          <Stat label="WINS" value={trades.length ? `${Math.round((wins / trades.length) * 100)}%` : '—'} color="var(--up)" />
          <Stat label="NET (MASTER)" value={net > 0 ? `+${net.toFixed(0)}$` : '—'} gold={net > 0} />
        </section>
      ) : (
        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderColor: 'rgba(245,194,74,.3)' }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--gold)', fontWeight: 800 }}>✨ HIGHLIGHT REEL — HER BEST RECENT TRADES</span>
          <div style={{ display: 'flex', gap: 18 }}>
            <Stat label="WINS" value={String(wins)} color="var(--up)" />
            <Stat label="BANKED" value={winSum > 0 ? `+${winSum.toFixed(0)}$` : '—'} gold={winSum > 0} />
            <Stat label="BEST" value={best > 0 ? `+${best.toFixed(0)}$` : '—'} color="var(--up)" />
          </div>
        </section>
      )}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {trades.map((t) => {
          const win = Number(t.pnl) > 0;
          return (
            <div key={t.ticket} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderBottom: '1px solid rgba(130,152,190,.1)', opacity: win ? 1 : 0.55 }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', minWidth: 60 }}>{new Date(t.closed_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} {new Date(t.closed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: t.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>{t.direction === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.symbol}</span>
              <span style={{ flex: 1 }} />
              {t.reason === 'be' && <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>BE</span>}
              <span className="mono" style={{ fontSize: 13, fontWeight: win ? 800 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)', minWidth: 58, textAlign: 'right' }}>{win ? '✓ +' : ''}{Number(t.pnl).toFixed(0)}$</span>
              {win && (
                <>
                  <button onClick={() => void shareWin(t, 'story')} disabled={sharing === `${t.ticket}-story`} title="story card 9:16 — the QR is YOUR referral link ($50 per friend who activates)"
                    style={{ border: '1px solid rgba(43,227,245,.35)', background: 'rgba(43,227,245,.06)', color: 'var(--cyan)', borderRadius: 7, padding: '3px 8px', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>
                    {sharing === `${t.ticket}-story` ? '…' : '📤'}
                  </button>
                  <button onClick={() => void shareWin(t, 'landscape')} disabled={sharing === `${t.ticket}-landscape`} title="wide card 16:9 (posts, statuses) — same referral QR"
                    style={{ border: '1px solid rgba(43,227,245,.35)', background: 'rgba(43,227,245,.06)', color: 'var(--cyan)', borderRadius: 7, padding: '3px 8px', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>
                    {sharing === `${t.ticket}-landscape` ? '…' : '🖼'}
                  </button>
                </>
              )}
            </div>
          );
        })}
        {trades.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>No closed trades yet today.</p>}
      </section>
      {/* prospect : l'historique reste EN CLAIR (c'est l'appât) — la bannière convertit le FOMO en action */}
      {!unlocked ? (
        <button
          onClick={() => setPaywall(true)}
          className="panel"
          style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', textAlign: 'left', borderColor: 'rgba(245,194,74,.4)', color: 'var(--text)' }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>
            {winSum > 0 ? <>You just watched <span className="goldText">+{winSum.toFixed(0)}$</span> of wins from the sidelines.</> : 'Every one of these trades lands on members’ accounts.'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>Members&rsquo; accounts copied all of this automatically — <b style={{ color: 'var(--gold)' }}>unlock your access →</b></span>
        </button>
      ) : (
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.55 }}>
          Master account results. Your personal history — your account, your lot size — lands here once your copier link is live.
        </p>
      )}
      {!unlocked && <UnlockSheet open={paywall} onClose={() => setPaywall(false)} status={member.status} />}
    </main>
  );
}

function Stat({ label, value, color, gold }: { label: string; value: string; color?: string; gold?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)' }}>{label}</span>
      <span className={gold ? 'mono goldText' : 'mono'} style={{ fontSize: 19, fontWeight: 800, ...(gold ? {} : { color: color ?? 'var(--text)' }) }}>{value}</span>
    </div>
  );
}
