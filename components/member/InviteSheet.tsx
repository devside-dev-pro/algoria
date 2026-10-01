'use client';
// 🤝 INVITER UN AMI (02/10/2026) — le parrainage expliqué en une feuille, ouverte depuis l'accueil et le Profil.
// Avant : un bloc « 10 % du dépôt, de $20 à $200, activé, paliers » au fond du Profil, et un bouton SHARE qui
// envoyait le lien sans texte. 7 filleuls sur 1 946 inscrits. Ici : ce que ça rapporte EN DOLLARS (« ton ami
// dépose $500 → +$50 »), les 3 étapes, les paliers, et le lien prêt à partir avec un texte, en un tap.
// Aucune promesse de gain sur le trading : le texte décrit le produit et rappelle le risque.
import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MILESTONES } from '@/lib/member/affiliate';
import { MIN_ENTRY_DEPOSIT } from '@/lib/member/minimums';
import { track } from '@/lib/member/funnel';
import type { Referral } from '@/app/member/ui';

export const inviteLink = (code: string) => `https://app.algoria.tech/r/${code}`;
export const inviteText = (link: string) =>
  `I'm using Algoria: its AI trades gold and every trade is copied automatically to my account. Have a look, signing in is free 👇\n\n${link}\n\nTrading involves risk.`;
/** Ce que rapporte un filleul pour un dépôt donné : même règle que lib/member/affiliate (taux, plafond, arrondi). */
export const rewardFor = (r: Pick<Referral, 'rewardRate' | 'rewardCapUsd'>, deposit: number) => Math.min(Math.round(deposit * r.rewardRate), r.rewardCapUsd);
/** Les exemples affichés : le dépôt d'entrée, puis des montants ronds, jusqu'à celui qui atteint le plafond. */
export const exampleDeposits = (r: Pick<Referral, 'rewardRate' | 'rewardCapUsd'>) => {
  const atCap = Math.ceil(r.rewardCapUsd / r.rewardRate);
  return [...new Set([MIN_ENTRY_DEPOSIT, 500, 1000, atCap])].filter((d) => d >= MIN_ENTRY_DEPOSIT && d <= atCap).sort((a, b) => a - b);
};

const btn = (primary?: boolean): CSSProperties => ({
  padding: primary ? '14px 16px' : '12px 14px', borderRadius: 13, cursor: 'pointer', fontWeight: 800, letterSpacing: 0.4, fontSize: primary ? 14 : 13,
  textAlign: 'center', textDecoration: 'none', display: 'block',
  border: primary ? 'none' : '1px solid rgba(43,227,245,.4)', color: primary ? '#0b0e14' : 'var(--cyan)',
  background: primary ? 'linear-gradient(90deg,#ffd166,#f5a623)' : 'rgba(43,227,245,.06)',
});

export function InviteSheet({ open, referral, from, onClose }: { open: boolean; referral: Referral | null; from: 'home' | 'profile'; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (open) { setCopied(false); track('invite_open', null, { from }); } }, [open, from]);
  if (!open || !referral?.code || typeof document === 'undefined') return null;

  const link = inviteLink(referral.code);
  const text = inviteText(link);
  const pct = Math.round(referral.rewardRate * 100);
  const shareNative = async () => {
    track('invite_share', null, { channel: 'native' });
    if (navigator.share) { try { await navigator.share({ text }); return; } catch { return; /* annulé */ } }
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* le lien reste visible */ }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); track('invite_share', null, { channel: 'copy' }); } catch { /* rien */ }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(3,7,15,.78)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, borderRadius: '22px 22px 0 0', border: '1px solid rgba(245,194,74,.4)', borderBottom: 'none', background: 'linear-gradient(180deg, var(--panel-top) 0%, var(--panel-bottom) 100%)', padding: '18px 18px max(22px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '92dvh', overflowY: 'auto' }}>
        <span style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(130,152,190,.35)', margin: '0 auto' }} />
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 19 }}>🤝 Invite a friend</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
            You get <b className="goldText">{pct}% of what they deposit</b>, up to <b style={{ color: 'var(--text)' }}>${referral.rewardCapUsd}</b> per friend, paid in USDT.
          </p>
        </div>

        {/* EN DOLLARS — un pourcentage ne se projette pas, « $500 → +$50 » si */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 13px' }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)' }}>WHAT YOU GET</span>
          {exampleDeposits(referral).map((d) => (
            <div key={d} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>Your friend deposits <b style={{ color: 'var(--text)' }}>${d.toLocaleString('en-US')}</b></span>
              <span className="mono goldText" style={{ fontWeight: 800, fontSize: 14 }}>+${rewardFor(referral, d)}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[
            'Send your link to a friend',
            'They sign in and open their account, like you did',
            `Once their account is activated, your reward lands in your wallet. Withdraw from $${referral.minPayoutUsd}.`,
          ].map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 800, color: 'var(--gold)' }}>{i + 1}</span>
              <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>{s}</span>
            </div>
          ))}
        </div>

        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          🏆 {MILESTONES.map((m) => `${m.at} friends: +$${m.bonus} bonus${m.at === 10 ? ' (or an iPhone)' : ''}`).join(' · ')}
        </p>

        <span className="mono" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-strong)', fontSize: 12.5, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
          {link.replace(/^https:\/\//, '')}
        </span>
        <button onClick={() => void shareNative()} style={btn(true)}>📤 SEND MY LINK</button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => track('invite_share', null, { channel: 'whatsapp' })} style={btn()}>WhatsApp</a>
          <a href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text.replace(`\n\n${link}`, ''))}`} target="_blank" rel="noreferrer" onClick={() => track('invite_share', null, { channel: 'telegram' })} style={btn()}>Telegram</a>
        </div>
        <button onClick={() => void copy()} style={{ ...btn(), border: '1px solid var(--border)', color: copied ? 'var(--up)' : 'var(--muted)', background: 'transparent' }}>{copied ? '✓ Text + link copied' : '🔗 Copy the text + my link'}</button>

        {from === 'home' && (
          <a href="/member/profile#refer" style={{ fontSize: 12.5, color: 'var(--dim)', textAlign: 'center', textDecoration: 'none' }}>
            {referral.totalEarnedUsd > 0 ? `💰 $${referral.totalEarnedUsd} earned so far · ` : ''}My referrals & withdrawals →
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}
