import './globals.css';
import type { ReactNode } from 'react';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';

// Polices self-hosted (next/font) → zéro requête runtime, zéro FOUT au démarrage du stream (le décalage serait gravé sur l'enregistrement).
const display = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'Algoria AI — the AI that trades gold & the Nasdaq, live',
  description: 'Real trades executed autonomously 24/5. Analysis, signals and results, free in the Telegram channel. Join for free.',
  openGraph: {
    title: 'Algoria AI — live AI trading',
    description: 'Gold & Nasdaq traded by an AI, live. Join the free Telegram channel.',
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
