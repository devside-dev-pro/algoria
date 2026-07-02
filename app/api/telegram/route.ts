import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Webhook Telegram (bot admin du canal) → alimente la WAITLIST du widget /join.
// Flux : un viewer clique le lien d'invitation "demander à rejoindre" → Telegram POSTe un chat_join_request ici
// → insert dans telegram_joins (Supabase realtime → spotlight du widget en ~1 s) → le bot DM le demandeur
// ("you're on the waitlist — watch the live"). AUCUNE auto-approbation : l'acceptation se fait EN LIVE (le show).
//
// Env Vercel (server-only) :
//   TELEGRAM_BOT_TOKEN      — token @BotFather (sert au DM de confirmation)
//   TELEGRAM_WEBHOOK_SECRET — chaîne aléatoire ; Telegram la renvoie en header X-Telegram-Bot-Api-Secret-Token
//   SUPABASE_SERVICE_KEY    — insert côté serveur (la table est en lecture seule pour anon)
// Enregistrement du webhook (navigateur) :
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://algoria.tech/api/telegram&secret_token=<SECRET>&allowed_updates=%5B%22chat_join_request%22%5D

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

  const jr = update?.chat_join_request;
  if (jr?.from) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_KEY;
    if (url && service) {
      const db = createClient(url, service, { auth: { persistSession: false } });
      const { error } = await db.from('telegram_joins' as never).insert({
        username: jr.from.username ?? null,
        first_name: jr.from.first_name ?? null,
      } as never);
      if (error) console.error('[telegram] insert failed:', error.message);
    } else {
      console.error('[telegram] SUPABASE_SERVICE_KEY / NEXT_PUBLIC_SUPABASE_URL manquants');
    }

    // DM de confirmation (autorisé par Telegram tant que la demande n'est pas traitée) — best effort.
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const userChatId = jr.user_chat_id ?? jr.from.id;
    if (token && userChatId) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: userChatId,
            text: "🎟 You're on the ALGORIA waitlist!\nYour name just showed up on the live stream.\n\n🔓 Batches get accepted LIVE — stay on the stream to get in.",
          }),
        });
      } catch (e) {
        console.error('[telegram] DM failed:', (e as { message?: string })?.message ?? e);
      }
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
      bot_token: !!process.env.TELEGRAM_BOT_TOKEN,
      webhook_secret: !!process.env.TELEGRAM_WEBHOOK_SECRET,
      service_key: !!process.env.SUPABASE_SERVICE_KEY,
    },
  });
}
