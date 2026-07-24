'use client';
// HOME membre : statut de copie en tête (la réassurance n°1), badge Member #N, derniers trades d'Algoria.
// PROSPECT (accès non activé) : même écran, mais le bloc statut devient le HERO d'acquisition —
// « Algoria trade en ce moment, toi tu regardes de dehors » + UNLOCK (paywall broker) + support Telegram.
// Les gains restent EN CLAIR : c'est l'appât — il voit exactement ce qu'il rate.
import { useEffect, useState } from 'react';
import { useMe, StatusPill, UnlockSheet, SUPPORT_TG, BOOK_CALL_URL, type Member, type MemberAccount, type Referral } from './ui';
import { tgHref } from '@/lib/telegram';
import { STRATEGY_MIN_DEPOSIT } from '@/lib/member/minimums';

interface FeedTrade { ticket: string; symbol: string; direction: string; pnl: number; r: number | null; closed_at: string; lot?: number }

export default function MemberHome() {
  const { member, setMember, accounts, referral, unlocked, loading } = useMe();
  const [trades, setTrades] = useState<FeedTrade[]>([]);
  const [clientLot, setClientLot] = useState(0.01);
  const [busy, setBusy] = useState(false);
  const [paywall, setPaywall] = useState(false);
  interface Social { members: number; live: number; joins48h: number; lastLiveNo: number | null; lastLiveHours: number | null }
  const [social, setSocial] = useState<Social | null>(null);
  const [tick, setTick] = useState(0); // rotation du bandeau preuve sociale
  useEffect(() => {
    void fetch('/api/member/feed').then(async (r) => {
      if (!r.ok) return;
      const d = (await r.json()) as { trades: FeedTrade[]; clientLot?: number; social?: Social };
      setTrades(d.trades.slice(0, 8));
      if (d.clientLot) setClientLot(d.clientLot);
      if (d.social) setSocial(d.social);
    });
    const iv = setInterval(() => setTick((t) => t + 1), 4000);
    return () => clearInterval(iv);
  }, []);
  // ÉCHELLE CLIENT (voir History) : « −1291$ » du master ($70k, lot 1) = −13$ pour un copieur en 0.01 —
  // afficher le chiffre du master en premier fait fuir ; on montre le SIEN, master en note.
  const you = (t: FeedTrade) => Number(t.pnl) * clientLot / (Number(t.lot) > 0 ? Number(t.lot) : 1);
  const fmtYou = (v: number) => `${v > 0 ? '+' : ''}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}$`;
  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;

  const act = (action: 'pause' | 'resume' | 'risk', tier?: string) => {
    setBusy(true);
    void fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(tier ? { tier } : {}) }) })
      .then(async (r) => { const d = (await r.json()) as { member?: Member }; if (d.member) setMember(d.member); })
      .finally(() => setBusy(false));
  };

  const wins = trades.filter((t) => Number(t.pnl) > 0);
  const winTotal = wins.reduce((a, t) => a + Number(t.pnl), 0);
  const pendingReview = member.status === 'pending_copier';

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      {/* identité + statut */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {member.photo_url
            ? <img src={member.photo_url} alt="" width={42} height={42} style={{ borderRadius: '50%', border: '2px solid rgba(245,194,74,.5)' }} />
            : <span style={{ width: 42, height: 42, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, background: 'linear-gradient(135deg,#2be3f5,#1e40e5)', color: '#0b0e14' }}>{(member.tg_name ?? '?').charAt(0).toUpperCase()}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 750, fontSize: 15.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.tg_name ?? member.tg_username}</div>
            <div className="mono goldText" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1 }}>MEMBER #{member.member_no}</div>
          </div>
        </div>
        {unlocked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <StatusPill status={member.status} />
            {(member.status === 'live' || member.status === 'paused') && (
              <button disabled={busy} onClick={() => act(member.status === 'paused' ? 'resume' : 'pause')} style={{ marginLeft: 'auto', border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)', color: member.status === 'paused' ? 'var(--up)' : 'var(--muted)', borderRadius: 9, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {member.status === 'paused' ? '▶ RESUME COPYING' : '⏸ PAUSE COPYING'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* HERO PROSPECT — pas de mur : l'app entière est visible, ce bloc vend le déblocage */}
      {!unlocked && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'rgba(245,194,74,.4)', boxShadow: '0 0 26px rgba(245,194,74,.09)' }}>
          {pendingReview ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 9px rgba(245,194,74,.6)' }} />
                <h2 style={{ margin: 0, fontSize: 16 }}>Setup received — access under review</h2>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                The team is verifying your broker account and switching the copy on. Everything unlocks automatically — usually within a few hours.
              </p>
              <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={ctaGhost}>💬 MESSAGE SUPPORT — @mathieu_algoria</a>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--up)', boxShadow: '0 0 9px rgba(31,216,176,.6)' }} />
                <h2 style={{ margin: 0, fontSize: 16 }}>Algoria is trading right now</h2>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                You&rsquo;re watching from the outside — members&rsquo; accounts copy every one of these trades <b style={{ color: 'var(--text)' }}>automatically</b>.
                {winTotal > 0 && <> The wins below alone made members <b className="goldText">+{winTotal.toFixed(0)}$</b>.</>}
              </p>
              <button onClick={() => setPaywall(true)} style={ctaGold}>⚡ UNLOCK MY ACCESS</button>
              {/* l'appel = l'arme de closing : 10 min au téléphone avec Mathieu et c'est signé */}
              <a {...tgHref(BOOK_CALL_URL)} rel="noreferrer" style={ctaGhost}>📞 BOOK A CALL WITH MATHIEU</a>
              <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={{ ...ctaGhost, border: 'none', background: 'transparent', fontSize: 12, color: 'var(--muted)' }}>💬 or just message @mathieu_algoria</a>
            </>
          )}
        </section>
      )}

      {/* PREUVE SOCIALE (prospects) — bandeau ROTATIF (4 s), uniquement du FRAIS : inscrits 48h,
          activation < 72h, compteurs. Seuils mini pour ne jamais afficher un chiffre faible ou figé. */}
      {!unlocked && social && (() => {
        const msgs: string[] = [];
        if (social.joins48h >= 3) msgs.push(`🔥 ${social.joins48h} traders joined in the last 48h`);
        if (social.lastLiveNo != null) msgs.push(`⚡ Member #${social.lastLiveNo} just went LIVE${social.lastLiveHours ? ` — ${social.lastLiveHours}h ago` : ''}`);
        if (social.live >= 3) msgs.push(`🟢 ${social.live} accounts copying Algoria right now`);
        if (social.members >= 20) msgs.push(`👥 ${social.members} members inside`);
        if (msgs.length === 0) return null;
        return (
          <div className="panel" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, borderColor: 'rgba(43,227,245,.3)', overflow: 'hidden' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--up)', boxShadow: '0 0 8px var(--up)', flexShrink: 0 }} />
            <span key={tick % msgs.length} className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', letterSpacing: 0.3, animation: 'cardIn .45s ease' }}>
              {msgs[tick % msgs.length]}
            </span>
          </div>
        );
      })()}

      {/* Derniers trades d'Algoria — pour les prospects le serveur n'envoie QUE les gains (bande-annonce
          assumée : "LATEST WINS") ; le flux complet et honnête arrive avec l'accès débloqué */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: unlocked ? 'var(--muted)' : 'var(--gold)' }}>{unlocked ? 'ALGORIA — LATEST TRADES' : '✨ ALGORIA — LATEST WINS'}</h2>
          {wins.length > 0 && <span className="mono" style={{ fontSize: 11, color: 'var(--up)' }}>{unlocked ? `✓ ${wins.length}/${trades.length} wins` : `✓ ${wins.length} wins`}</span>}
        </div>
        {trades.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>The AI is hunting — trades appear here as they close.</p>}
        {trades.map((t) => {
          const win = Number(t.pnl) > 0;
          return (
            <div key={t.ticket} style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: win ? 1 : 0.55 }}>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', minWidth: 38 }}>{new Date(t.closed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: t.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>{t.direction === 'long' ? '▲' : '▼'}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.symbol}</span>
              <span style={{ flex: 1 }} />
              {unlocked ? (
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: win ? 800 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{win ? '✓ ' : ''}{fmtYou(you(t))}</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>({Number(t.pnl) > 0 ? '+' : ''}{Number(t.pnl).toFixed(0)}$)</span>
                </span>
              ) : (
                <span className="mono" style={{ fontSize: 12.5, fontWeight: win ? 800 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{win ? '✓ +' : ''}{Number(t.pnl).toFixed(0)}$</span>
              )}
            </div>
          );
        })}
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--dim)' }}>
          {unlocked ? `Shown at your copy size (${clientLot} lot) — master account in brackets.` : 'Her best recent trades — members’ accounts copied these automatically. The complete live history unlocks with your access.'}
        </p>
      </section>

      {/* ➕ MULTI-STRATÉGIES — l'upsell de continuité : le membre live voit dans le VIP les wins des
          stratégies qu'il n'a PAS ("+$571 S1 STEADY" alors qu'il est en S2)… cette carte est la réponse.
          Argument honnête : la décorrélation est réelle (quand une stratégie a un jour rouge, les autres
          compensent souvent). Un compte par stratégie, chez un nouveau broker. */}
      {unlocked && ['live', 'paused'].includes(member.status) && <AddStrategyCard member={member} accounts={accounts} />}

      {/* PARRAINAGE — sur le Home, là où le membre regarde ses gains chaque jour = le moment où il est
          content. On surfe sur la dopamine des wins juste au-dessus : "Algoria vient de te faire gagner,
          amène ton crew et touche $50 par ami financé". La mécanique complète (retrait, historique,
          paliers) reste dans le Profil ; ici c'est le déclencheur en un tap. */}
      {unlocked && referral?.code && <InviteCard referral={referral} hasWins={wins.length > 0} />}

      <UnlockSheet open={paywall} onClose={() => setPaywall(false)} status={member.status} />
    </main>
  );
}

