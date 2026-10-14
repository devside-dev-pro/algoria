import { NextResponse, type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';
import { MASTER_TRACK_FROM } from '@/lib/track/source';
import { loadMaster } from '../master';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// LE DÉTAIL TRADE PAR TRADE D'UN MOIS DU TRACK RECORD (14/10/2026, décision Mathieu : à partir d'octobre 2026,
// les mois du master). Un prospect à qui le bot avait promis « chaque trade, entrée, sortie, gain ou perte »
// n'a trouvé que le total et le mois par mois : la page dit maintenant ce qu'on dit d'elle.
// Même source et même calcul que le mois affiché au-dessus (master.ts) : la liste ne peut pas le contredire.
// `u` = résultat ramené à 1 lot (l'écran le multiplie par le lot choisi) ; `fee` = le swap du jour, compté à
// 1 lot comme dans la courbe (le master trade 1 lot). Les jours vont du plus récent au plus ancien.
const r2 = (x: number) => Math.round(x * 100) / 100;
const lotOf = (lot: unknown) => (Number(lot) > 0 ? Number(lot) : 1);

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < MASTER_TRACK_FROM.slice(0, 7)) {
    return NextResponse.json({ error: `trade-by-trade detail starts in ${MASTER_TRACK_FROM.slice(0, 7)}` }, { status: 400 });
  }
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const db = sdb() as unknown as Parameters<typeof loadMaster>[0];
  let master: Awaited<ReturnType<typeof loadMaster>>;
  try { master = await loadMaster(db, `${month}-01`, next); } catch (e) { return NextResponse.json({ error: String((e as Error).message) }, { status: 500 }); }
  const days = master.days.map((d) => ({
    d: d.d,
    fee: r2(d.fee),
    trades: d.trades.map((t) => ({
      c: t.closed_at, o: t.opened_at, dir: t.direction === 'short' ? 'sell' : t.direction === 'long' ? 'buy' : null, // null : ligne de clôture seule, sens inconnu
      entry: t.entry == null ? null : Number(t.entry), exit: t.exit == null ? null : Number(t.exit),
      u: r2(Number(t.pnl) / lotOf(t.lot)), reason: t.reason ?? null,
    })).reverse(),
  })).reverse();
  const res = NextResponse.json({ month, days });
  res.headers.set('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  return res;
}
