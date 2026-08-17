import { randomInt } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { sdb, signSession, newReferralCode } from './server';
import { localeForChat } from './i18n';

// CONSOMMATION D'UN CODE DE CONNEXION TELEGRAM — logique partagée par les DEUX chemins d'entrée :
//   · /api/member/tglogin (GET, polling) — l'onglet qui a lancé la connexion attend la confirmation ;
//   · /member/login/confirm — le BOUTON que le bot envoie dans la conversation après le START.
// Le second existe parce que le premier ne survit pas au navigateur intégré de Telegram : partir sur
// Telegram pour taper START détruit (ou fait perdre de vue) la page qui interroge le serveur, et la
// connexion — pourtant réussie côté bot — ne se termine jamais. Vécu par les membres qui arrivent sur
// app.algoria.tech depuis un lien Telegram. Le bouton supprime l'aller-retour au lieu de le contourner :
// on ne peut PAS forcer un navigateur externe depuis Telegram sur iPhone (Apple ne l'autorise pas).
// Une seule implémentation ici = les deux portes posent EXACTEMENT la même session.

export type LoginOutcome =
  | { kind: 'bad' }
  | { kind: 'expired' }
  | { kind: 'pending' }
  | { kind: 'denied' }
  | { kind: 'ok'; session: string };

export const LOGIN_CODE_RE = /^[A-Za-z0-9]{16,64}$/;

// ===== TROISIÈME PORTE : le CODE À 6 CHIFFRES (13/08/2026) =====
// Les deux portes existantes transportent la session depuis Telegram vers le navigateur — le polling la
// pose dans l'onglet qui attend, le bouton la pose dans le navigateur qui l'ouvre. Aucune des deux
// n'atteint une app AJOUTÉE À L'ÉCRAN D'ACCUEIL sur iPhone : celle-ci a son PROPRE magasin de cookies,
// séparé de Safari. Le bouton du bot s'ouvre dans Safari, donc il connecte Safari ; l'app installée, elle,
// reste sans session et renvoie au login — qui renvoie sur Telegram. Boucle sans issue, signalée par un
// prospect le 13/08. Le polling y arrive en théorie (il faut revenir par le sélecteur d'apps sans toucher
// au bouton), mais iOS décharge volontiers la page pendant le détour par Telegram.
// Le code court renverse le sens : plus rien à transporter d'un navigateur à l'autre, la personne RECOPIE
// six chiffres là où elle veut se connecter. C'est la seule forme qui traverse deux magasins de cookies.
export const SHORT_CODE_RE = /^[0-9]{6}$/;
const SHORT_CODE_TTL_MIN = 10; // même fenêtre que le code long
// ⚠️ 6 chiffres = 1e6 combinaisons seulement. Avec quelques codes vivants à un instant donné, un tirage au
// sort devient payant en quelques heures de requêtes : la limitation par IP ci-dessous n'est pas un
// confort, c'est ce qui rend ce chemin acceptable. Ne jamais l'enlever sans allonger le code.
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MIN = 10;

/** true = cette IP a épuisé ses essais (fenêtre glissante). À vérifier AVANT de consommer un code court. */
export async function tooManyAttempts(ip: string): Promise<boolean> {
  if (!ip) return false;
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MIN * 60_000).toISOString();
  const { count } = await (sdb() as any)
    .from('login_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('at', since);
  return (count ?? 0) >= MAX_ATTEMPTS;
}

/** Trace un essai INFRUCTUEUX (un succès ne compte pas — se connecter ne doit pas rapprocher du blocage). */
export async function recordFailedAttempt(ip: string): Promise<void> {
  if (!ip) return;
  await (sdb() as any).from('login_attempts').insert({ ip }).then(
    () => {},
    () => {}, // best effort : une panne du compteur ne doit pas casser la connexion
  );
}

/**
 * Émet un code à 6 chiffres DÉJÀ CONFIRMÉ pour un utilisateur Telegram authentifié (l'expéditeur du
 * message reçu par le webhook). Renvoie null si la place ne s'est pas libérée après quelques tirages.
 *
 * Le code est écrit avec le statut `confirmed` parce que l'identité est établie à l'émission : c'est le
 * bot qui parle à un compte Telegram précis, il n'y a personne d'autre à attendre. Consommation, usage
 * unique, fenêtre de 10 minutes et contrôle du bannissement restent ceux de consumeLoginCode.
 */
export async function issueShortCode(
  db: any,
  u: { id: number; username?: string | null; first_name?: string | null; last_name?: string | null },
  photoUrl?: string | null,
): Promise<string | null> {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id);
  for (let i = 0; i < 6; i++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // `code` est la clé primaire : un code périmé qui traîne bloquerait ce tirage pour toujours. On purge
    // l'ancienne ligne SI ET SEULEMENT SI elle est hors fenêtre — jamais un code encore vivant, qui
    // appartient à quelqu'un d'autre en train de s'en servir.
    await db.from('member_login_codes').delete()
      .eq('code', code).lt('created_at', new Date(Date.now() - SHORT_CODE_TTL_MIN * 60_000).toISOString());
    const { error } = await db.from('member_login_codes').insert({
      code, status: 'confirmed', tg_id: u.id, tg_username: u.username ?? null, tg_name: name,
      ...(photoUrl ? { photo_url: photoUrl } : {}), confirmed_at: new Date().toISOString(),
    });
    if (!error) return code;
  }
  return null;
}

