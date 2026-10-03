// PAGE D'INVITATION (arrivée des liens de parrainage /r/<code>).
// 02/10/2026 — DIRECTION L'APP, plus le canal. Décision Mathieu : « on parraine son ami sur l'app, pas sur un
// canal Telegram ». L'app est ouverte à tous (gains en clair, Algoria AI, Academy, support) et la confiance,
// c'est l'ami qui l'apporte : une étape de moins. Le canal reste proposé, en petit, pour qui veut regarder avant.
// Le prénom du parrain est lu ICI, côté serveur, À PARTIR DU CODE (cookie posé par /r/, ou ?c= pour les robots
// d'aperçu qui n'ont pas de cookie) : jamais un nom pris dans l'URL, donc personne ne peut fabriquer un lien
// « Elon got you into Algoria » — seul un vrai code donne le vrai prénom de son propriétaire.
// APERÇU DE LIEN (02/10/2026) : WhatsApp / Telegram lisent l'og:image de CETTE page (après la redirection de /r/).
// Gain partagé (?w=ticket) → la carte du gain, rendue serveur avec le QR du parrain ; sinon la carte d'invitation.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { atRef, REF_LABEL } from '@/lib/display/scale';
import { sdb, verifySession, SESSION_COOKIE } from '@/lib/member/server';
import { REF_CODE_RE } from '@/lib/member/login';
import InviteView from './InviteView';

export const dynamic = 'force-dynamic';

async function referrerFirstName(code: string): Promise<string | null> {
  if (!REF_CODE_RE.test(code)) return null;
  try {
    const { data } = await sdb().from('members').select('tg_name').eq('referral_code', code).limit(1);
    const first = String((data?.[0] as { tg_name?: string | null } | undefined)?.tg_name ?? '').trim().split(/\s+/)[0] ?? '';
    // un prénom, pas un pseudo de 40 caractères ni un nom vide : sinon « A friend »
    return first.length >= 2 && first.length <= 20 ? first : null;
  } catch {
    return null;
  }
}

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const ORIGIN = 'https://app.algoria.tech';

/** Le gain partagé : uniquement un trade RÉEL, clôturé en gain (même règle anti-falsification que /api/card/win). */
async function sharedWin(ticket: string) {
  if (!/^\d{1,20}$/.test(ticket)) return null;
  try {
    const { data } = await sdb().from('trades').select('symbol,pnl,lot,strategy').eq('ticket', ticket).not('closed_at', 'is', null).gt('pnl', 0).limit(1);
    const t = data?.[0] as { symbol: string; pnl: number; lot: number | null; strategy: number | null } | undefined;
    return t ? { ...t, ref: Math.round(atRef(t.pnl, t.lot)) } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const sp = await searchParams;
  const code = one(sp.c).toLowerCase();
  const [name, win] = await Promise.all([referrerFirstName(code), sharedWin(one(sp.w))]);
  const title = `${name ?? 'A friend'} invited you to Algoria`;
  const asset = win && /XAU|GOLD/i.test(win.symbol) ? 'gold' : win && /BTC/i.test(win.symbol) ? 'Bitcoin' : 'gold';
  const description = win
    ? `Algoria's AI just closed +$${win.ref} on ${asset} (at ${REF_LABEL}). Members' accounts copy every trade automatically. Trading involves risk.`
    : "The AI trades gold live, and members' accounts copy every trade automatically. Sign in free with Telegram.";
  const ref = REF_CODE_RE.test(code) ? code : '';
  const image = win
    ? { url: `${ORIGIN}/api/card/win?ticket=${one(sp.w)}&strategy=${win.strategy ?? 2}${ref ? `&ref=${ref}` : ''}`, width: 1200, height: 675 }
    : { url: `${ORIGIN}/api/card/invite${ref ? `?c=${ref}` : ''}`, width: 1200, height: 630 };
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', siteName: 'Algoria AI', images: [{ ...image, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

export default async function Invite({ searchParams }: { searchParams: Search }) {
  const jar = await cookies();
  const sp = await searchParams;
  const name = await referrerFirstName((jar.get('alg_ref')?.value ?? one(sp.c)).toLowerCase());
  const signedIn = !!verifySession(jar.get(SESSION_COOKIE)?.value);
  return <InviteView name={name} signedIn={signedIn} />;
}
