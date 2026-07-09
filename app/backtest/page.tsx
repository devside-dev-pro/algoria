// algoria.tech/backtest — page PUBLIQUE partageable aux prospects. Rapport de backtest clairement étiqueté
// SIMULATION (jamais présenté comme du live). Le rendu vit dans Report.tsx (client, canvas) ; ici les
// métadonnées + la carte OpenGraph pour que le lien soit propre quand il est partagé (Telegram/WhatsApp).
import type { Metadata } from 'next';
import Report from './Report';

export const metadata: Metadata = {
  metadataBase: new URL('https://algoria.tech'),
  title: 'Algoria — Strategy Backtest (historical simulation)',
  description: 'How Algoria’s gold and Bitcoin strategies performed in historical simulation — 17 months of every trade, scalp and swing on one account. A backtest, clearly labelled, not a live track record.',
  openGraph: {
    title: 'Algoria — Strategy Backtest',
    description: 'Historical simulation of the gold & Bitcoin strategies — 17 months, every trade on one account. Clearly labelled, not a live track record.',
    type: 'website',
    url: 'https://algoria.tech/backtest',
    siteName: 'Algoria AI',
    images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: 'Algoria AI — strategy backtest' }],
  },
  twitter: { card: 'summary_large_image', title: 'Algoria — Strategy Backtest', description: 'Historical simulation of the gold & Bitcoin strategies. Clearly labelled, not a live track record.', images: ['/brand/og.png'] },
};

export default function BacktestPage() {
  return <Report />;
}
