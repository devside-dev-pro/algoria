// Client Partner API de Social Trade Hub (copieur). Server-only : la PartnerLicense est un SECRET, jamais exposé
// au navigateur. GATÉ : sthReady() est faux tant que STH_PARTNER_LICENSE n'est pas posé (Vercel) → aucun appel.
// Auth = champ PartnerLicense dans le body (pas d'en-tête). Réponse : HTTP 200 + errorMessage ('' = succès).
// Doc : POST /Partner/{connect-customer-copier | join-master-account | get-user-status | disconnect}.
const BASE = process.env.STH_BASE_URL ?? 'https://socialtradehubapp.com';
const LICENSE = process.env.STH_PARTNER_LICENSE ?? '';
const MASTER_ID = process.env.STH_MASTER_ID ?? ''; // id du master Algoria dans STH ; sinon auto-découvert via get-user-status

export const sthReady = (): boolean => Boolean(LICENSE);

type SthResult<T = Record<string, unknown>> = { ok: boolean; errorMessage: string; data: T };

async function sthPost<T = Record<string, unknown>>(route: string, payload: Record<string, unknown>): Promise<SthResult<T>> {
  if (!LICENSE) return { ok: false, errorMessage: 'STH not configured (STH_PARTNER_LICENSE missing)', data: {} as T };
  try {
    const res = await fetch(`${BASE}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ PartnerLicense: LICENSE, ...payload }),
    });
    const data = (await res.json().catch(() => ({}))) as T & { errorMessage?: string };
    const err = (data?.errorMessage ?? '').toString().trim() || (res.ok ? '' : `HTTP ${res.status}`);
    return { ok: !err, errorMessage: err, data };
  } catch (e) {
    return { ok: false, errorMessage: (e as { message?: string })?.message ?? 'network error', data: {} as T };
  }
}

/** Statut d'un utilisateur du copieur : compte connecté ? + liste des masters de la licence. */
export function sthStatus(userId: string) {
  return sthPost<{ tradingAccountConnected?: boolean; masterAccountsList?: Array<{ id: string; name?: string }> }>(
    '/Partner/get-user-status',
    { UserID: userId },
  );
}

/** Connecte le compte MetaTrader du client au copieur (1re étape). Lots = taille de copie fixe. */
export function sthConnectCustomer(o: { userId: string; login: string | number; password: string; server: string; isMt4: boolean; lots: number }) {
  return sthPost('/Partner/connect-customer-copier', {
    UserID: o.userId,
    MetatraderLogin: Number(o.login),
    MetatraderPassword: o.password,
    Server: o.server,
    IsMT4: o.isMt4,
    Lots: o.lots,
  });
}

/** Abonne l'utilisateur au(x) master(s) Algoria (2e étape). MasterAccounts:[] désabonne tout. */
export function sthJoinMaster(o: { userId: string; masterId: string; lots: number }) {
  return sthPost('/Partner/join-master-account', {
    UserID: o.userId,
    MasterAccounts: [{ id: o.masterId, lots: o.lots }],
  });
}

/** Déconnecte le compte : retire tous les abonnements et libère la capacité de licence. */
export function sthDisconnect(userId: string) {
  return sthPost('/Partner/disconnect', { UserID: userId });
}

/** Flux complet « brancher un client » : connect PUIS join master (id via env ou auto-découverte si unique).
 *  ORDRE IMPORTANT : get-user-status sur un utilisateur JAMAIS connecté renvoie une liste de masters VIDE
 *  (doc STH : « un utilisateur inconnu renvoie tradingAccountConnected: false et une liste vide ») — la
 *  découverte du master ne marche donc qu'APRÈS connect-customer-copier.
 *  Renvoie {ok, error} — error non vide = à AFFICHER au support (ex. « MetaTrader Server not found »). */
export async function sthConnectAndJoin(o: {
  userId: string; login: string | number; password: string; server: string; isMt4: boolean; lots: number;
}): Promise<{ ok: boolean; error: string }> {
  // 1) connecter le compte au copieur (rend l'utilisateur « connu » de STH).
  //    RETRY-SAFE : si le compte est DÉJÀ connecté (re-clic après un join échoué), on continue vers le join
  //    au lieu de bloquer — l'erreur « already connected » n'est pas un échec pour nous.
  const c = await sthConnectCustomer(o);
  if (!c.ok && !/already/i.test(c.errorMessage)) return { ok: false, error: c.errorMessage };
  // 2) master id : env prioritaire, sinon auto-découverte maintenant que l'utilisateur existe
  let masterId = MASTER_ID;
  if (!masterId) {
    const st = await sthStatus(o.userId);
    if (!st.ok) return { ok: false, error: `connected, but master lookup failed: ${st.errorMessage}` };
    const list = st.data.masterAccountsList ?? [];
    if (list.length === 1) masterId = list[0].id;
    else if (list.length === 0) return { ok: false, error: 'connected, but NO master visible under this license — ask STH to attach your master account to the Partner license (or set STH_MASTER_ID)' };
    else return { ok: false, error: `connected, but ${list.length} masters under this license — set STH_MASTER_ID to pick the right one (${list.map((m) => m.id).join(', ')})` };
  }
  // 3) abonner au master Algoria
  const j = await sthJoinMaster({ userId: o.userId, masterId, lots: o.lots });
  if (!j.ok) return { ok: false, error: `connected, but join failed: ${j.errorMessage}` };
  return { ok: true, error: '' };
}
