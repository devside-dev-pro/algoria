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
  // ON TENTE, ON NE PRÉ-JUGE PLUS (26/08). Le garde isApiKnown vivait ici ; avec un drapeau MT faux pour
  // tout le monde il se réduit à « possède déjà des masters » — et refusait donc précisément les deux
  // populations qu'il devait servir : le membre EN PAUSE (sthPauseCopy vide sa liste de masters, c'est
  // sa définition) et le membre masterless que l'audit veut réparer. Un garde qui bloque exactement les
  // cas qu'il est censé débloquer doit sauter.
  const j = await sthJoinMaster({ userId, masterId, lots });
  return j.ok ? { ok: true, error: '' } : { ok: false, error: hintUnknownUser(j.errorMessage) };
}

/** Le conseil que portait l'ancien garde isApiKnown, rendu au moment où il est réellement fondé : quand
 *  STH dit lui-même ne pas connaître cet utilisateur. Avant, il s'affichait sur une SUPPOSITION tirée d'un
 *  drapeau, ce qui envoyait le support corriger à la main des membres qui n'avaient rien. */
function hintUnknownUser(error: string): string {
  return /user.*(not found|unknown)|invalid user/i.test(error)
    ? `${error} — STH doesn't know this UserID (manually-added receiver?). Do it in the STH dashboard instead.`
    : error;
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
 *
 * ⚠️ MISE À JOUR DU 26/08/2026 — LE FLAG EST MORT, ET CETTE FONCTION EN DÉPEND À MOITIÉ.
 * Constat de Mathieu sur TOUT le parc : tradingAccountConnected est false pour tous les membres, y compris
 * ceux qui copient parfaitement. Ce n'est donc pas « instantané », c'est inexploitable. Concrètement,
 * `isApiKnown` se réduit à « possède au moins un master » — ce qui rend faux, à nouveau, le cas de la
 * PAUSE décrit juste au-dessus (un membre en pause a une liste VIDE).
 * C'est pourquoi elle n'est plus utilisée comme GARDE D'ENTRÉE nulle part : sthMoveMaster et sthPauseCopy
 * tentent l'opération et laissent STH répondre. Elle ne sert plus qu'à un seul endroit (confirmation
 * post-connect), où « possède un master » est une preuve suffisante et où un faux négatif ne fait que
 * remonter l'erreur réelle du connect.
 * NE PAS la réintroduire comme pré-condition tant que STH n'a pas réparé ce champ.
 */
function isApiKnown(st: { ok: boolean; data: { tradingAccountConnected?: boolean; masterAccountsList?: Array<{ id: string }> } }): boolean {
  if (!st.ok) return true; // STH injoignable → on laisse passer, l'appel suivant tranchera avec sa vraie erreur
  return st.data.tradingAccountConnected === true || (st.data.masterAccountsList ?? []).length > 0;
}

/** PAUSE la copie d'un utilisateur API : join-master-account DÉCLARATIF avec une liste VIDE = désabonné de
 *  tout, mais le compte MT reste connecté au copieur → le resume est un simple re-join (sthMoveMaster).
 *  Même garde que sthMoveMaster : les receivers ajoutés à la main dans le dashboard sont invisibles ici. */
export async function sthPauseCopy(userId: string): Promise<{ ok: boolean; error: string }> {
  // même raison qu'au-dessus : on laisse STH répondre plutôt que de deviner à partir d'un drapeau mort
  const r = await sthPost('/Partner/join-master-account', { UserID: userId, MasterAccounts: [] });
  return r.ok ? { ok: true, error: '' } : { ok: false, error: hintUnknownUser(r.errorMessage) };
}

// ⚠️ NE PAS RECONSTRUIRE UNE VÉRIFICATION D'IDENTIFIANTS BLOQUANTE À L'INSCRIPTION (leçon du 15/08/2026).
// Une fonction sthVerifyCredentials a existé ici pendant 24 h : elle tentait un connect puis sondait
// tradingAccountConnected pendant 27 s, et le formulaire d'inscription REFUSAIT l'envoi si le pont
// n'était pas monté. Effet en production : 0 inscription en 24 h (5 à 7 par jour la semaine d'avant), et
// des membres aux identifiants parfaitement valides refusés en boucle.
// La raison est écrite dix lignes plus bas, dans sthConnectAndJoin : après ~25 s d'attente, le message
// dit lui-même « STH is still connecting — retry CONNECT in 1-2 min ». L'absence de pont à 27 secondes
// est donc le cas NORMAL, pas un signe d'identifiants faux. Le provisioning MetaTrader côté STH prend
// souvent plus longtemps que ce qu'une requête HTTP peut attendre.
// Si le besoin revient : contrôle ASYNCHRONE après enregistrement, résultat INDICATIF sur la fiche admin,
// et jamais dans le chemin de l'envoi.

/** Flux complet « brancher un client » : connect PUIS join master (id via env ou auto-découverte si unique).
 *  ORDRE IMPORTANT : get-user-status sur un utilisateur JAMAIS connecté renvoie une liste de masters VIDE
 *  (doc STH : « un utilisateur inconnu renvoie tradingAccountConnected: false et une liste vide ») — la
 *  découverte du master ne marche donc qu'APRÈS connect-customer-copier.
 *  Renvoie {ok, error} — error non vide = à AFFICHER au support (ex. « MetaTrader Server not found »). */
export async function sthConnectAndJoin(o: {
  userId: string; login: string | number; password: string; server: string; isMt4: boolean; lots: number; strategy?: number;
}): Promise<{ ok: boolean; error: string }> {
  // 0) ⚠️ IL Y AVAIT ICI UN PRÉ-DÉCONNECT, ET IL DÉCONNECTAIT TOUT LE MONDE (retiré le 26/08/2026).
  //
  //    Le code lisait `pre.data.tradingAccountConnected === false` pour repérer un utilisateur « connu mais
  //    pas branché » (cas des identifiants périmés) et appelait sthDisconnect avant de reconnecter.
  //    Sauf que ce drapeau est faux pour TOUS les membres, y compris ceux qui copient parfaitement —
  //    constat de Mathieu sur l'ensemble du parc, et déjà écrit noir sur blanc vingt lignes plus haut dans
  //    isApiKnown : « vécu 23/07 : userIsSubscribed true avec connected false ». La leçon était dans le
  //    fichier ; le code d'à côté ne s'en servait pas.
  //
  //    Conséquence réelle (membre #422, 26/08, 2h du matin) : un clic sur RECONNECT déconnectait le membre,
  //    puis connect-customer-copier renvoyait HTTP 500 — il restait débranché, et le bouton censé le
  //    réparer était ce qui l'avait cassé. Un geste de secours ne doit JAMAIS commencer par détruire
  //    l'état qu'il tente de restaurer.
  //
  //    On ne remplace pas par un autre test : aucun signal fiable ne distingue « connu mais pas branché »
  //    d'un membre sain (la liste de masters vide est aussi l'état d'un membre en PAUSE — voir isApiKnown).
  //    Le cas des identifiants périmés reste couvert : sthConnectCustomer renvoie les identifiants ACTUELS,
  //    et si STH s'obstine à garder les anciens, la sortie est un DISCONNECT explicite depuis la fiche
  //    membre — une action que le support décide, pas un effet de bord silencieux de chaque reconnexion.
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
    // On redemande l'état RÉEL — via isApiKnown, PAS via le drapeau seul. Le drapeau étant faux pour tout
    // le monde, ce test transformait la moindre erreur de connect en échec définitif, y compris sur un
    // compte parfaitement abonné : c'est exactement le faux négatif que isApiKnown documente.
    const after = await sthStatus(o.userId);
    if (!isApiKnown(after)) return { ok: false, error: c.errorMessage };
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
  //    MetaTrader soit établi → un join immédiat peut échouer « MetaTrader account not connected ».
  //
  //    ON RÉESSAIE LE JOIN LUI-MÊME, on n'attend plus le drapeau (26/08). L'ancienne boucle sondait
  //    tradingAccountConnected et ne relançait le join qu'une fois le drapeau vrai — un drapeau faux pour
  //    tout le monde, donc elle brûlait ses 24 secondes puis abandonnait TOUJOURS, y compris quand le join
  //    serait passé du premier coup au deuxième essai. Interroger l'opération qu'on veut réellement réussir
  //    vaut mieux que surveiller un indicateur qui prétend la prédire.
  let j = await sthJoinMaster({ userId: o.userId, masterId, lots: o.lots });
  for (let attempt = 0; attempt < 8 && !j.ok && /not connected/i.test(j.errorMessage); attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    j = await sthJoinMaster({ userId: o.userId, masterId, lots: o.lots });
  }
  if (!j.ok && /not connected/i.test(j.errorMessage))
    return {
      ok: false,
      error:
        "account saved but STH can't reach the MetaTrader account (after ~25s). Either STH is still connecting — retry CONNECT in 1-2 min — or the login/password/server is wrong (check it's the MAIN password, not investor, and the exact server name).",
    };
  if (!j.ok) return { ok: false, error: `connected, but join failed: ${j.errorMessage}` };
  return { ok: true, error: '' };
}
