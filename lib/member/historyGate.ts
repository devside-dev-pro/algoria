// Côté serveur : qui a le droit de lire les chiffres pendant la maintenance de l'historique
// (lib/member/historyMaintenance.ts). Les routes publiques du track record n'avaient pas de session ; elles lisent
// le cookie s'il y en a un. 'open' = pas de maintenance (cache CDN habituel) ; 'member' = maintenance, mais membre ou
// admin (réponse PRIVÉE, jamais mise en cache partagé : un prospect ne doit pas récupérer la copie d'un membre) ;
// 'hidden' = prospect ou visiteur.
import type { NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, sdb, isAdmin } from './server';
import { HISTORY_MAINTENANCE, seesHistory } from './historyMaintenance';

export async function historyGate(req: NextRequest): Promise<'open' | 'member' | 'hidden'> {
  if (!HISTORY_MAINTENANCE) return 'open';
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return 'hidden';
  if (isAdmin(s.username)) return 'member';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sdb() as any).from('members').select('status').eq('tg_id', s.tgId).limit(1);
  return seesHistory((data?.[0] as { status?: string } | undefined)?.status) ? 'member' : 'hidden';
}

export const MAINTENANCE_BODY = { maintenance: true } as const;
