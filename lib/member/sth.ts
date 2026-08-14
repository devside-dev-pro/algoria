// Client Partner API de Social Trade Hub (copieur). Server-only : la PartnerLicense est un SECRET, jamais exposé
// au navigateur. GATÉ : sthReady() est faux tant que STH_PARTNER_LICENSE n'est pas posé (Vercel) → aucun appel.
// Auth = champ PartnerLicense dans le body (pas d'en-tête). Réponse : HTTP 200 + errorMessage ('' = succès).
// Doc : POST /Partner/{connect-customer-copier | join-master-account | get-user-status | disconnect}.
const BASE = process.env.STH_BASE_URL ?? 'https://socialtradehubapp.com';
const LICENSE = process.env.STH_PARTNER_LICENSE ?? '';
const MASTER_ID = process.env.STH_MASTER_ID ?? ''; // id du master Algoria dans STH ; sinon auto-découvert via get-user-status
// MULTI-STRATÉGIES : un master par stratégie (S1 Steady / S2 Balanced / S3 Turbo). S2 retombe sur
// STH_MASTER_ID (le master historique). Stratégie sans master configuré → repli MASTER_ID/auto-découverte.
const MASTER_BY_STRATEGY: Record<number, string> = {
  1: process.env.STH_MASTER_ID_S1 ?? '',
  2: process.env.STH_MASTER_ID_S2 ?? process.env.STH_MASTER_ID ?? '',
  3: process.env.STH_MASTER_ID_S3 ?? '',
};

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
    MetatraderServer: o.server, // nom EXACT du champ doc STH — « Server » était ignoré → compte enregistré SANS serveur, jamais connectable
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

/** DÉPLACE un utilisateur API vers le master d'une AUTRE stratégie — join-master-account est DÉCLARATIF
 *  (la liste envoyée REMPLACE les abonnements) : un seul appel = changement de master. Ne marche que pour
 *  les membres connectés via l'API ; les receivers ajoutés à la main dans le dashboard STH sont invisibles
 *  ici → erreur explicite pour que le support les déplace à la main. */
export async function sthMoveMaster(userId: string, strategy: number, lots: number): Promise<{ ok: boolean; error: string }> {
  // JAMAIS de repli silencieux vers le master historique pour S1/S3 : brancher quelqu'un sur une stratégie
  // qu'il n'a pas choisie est pire qu'un message d'erreur. S2 garde le repli — MASTER_ID EST son master.
  const masterId = MASTER_BY_STRATEGY[strategy] || (strategy === 2 ? MASTER_ID : '');
  if (!masterId) return { ok: false, error: `no master configured for S${strategy} (set STH_MASTER_ID_S${strategy})` };
  if (!isApiKnown(await sthStatus(userId)))
    return { ok: false, error: 'this member is not API-connected (manually-added receiver?) — move them in the STH dashboard instead' };
  const j = await sthJoinMaster({ userId, masterId, lots });
  return j.ok ? { ok: true, error: '' } : { ok: false, error: j.errorMessage };
}

/**
 * « Connu de l'API ? » — la question paraît simple, elle a coûté une cliente bloquée (03/08, membre #7).
 * Un utilisateur INCONNU de STH renvoie les DEUX à la fois : tradingAccountConnected false ET une liste de
 * masters vide. Chacun pris isolément est un faux négatif :
 *  · la liste vide seule → c'est aussi l'état exact d'un membre MIS EN PAUSE par sthPauseCopy (join
 *    déclaratif avec une liste vide). Résultat vécu : une cliente se déconnecte depuis l'app, son compte
 *    reste parfaitement connecté chez STH, et plus aucune reconnexion n'est possible — ni par elle, ni par
 *    le support. Le mécanisme de pause fabriquait l'état que le mécanisme de reprise refusait de traiter.
 *  · le flag seul → il reflète l'état INSTANTANÉ du bridge MT et peut être false sur un membre
 *    parfaitement abonné (vécu 23/07 : userIsSubscribed true avec connected false).
 * On exige donc les deux pour déclarer quelqu'un inconnu.
 */
function isApiKnown(st: { ok: boolean; data: { tradingAccountConnected?: boolean; masterAccountsList?: Array<{ id: string }> } }): boolean {
  if (!st.ok) return true; // STH injoignable → on laisse passer, l'appel suivant tranchera avec sa vraie erreur
  return st.data.tradingAccountConnected === true || (st.data.masterAccountsList ?? []).length > 0;
}

/** PAUSE la copie d'un utilisateur API : join-master-account DÉCLARATIF avec une liste VIDE = désabonné de
 *  tout, mais le compte MT reste connecté au copieur → le resume est un simple re-join (sthMoveMaster).
 *  Même garde que sthMoveMaster : les receivers ajoutés à la main dans le dashboard sont invisibles ici. */
