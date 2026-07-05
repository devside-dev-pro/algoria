import { NextResponse, type NextRequest } from 'next/server';

// app.algoria.tech → espace MEMBRE (/member/*) · admin.algoria.tech → back-office (/member/admin).
// Le domaine principal garde le funnel (/) et le cockpit (/app). /api, /_next et les statiques passent tels quels.
export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase();
  const url = req.nextUrl.clone();
  if (host.startsWith('admin.')) {
    // tout le sous-domaine admin pointe sur le back-office (le login membre reste accessible pour la session)
    if (!url.pathname.startsWith('/member')) {
      url.pathname = url.pathname === '/' ? '/member/admin' : `/member${url.pathname}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }
  if (host.startsWith('app.')) {
    // la fiche store /download vit aussi sur ce sous-domaine (la popup membre y renvoie en relatif —
    // sans ça, app.algoria.tech/download était réécrit en /member/download → 404)
    if (url.pathname === '/download') return NextResponse.next();
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
