// algoria.tech/track-record — page PUBLIQUE partageable aux prospects. Depuis le 24/09/2026 elle montre le
// VRAI historique du compte qu'Algoria copie (depuis le lancement, juillet 2026), plus la simulation d'avant.
// L'ancienne URL /backtest a circulé : next.config.mjs la redirige ici (308, permanente), aucun lien ne casse.
// Sur app.algoria.tech, le middleware réécrit /track-record vers l'écran in-app — même lien, bonne page.
// Le rendu vit dans components/TrackRecord.tsx, partagé avec l'écran in-app : une seule version des chiffres.
import type { Metadata } from 'next';
import { TrackRecord } from '@/components/TrackRecord';

export const metadata: Metadata = {
  metadataBase: new URL('https://algoria.tech'),
  title: 'Algoria — Track Record (real account)',
  description: 'Every trade of the real MetaTrader 5 account Algoria copies, since launch in July 2026 — in % or in $ at the lot size you choose. Red months and drawdowns included.',
  openGraph: {
    title: 'Algoria — Track Record',
    description: 'The real account Algoria copies, since July 2026 — every trade, red months included. See it in % or in $ at your lot size.',
    type: 'website',
    url: 'https://algoria.tech/track-record',
    siteName: 'Algoria AI',
    images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: 'Algoria AI — track record' }],
  },
  twitter: { card: 'summary_large_image', title: 'Algoria — Track Record', description: 'The real account Algoria copies, since July 2026 — red months included.', images: ['/brand/og.png'] },
};

export default function TrackRecordPage() {
  return (
    <main style={{ minHeight: '100dvh', background: 'radial-gradient(120% 60% at 50% -8%, #10223e 0%, transparent 55%), #070b12', color: 'var(--text)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px 56px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <a href="https://algoria.tech" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <img src="/brand/algoria-mark.png" alt="" width={32} height={32} style={{ filter: 'drop-shadow(0 0 10px rgba(43,227,245,.4))' }} />
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.4, color: 'var(--cyan)' }}>ALGORIA</span>
        </a>
        <TrackRecord />
        <a href="https://algoria.tech" style={{ alignSelf: 'stretch', textAlign: 'center', padding: '13px 16px', borderRadius: 12, border: '1px solid rgba(43,227,245,.35)', background: 'rgba(43,227,245,.08)', color: 'var(--cyan)', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' }}>
          Watch Algoria trade live — free →
        </a>
      </div>
    </main>
  );
}
