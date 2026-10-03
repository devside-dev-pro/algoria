// CARTE D'INVITATION (/api/card/invite?c=<code>) — l'aperçu de lien d'un lien de parrainage simple (02/10/2026).
// Avant, WhatsApp montrait l'image générale du site (« gold & Bitcoin, live… join the Telegram channel ») :
// une promesse qui ne correspond plus au chemin (l'ami arrive sur l'app) et rien de personnel. Ici : le prénom du
// parrain, lu en base à partir de son code (jamais un nom pris dans l'URL), et ce qu'est Algoria en une ligne.
// Pas d'emoji ni de flèche : Satori ne rend que les glyphes de la police chargée (voir /api/card/win).
import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';
import { loadFonts } from '@/lib/cards/ogFonts';
import { REF_CODE_RE } from '@/lib/member/login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function firstName(code: string): Promise<string | null> {
  if (!REF_CODE_RE.test(code)) return null;
  try {
    const { data } = await sdb().from('members').select('tg_name').eq('referral_code', code).limit(1);
    const first = String((data?.[0] as { tg_name?: string | null } | undefined)?.tg_name ?? '').trim().split(/\s+/)[0] ?? '';
    // lettres latines seulement : un prénom en écriture que la police n'a pas sortirait en « ? »
    return first.length >= 2 && first.length <= 16 && /^[A-Za-zÀ-ÿ'-]+$/.test(first) ? first : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get('c') ?? '').toLowerCase();
  const name = await firstName(code);
  let markUri: string | null = null;
  try {
    const r = await fetch(new URL('/brand/algoria-mark.png', req.nextUrl.origin));
    if (r.ok) markUri = `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch { /* sans logo */ }
  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: 'flex', position: 'relative', backgroundImage: 'linear-gradient(180deg, #10223e 0%, #0a1322 50%, #070b12 100%)', fontFamily: 'Grotesk' }}>
        <div style={{ position: 'absolute', left: -160, top: -260, width: 700, height: 700, borderRadius: 350, backgroundImage: 'radial-gradient(circle, rgba(43,227,245,.16) 0%, rgba(43,227,245,0) 70%)' }} />
        <div style={{ position: 'absolute', right: -120, bottom: -260, width: 700, height: 700, borderRadius: 350, backgroundImage: 'radial-gradient(circle, rgba(245,194,74,.12) 0%, rgba(245,194,74,0) 70%)' }} />
        {markUri && <img src={markUri} width={420} height={420} style={{ position: 'absolute', right: 50, top: 105, opacity: 0.08 }} />}

        <div style={{ position: 'absolute', left: 64, top: 52, display: 'flex', alignItems: 'center' }}>
          {markUri && <img src={markUri} width={58} height={58} />}
          <span style={{ fontSize: 44, fontWeight: 700, marginLeft: 14, backgroundImage: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', backgroundClip: 'text', color: 'transparent' }}>ALGORIA</span>
        </div>

        <div style={{ position: 'absolute', left: 64, top: 190, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 26, color: '#f5c24a', letterSpacing: 4, lineHeight: 1 }}>YOU&apos;VE BEEN INVITED</span>
          <span style={{ fontSize: 84, fontWeight: 700, color: '#e8f0ff', lineHeight: 1.05, marginTop: 22, maxWidth: 900 }}>
            {name ? `${name} invited you` : 'A friend invited you'}
          </span>
          <span style={{ fontSize: 34, color: 'rgba(200,214,236,.9)', lineHeight: 1.3, marginTop: 26, maxWidth: 860 }}>
            The AI trades gold. Your account copies every trade, automatically.
          </span>
        </div>

        <div style={{ position: 'absolute', left: 64, bottom: 56, display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', padding: '12px 24px', borderRadius: 999, border: '2px solid rgba(43,227,245,.5)', backgroundColor: 'rgba(43,227,245,.08)' }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#2be3f5', letterSpacing: 2, lineHeight: 1 }}>FREE TO SIGN IN · REAL ACCOUNT · LIVE</span>
          </div>
          <span style={{ fontSize: 26, fontWeight: 700, color: 'rgba(232,240,255,.85)', marginLeft: 28, lineHeight: 1 }}>app.algoria.tech</span>
        </div>
        <span style={{ position: 'absolute', right: 56, bottom: 30, fontSize: 16, color: 'rgba(147,165,196,.55)', lineHeight: 1 }}>Trading involves risk.</span>
      </div>
    ),
    { width: 1200, height: 630, fonts, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}
