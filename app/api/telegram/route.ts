import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { JOIN_DM, INBOX_ACK, SIGNED_IN, localeForChat, asLocale, type Locale } from '@/lib/member/i18n';

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
    // le DM part AVANT l'avatar : la fenêtre d'autorisation Telegram est liée à la demande en cours,
    // et 6 s de récupération de photo avant d'écrire, c'est 6 s d'attente pour le prospect.
    const dmStatus = userId ? await sendJoinDm(userId, locale) : 'skipped';
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
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
            body: JSON.stringify({ chat_id: u.id, text: SIGNED_IN[loginLocale] }),
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[telegram] login code failed:', (e as { message?: string })?.message ?? e);
    }
  }

  // 🤖 BOÎTE DE RÉCEPTION DU BOT — tout DM privé qui n'est PAS un /start de login : enregistré
  // (member_actions kind='bot_reply' → fil BOT ACTIVITY de l'admin, réponse via le bot possible)
  // + UN accusé de réception routant vers l'humain, dédupliqué 6 h (anti-spam).
  if (db && msg?.from && !msg.from.is_bot && msg.chat?.type === 'private' && !startPayload && !(typeof msg.text === 'string' && msg.text.startsWith('/start'))) {
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