export async function sthPauseCopy(userId: string): Promise<{ ok: boolean; error: string }> {
  if (!isApiKnown(await sthStatus(userId)))
    return { ok: false, error: 'this member is not API-connected (manually-added receiver?) — pause them in the STH dashboard instead' };
  const r = await sthPost('/Partner/join-master-account', { UserID: userId, MasterAccounts: [] });
  return r.ok ? { ok: true, error: '' } : { ok: false, error: r.errorMessage };
}

/**
 * VÉRIFICATION DES IDENTIFIANTS À L'INSCRIPTION (14/08/2026) — le premier motif de refus, et de loin :
 * 20 demandes sur 42 refusées pour « invalid account », presque toujours le mot de passe de l'espace
 * client du broker saisi à la place de celui du compte MetaTrader. Jusqu'ici l'erreur ne se découvrait
 * qu'à l'examen, des heures plus tard, et coûtait un aller-retour au support — souvent le prospect.
 * Ici, la personne l'apprend pendant qu'elle a encore le formulaire sous les yeux.
 *
 * TROIS PIÈGES, tous vérifiés dans le code au-dessus :
 *  1. connect-customer-copier rend la main AVANT que le bridge MetaTrader soit établi. Un connect « réussi »
 *     ne prouve donc RIEN sur les identifiants : la seule preuve est tradingAccountConnected, qu'il faut
 *     aller chercher en sondant. C'est aussi pour ça qu'un mauvais mot de passe se manifeste par un
 *     silence, pas par une erreur — d'où le sondage plutôt qu'une lecture du libellé d'erreur.
 *  2. STH répond « Invalid account » pour un compte DÉJÀ enregistré (incident du 03/08, membre #7). On ne
 *     conclut donc jamais sur le texte de l'erreur : on redemande l'état réel.
 *  3. Le contrôle NE DOIT JAMAIS bloquer une inscription valide à cause de NOTRE infrastructure. Si STH
 *     n'est pas configuré ou ne répond pas, on renvoie 'unknown' et l'inscription passe — l'examen humain
 *     reste le filet. On ne conclut à l'échec que si STH répond correctement ET que le compte refuse de se
 *     connecter : STH joignable + compte injoignable = ce sont bien les identifiants.
 *
 * On DÉCONNECTE toujours à la fin, succès comme échec : ce n'est qu'un test, il ne doit pas consommer une
 * place de licence pour un compte pas encore approuvé (219 personnes en onboarding). L'approbation
 * reconnecte ensuite normalement — sthConnectAndJoin sait repartir d'un utilisateur déconnecté.
 */
export async function sthVerifyCredentials(o: {
  userId: string; login: string | number; password: string; server: string; isMt4: boolean;
}): Promise<{ verdict: 'ok' | 'bad' | 'unknown'; error: string }> {
  if (!sthReady()) return { verdict: 'unknown', error: '' };
  try {
    // repartir propre : d'anciens identifiants mémorisés feraient répondre « already » au connect, et on
    // testerait alors le compte de la tentative précédente au lieu de celui qu'on vient de saisir.
    await sthDisconnect(o.userId).catch(() => {});
    const c = await sthConnectCustomer({ ...o, lots: 0.01 });
    // Erreur de SERVEUR : verdict immédiat, inutile de sonder 30 secondes un nom de serveur qui n'existe pas.
    if (!c.ok && /server/i.test(c.errorMessage) && /not found|invalid|unknown/i.test(c.errorMessage))
      return { verdict: 'bad', error: c.errorMessage };
    let sthAnswered = false;
    for (let attempt = 0; attempt < 9; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await sthStatus(o.userId);
      if (st.ok) sthAnswered = true;
      if (st.ok && st.data.tradingAccountConnected === true) return { verdict: 'ok', error: '' };
    }
    // STH n'a jamais répondu correctement → c'est NOTRE côté qui est muet, pas le compte du membre.
    if (!sthAnswered) return { verdict: 'unknown', error: '' };
    return { verdict: 'bad', error: c.ok ? '' : c.errorMessage };
  } catch {
    return { verdict: 'unknown', error: '' }; // toute panne imprévue laisse passer : l'examen tranchera
  } finally {
    await sthDisconnect(o.userId).catch(() => {}); // le test ne garde jamais une place de licence
  }
}

/** Flux complet « brancher un client » : connect PUIS join master (id via env ou auto-découverte si unique).
 *  ORDRE IMPORTANT : get-user-status sur un utilisateur JAMAIS connecté renvoie une liste de masters VIDE
 *  (doc STH : « un utilisateur inconnu renvoie tradingAccountConnected: false et une liste vide ») — la
 *  découverte du master ne marche donc qu'APRÈS connect-customer-copier.
 *  Renvoie {ok, error} — error non vide = à AFFICHER au support (ex. « MetaTrader Server not found »). */
