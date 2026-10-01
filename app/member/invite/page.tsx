// PAGE D'INVITATION (arrivée des liens de parrainage /r/<code>).
// 02/10/2026 — DIRECTION L'APP, plus le canal. Décision Mathieu : « on parraine son ami sur l'app, pas sur un
// canal Telegram ». L'app est ouverte à tous (gains en clair, Algoria AI, Academy, support) et la confiance,
// c'est l'ami qui l'apporte : une étape de moins. Le canal reste proposé, en petit, pour qui veut regarder avant.
// Le prénom du parrain est lu ICI, côté serveur, depuis le cookie posé par /r/ : jamais pris dans l'URL, donc
// personne ne peut fabriquer un lien « Elon got you into Algoria ».
import { cookies } from 'next/headers';
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

export default async function Invite() {
  const jar = await cookies();
  const name = await referrerFirstName((jar.get('alg_ref')?.value ?? '').toLowerCase());
  const signedIn = !!verifySession(jar.get(SESSION_COOKIE)?.value);
  return <InviteView name={name} signedIn={signedIn} />;
}
