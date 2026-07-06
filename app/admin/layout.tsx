import type { Metadata, Viewport } from 'next';

// BACK-OFFICE CRM (admin.algoria.tech) — interface OPÉRATEUR, desktop-first, hors de la coque membre :
// plus de nav mobile Home/History/…, un vrai outil de gestion (file STH, CRM membres, affiliation, outils).
export const metadata: Metadata = {
  title: 'Algoria Admin',
  description: 'Algoria back-office — members CRM, STH queue, affiliate money.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#08101f', width: 'device-width', initialScale: 1 };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
