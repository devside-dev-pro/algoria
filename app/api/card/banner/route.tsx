// BANNIÈRE DES POSTS DU CANAL (15/10/2026, Mathieu : « ça manque de couleurs, de bannières, ça fait très texte et
// robot »). Chaque How it works et chaque CTA du CM (lib/channel/cm.ts) part avec une bannière aux couleurs d'Algoria :
// le titre du post en grand, son étiquette, le QR algoria.tech. Même famille visuelle que la carte de gain (/api/card/win).
// ANTI-DÉTOURNEMENT : aucun texte ne vient de l'URL. On charge le post RÉEL (channel_posts, par son id) : impossible de
// fabriquer une bannière Algoria avec un texte arbitraire. `v` ne sert qu'à casser le cache quand le texte change.
// PAS D'EMOJI : Satori ne rend que les glyphes de la police (voir /api/card/win) ; le titre est nettoyé.
import { type NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { sdb } from '@/lib/member/server';
import { loadFonts } from '@/lib/cards/ogFonts';
import { bannerParts } from '@/lib/channel/cm';
import { renderBanner } from '@/lib/cards/banner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('post') ?? 0);
  if (!Number.isFinite(id) || id <= 0) return new Response('bad request', { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sdb() as any).from('channel_posts').select('id,kind,text,button_text,report,day').eq('id', id).limit(1);
  const row = data?.[0] as { id: number; kind: string; text: string | null; button_text: string | null; report: { variant?: number } | null; day: string } | undefined;
  if (!row || !['morning', 'howto', 'cta'].includes(row.kind)) return new Response('not found', { status: 404 });
  const { kicker, title } = bannerParts(row);

  const qrSvg = await QRCode.toString('https://algoria.tech', { type: 'svg', margin: 1, color: { dark: '#0b0e14', light: '#ffffff' } });
  const qrUri = `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}`;
  let markUri: string | null = null;
  try {
    const r = await fetch(new URL('/brand/algoria-mark.png', req.nextUrl.origin));
    if (r.ok) markUri = `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch { /* sans logo */ }
  const fonts = await loadFonts();

  return renderBanner({ kicker, title, theme: row.id + Number(row.report?.variant ?? 0), qrUri, markUri, fonts });
}
