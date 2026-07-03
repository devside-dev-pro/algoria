import { NextResponse, type NextRequest } from 'next/server';

// app.algoria.tech → espace MEMBRE (/member/*). Le domaine principal garde le funnel (/) et le cockpit (/app).
// On ne réécrit que les pages ; /api, /_next et les fichiers statiques passent tels quels.
export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase();
  if (host.startsWith('app.')) {
    const url = req.nextUrl.clone();
    if (!url.pathname.startsWith('/member')) {
      url.pathname = `/member${url.pathname === '/' ? '' : url.pathname}`;
      return NextResponse.rewrite(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  // tout sauf api, assets Next, fichiers statiques (manifest, icônes, service worker…)
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