const STRAT_LABEL: Record<number, { icon: string; name: string }> = { 1: { icon: '🛡️', name: 'S1 STEADY' }, 2: { icon: '⚖️', name: 'S2 BALANCED' }, 3: { icon: '🔥', name: 'S3 TURBO' } };

function AddStrategyCard({ member, accounts }: { member: Member; accounts: MemberAccount[] }) {
  const active = accounts.filter((a) => a.status !== 'rejected');
  const used = new Set<number>([Number(member.strategy ?? 2), ...active.map((a) => a.strategy)]);
  const missing = [1, 2, 3].filter((id) => !used.has(id));
  const pending = active.filter((a) => a.status === 'pending');
  if (missing.length === 0 && pending.length === 0) return null; // flotte complète → rien à vendre
  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'rgba(43,227,245,.3)' }}>
      {pending.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--gold)' }}>
          <span>⧗</span>
          <span><b>{STRAT_LABEL[pending[0].strategy]?.name}</b> — new account under review, unlocks automatically.</span>
        </div>
      )}
      {missing.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontSize: 16 }}>➕</span>
            <h2 style={{ margin: 0, fontSize: 15 }}>Run {missing.length > 1 ? 'more strategies' : 'the missing strategy'} in parallel</h2>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            You&rsquo;re on <b style={{ color: 'var(--text)' }}>{STRAT_LABEL[Number(member.strategy ?? 2)]?.name}</b>. Members running several strategies get real diversification — when one has a red day, the others often cover it.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {missing.map((id) => (
              <span key={id} className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 9px', background: 'rgba(10,17,31,.55)' }}>
                {STRAT_LABEL[id].icon} {STRAT_LABEL[id].name} · from ${STRATEGY_MIN_DEPOSIT[id]}
              </span>
            ))}
          </div>
          <a href="/member/add-strategy" style={{ padding: '12px 16px', borderRadius: 11, textAlign: 'center', textDecoration: 'none', fontWeight: 800, letterSpacing: 0.5, fontSize: 12.5, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }}>
            ➕ ADD A STRATEGY
          </a>
        </>
      )}
    </section>
  );
}

