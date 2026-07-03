import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  // DEMANDE d'adhésion → entre en waitlist (status 'waiting').
  // Pas de DM ici : un autre bot du canal envoie déjà les instructions aux demandeurs (éviter le double message).
  const jr = update?.chat_join_request;
  if (db && jr?.from) {
    const photoUrl = jr.from.id ? await fetchAvatar(db, jr.from.id) : null; // avant l'insert → le spotlight arrive avec la photo
    const { error } = await (db as any).from('telegram_joins').insert({
      user_id: jr.from.id ?? null,
      username: jr.from.username ?? null,
      first_name: jr.from.first_name ?? null,
      photo_url: photoUrl,
      status: 'waiting',
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
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
            body: JSON.stringify({ chat_id: u.id, text: '✅ Signed in — head back to the Algoria app.' }),
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[telegram] login code failed:', (e as { message?: string })?.message ?? e);
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
