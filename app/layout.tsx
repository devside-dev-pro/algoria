import './globals.css';
import type { ReactNode } from 'react';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';

// Polices self-hosted (next/font) → zéro requête runtime, zéro FOUT au démarrage du stream (le décalage serait gravé sur l'enregistrement).
const display = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'Algoria AI — l\'IA qui trade l\'or & le Nasdaq, en direct',
  description: 'Trades réels exécutés en autonomie 24/5. Analyses, signaux et résultats gratuitement dans le canal Telegram. Rejoins gratuitement.',
  openGraph: {
    title: 'Algoria AI — trading IA en direct',
    description: 'Or & Nasdaq tradés par une IA, en direct. Rejoins le canal Telegram gratuit.',
    type: 'website',
  },
};

export const viewport = { themeColor: '#08101f' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