export async function sthConnectAndJoin(o: {
  userId: string; login: string | number; password: string; server: string; isMt4: boolean; lots: number; strategy?: number;
}): Promise<{ ok: boolean; error: string }> {
  // 0) PIÈGE DES IDENTIFIANTS PÉRIMÉS : si un connect précédent a enregistré de MAUVAIS identifiants
  //    (login corrigé après coup, faute de frappe…), STH garde les anciens et répond « already » au re-connect
  //    → le compte ne se connectera jamais. Si l'utilisateur est connu mais PAS connecté, on disconnect
  //    d'abord (best-effort) pour repartir proprement avec les identifiants ACTUELS.
  const pre = await sthStatus(o.userId);
  if (pre.ok && pre.data.tradingAccountConnected === false) await sthDisconnect(o.userId).catch(() => {});
  // 1) connecter le compte au copieur (rend l'utilisateur « connu » de STH).
  //    RETRY-SAFE : si le compte est DÉJÀ connecté (re-clic alors que tout marche), on continue vers le join
  //    au lieu de bloquer — l'erreur « already connected » n'est pas un échec pour nous.
  const c = await sthConnectCustomer(o);
  if (!c.ok) {
    // ON NE FAIT PAS CONFIANCE AU LIBELLÉ (03/08, cliente #7) : le filet ne reconnaissait « déjà connecté »
    // qu'au mot « already ». STH répond « Invalid account » pour un compte déjà enregistré — message que
    // rien ne laisse deviner. Résultat : une cliente parfaitement connectée chez eux était déclarée
    // invalide chez nous, et le support ne pouvait plus la rebrancher.
    // On redemande donc l'état RÉEL : si le compte est connecté, l'échec du connect n'en est pas un et on
    // continue vers le join. Un fait vérifié vaut mieux qu'une chaîne de caractères devinée.
    const after = await sthStatus(o.userId);
    if (!(after.ok && after.data.tradingAccountConnected === true)) return { ok: false, error: c.errorMessage };
  }
  // 2) master id : celui de la STRATÉGIE du membre d'abord, sinon env global, sinon auto-découverte.
  //    Comme sthMoveMaster : jamais de repli silencieux vers le master historique pour S1/S3 — brancher
  //    quelqu'un sur une stratégie qu'il n'a pas choisie est pire qu'une erreur affichée.
  let masterId = (o.strategy != null ? MASTER_BY_STRATEGY[o.strategy] : '') || (o.strategy == null || o.strategy === 2 ? MASTER_ID : '');
  if (!masterId && o.strategy != null && o.strategy !== 2) return { ok: false, error: `no master configured for S${o.strategy} (set STH_MASTER_ID_S${o.strategy})` };
  if (!masterId) {
    const st = await sthStatus(o.userId);
    if (!st.ok) return { ok: false, error: `connected, but master lookup failed: ${st.errorMessage}` };
    const list = st.data.masterAccountsList ?? [];
    if (list.length === 1) masterId = list[0].id;
    else if (list.length === 0) return { ok: false, error: 'connected, but NO master visible under this license — ask STH to attach your master account to the Partner license (or set STH_MASTER_ID)' };
    else return { ok: false, error: `connected, but ${list.length} masters under this license — set STH_MASTER_ID to pick the right one (${list.map((m) => m.id).join(', ')})` };
  }
  // 3) abonner au master Algoria.
  //    La connexion MT côté STH est ASYNCHRONE : connect-customer-copier rend la main avant que le bridge
  //    MetaTrader soit établi → un join immédiat peut échouer « MetaTrader account not connected ». Dans ce
  //    cas on POLL get-user-status (jusqu'à ~25 s) en attendant tradingAccountConnected, puis on re-join.
  //    Si le compte ne se connecte jamais, c'est presque toujours login/mot de passe/serveur incorrects.
  let j = await sthJoinMaster({ userId: o.userId, masterId, lots: o.lots });
  if (!j.ok && /not connected/i.test(j.errorMessage)) {
    let connected = false;
    for (let attempt = 0; attempt < 8 && !connected; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await sthStatus(o.userId);
      connected = st.ok && st.data.tradingAccountConnected === true;
    }
    if (!connected)
      return {
        ok: false,
        error:
          "account saved but STH can't reach the MetaTrader account (after ~25s). Either STH is still connecting — retry CONNECT in 1-2 min — or the login/password/server is wrong (check it's the MAIN password, not investor, and the exact server name).",
      };
    j = await sthJoinMaster({ userId: o.userId, masterId, lots: o.lots });
  }
  if (!j.ok) return { ok: false, error: `connected, but join failed: ${j.errorMessage}` };
  return { ok: true, error: '' };
}
