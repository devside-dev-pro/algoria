'use client';
// HISTORY — les trades clôturés d'Algoria (compte maître). L'historique PERSONNEL (son compte, son lot)
// arrive avec le branchement de l'API du copieur — bannière honnête en attendant.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, UnlockSheet } from '../ui';
import { drawWinCard, shareOrDownloadCard } from '@/lib/cards/winCard';
import { RECORD } from '@/lib/backtest/record';

interface FeedTrade { ticket: string; symbol: string; direction: string; entry: number; exit: number; pnl: number; r: number | null; reason: string; closed_at: string; lot?: number }

export default function MemberHistory() {
  const router = useRouter();
  const { member, unlocked, loading, referral } = useMe();
  const [trades, setTrades] = useState<FeedTrade[]>([]);
  const [clientLot, setClientLot] = useState(0.01);
  const [paywall, setPaywall] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  useEffect(() => {
    void fetch('/api/member/feed').then(async (r) => {
      if (!r.ok) return;
      const d = (await r.json()) as { trades: FeedTrade[]; clientLot?: number };
      setTrades(d.trades);
      if (d.clientLot) setClientLot(d.clientLot);
    });
  }, []);
  // ÉCHELLE CLIENT : le master (~$70k) trade en lot 1 — le membre copie en lot FIXE (clientLot, ex. 0.01).
  // Montant « pour toi » = pnl × clientLot ÷ lot du master. Leçon churn : « −1291$ » a fait fuir un client
  // à 500$ dont le vrai chiffre était −13$ — on met SON échelle en avant, le master en petit.
  const you = (t: FeedTrade) => Number(t.pnl) * clientLot / (Number(t.lot) > 0 ? Number(t.lot) : 1);
  const fmtYou = (v: number) => `${v > 0 ? '+' : ''}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}$`;
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
      {/* CLOSING EN HAUT (prospects) — la 1re chose qu'un non-membre voit : le manque à gagner + le CTA.
          C'est l'arme de conversion, elle doit être au-dessus de la ligne de flottaison, pas noyée en bas. */}
      {!unlocked && winSum > 0 && (
        <button
          onClick={() => setPaywall(true)}
          className="panel"
          style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', textAlign: 'left', color: 'var(--text)', borderColor: 'rgba(245,194,74,.5)', background: 'linear-gradient(180deg, rgba(245,194,74,.08), rgba(10,17,31,.45))' }}
        >
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--gold)', fontWeight: 800 }}>⚡ YOU WATCHED FROM THE SIDELINES</span>
          <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.25 }}>
            <span className="goldText" style={{ fontSize: 27 }}>+{winSum.toFixed(0)}$</span> you&rsquo;d have banked following Algoria
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Every trade below copied straight to members&rsquo; accounts, hands-free — you just watched. Unlock and the next ones land on <b style={{ color: 'var(--text)' }}>yours</b>. <b style={{ color: 'var(--gold)' }}>Unlock my access →</b>
          </span>
        </button>
      )}

      {/* prospect : le serveur n'envoie que les gains → on l'ASSUME (highlight reel) au lieu d'afficher
          un win rate 100% qui sentirait le faux. L'historique complet arrive avec l'accès. */}
      {unlocked ? (
        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 18 }}>
            <Stat label="TRADES" value={String(trades.length)} />
            <Stat label="WINS" value={trades.length ? `${Math.round((wins / trades.length) * 100)}%` : '—'} color="var(--up)" />
            {/* le NET à SON échelle, honnête (rouge inclus) — un « — » qui masque le rouge sent le cache-misère */}
            <Stat label="NET (YOUR SIZE)" value={trades.length ? fmtYou(trades.reduce((a, t) => a + you(t), 0)) : '—'} gold={trades.reduce((a, t) => a + you(t), 0) > 0} color={trades.reduce((a, t) => a + you(t), 0) > 0 ? undefined : 'rgba(210,150,165,.85)'} />
          </div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
            Algoria trades a <b style={{ color: 'var(--muted)' }}>$70k master account</b> — you copy at <b style={{ color: 'var(--muted)' }}>{clientLot} lot</b>. Amounts below are shown <b style={{ color: 'var(--cyan)' }}>at your size</b> (master in small).
          </p>
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
        {/* MEMBRES : trades REGROUPÉS PAR JOURNÉE, bilan du jour en tête — on raconte la journée (souvent
            verte), pas le trade isolé (parfois rouge). Un mur de trades bruts laisse l'œil accrocher les
            3 gros rouges du master et rater le net positif → c'est ça qui a fait fuir un client. */}
        {(() => {
          const groups: { day: string; items: FeedTrade[] }[] = [];
          for (const t of trades) {
            const day = new Date(t.closed_at).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' });
            const g = groups[groups.length - 1];
            if (g && g.day === day) g.items.push(t);
            else groups.push({ day, items: [t] });
          }
          return groups.map((g) => {
            const dayYou = g.items.reduce((a, t) => a + you(t), 0);
            const dayWins = g.items.filter((t) => Number(t.pnl) > 0).length;
            const dayGreen = dayYou > 0;
            return (
              <div key={g.day} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {unlocked && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: dayGreen ? 'rgba(38,224,166,.07)' : 'rgba(210,150,165,.06)', border: `1px solid ${dayGreen ? 'rgba(38,224,166,.25)' : 'rgba(210,150,165,.18)'}` }}>
                    <span className="mono" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, color: 'var(--muted)' }}>{g.day.toUpperCase()}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>{g.items.length} trades · {Math.round((dayWins / g.items.length) * 100)}% wins</span>
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: 13.5, fontWeight: 800, color: dayGreen ? 'var(--up)' : 'rgba(210,150,165,.85)' }}>{fmtYou(dayYou)}</span>
                  </div>
                )}
                {g.items.map((t) => {
                  const win = Number(t.pnl) > 0;
                  return (
                    <div key={t.ticket} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0 7px 10px', borderBottom: '1px solid rgba(130,152,190,.1)', opacity: win ? 1 : 0.55 }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', minWidth: 34 }}>{new Date(t.closed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: t.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>{t.direction === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.symbol}</span>
                      <span style={{ flex: 1 }} />
                      {t.reason === 'be' && <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>BE</span>}
                      {unlocked ? (
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 74 }}>
                          <span className="mono" style={{ fontSize: 13, fontWeight: win ? 800 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{win ? '✓ ' : ''}{fmtYou(you(t))}</span>
                          <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>master {Number(t.pnl) > 0 ? '+' : ''}{Number(t.pnl).toFixed(0)}$</span>
                        </span>
                      ) : (
                        <span className="mono" style={{ fontSize: 13, fontWeight: win ? 800 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)', minWidth: 58, textAlign: 'right' }}>{win ? '✓ +' : ''}{Number(t.pnl).toFixed(0)}$</span>
                      )}
                      {/* UN SEUL bouton, texte explicite. Carte paysage ; QR = SON lien de parrainage */}
                      {win && (
                        <button onClick={() => void shareWin(t, 'landscape')} disabled={sharing === `${t.ticket}-landscape`} title="share this win as a card — the QR is YOUR referral link ($50 per friend who activates)"
                          style={{ border: '1px solid rgba(43,227,245,.35)', background: 'rgba(43,227,245,.06)', color: 'var(--cyan)', borderRadius: 7, padding: '4px 9px', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, cursor: 'pointer', lineHeight: 1, whiteSpace: 'nowrap' }}>
                          {sharing === `${t.ticket}-landscape` ? '…' : 'SHARE'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
        {trades.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>No closed trades yet today.</p>}
      </section>

      {/* « tu veux voir plus loin ? » → le track record COMPLET (16 mois, simulé), en natif. Visible par tous :
          c'est du contenu public-équivalent (même données que la page /backtest), excellent pour la conversion. */}
      <button
        onClick={() => router.push('/member/track-record')}
        className="panel"
        style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left', color: 'var(--text)', borderColor: 'rgba(43,227,245,.28)' }}
      >
        <span style={{ fontSize: 20 }}>📊</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>See Algoria&rsquo;s full track record</span>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.45 }}>
            {RECORD.window.months} months, every strategy combined — <b style={{ color: 'var(--cyan)' }}>+{RECORD.returnPct}%</b> simulated <span style={{ color: 'var(--dim)' }}>· drawdowns shown</span>
          </span>
        </span>
        <span style={{ color: 'var(--cyan)', fontSize: 18 }}>›</span>
      </button>

      {/* Le CLOSING prospect vit désormais EN HAUT (bannière « manque à gagner »). Ici, juste un repli
          si aucun gain n'est encore chargé (winSum 0) — sinon on ne duplique pas le CTA. Membre : la note. */}
      {unlocked ? (
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.55 }}>
          Master account results. Your personal history — your account, your lot size — lands here once your copier link is live.
        </p>
      ) : winSum === 0 ? (
        <button
          onClick={() => setPaywall(true)}
          className="panel"
          style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', textAlign: 'left', borderColor: 'rgba(245,194,74,.4)', color: 'var(--text)' }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Every one of these trades lands on members&rsquo; accounts.</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>Members&rsquo; accounts copied all of this automatically — <b style={{ color: 'var(--gold)' }}>unlock your access →</b></span>
        </button>
      ) : null}
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
