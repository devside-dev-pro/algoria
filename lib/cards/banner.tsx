// LE RENDU DE LA BANNIÈRE DES POSTS DU CANAL — voir app/api/card/banner/route.tsx (qui charge le post et appelle ceci).
import { ImageResponse } from 'next/og';

// quatre ambiances aux couleurs de la marque, alternées d'un post à l'autre
const THEMES = [
  { a: '#2be3f5', b: '#2e8bf0', bg: 'linear-gradient(160deg, #10223e 0%, #0a1322 55%, #070b12 100%)', halo: 'rgba(43,227,245,.16)', halo2: 'rgba(46,139,240,.14)' },
  { a: '#f5c24a', b: '#ff9f43', bg: 'linear-gradient(160deg, #2a1f0c 0%, #141008 55%, #090705 100%)', halo: 'rgba(245,194,74,.18)', halo2: 'rgba(255,159,67,.12)' },
  { a: '#22e0a6', b: '#2be3f5', bg: 'linear-gradient(160deg, #0b2a26 0%, #08161a 55%, #05090c 100%)', halo: 'rgba(34,224,166,.16)', halo2: 'rgba(43,227,245,.12)' },
  { a: '#9b8cff', b: '#2e8bf0', bg: 'linear-gradient(160deg, #1a1640 0%, #0d0b22 55%, #07060f 100%)', halo: 'rgba(155,140,255,.18)', halo2: 'rgba(46,139,240,.12)' },
];

export function renderBanner(o: { kicker: string; title: string; theme: number; qrUri: string; markUri: string | null; fonts?: Awaited<ReturnType<typeof import('./ogFonts').loadFonts>> }) {
  const { kicker, title, qrUri, markUri, fonts } = o;
  const th = THEMES[((o.theme % THEMES.length) + THEMES.length) % THEMES.length];
  const size = title.length <= 26 ? 92 : title.length <= 44 ? 76 : title.length <= 70 ? 62 : 52;
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 675, display: 'flex', position: 'relative', backgroundImage: th.bg, fontFamily: 'Grotesk', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: -180, top: -260, width: 760, height: 760, borderRadius: 380, backgroundImage: `radial-gradient(circle, ${th.halo} 0%, rgba(0,0,0,0) 70%)` }} />
        <div style={{ position: 'absolute', right: -220, bottom: -300, width: 820, height: 820, borderRadius: 410, backgroundImage: `radial-gradient(circle, ${th.halo2} 0%, rgba(0,0,0,0) 70%)` }} />
        {/* deux traits de lumière en diagonale, pour le mouvement */}
        <div style={{ position: 'absolute', left: 640, top: -120, width: 6, height: 980, backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0), ${th.a}, rgba(0,0,0,0))`, opacity: 0.35, transform: 'rotate(28deg)' }} />
        <div style={{ position: 'absolute', left: 760, top: -120, width: 2, height: 980, backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0), ${th.b}, rgba(0,0,0,0))`, opacity: 0.3, transform: 'rotate(28deg)' }} />
        {markUri && <img src={markUri} width={460} height={460} style={{ position: 'absolute', right: 30, top: 110, opacity: 0.09 }} />}

        {/* en-tête */}
        <div style={{ position: 'absolute', left: 56, top: 40, display: 'flex', alignItems: 'center' }}>
          {markUri && <img src={markUri} width={58} height={58} />}
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14 }}>
            <span style={{ fontSize: 44, fontWeight: 700, backgroundImage: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', backgroundClip: 'text', color: 'transparent' }}>ALGORIA</span>
            <span style={{ fontSize: 20, color: 'rgba(147,165,196,.9)', letterSpacing: 2 }}>AI COPY TRADING · REAL ACCOUNT</span>
          </div>
        </div>

        {/* étiquette + titre */}
        <div style={{ position: 'absolute', left: 60, top: 170, width: 1000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex' }}>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, color: '#06101c', backgroundImage: `linear-gradient(90deg, ${th.a}, ${th.b})`, borderRadius: 999, padding: '10px 22px', lineHeight: 1 }}>{kicker}</span>
          </div>
          <span style={{ fontSize: size, fontWeight: 700, color: '#f2f6ff', lineHeight: 1.08, marginTop: 26, textShadow: `0 0 40px ${th.halo}` }}>{title}</span>
        </div>

        {/* QR + pitch */}
        <div style={{ position: 'absolute', left: 60, bottom: 44, display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', backgroundColor: '#ffffff', borderRadius: 18, padding: 10 }}>
            <img src={qrUri} width={112} height={112} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 30, marginTop: 12 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#e8f0ff', lineHeight: 1 }}>Watch the AI trade live, free.</span>
            <span style={{ fontSize: 20, color: 'rgba(147,165,196,.9)', lineHeight: 1, marginTop: 10 }}>Scan to get in.</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: th.a, lineHeight: 1, marginTop: 14 }}>getalgoria.com</span>
          </div>
        </div>
        <div style={{ position: 'absolute', right: 48, bottom: 48, display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: th.a }} />
          <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(232,240,255,.85)', letterSpacing: 1, lineHeight: 1, marginLeft: 10 }}>ALGORIA 2.0</span>
        </div>
      </div>
    ),
    { width: 1200, height: 675, fonts, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}
