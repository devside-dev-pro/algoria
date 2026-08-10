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
  if (!LOGIN_CODE_RE.test(code)) return { kind: 'bad' };
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
  const source = /^[a-z0-9:_-]{2,60}$/.test(srcCookie) ? srcCookie : null;

  // MARCHÉ (01/08) : la langue vient du canal par lequel la personne est arrivée. On la retrouve via sa
  // demande d'adhésion la plus récente — c'est le seul lien fiable entre un compte et son canal d'origine.
  const { data: jr } = (await (db as any)
    .from('telegram_joins')
    .select('chat_id')
    .eq('user_id', row.tg_id)
    .order('joined_at', { ascending: false })
    .limit(1)) as { data: Array<{ chat_id: number | null }> | null };
  const locale = localeForChat(jr?.[0]?.chat_id);

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
