import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { JOIN_DM, INBOX_ACK, SIGNED_IN, SIGNED_IN_BTN, SIGNED_IN_CODE_HINT, LOGIN_CODE_MSG, localeForChat, asLocale, type Locale } from '@/lib/member/i18n';
import { issueShortCode } from '@/lib/member/login';
import { translateToItalian, entitiesToHtml } from '@/lib/member/translate';

// Webhook Telegram (bot admin du canal) → alimente la WAITLIST du widget /join.
// Flux : un viewer clique le lien d'invitation "demander à rejoindre" → Telegram POSTe un chat_join_request ici
// → insert dans telegram_joins (Supabase realtime → spotlight du widget en ~1 s). C'est TOUT :
// pas de DM (un autre bot du canal envoie déjà les instructions) et AUCUNE auto-approbation —
// l'acceptation se fait EN LIVE, à la main (c'est le show).
//
// Env Vercel (server-only) :
//   TELEGRAM_WEBHOOK_SECRET — chaîne aléatoire ; Telegram la renvoie en header X-Telegram-Bot-Api-Secret-Token
//   TELEGRAM_BOT_TOKEN      — sert à récupérer la photo de profil du demandeur (getUserProfilePhotos)
//   SUPABASE_SERVICE_KEY    — insert + upload Storage côté serveur (la table est en lecture seule pour anon)
// Enregistrement du webhook (navigateur, TOKEN = celui du bot @BotFather) — chat_member est indispensable
// pour capter les ACCEPTATIONS (Telegram ne l'envoie que s'il est explicitement listé) :
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://www.algoria.tech/api/telegram&secret_token=<SECRET>&allowed_updates=%5B%22chat_join_request%22%2C%22chat_member%22%5D

/**
 * Photo de profil du demandeur → copiée dans Supabase Storage (bucket public tg-avatars).
 * On ne stocke JAMAIS l'URL Telegram (elle contient le token du bot). Best effort avec timeouts courts :
 * null si l'utilisateur masque sa photo (réglage de confidentialité) ou au moindre pépin — l'insert n'attend pas plus de ~6 s.
 */
