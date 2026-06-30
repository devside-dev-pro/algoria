import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Algoria AI',
  description: 'AI gold (XAU/USD) trading cockpit',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
