import type { Metadata, Viewport } from 'next';

// PAGE STORE (algoria.tech/download) — l'installation d'une PWA n'est un réflexe pour personne :
// on la présente comme une fiche App Store (icône, note, screenshots, avis, bouton INSTALL).
// Lien direct partageable aux VIP ; la mini-popup de l'espace membre redirige ici.
// Le manifest DOIT être lié sur cette page : c'est lui qui rend la page « installable »
// (déclenche beforeinstallprompt sur Android/Chrome → vrai bouton d'installation en un tap).
export const metadata: Metadata = {
  title: 'Get the Algoria app — AI trading, live on your phone',
  description: 'Install the Algoria app: live AI trade feed, copying status, win alerts on your lock screen. Free, installs in seconds on iPhone & Android.',
  manifest: '/member-manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Algoria' },
  icons: { icon: '/icons/member-192.png', apple: '/icons/apple-touch.png' },
  openGraph: {
    title: 'Algoria — the AI trading app',
    description: 'Live AI trades, copying status and win alerts, on your phone. Free.',
    type: 'website',
  },
};
export const viewport: Viewport = { themeColor: '#08101f', width: 'device-width', initialScale: 1 };

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