async function fetchAvatar(db: any, userId: number): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const t = (ms: number) => AbortSignal.timeout(ms);
    const photos = await (await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${userId}&limit=1`, { signal: t(2500) })).json();
    const sizes = photos?.result?.photos?.[0];
    if (!Array.isArray(sizes) || !sizes.length) return null; // pas de photo (ou masquée)
    const fileId = sizes[0].file_id; // la plus petite (~160px) suffit pour un avatar
    const file = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, { signal: t(2500) })).json();
    const path = file?.result?.file_path;
    if (!path) return null;
    const img = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { signal: t(3000) });
    if (!img.ok) return null;
    const bytes = await img.arrayBuffer();
    const key = `${userId}.jpg`;
    const { error } = await db.storage.from('tg-avatars').upload(key, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) return null;
    return db.storage.from('tg-avatars').getPublicUrl(key).data.publicUrl;
  } catch {
    return null;
  }
}

/**
 * DM AUTOMATIQUE au demandeur d'adhésion (30/07 — le bot qui faisait ça sur l'ancien canal est mort).
 * Telegram AUTORISE un bot admin à écrire à quelqu'un qui vient d'envoyer une demande d'adhésion, même
 * sans conversation préalable (Bot API 5.4+) — c'est la SEULE fenêtre où c'est permis, d'où l'envoi ici,
 * tout de suite. Échoue si la personne a bloqué le bot ou a des réglages stricts → best effort, on note
 * juste le résultat (dm_status) pour mesurer le taux réel.
 * Le message ne fait PAS patienter les mains vides : il envoie sur l'APP (décision Mathieu 30/07 — « le
 * temps qu'ils soient acceptés ils installent l'appli, ils sont déjà à moitié closés »). Pas de canal de
 * secours ici : proposer un 2e canal à quelqu'un qui n'est pas encore entré dans le 1er n'a aucun sens —
 * et si le canal principal tombait, telegram_joins garde tous les user_id pour un broadcast.
 * Texte surchargeable sans redéploiement par l'env TELEGRAM_JOIN_DM.
 */
async function sendJoinDm(userId: number, locale: Locale): Promise<'sent' | 'failed' | 'skipped'> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return 'skipped';
  // l'override d'env ne s'applique qu'à l'anglais : sinon poser TELEGRAM_JOIN_DM ré-anglaiserait
  // silencieusement les Italiens (le genre de régression qu'on ne voit qu'en lisant les logs du bot).
  const text = locale === 'en' ? (process.env.TELEGRAM_JOIN_DM?.trim() || JOIN_DM[locale]) : JOIN_DM[locale];
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ chat_id: userId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!d.ok) console.error('[telegram] join DM refused:', d.description ?? 'unknown');
    return d.ok ? 'sent' : 'failed';
  } catch (e) {
    console.error('[telegram] join DM failed:', (e as { message?: string })?.message ?? e);
    return 'failed';
  }
}

/** Le post rejoué vient-il d'ailleurs (témoignage VIP transféré par Mathieu) ? */
function isForwarded(post: any): boolean {
  return !!(post?.forward_origin || post?.forward_from || post?.forward_from_chat || post?.forward_sender_name);
}

/**
 * MIROIR EN → EN (01/08) : un second canal anglais racheté avec sa communauté (2 300 membres déjà
 * qualifiés) rejoue à l'identique tout ce qui part du canal principal.
 *
 * DEUX RÉGIMES, et c'est le post qui décide :
 *  · POST NORMAL → copyMessage. Le forward afficherait « Transféré de Algoria » et trahirait le montage ;
 *    la copie republie comme un post natif. Gère aussi les BULLES VIDÉO, que la traduction ne sait pas
 *    traiter : ce canal-là reçoit donc 100 % du contenu, sans intervention humaine.
 *  · TÉMOIGNAGE (post déjà transféré : un VIP écrit à Mathieu, il le relaie sur le canal) → forwardMessage.
 *    Ici l'étiquette « Transféré de <VIP> » N'EST PAS un défaut, c'est TOUTE la preuve sociale : copier
 *    la retirerait et laisserait un screenshot anonyme. Telegram garde l'auteur D'ORIGINE quand on
 *    retransfère un transfert — le miroir affiche donc le VIP, jamais le canal principal.
 *    (VIP en profil privé → Telegram affiche son nom sans lien : c'est sa limite, pas la nôtre.)
 */
async function mirrorChannelPost(db: any, post: any, dst: string): Promise<void> {
  const src = (process.env.TELEGRAM_CHANNEL_EN ?? '').trim();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!src || !dst || !token) return;
  const chatId = String(post?.chat?.id ?? '');
  const messageId = Number(post?.message_id) || 0;
  if (chatId !== src || !messageId) return;

  const testimonial = isForwarded(post);
  const { error: lockErr } = await db.from('channel_translations').insert({ src_chat_id: Number(chatId), src_message_id: messageId, dst_chat_id: Number(dst), kind: testimonial ? 'mirror_fwd' : 'mirror' });
  if (lockErr) return;
  const finish = (patch: Record<string, unknown>) =>
    db.from('channel_translations').update(patch).eq('src_chat_id', Number(chatId)).eq('src_message_id', messageId).eq('dst_chat_id', Number(dst));

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${testimonial ? 'forwardMessage' : 'copyMessage'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ chat_id: dst, from_chat_id: chatId, message_id: messageId }),
    });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (d.ok) await finish({ status: 'sent', dst_message_id: d.result?.message_id ?? null });
    else await finish({ status: 'failed', error: (d.description ?? 'unknown').slice(0, 200) });
  } catch (e) {
    await finish({ status: 'failed', error: String((e as { message?: string })?.message ?? e).slice(0, 200) });
  }
}

/**
 * PONT DE TRADUCTION EN → IT (01/08) : tout ce que Mathieu poste sur le canal anglais part traduit sur
 * le canal italien, sans intervention. La CM garde les bulles vidéo (non traduisibles) — le bot la
 * prévient au lieu de la laisser surveiller le canal.
 *
 * Trois pièges traités ici :
 *  · DOUBLON — Telegram retente un webhook lent, et traduire prend 1-3 s. La ligne channel_translations
 *    est insérée AVANT la traduction : si l'insert casse sur la contrainte d'unicité, un autre passage
 *    s'en occupe déjà, on sort.
 *  · BOUCLE — on ne traite QUE le canal source déclaré (TELEGRAM_CHANNEL_EN). Le bot étant admin du
 *    canal italien, ses propres posts lui reviennent : sans ce filtre, il se traduirait lui-même.
 *  · MESSAGE CASSÉ — traduction vide ou en échec → on ne poste RIEN. Un trou côté italien se rattrape
 *    à la main ; un post mutilé devant l'audience, non.
 */
async function bridgeChannelPost(db: any, post: any, dst: string): Promise<void> {
  const src = (process.env.TELEGRAM_CHANNEL_EN ?? '').trim();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!src || !dst || !token) return; // pont non configuré → aucun effet
  const chatId = String(post?.chat?.id ?? '');
  const messageId = Number(post?.message_id) || 0;
  if (chatId !== src || !messageId) return;

  // verrou d'idempotence PAR DESTINATION : si la traduction échoue, le miroir ne doit pas être rejoué
  // (et inversement). C'est l'insert qui gagne la course, pas une lecture préalable.
  const { error: lockErr } = await db.from('channel_translations').insert({ src_chat_id: Number(chatId), src_message_id: messageId, dst_chat_id: Number(dst) });
  if (lockErr) return; // doublon (retry Telegram) ou base indisponible → on ne poste pas deux fois

  const finish = (patch: Record<string, unknown>) =>
    db.from('channel_translations').update(patch).eq('src_chat_id', Number(chatId)).eq('src_message_id', messageId).eq('dst_chat_id', Number(dst));

  // TÉMOIGNAGES : PAS DE RELAI AUTOMATIQUE VERS L'ITALIEN (décision Mathieu, 03/08).
  // Un message transféré ne peut pas être traduit — le modifier impose copyMessage, qui efface
  // « Transféré de <VIP> » et transforme la preuve en screenshot anonyme. Toutes les variantes
  // automatiques essayées butent sur ce mur : soit la langue, soit l'auteur.
  // Sur ce canal, c'est donc la CM qui recrée les témoignages en italien, à la main. Le relayer
  // quand même obligerait à supprimer le doublon à chaque fois — du travail en plus, pas en moins.
  // Le miroir ANGLAIS (canal principal → canal UK) garde le transfert : là, aucune traduction
  // n'est en jeu, l'attribution du VIP passe telle quelle.
  if (isForwarded(post)) {
    await finish({ status: 'skipped', kind: 'testimonial_manual' });
    const cm = (process.env.TELEGRAM_CM_IT_ID ?? '').trim();
    if (cm) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ chat_id: cm, text: "⭐️ Nuova testimonianza VIP sul canale EN — NON è stata inoltrata sul canale IT (scelta voluta). Ricreala tu in italiano quando puoi." }),
      }).catch(() => {});
    }
    return;
  }

  const text: string = typeof post.text === 'string' ? post.text : '';
  const caption: string = typeof post.caption === 'string' ? post.caption : '';
  const raw = text || caption;

  // Rien à traduire (bulle vidéo, média nu, sondage…) → on alerte la CM, qui reste maîtresse du format.
  if (!raw.trim()) {
    const cm = (process.env.TELEGRAM_CM_IT_ID ?? '').trim();
    if (cm) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ chat_id: cm, text: "🎥 Nuovo post senza testo sul canale EN (video bubble o media) — da tradurre e ripubblicare a mano sul canale IT." }),
      }).catch(() => {});
    }
    await finish({ status: 'skipped', kind: 'manual' });
    return;
  }

  const html = entitiesToHtml(raw, text ? post.entities : post.caption_entities);
  const translated = await translateToItalian(html);
  // Traduction vide OU refusée par le garde-fou de sortie (le modèle a bavardé au lieu de traduire —
  // incident du 11/08, voir lib/member/translate.ts). On ne poste RIEN, mais on ne perd pas le post
  // en silence : la CM est prévenue et republie à la main, comme pour les bulles vidéo.
  if (!translated) {
    await finish({ status: 'failed', error: 'translation rejected' });
    const cm = (process.env.TELEGRAM_CM_IT_ID ?? '').trim();
    if (cm) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ chat_id: cm, text: "⚠️ Traduzione NON riuscita per un post del canale EN — niente è stato pubblicato sul canale IT. Traducilo e pubblicalo a mano." }),
      }).catch(() => {});
    }
    return;
  }

  try {
    // média + légende → copyMessage rejoue le média avec la légende traduite (une seule requête).
    // texte pur → sendMessage.
    const endpoint = caption && !text ? 'copyMessage' : 'sendMessage';
    const body = caption && !text
      ? { chat_id: dst, from_chat_id: chatId, message_id: messageId, caption: translated, parse_mode: 'HTML' }
      : { chat_id: dst, text: translated, parse_mode: 'HTML', disable_web_page_preview: true };
    const r = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify(body),
    });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (d.ok) await finish({ status: 'sent', kind: caption && !text ? 'caption' : 'text', dst_message_id: d.result?.message_id ?? null });
    else await finish({ status: 'failed', error: (d.description ?? 'unknown').slice(0, 200) });
  } catch (e) {
    await finish({ status: 'failed', error: String((e as { message?: string })?.message ?? e).slice(0, 200) });
  }
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_KEY;
  const db = url && service ? createClient(url, service, { auth: { persistSession: false } }) : null;
  if (!db) console.error('[telegram] SUPABASE_SERVICE_KEY / NEXT_PUBLIC_SUPABASE_URL manquants');

  // CARNET D'ADRESSES DES CANAUX (01/08) : un canal Telegram n'a pas de « lien » exploitable côté API,
  // il a un ID numérique (-100…) invisible dans l'interface. Dès que le bot est admin quelque part
  // (ajout = my_chat_member, ou premier post = channel_post), on note l'ID et le titre : l'admin lit la
  // liste et copie l'ID dans les variables d'environnement. Fini le passage par un bot tiers.
  // chat_member inclus : sur un canal vivant, une entrée ou une sortie de membre suffit à le révéler —
  // pas besoin d'attendre que Mathieu y publie. Un canal racheté avec sa communauté bouge tout seul.
  const seenChat = update?.channel_post?.chat ?? update?.my_chat_member?.chat ?? update?.chat_member?.chat ?? update?.chat_join_request?.chat ?? null;
  if (db && seenChat?.id && (seenChat.type === 'channel' || seenChat.type === 'supergroup')) {
    await db.from('telegram_chats').upsert(
      { chat_id: Number(seenChat.id), title: String(seenChat.title ?? '').slice(0, 120) || null, type: String(seenChat.type), username: seenChat.username ? String(seenChat.username) : null, last_seen_at: new Date().toISOString() },
      { onConflict: 'chat_id' },
    ).then(() => {}, () => {});
  }

  // POST DE CANAL → pont de traduction EN → IT (channel_post doit être dans allowed_updates du webhook).
  // edited_channel_post volontairement IGNORÉ : republier une correction créerait un second post italien
  // sans supprimer le premier — la CM corrige à la main les rares cas.
  // FAN-OUT du canal principal : miroir anglais (copie conforme) + canal italien (traduction).
  // Le miroir d'abord : il est instantané, alors que la traduction attend le modèle. Les deux ont leur
  // propre verrou, donc l'échec de l'un ne rejoue jamais l'autre.
  if (db && update?.channel_post) {
    const mirror = (process.env.TELEGRAM_CHANNEL_MIRROR ?? '').trim();
    const it = (process.env.TELEGRAM_CHANNEL_IT ?? '').trim();
    if (mirror) await mirrorChannelPost(db, update.channel_post, mirror);
    if (it) await bridgeChannelPost(db, update.channel_post, it);
  }

  // DEMANDE d'adhésion → entre en waitlist (status 'waiting') + DM instantané au demandeur.
  // ATTRIBUTION : invite_link porte le lien exact utilisé — un lien nommé par campagne (« META-UK-JUL »)
  // relie enfin une pub à ses demandes, alors que les ads pointent vers le canal et pas vers l'app.
  const jr = update?.chat_join_request;
  if (db && jr?.from) {
    const userId = Number(jr.from.id) || null;
    // LANGUE = le canal qui a reçu la demande (01/08, ouverture Italie). Pas la langue Telegram du
    // compte : un Italien peut avoir Telegram en anglais, mais s'il rejoint le canal italien il veut
    // être servi en italien.
    const locale = localeForChat(jr.chat?.id);
    // UN SEUL MESSAGE DE BIENVENUE PAR PERSONNE (01/08). Trois canaux ouverts (principal, UK, IT) et une
    // demande d'adhésion peut être annulée puis refaite : sans garde, le prospect reçoit deux fois le même
    // accueil — l'impression d'un bot cassé, dès la première seconde. Fenêtre de 48 h : elle couvre le
    // multi-canal et le re-clic, sans museler celui qui revient une semaine plus tard.
    let dmStatus: string = 'skipped';
    if (userId) {
      const since = new Date(Date.now() - 48 * 3600_000).toISOString();
      const { data: already } = await (db as any).from('telegram_joins')
        .select('id').eq('user_id', userId).eq('dm_status', 'sent').gte('joined_at', since).limit(1) as { data: Array<{ id: number }> | null };
      // le DM part AVANT l'avatar : la fenêtre d'autorisation Telegram est liée à la demande en cours,
      // et 6 s de récupération de photo avant d'écrire, c'est 6 s d'attente pour le prospect.
      dmStatus = already?.length ? 'duplicate' : await sendJoinDm(userId, locale);
    }
    // si la personne a DÉJÀ un compte (re-demande, autre canal), on aligne sa langue sur ce canal
    if (userId && locale !== 'en') await (db as any).from('members').update({ locale }).eq('tg_id', userId);
    const photoUrl = userId ? await fetchAvatar(db, userId) : null; // avant l'insert → le spotlight arrive avec la photo
    const { error } = await (db as any).from('telegram_joins').insert({
      user_id: userId,
      username: jr.from.username ?? null,
      first_name: jr.from.first_name ?? null,
      photo_url: photoUrl,
      status: 'waiting',
      // chat_id : requis par approveChatJoinRequest — c'est lui qui rend l'auto-approbation possible
      chat_id: jr.chat?.id ?? null,
      invite_link: jr.invite_link?.invite_link ?? null,
      invite_name: jr.invite_link?.name ?? null,
      dm_status: dmStatus,
    });
    if (error) console.error('[telegram] insert failed:', error.message);
  }

  // ACCEPTATION (le streamer approuve en live) : chat_member left/kicked → member.
  // On passe la ligne en 'accepted' (spotlight doré "GOT IN") ; si la demande date d'avant le webhook
  // (backlog), on l'insère directement en 'accepted' — les drops du backlog s'affichent donc aussi.
  const cm = update?.chat_member;
  const becameMember = cm?.new_chat_member?.status === 'member' && ['left', 'kicked'].includes(cm?.old_chat_member?.status);
  if (db && becameMember && cm.new_chat_member.user) {
    const u = cm.new_chat_member.user;
    const acceptedAt = new Date().toISOString();
    try {
      const filter = u.username ? `user_id.eq.${u.id},username.eq.${u.username}` : `user_id.eq.${u.id}`;
      const { data: rows } = await (db as any)
        .from('telegram_joins').select('id').or(filter).eq('status', 'waiting')
        .order('joined_at', { ascending: false }).limit(1);
      if (rows?.length) {
        await (db as any).from('telegram_joins').update({ status: 'accepted', accepted_at: acceptedAt, user_id: u.id }).eq('id', rows[0].id);
      } else {
        const photoUrl = await fetchAvatar(db, u.id);
        await (db as any).from('telegram_joins').insert({
          user_id: u.id, username: u.username ?? null, first_name: u.first_name ?? null,
          photo_url: photoUrl, status: 'accepted', accepted_at: acceptedAt,
        });
      }
    } catch (e) {
      console.error('[telegram] accept handling failed:', (e as { message?: string })?.message ?? e);
    }
  }

  // CONNEXION NATIVE de l'app membre : /start lg_<code> (deep-link depuis app.algoria.tech/member/login).
  // On confirme le code avec l'identité Telegram de l'expéditeur → la page de login (en polling) pose la session.
  // Nécessite "message" dans allowed_updates du webhook.
  // ⚠️ CE WEBHOOK EST LE SEUL DU BOT (Telegram n'en autorise qu'UN) : login + waitlist live + inbox vivent
  // ICI. Ne JAMAIS enregistrer une autre URL de webhook — vécu 26/07 : une route inbox séparée a écrasé
  // celle-ci et cassé la connexion de tous les membres pendant une soirée.
  const msg = update?.message;
  const startPayload = typeof msg?.text === 'string' ? msg.text.match(/^\/start\s+lg_([A-Za-z0-9]{16,64})$/) : null;
  if (db && startPayload && msg?.from?.id) {
    const code = startPayload[1];
    const u = msg.from;
    try {
      // code encore pendant et frais (< 10 min) uniquement — sinon on ignore (anti-rejeu)
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: rows } = await (db as any)
        .from('member_login_codes').select('code').eq('code', code).eq('status', 'pending').gte('created_at', cutoff).limit(1);
      if (rows?.length) {
        const photoUrl = await fetchAvatar(db, u.id);
        await (db as any).from('member_login_codes').update({
          status: 'confirmed', tg_id: u.id, tg_username: u.username ?? null,
          tg_name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id),
          photo_url: photoUrl, confirmed_at: new Date().toISOString(),
        }).eq('code', code).eq('status', 'pending');
        // petit accusé dans Telegram (best effort) — l'utilisateur sait qu'il peut revenir sur l'app
        const { data: lrow } = await (db as any).from('members').select('locale').eq('tg_id', u.id).limit(1);
        const loginLocale = asLocale(lrow?.[0]?.locale);
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          // BOUTON DE RETOUR — indispensable quand la personne est arrivée sur l'app depuis un lien
          // Telegram : le navigateur INTÉGRÉ de Telegram a emporté l'onglet qui interrogeait le serveur,
          // donc « reviens sur l'app » ne mène nulle part et la connexion, pourtant validée ici, reste
          // bloquée sur l'écran d'attente. Le bouton la termine en un tap, dans la conversation où la
          // personne se trouve déjà. (Forcer un navigateur externe n'est pas une option : impossible sur
          // iPhone, et intent:// ne couvrirait qu'Android.) Le polling de /member/login reste le chemin
          // normal quand l'onglet a survécu — /member/login/confirm accepte un code déjà consommé.
          // Le bouton ci-dessus n'atteint PAS une app ajoutée à l'écran d'accueil (stockage séparé de
          // Safari) : on joint donc un code à 6 chiffres, la seule forme qui traverse deux magasins de
          // cookies. Émission best effort — si elle échoue, le message part avec le seul bouton.
          const shortCode = await issueShortCode(db, u, photoUrl).catch(() => null);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
            body: JSON.stringify({
              chat_id: u.id,
              text: SIGNED_IN[loginLocale] + (shortCode ? SIGNED_IN_CODE_HINT[loginLocale].replace('%s', shortCode) : ''),
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: SIGNED_IN_BTN[loginLocale], url: `https://app.algoria.tech/member/login/confirm?c=${code}` }]] },
            }),
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[telegram] login code failed:', (e as { message?: string })?.message ?? e);
    }
  }

  // /code — DONNER UN CODE À 6 CHIFFRES à la demande. Indispensable pour l'app ajoutée à l'écran d'accueil :
  // son stockage est séparé de celui du navigateur, donc ni le polling ni le bouton ne l'atteignent, et la
  // personne tourne en boucle entre l'app et Telegram (signalé par un prospect le 13/08). Six chiffres se
  // recopient là où la session est voulue. L'identité est celle de l'expéditeur, authentifiée par Telegram.
  const wantsCode = typeof msg?.text === 'string' && /^\/(code|login)\b/i.test(msg.text.trim());
  if (db && wantsCode && msg?.from?.id && msg.chat?.type === 'private') {
    const u = msg.from;
    try {
      const photoUrl = await fetchAvatar(db, u.id);
      const short = await issueShortCode(db, u, photoUrl);
      const { data: lrow } = await (db as any).from('members').select('locale').eq('tg_id', u.id).limit(1);
      const loc = asLocale(lrow?.[0]?.locale);
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token && short) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
          body: JSON.stringify({ chat_id: u.id, text: LOGIN_CODE_MSG[loc].replace('%s', short), parse_mode: 'HTML' }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[telegram] short login code failed:', (e as { message?: string })?.message ?? e);
    }
  }

  // 🤖 BOÎTE DE RÉCEPTION DU BOT — tout DM privé qui n'est PAS un /start de login : enregistré
  // (member_actions kind='bot_reply' → fil BOT ACTIVITY de l'admin, réponse via le bot possible)
  // + UN accusé de réception routant vers l'humain, dédupliqué 6 h (anti-spam).
  // `wantsCode` exclu comme les /start : une demande de code est une commande, pas un message pour le
  // support — sans ça chaque /code déclencherait un accusé de réception et une carte dans BOT ACTIVITY.
  if (db && msg?.from && !msg.from.is_bot && msg.chat?.type === 'private' && !startPayload && !wantsCode && !(typeof msg.text === 'string' && msg.text.startsWith('/start'))) {
    try {
      const text = (typeof msg.text === 'string' ? msg.text : typeof msg.caption === 'string' ? msg.caption : '').slice(0, 1500) || '[media]';
      const tgId = Number(msg.from.id);
      const { data: mrow } = await (db as any).from('members').select('member_no,locale').eq('tg_id', tgId).limit(1);
      const { data: recent } = await (db as any).from('member_actions').select('id').eq('tg_id', tgId).eq('kind', 'bot_reply')
        .gte('created_at', new Date(Date.now() - 6 * 3_600_000).toISOString()).limit(1);
      await (db as any).from('member_actions').insert({
        tg_id: tgId, member_no: mrow?.[0]?.member_no ?? null, kind: 'bot_reply', status: 'done', done_by: 'telegram',
        detail: { text, username: msg.from.username ?? null, name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || null },
      });
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token && !recent?.length) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
          body: JSON.stringify({
            chat_id: tgId,
            text: INBOX_ACK[asLocale((mrow?.[0] as { locale?: string } | undefined)?.locale)],
            disable_web_page_preview: true,
          }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[telegram] bot inbox failed:', (e as { message?: string })?.message ?? e);
    }
  }

  // Toujours 200 : Telegram retente sinon, et on ne veut pas de boucle de retry sur un update qu'on ignore.
  return NextResponse.json({ ok: true });
}

/** Health check (GET) — vérifie le déploiement + la présence des env, sans rien divulguer. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      webhook_secret: !!process.env.TELEGRAM_WEBHOOK_SECRET,
      service_key: !!process.env.SUPABASE_SERVICE_KEY,
      bot_token: !!process.env.TELEGRAM_BOT_TOKEN, // requis pour les photos de profil
    },
  });
}
