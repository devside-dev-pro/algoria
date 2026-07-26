// CARTE DE GAIN SERVEUR (/api/card/win?ticket=…&strategy=…) — le visuel « flex » du Win Card Studio,
// rendu par ImageResponse (Satori) pour que le RUNNER puisse poster une photo dans le VIP à chaque TP
// (Telegram va chercher cette URL lui-même). ANTI-FALSIFICATION : les chiffres ne viennent JAMAIS de
// l'URL — on charge le trade RÉEL en base par (ticket, strategy) et on ne rend que les gains clôturés.
// Une URL bricolée avec un faux montant est donc impossible : pas de trade → 404.
import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PAS d'emoji ni de symboles ▲▼ sur la carte : Satori ne rend que les glyphes présents dans la police
// chargée (Space Grotesk) — un caractère absent devient un « ? » (vécu 26/07 : ▲ et 🌱 cassés). Flèche =
// triangle CSS, tag stratégie = texte + puce colorée.
const STRAT_NAME: Record<number, string> = { 1: 'S1 STEADY', 2: 'S2 BALANCED', 3: 'S3 TURBO' };
const STRAT_DOT: Record<number, string> = { 1: '#22e0a6', 2: '#2be3f5', 3: '#f5a623' };
const symLabel = (s: string) => (s === 'XAUUSD' ? 'GOLD' : s === 'BTCUSD' ? 'BITCOIN' : s);
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

// Polices (Satori ne synthétise pas le gras) : chargées une fois par instance, repli police par défaut
// si unpkg est injoignable — la carte part quand même, jamais d'échec pour une police.
let fontsCache: Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }> | null | undefined;
async function loadFonts() {
  if (fontsCache !== undefined) return fontsCache ?? undefined;
  try {
    const get = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`font ${r.status}`);
      return r.arrayBuffer();
    };
    const [bold, reg] = await Promise.all([
      get('https://unpkg.com/@fontsource/space-grotesk@5.0.16/files/space-grotesk-latin-700-normal.woff'),
      get('https://unpkg.com/@fontsource/space-grotesk@5.0.16/files/space-grotesk-latin-500-normal.woff'),
    ]);
    fontsCache = [
      { name: 'Grotesk', data: bold, weight: 700, style: 'normal' },
      { name: 'Grotesk', data: reg, weight: 400, style: 'normal' },
    ];
  } catch {
    fontsCache = null; // repli : police par défaut de Satori
  }
  return fontsCache ?? undefined;
}

