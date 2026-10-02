import { NextResponse, type NextRequest } from 'next/server';
import { sdb, verifySession, SESSION_COOKIE, isAdmin } from '@/lib/member/server';
import { buildRecap, draftTonight, parisDay, parisHour } from '@/lib/channel/recap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 📣 RÉCAP DU SOIR (02/10/2026) — voir lib/channel/recap.ts.
// Appelé par pg_cron (migration 0020) à 19:15 ET 20:15 UTC : l'un des deux tombe à 21h15 à Paris selon l'heure
// d'été ou d'hiver, l'autre est refusé par le contrôle d'heure ci-dessous. Pas de secret à partager avec la base :
// l'appel ne fait que préparer LE brouillon du jour (une fois, clé = le jour) et l'envoyer aux admins ; rien n'est
// publié sans un clic sur ✅. Un appel hors de la fenêtre de 21h ne fait rien.
// GET ?preview=1 (session admin) → le récap du jour tel qu'il serait, sans rien enregistrer ni envoyer.
export async function GET(req: NextRequest) {
  const db = sdb();
  if (req.nextUrl.searchParams.get('preview')) {
    const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!s || !isAdmin(s.username)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.nextUrl.searchParams.get('day') ?? '') ? String(req.nextUrl.searchParams.get('day')) : parisDay(new Date());
    return NextResponse.json({ recap: await buildRecap(db, day) });
  }
  if (parisHour() !== 21) return NextResponse.json({ ok: true, status: 'outside the 21h window' });
  try {
    return NextResponse.json({ ok: true, ...(await draftTonight(db)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
