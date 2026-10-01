'use client';
// 📤 PARTAGER UN GAIN (01/10/2026) — « faire de la card de gain un outil d'acquisition ». La card existait déjà
// (lib/cards/winCard.ts, QR = lien de parrainage du membre) mais seulement en paysage, au fond de l'Historique,
// sans le lien dans le texte. Ici : aperçu, format story (statut WhatsApp / Insta) ou large, texte prêt avec SON
// lien, et WhatsApp / Telegram / copier en un tap. Montant toujours à 0.10 lot (jamais la taille du compte),
// passé réel uniquement, rappel de risque dans le texte.
import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { drawWinCard, shareOrDownloadCard, type CardFormat } from '@/lib/cards/winCard';
import { REF_LABEL } from '@/lib/display/scale';
import { track } from '@/lib/member/funnel';

export type ShareableWin = { ticket: string; symbol: string; direction: string; refPnl: number; closedAt: string };
const RISK = 'Trading involves risk. Past results don\'t guarantee future results.';
const asset = (s: string) => (/XAU|GOLD/i.test(s) ? 'gold' : /BTC/i.test(s) ? 'Bitcoin' : s);

export function shareText(w: ShareableWin, link: string, copying: boolean): string {
  const amount = `+$${Math.round(w.refPnl)}`;
  return [
    copying
      ? `Algoria's AI just closed ${amount} on ${asset(w.symbol)} (at ${REF_LABEL}), copied automatically to my account. I didn't touch a thing.`
      : `Algoria's AI just closed ${amount} on ${asset(w.symbol)} (at ${REF_LABEL}).`,
    `Start with my link: ${link}`,
    RISK,
  ].join('\n\n');
}

const btn = (primary?: boolean): CSSProperties => ({
  padding: primary ? '14px 16px' : '12px 14px', borderRadius: 13, cursor: 'pointer', fontWeight: 800, letterSpacing: 0.4, fontSize: primary ? 14 : 13,
  textAlign: 'center', textDecoration: 'none', display: 'block',
  border: primary ? 'none' : '1px solid rgba(43,227,245,.4)', color: primary ? '#0b0e14' : 'var(--cyan)',
  background: primary ? 'linear-gradient(90deg,#2be3f5,#22c55e)' : 'rgba(43,227,245,.06)',
});

export function ShareWinSheet({ win, code, copying, rewardRate, onClose }: { win: ShareableWin | null; code: string | null; copying: boolean; rewardRate?: number | null; onClose: () => void }) {
  const [format, setFormat] = useState<CardFormat>('story');
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [copied, setCopied] = useState(false);
  const link = code ? `https://app.algoria.tech/r/${code}` : 'https://algoria.tech';
  const text = win ? shareText(win, link, copying) : '';

  useEffect(() => {
    if (!win) return;
    let alive = true;
    let url: string | null = null;
    setPreview(null);
    void drawWinCard({
      symbol: win.symbol, direction: win.direction, pnl: win.refPnl, closedAt: win.closedAt, format,
      qrUrl: link, qrLabel: link.replace(/^https:\/\//, ''),
    }).then((blob) => { if (!alive) return; url = URL.createObjectURL(blob); setPreview({ url, blob }); }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [win, format, link]);
  useEffect(() => { if (win) track('share_open', null, { ticket: win.ticket }); }, [win]);
  if (!win || typeof document === 'undefined') return null;

  const shareImage = async () => {
    if (!preview) return;
    const file = new File([preview.blob], `algoria-win-${win.ticket}-${format}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[]; text?: string }) => boolean };
    track('share_done', null, { channel: 'image', format });
    if (nav.share && nav.canShare?.({ files: [file], text })) {
      try { await nav.share({ files: [file], text }); return; } catch { return; /* annulé */ }
    }
    await shareOrDownloadCard(preview.blob, file.name); // ordinateur : téléchargement de la card
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* le lien reste visible plus bas */ }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); track('share_done', null, { channel: 'copy' }); } catch { /* rien */ }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(3,7,15,.78)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, borderRadius: '22px 22px 0 0', border: '1px solid rgba(43,227,245,.32)', borderBottom: 'none', background: 'linear-gradient(180deg, var(--panel-top) 0%, var(--panel-bottom) 100%)', padding: '18px 18px max(22px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '92dvh', overflowY: 'auto' }}>
        <span style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(130,152,190,.35)', margin: '0 auto' }} />
        <h2 style={{ margin: 0, fontSize: 18, textAlign: 'center' }}>📤 Share this win</h2>
        {code && rewardRate ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
            The QR and the link are <b style={{ color: 'var(--text)' }}>yours</b>: you earn <b className="goldText">{Math.round(rewardRate * 100)}% of what each friend deposits</b> once their account is activated.
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          {(['story', 'landscape'] as CardFormat[]).map((f) => (
            <button key={f} onClick={() => setFormat(f)} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${format === f ? 'var(--cyan)' : 'var(--border)'}`, background: format === f ? 'rgba(43,227,245,.12)' : 'transparent', color: format === f ? 'var(--cyan)' : 'var(--muted)' }}>
              {f === 'story' ? 'Story · status' : 'Wide · post'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', minHeight: 160 }}>
          {preview
            ? <img src={preview.url} alt="Your win card" style={{ maxHeight: format === 'story' ? '42dvh' : 'none', maxWidth: '100%', borderRadius: 12, border: '1px solid var(--border)' }} />
            : <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--dim)' }}>preparing your card…</span>}
        </div>
        <button disabled={!preview} onClick={() => void shareImage()} style={{ ...btn(true), opacity: preview ? 1 : 0.5 }}>📤 SHARE THE CARD</button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => track('share_done', null, { channel: 'whatsapp' })} style={btn()}>WhatsApp</a>
          <a href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text.replace(`\n\nStart with my link: ${link}`, ''))}`} target="_blank" rel="noreferrer" onClick={() => track('share_done', null, { channel: 'telegram' })} style={btn()}>Telegram</a>
        </div>
        <button onClick={() => void copyLink()} style={{ ...btn(), border: '1px solid var(--border)', color: copied ? 'var(--up)' : 'var(--muted)', background: 'transparent' }}>{copied ? '✓ Text + link copied' : '🔗 Copy the text + my link'}</button>
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.5 }}>Amount shown at {REF_LABEL}, never your account size. {RISK}</p>
      </div>
    </div>,
    document.body,
  );
}
