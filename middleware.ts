import { NextResponse, type NextRequest } from 'next/server';

// ATTRIBUTION D'ACQUISITION (premier contact gagne) : ?utm_source=meta&utm_campaign=uk-july (ou ?src=…)
// → cookie alg_src posé sur .getalgoria.com (suit le visiteur de la landing au sous-domaine app) — relu à la
// CRÉATION de la fiche membre (tglogin) puis figé. Cross-device (ads → Telegram → autre appareil) non
// couvert : attribution partielle assumée, les canaux qui pointent vers l'app sont eux 100 % traçables.
const clean = (v: string | null, max: number) => (v ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, max);
function withAttribution(req: NextRequest, res: NextResponse): NextResponse {
  if (req.cookies.get('alg_src')?.value) return res; // premier contact gagne — jamais réécrit
  const q = req.nextUrl.searchParams;
  const src = clean(q.get('utm_source') ?? q.get('src'), 24);
  if (!src) return res;
  const camp = clean(q.get('utm_campaign'), 32);
  res.cookies.set('alg_src', camp ? `${src}:${camp}` : src, { domain: '.getalgoria.com', path: '/', maxAge: 30 * 86_400, sameSite: 'lax' });
  return res;
}

// app.getalgoria.com → espace MEMBRE (/member/*) · admin.getalgoria.com → back-office CRM (/admin).
// Le domaine principal garde le funnel (/) et le cockpit (/app). /api, /_next et les statiques passent tels quels.
export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase();
  const url = req.nextUrl.clone();
  if (host.startsWith('admin.')) {
    // la racine du sous-domaine → CRM ; /member/* reste accessible (login Telegram de la session admin)
    if (url.pathname.startsWith('/member') || url.pathname.startsWith('/admin')) return withAttribution(req, NextResponse.next());
    url.pathname = url.pathname === '/' ? '/admin' : `/member${url.pathname}`;
    return withAttribution(req, NextResponse.rewrite(url));
  }
  if (host.startsWith('app.')) {
    // la fiche store /download vit aussi sur ce sous-domaine (la popup membre y renvoie en relatif —
    // sans ça, app.getalgoria.com/download était réécrit en /member/download → 404)
    // (24/10/2026) les pages légales aussi : l'étape du mot de passe MT5 y renvoie (voir lib/legal.ts) ; et la page
    // d'inscription aux webinaires, partagée sous les deux adresses
    if (['/download', '/terms', '/privacy', '/risk', '/webinar'].includes(url.pathname)) return withAttribution(req, NextResponse.next());
    if (!url.pathname.startsWith('/member')) {
      url.pathname = `/member${url.pathname === '/' ? '' : url.pathname}`;
      return withAttribution(req, NextResponse.rewrite(url));
    }
  }
  return withAttribution(req, NextResponse.next());
}

export const config = {
  // tout sauf api, assets Next, fichiers statiques (manifest, icônes, service worker…)
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
