import type { Metadata, Viewport } from 'next';
import { MemberChrome } from './ui';

// Espace MEMBRE (PWA app.algoria.tech) — back-office des membres : statut de copie, risque, flux IA, académie.
// Rien ici ne touche au cockpit opérateur (/app) : frontière structurelle, les membres n'y ont pas accès.
export const metadata: Metadata = {
  title: 'Algoria Members',
  description: 'Your Algoria member dashboard — copying status, risk control, live AI feed.',
  manifest: '/member-manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Algoria' },
  icons: { icon: '/icons/member-192.png', apple: '/icons/apple-touch.png' },
};
export const viewport: Viewport = { themeColor: '#08101f', width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return <MemberChrome>{children}</MemberChrome>;
}