/** Valide le code, crée/met à jour la fiche membre, renvoie le cookie de session signé (non posé). */
export async function consumeLoginCode(
  req: NextRequest,
  code: string,
  // allowUsed : le BOUTON accepte un code déjà consommé par le polling (fenêtre de 10 min inchangée).
  // Sans ça, le membre dont l'onglet a survécu serait connecté DANS l'onglet puis rejeté par le bouton —
  // deux portes pour la même connexion ne doivent pas se voler le code. Le code reste lié au tg_id que le
  // bot a écrit depuis l'expéditeur authentifié, et le lien ne vit que dans la conversation privée du membre.
  opts: { allowUsed?: boolean } = {},
): Promise<LoginOutcome> {
  if (!LOGIN_CODE_RE.test(code) && !SHORT_CODE_RE.test(code)) return { kind: 'bad' };
  const db = sdb();
  const { data } = await db.from('member_login_codes').select('*').eq('code', code).limit(1);
  const row = data?.[0] as
    | { status: string; tg_id: number | null; tg_username: string | null; tg_name: string | null; photo_url: string | null; created_at: string }
    | undefined;
  if (!row || Date.now() - Date.parse(row.created_at) > 10 * 60_000) return { kind: 'expired' };
  const usable = row.status === 'confirmed' || (opts.allowUsed === true && row.status === 'used');
  if (!usable || !row.tg_id) return { kind: 'pending' };

  // code confirmé → usage unique (anti-rejeu)
  await db.from('member_login_codes').update({ status: 'used' }).eq('code', code);

  // BANNIS : aucune session posée (31/07 — un concurrent capturait l'app pour la copier). On refuse ICI,
  // avant le cookie : la page de login attendait déjà `denied` et redirige vers /member/denied.
  const { data: banRow } = (await (db as any).from('members').select('banned_at').eq('tg_id', row.tg_id).limit(1)) as { data: Array<{ banned_at: string | null }> | null };
  if (banRow?.[0]?.banned_at) return { kind: 'denied' };

  // PORTE OUVERTE À TOUS (stratégie teaser/FOMO) : plus aucune waitlist à la connexion — n'importe quel
  // compte Telegram entre et voit l'app en mode grisé (gains en clair, flux verrouillé, paywall broker).
  // Le VRAI filtre n'a pas bougé : l'approbation admin (compte via notre lien + dépôt ≥ 500$) débloque tout.
  // Chaque visiteur devient un LEAD visible dans le CRM au lieu d'un rebond sur une page fermée.
  // PARRAINAGE : un lien /r/<code> valide (cookie) attache le filleul à son parrain. Auto-parrainage exclu.
  const refCookie = (req.cookies.get('alg_ref')?.value ?? '').toLowerCase();
  let referrerTg: number | null = null;
  if (/^[a-f0-9]{6,12}$/.test(refCookie)) {
    const { data: r } = await db.from('members').select('tg_id').eq('referral_code', refCookie).limit(1);
    if (r?.length && Number(r[0].tg_id) !== row.tg_id) referrerTg = Number(r[0].tg_id);
  }

  // ATTRIBUTION : canal d'origine (cookie alg_src posé par le middleware au premier clic UTM) — figé à la
  // CRÉATION uniquement, comme referred_by. Absent = organique/cross-device (attribution partielle assumée).
  const srcCookie = (req.cookies.get('alg_src')?.value ?? '').toLowerCase().slice(0, 60);
  let source = /^[a-z0-9:_-]{2,60}$/.test(srcCookie) ? srcCookie : null;
  // TROIS SECOURS AU COOKIE (17/08). Le cookie seul n'a jamais rien rempli : 0 fiche sur 516 avait une
  // origine, parce qu'il exige un clic UTM vers algoria.tech alors que les pubs pointent vers le CANAL
  // Telegram — le prospect arrive sur l'app par le lien du bot, sans jamais passer par notre site.
  //   1. acquisition_sources : le tag d'un deep-link de pub (/start ad_sa), capté par le webhook du bot.
  //   2. invite_name : le NOM du lien d'invitation du canal, déjà enregistré sur chaque demande d'adhésion.
  //      Gratuit et rétroactif — il suffit de nommer un lien par set de pub dans Telegram.
  //   3. geo:<pays> lu sur l'en-tête Vercel — le seul qui ne demande RIEN à personne (voir plus bas).
  // Ordre = du plus précis au plus large : une déduction ne doit jamais écraser une mesure. Comme
  // referred_by, l'origine est figée à la CRÉATION de la fiche et ne bouge plus ensuite.
  if (!source) {
    const { data: acq } = (await (db as any)
      .from('acquisition_sources').select('source').eq('tg_id', row.tg_id).limit(1)) as { data: Array<{ source: string }> | null };
    const tag = (acq?.[0]?.source ?? '').toLowerCase();
    if (/^[a-z0-9:_-]{2,60}$/.test(tag)) source = tag;
  }

  // MARCHÉ (01/08) : la langue vient du canal par lequel la personne est arrivée. On la retrouve via sa
  // demande d'adhésion la plus récente — c'est le seul lien fiable entre un compte et son canal d'origine.
  // invite_name est lu dans LA MÊME requête (secours d'attribution n°2) : la page de connexion est le
  // chemin le plus sensible de l'app, on n'y ajoute pas un aller-retour en base pour une statistique.
  const { data: jr } = (await (db as any)
    .from('telegram_joins')
    .select('chat_id,invite_name')
    .eq('user_id', row.tg_id)
    .order('joined_at', { ascending: false })
    .limit(20)) as { data: Array<{ chat_id: number | null; invite_name: string | null }> | null };
  const locale = localeForChat(jr?.[0]?.chat_id); // le plus RÉCENT — sémantique inchangée
  if (!source && jr?.length) {
    // le plus ANCIEN nommé : l'attribution suit « premier contact gagne », à l'inverse de la langue.
    // Le nom du lien est saisi à la main dans Telegram (« Pub mcy », « Algoria.tech ») — on le normalise
    // pour qu'il tienne dans le même format que les tags de pub : minuscules, tirets, rien d'autre.
    for (let i = jr.length - 1; i >= 0; i--) {
      const slug = (jr[i].invite_name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      if (slug.length >= 2) { source = slug; break; }
    }
  }
  // SECOURS N°3, LE PAYS (17/08) — celui qui marche sans la coopération de personne.
  //
  // Les trois voies précédentes exigent que quelqu'un pose un paramètre ou nomme un lien. Or les pubs sont
  // gérées par un media buyer externe, et l'entonnoir amont fabrique un lien d'invitation à usage unique
  // PAR VISITEUR (569 liens distincts pour 613 arrivées sur une semaine, un seul canal) : ni invite_name
  // ni chat_id ne peuvent donc séparer les sets de pub.
  // Mais chaque set de pub EST un pays — SA, NZ, AU, UK, UAE. Le pays d'origine de la requête suffit donc
  // à attribuer, et Vercel le fournit gratuitement sur chaque requête. Aucune dépendance externe, rien à
  // demander au media buyer, rien à changer dans les créas.
  // LIMITE ASSUMÉE : un VPN fausse la lecture (une minorité chez des traders, mais pas zéro), et le pays
  // reste un PROXY du set de pub, pas le set lui-même. Le préfixe geo: le dit explicitement pour que
  // personne ne confonde plus tard une déduction avec une mesure.
  if (!source) {
    const cc = (req.headers.get('x-vercel-ip-country') ?? '').toLowerCase();
    if (/^[a-z]{2}$/.test(cc)) source = `geo:${cc}`;
  }

  const patch = { tg_username: row.tg_username, tg_name: row.tg_name, ...(row.photo_url ? { photo_url: row.photo_url } : {}), updated_at: new Date().toISOString() };
  const { data: existing } = await (db as any).from('members').select('id,locale_chosen_at').eq('tg_id', row.tg_id).limit(1);
  // sur un compte EXISTANT on n'écrase la langue que pour la promouvoir en 'it' : si le support l'a
  // corrigée à la main, une vieille demande d'adhésion anglaise ne doit pas la ramener en arrière.
  // LE CHOIX DU MEMBRE GAGNE (03/08) : si la personne a explicitement réglé sa langue dans l'app
  // (locale_chosen_at), aucune déduction automatique ne la réécrit — sinon un Italien qui choisit
  // l'anglais se ferait repasser en italien à sa prochaine demande d'adhésion, sans comprendre pourquoi.
  const chosen = (existing?.[0] as { locale_chosen_at?: string | null } | undefined)?.locale_chosen_at;
  if (existing?.length) await (db as any).from('members').update({ ...patch, ...(locale !== 'en' && !chosen ? { locale } : {}) }).eq('tg_id', row.tg_id); // referred_by/source ne s'écrivent qu'à la CRÉATION
  else await (db as any).from('members').insert({ tg_id: row.tg_id, ...patch, locale, referral_code: newReferralCode(), ...(referrerTg != null ? { referred_by: referrerTg } : {}), ...(source ? { source } : {}) });

  return { kind: 'ok', session: signSession({ tgId: row.tg_id, username: row.tg_username, name: row.tg_name ?? String(row.tg_id), iat: Date.now() }) };
}

/** Options du cookie de session — identiques sur les deux portes d'entrée. */
export const SESSION_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 86_400 } as const;
