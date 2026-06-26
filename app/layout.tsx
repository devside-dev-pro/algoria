import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Algoria AI',
  description: 'Cockpit de trading IA spécialisé or (XAU/USD)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
