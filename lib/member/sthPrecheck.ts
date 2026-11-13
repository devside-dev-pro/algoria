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
//
// 13/11/2026 — ON NE SAUTE PLUS POUR TOUT LE tg_id. Le saut « already known to STH » se faisait dès qu'une
// carte connect était done, ou dès qu'une note « copier connected via STH » existait pour ce Telegram,
// SANS regarder le login. Conséquence vécue (#652 Steven Horne, accord de Mathieu le 13/11) : un membre
// déjà passé live sur PUPrime (34710390) soumet un nouveau compte RaiseFX (1258486) — le pré-test est sauté,
// les nouveaux identifiants ne sont jamais éprouvés, et GO LIVE échoue plus tard sans aucun signal à
// l'inscription. On ne saute désormais que si le login (et le serveur, quand il est connu) est LE MÊME
// que celui déjà connecté. Un autre compte est testé, après un disconnect pour éviter le « Invalid account »
// ambigu d'un UserID déjà enregistré.
import { sdb } from './server';
import { sthReady, sthConnectCustomer, sthDisconnect } from './sth';

export type PrecheckResult = 'ok' | 'invalid' | 'error' | 'known' | 'timeout';
export interface Precheck { result: PrecheckResult; error?: string; at: string }

const TIMEOUT_MS = 25_000;

/** Le compte soumis est-il celui déjà passé en connect done — même login, et même serveur s'il est connu ? */
function sameSubmittedAccount(detail: Record<string, unknown> | null | undefined, login: string, server: string): boolean {
  const d = detail ?? {};
  const haveLogin = String(d.login ?? d.mt5_login ?? '').trim();
  const haveServer = String(d.server ?? d.mt5_server ?? '').trim();
  const wantLogin = String(login).trim();
  const wantServer = String(server).trim();
  if (!haveLogin || haveLogin !== wantLogin) return false;
  if (haveServer && wantServer && haveServer !== wantServer) return false;
  return true;
}

export async function sthPrecheck(o: { tgId: number; kycId: string | null; login: string; server: string; password: string; isMt4: boolean }): Promise<void> {
  if (!sthReady()) return;
  const db = sdb() as unknown as { from: (t: string) => any };
  const userId = String(o.tgId);
  // DÉJÀ CONNU DE STH, MAIS SEULEMENT POUR LE MÊME COMPTE (13/11/2026) : « Invalid account » y serait
  // ambigu — c'est aussi la réponse à un compte déjà enregistré. Un AUTRE login/serveur doit être testé.
  const [{ data: doneConnects }, { data: connectedNote }, { data: prevOk }] = await Promise.all([
    db.from('member_actions').select('id,detail').eq('tg_id', o.tgId).eq('kind', 'connect').eq('status', 'done').order('created_at', { ascending: false }).limit(50),
    db.from('member_actions').select('id').eq('tg_id', o.tgId).eq('kind', 'note').ilike('detail->>text', '%copier connected via STH%').limit(1),
    db.from('member_actions').select('id').eq('tg_id', o.tgId).eq('kind', 'kyc').eq('detail->sth_precheck->>result', 'ok').limit(1),
  ]);
  const knownSameAccount = (doneConnects ?? []).some((row: { detail?: Record<string, unknown> | null }) =>
    sameSubmittedAccount(row.detail, o.login, o.server),
  );
  const wasConnected = Boolean((doneConnects ?? []).length || connectedNote?.length);
  let check: Precheck;
  if (knownSameAccount) {
    check = { result: 'known', at: new Date().toISOString() };
  } else {
    // Un pré-test précédent a réussi, ou le membre était déjà branché sur UN AUTRE compte : le UserID
    // est enregistré chez STH. On le retire d'abord, sinon le nouveau test répondrait « Invalid account »
    // à tort (leçon cliente #7, 03/08). Un disconnect ici n'est lancé que si le login/serveur soumis
    // diffère — le même compte, lui, reste sauté plus haut.
    if (prevOk?.length || wasConnected) await sthDisconnect(userId);
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
