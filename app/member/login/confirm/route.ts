import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/member/server';
import { consumeLoginCode, SESSION_COOKIE_OPTS } from '@/lib/member/login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CONNEXION EN UN TAP DEPUIS TELEGRAM — la cible du bouton « Open Algoria » que le bot envoie juste après
// le START (voir app/api/telegram/route.ts). Raison d'être : un lien vers app.algoria.tech cliqué dans
// Telegram s'ouvre dans le navigateur INTÉGRÉ de Telegram ; le login natif renvoie alors la personne sur
// Telegram pour taper START, ce qui emporte l'onglet qui interrogeait le serveur. La connexion réussit
// côté bot mais ne se termine jamais côté app — la personne reste bloquée sur l'écran d'attente.
// On ne peut PAS forcer un navigateur externe depuis Telegram sur iPhone (aucune API Apple ; le
// intent:// d'Android ne couvrirait que la moitié des membres). Le bouton supprime donc l'aller-retour :
// la personne tape dans la conversation où elle est DÉJÀ, et atterrit connectée.
// Le polling de /member/login reste en place — c'est le chemin normal quand l'onglet a survécu.

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('c') ?? '';
  const home = new URL('/member', req.url);
  // allowUsed : si le polling a déjà consommé le code (onglet survivant), le bouton ne doit PAS rejeter
  // la personne — les deux portes mènent à la même session, dans la même fenêtre de 10 minutes.
  const out = await consumeLoginCode(req, code, { allowUsed: true });
  if (out.kind === 'denied') return NextResponse.redirect(new URL('/member/denied', req.url));
  if (out.kind !== 'ok') {
    // code inconnu, périmé ou pas encore confirmé → on renvoie sur le login avec un motif affichable
    const back = new URL('/member/login', req.url);
    back.searchParams.set('e', out.kind === 'expired' ? 'expired' : 'retry');
    return NextResponse.redirect(back);
  }
  const res = NextResponse.redirect(home);
  res.cookies.set(SESSION_COOKIE, out.session, SESSION_COOKIE_OPTS);
  return res;
}