export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get('ticket') ?? '';
  const strategy = Number(req.nextUrl.searchParams.get('strategy') ?? 0);
  if (!ticket || ![1, 2, 3].includes(strategy)) return new Response('bad request', { status: 400 });

  // le trade RÉEL — uniquement des gains clôturés (la carte n'existe pas pour autre chose)
  const { data } = await sdb().from('trades')
    .select('symbol,direction,pnl,closed_at')
    .eq('ticket', ticket).eq('strategy' as never, strategy as never)
    .not('closed_at', 'is', null).gt('pnl', 0).limit(1);
  const t = data?.[0];
  if (!t) return new Response('not found', { status: 404 });

  const pnl = Math.round(Number(t.pnl));
  const isLong = String(t.direction) === 'long';
  const qrSvg = await QRCode.toString('https://algoria.tech', { type: 'svg', margin: 1, color: { dark: '#0b0e14', light: '#ffffff' } });
  const qrUri = `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}`;
  // logo (filigrane + en-tête) — best-effort : la carte se rend sans si l'asset est injoignable
  let markUri: string | null = null;
  try {
    const r = await fetch(new URL('/brand/algoria-mark.png', req.nextUrl.origin));
    if (r.ok) markUri = `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch { /* sans logo */ }

  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 675, display: 'flex', position: 'relative', backgroundImage: 'linear-gradient(180deg, #10223e 0%, #0a1322 50%, #070b12 100%)', fontFamily: 'Grotesk' }}>
        {/* halos (cyan en-tête, vert sur le P&L) */}
        <div style={{ position: 'absolute', left: -140, top: -240, width: 660, height: 660, borderRadius: 330, backgroundImage: 'radial-gradient(circle, rgba(43,227,245,.14) 0%, rgba(43,227,245,0) 70%)' }} />
        <div style={{ position: 'absolute', left: 90, top: 70, width: 660, height: 660, borderRadius: 330, backgroundImage: 'radial-gradient(circle, rgba(34,224,166,.12) 0%, rgba(34,224,166,0) 70%)' }} />
        {/* filigrane marque à droite */}
        {markUri && <img src={markUri} width={430} height={430} style={{ position: 'absolute', right: 40, top: 122, opacity: 0.08 }} />}

        {/* en-tête : logo + ALGORIA + tagline */}
        <div style={{ position: 'absolute', left: 56, top: 40, display: 'flex', alignItems: 'center' }}>
          {markUri && <img src={markUri} width={58} height={58} />}
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14 }}>
            <span style={{ fontSize: 44, fontWeight: 700, backgroundImage: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', backgroundClip: 'text', color: 'transparent' }}>ALGORIA</span>
            <span style={{ fontSize: 20, color: 'rgba(147,165,196,.9)', letterSpacing: 2 }}>AI COPY TRADING · REAL ACCOUNT</span>
          </div>
        </div>

        {/* le trade + le P&L héros — lineHeight:1 PARTOUT (sinon la ligne du gros chiffre déborde et
            chevauche le bloc QR — vécu au premier rendu) */}
        <div style={{ position: 'absolute', left: 60, top: 178, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* flèche = triangle CSS (aucun glyphe de police) */}
            <div style={isLong
              ? { width: 0, height: 0, borderLeft: '20px solid transparent', borderRight: '20px solid transparent', borderBottom: '34px solid #22e0a6' }
              : { width: 0, height: 0, borderLeft: '20px solid transparent', borderRight: '20px solid transparent', borderTop: '34px solid #ff6b8a' }} />
            <span style={{ fontSize: 46, fontWeight: 700, color: isLong ? '#22e0a6' : '#ff6b8a', letterSpacing: 3, lineHeight: 1, marginLeft: 22 }}>
              {isLong ? 'LONG' : 'SHORT'}  {symLabel(String(t.symbol))}
            </span>
          </div>
          <span style={{ fontSize: 138, fontWeight: 700, color: '#22e0a6', lineHeight: 1, marginTop: 18, textShadow: '0 0 45px rgba(34,224,166,.5)' }}>+${pnl.toLocaleString('en-US')}</span>
          <span style={{ fontSize: 24, color: '#f5c24a', letterSpacing: 3, lineHeight: 1, marginTop: 20 }}>PROFIT BANKED AUTOMATICALLY</span>
        </div>

        {/* QR + pitch (bloc « parrainage » Binance) */}
        <div style={{ position: 'absolute', left: 60, bottom: 44, display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', backgroundColor: '#ffffff', borderRadius: 20, padding: 12 }}>
            <img src={qrUri} width={138} height={138} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 38, marginTop: 16 }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: '#e8f0ff', lineHeight: 1 }}>Watch the AI trade live — free.</span>
            <span style={{ fontSize: 22, color: 'rgba(147,165,196,.9)', lineHeight: 1, marginTop: 12 }}>Scan to get in.</span>
            <span style={{ fontSize: 26, fontWeight: 700, color: '#2be3f5', lineHeight: 1, marginTop: 18 }}>algoria.tech</span>
          </div>
        </div>

        {/* stratégie (clarté multi-stratégies, puce colorée — pas d'emoji) + date de clôture, bas-droite */}
        <div style={{ position: 'absolute', right: 48, bottom: 44, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: STRAT_DOT[strategy] }} />
            <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(232,240,255,.85)', letterSpacing: 1, lineHeight: 1, marginLeft: 10 }}>{STRAT_NAME[strategy]}</span>
          </div>
          {t.closed_at && <span style={{ fontSize: 20, color: 'rgba(147,165,196,.7)', lineHeight: 1, marginTop: 12 }}>Closed: {fmtDate(String(t.closed_at))}</span>}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 675,
      fonts,
      // cache 1 jour (CDN Vercel) : assez pour Telegram et les re-forwards, mais permet d'itérer sur le
      // design sans servir des vieilles cartes pendant un an (l'immutable a mordu au premier fix visuel)
      headers: { 'cache-control': 'public, max-age=86400' },
    },
  );
}
