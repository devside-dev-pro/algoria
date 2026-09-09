// CARTE DU DESK (/api/card/desk?market=XAUUSD) — l'image que la CM poste et que Telegram va chercher pour
// le résumé quotidien du VIP (10/09/2026, phase 5). Rendu par ImageResponse (Satori), comme la carte de gain.
// ANTI-FALSIFICATION : rien ne vient de l'URL à part le marché. La note et le titre sont lus en base sur la
// dernière analyse publiée — une URL bricolée ne peut donc pas inventer un appel.
// C'est du CONTENU, pas une promesse : la carte porte la mention en toutes lettres, comme l'écran Desk.
// Pas d'emoji ni de ▲▼ : Satori ne rend que les glyphes de la police chargée (leçon de la carte de gain).
import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MARKETS: Record<string, string> = { XAUUSD: 'GOLD', BTCUSD: 'BITCOIN' };
// note → mot, couleur, sens de la flèche (0 = pas de flèche)
const RATING: Record<string, { word: string; color: string; dir: 1 | 0 | -1 }> = {
  Buy: { word: 'BUY', color: '#22e0a6', dir: 1 },
  Overweight: { word: 'OVERWEIGHT', color: '#22e0a6', dir: 1 },
  Hold: { word: 'HOLD', color: '#f5c24a', dir: 0 },
  Underweight: { word: 'UNDERWEIGHT', color: '#ff6b8a', dir: -1 },
  Sell: { word: 'SELL', color: '#ff6b8a', dir: -1 },
};
const rating = (r: string) => RATING[r] ?? { word: 'NO CALL', color: '#8298be', dir: 0 as const };
const fmtDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtLevel = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));

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
    fontsCache = null; // repli : police par défaut de Satori, la carte part quand même
  }
  return fontsCache ?? undefined;
}

export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get('market') ?? '';
  const market = MARKETS[asked] ? asked : 'XAUUSD';
  const db = sdb() as unknown as { from: (t: string) => any };
  const { data } = await db
    .from('desk_runs')
    .select('run_date,rating,brief')
    .eq('market', market).eq('published', true).eq('dry_run', false)
    .order('run_date', { ascending: false }).limit(1);
  const run = (data ?? [])[0] as { run_date: string; rating: string; brief: Record<string, unknown> | null } | undefined;
  if (!run) return new Response('not found', { status: 404 });

  const rt = rating(String(run.rating ?? ''));
  const brief = (run.brief ?? {}) as { headline?: string; levels?: { floor?: unknown; ceiling?: unknown } };
  const headline = String(brief.headline ?? '').slice(0, 150);
  const floor = fmtLevel(brief.levels?.floor);
  const ceiling = fmtLevel(brief.levels?.ceiling);

  let markUri: string | null = null;
  try {
    const r = await fetch(new URL('/brand/algoria-mark.png', req.nextUrl.origin));
    if (r.ok) markUri = `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch { /* sans logo */ }

  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 675, display: 'flex', position: 'relative', backgroundImage: 'linear-gradient(180deg, #10223e 0%, #0a1322 50%, #070b12 100%)', fontFamily: 'Grotesk' }}>
        <div style={{ position: 'absolute', left: -140, top: -240, width: 660, height: 660, borderRadius: 330, backgroundImage: 'radial-gradient(circle, rgba(43,227,245,.14) 0%, rgba(43,227,245,0) 70%)' }} />
        {markUri && <img src={markUri} width={430} height={430} style={{ position: 'absolute', right: 40, top: 140, opacity: 0.07 }} />}

        {/* en-tête */}
        <div style={{ position: 'absolute', left: 56, top: 40, display: 'flex', alignItems: 'center' }}>
          {markUri && <img src={markUri} width={58} height={58} />}
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14 }}>
            <span style={{ fontSize: 42, fontWeight: 700, backgroundImage: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', backgroundClip: 'text', color: 'transparent', lineHeight: 1 }}>ALGORIA DESK</span>
            <span style={{ fontSize: 19, color: 'rgba(147,165,196,.9)', letterSpacing: 2, lineHeight: 1, marginTop: 10 }}>AI ANALYST DESK · {MARKETS[market]}</span>
          </div>
        </div>
        <span style={{ position: 'absolute', right: 56, top: 58, fontSize: 21, color: 'rgba(147,165,196,.75)', letterSpacing: 1, lineHeight: 1 }}>{fmtDate(String(run.run_date))}</span>

        {/* la note + le titre en langage courant */}
        <div style={{ position: 'absolute', left: 60, top: 190, width: 1080, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {rt.dir !== 0 && (
              <svg width={38} height={34} viewBox="0 0 40 36">
                <polygon points={rt.dir === 1 ? '20,0 40,36 0,36' : '0,0 40,0 20,36'} fill={rt.color} />
              </svg>
            )}
            <span style={{ fontSize: 84, fontWeight: 700, color: rt.color, letterSpacing: 4, lineHeight: 1, marginLeft: rt.dir !== 0 ? 22 : 0, textShadow: `0 0 45px ${rt.color}55` }}>{rt.word}</span>
          </div>
          <span style={{ fontSize: 42, fontWeight: 700, color: '#e8f0ff', lineHeight: 1.25, marginTop: 30 }}>{headline}</span>
        </div>

        {/* les deux prix surveillés */}
        <div style={{ position: 'absolute', left: 60, bottom: 132, display: 'flex' }}>
          {floor && (
            <div style={{ display: 'flex', flexDirection: 'column', marginRight: 64 }}>
              <span style={{ fontSize: 17, color: 'rgba(147,165,196,.7)', letterSpacing: 2, lineHeight: 1 }}>FLOOR WATCHED</span>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#22e0a6', lineHeight: 1, marginTop: 12 }}>{floor}</span>
            </div>
          )}
          {ceiling && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 17, color: 'rgba(147,165,196,.7)', letterSpacing: 2, lineHeight: 1 }}>CEILING WATCHED</span>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#ff6b8a', lineHeight: 1, marginTop: 12 }}>{ceiling}</span>
            </div>
          )}
        </div>

        {/* pied : la mention honnête, jamais retirée */}
        <div style={{ position: 'absolute', left: 60, bottom: 48, right: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 19, color: 'rgba(147,165,196,.65)', letterSpacing: 2, lineHeight: 1 }}>READING MATERIAL, NOT A PROMISE</span>
          <span style={{ fontSize: 26, fontWeight: 700, color: '#2be3f5', lineHeight: 1 }}>algoria.tech</span>
        </div>
      </div>
    ),
    { width: 1200, height: 675, fonts, headers: { 'cache-control': 'public, max-age=3600' } },
  );
}