function InviteCard({ referral, hasWins }: { referral: Referral; hasWins: boolean }) {
  const [copied, setCopied] = useState(false);
  const reward = referral.rewardUsd || 50;
  const link = `https://app.algoria.tech/r/${referral.code}`;
  const share = () => {
    const text = 'Algoria is the AI that trades gold & Bitcoin for me on autopilot — my account just copies it. Get in with my link 👇';
    if (typeof navigator !== 'undefined' && navigator.share) void navigator.share({ title: 'Join Algoria', text, url: link }).catch(() => {});
    else { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); }
  };
  const earned = referral.totalEarnedUsd || 0;
  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11, borderColor: 'rgba(245,194,74,.4)', boxShadow: '0 0 22px rgba(245,194,74,.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 17 }}>💸</span>
        <h2 style={{ margin: 0, fontSize: 15.5 }}>Invite friends — earn <span className="goldText">${reward}</span> each</h2>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
        {hasWins
          ? <>Algoria&rsquo;s on a roll right now — the perfect moment to bring someone in. You pocket <b className="goldText">${reward}</b> for every friend who funds their account, paid in USDT.</>
          : <>Every friend whose account gets funded pays you <b className="goldText">${reward}</b>, straight to your wallet in USDT. Share once, earn on repeat.</>}
      </p>
      <button onClick={share} style={{ padding: '13px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.6, fontSize: 13.5, color: '#0b0e14', background: 'linear-gradient(90deg,#ffd166,#f5a623)', boxShadow: '0 8px 24px rgba(245,166,35,.24)' }}>
        {copied ? '✓ LINK COPIED — paste it anywhere' : '🚀 SHARE MY INVITE LINK'}
      </button>
      {(referral.activated > 0 || earned > 0) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
          <span style={{ color: 'var(--muted)' }}><b style={{ color: 'var(--up)' }}>{referral.activated}</b> activated</span>
          <span style={{ color: 'var(--dim)' }}>·</span>
          <span className="goldText" style={{ fontWeight: 800 }}>${earned} earned</span>
          {referral.nextMilestone && (
            <>
              <span style={{ flex: 1 }} />
              <span style={{ color: 'var(--dim)', fontSize: 10.5 }}>{referral.nextMilestone.remaining} more → +${referral.nextMilestone.bonus}</span>
            </>
          )}
          <a href="/member/profile" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--cyan)', textDecoration: 'none', fontWeight: 700 }}>track →</a>
        </div>
      ) : (
        <a href="/member/profile" style={{ margin: 0, fontSize: 11.5, color: 'var(--cyan)', textDecoration: 'none', fontWeight: 700 }}>See how it works & track your earnings →</a>
      )}
    </section>
  );
}

const ctaGold = {
  padding: '14px 16px', borderRadius: 13, border: 'none', cursor: 'pointer', textAlign: 'center',
  fontWeight: 800, letterSpacing: 0.6, fontSize: 14, color: '#0b0e14',
  background: 'linear-gradient(90deg,#ffd166,#f5a623)', boxShadow: '0 8px 26px rgba(245,166,35,.28)',
} as const;
const ctaGhost = {
  padding: '12px 16px', borderRadius: 13, textAlign: 'center', textDecoration: 'none', display: 'block',
  fontWeight: 700, letterSpacing: 0.4, fontSize: 13, color: 'var(--cyan)',
  border: '1px solid rgba(43,227,245,.4)', background: 'rgba(43,227,245,.06)',
} as const;
