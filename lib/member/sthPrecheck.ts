// PRÉ-TEST DES IDENTIFIANTS METATRADER CHEZ STH (01/10/2026) — MODE OBSERVATION. Server-only.
//
// Idée de Mathieu : à l'envoi du formulaire, pré-connecter le compte chez STH SANS l'abonner au master.
// Identifiants faux → STH répond « Invalid account » ; bons → le compte est enregistré, mais il ne copie
// RIEN : la copie ne démarre qu'au join-master-account, c'est-à-dire au clic CONNECT de l'admin, derrière
// le verrou des lots (inchangé). C'est l'état exact d'un membre « en pause ».
//
// Pourquoi « observation » : STH (Harold, 01/10) pense que le message est « invalid account » « il me
// semble » — et notre propre historique montre que STH renvoie AUSSI « Invalid account » pour un compte
// DÉJÀ enregistré chez eux (cliente #7, 03/08). Pendant une semaine, le résultat s'affiche donc sur la
// carte admin seulement ; le membre n'est prévenu de rien. On compare au verdict de Mathieu, puis on décide.
//
// ⚠️ LEÇON DU 15/08 : jamais dans le chemin de l'envoi. Ce pré-test tourne APRÈS la réponse (after()), ne
// bloque rien, ne change aucun statut, et un échec de STH (lent, muet, en panne) ne coûte rien au membre.
import { sdb } from './server';
import { sthReady, sthConnectCustomer, sthDisconnect } from './sth';

export type PrecheckResult = 'ok' | 'invalid' | 'error' | 'known' | 'timeout';
export interface Precheck { result: PrecheckResult; error?: string; at: string }

const TIMEOUT_MS = 25_000;

export async function sthPrecheck(o: { tgId: number; kycId: string | null; login: string; server: string; password: string; isMt4: boolean }): Promise<void> {
  if (!sthReady()) return;
  const db = sdb() as unknown as { from: (t: string) => any };
  const userId = String(o.tgId);
  // DÉJÀ CONNU DE STH (déjà validé une fois, ou déjà branché) : « Invalid account » y serait ambigu — c'est
  // aussi la réponse à un compte déjà enregistré. On ne teste pas, on le dit.
  const [{ data: doneConnect }, { data: connectedNote }, { data: prevOk }] = await Promise.all([
    db.from('member_actions').select('id').eq('tg_id', o.tgId).eq('kind', 'connect').eq('status', 'done').limit(1),
    db.from('member_actions').select('id').eq('tg_id', o.tgId).eq('kind', 'note').ilike('detail->>text', '%copier connected via STH%').limit(1),
    db.from('member_actions').select('id').eq('tg_id', o.tgId).eq('kind', 'kyc').eq('detail->sth_precheck->>result', 'ok').limit(1),
  ]);
  let check: Precheck;
  if (doneConnect?.length || connectedNote?.length) {
    check = { result: 'known', at: new Date().toISOString() };
  } else {
    // Un pré-test précédent a réussi (le membre renvoie le formulaire avec d'autres identifiants) : le
    // compte est enregistré chez STH mais n'a JAMAIS été abonné (aucune connexion validée, vérifié juste
    // au-dessus). On le retire d'abord, sinon le nouveau test répondrait « Invalid account » à tort.
    if (prevOk?.length) await sthDisconnect(userId);
    const r = await Promise.race([
      sthConnectCustomer({ userId, login: o.login, password: o.password, server: o.server, isMt4: o.isMt4, lots: 0.01 }),
      new Promise<null>((res) => setTimeout(() => res(null), TIMEOUT_MS)),
    ]);
    const at = new Date().toISOString();
    if (!r) check = { result: 'timeout', at };
    else if (r.ok) check = { result: 'ok', at };
    else check = { result: /invalid account/i.test(r.errorMessage) ? 'invalid' : 'error', error: r.errorMessage.slice(0, 200), at };
  }
  // Écrit sur la fiche kyc (recopiée telle quelle dans la carte CONNECT à la fin du tunnel) ET sur une
  // carte CONNECT déjà en attente, si le membre a fini le tunnel avant la réponse de STH.
  const merge = async (row: { id: string; detail: Record<string, unknown> | null }) =>
    db.from('member_actions').update({ detail: { ...(row.detail ?? {}), sth_precheck: check } }).eq('id', row.id);
  const [{ data: kycRows }, { data: pending }] = await Promise.all([
    o.kycId ? db.from('member_actions').select('id,detail').eq('id', o.kycId).limit(1) : Promise.resolve({ data: [] }),
    db.from('member_actions').select('id,detail').eq('tg_id', o.tgId).eq('kind', 'connect').eq('status', 'pending'),
  ]);
  await Promise.all([...(kycRows ?? []), ...(pending ?? [])].map(merge));
}
