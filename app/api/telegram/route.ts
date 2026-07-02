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
//   SUPABASE_SERVICE_KEY    — insert côté serveur (la table est en lecture seule pour anon)
// Enregistrement du webhook (navigateur, TOKEN = celui du bot @BotFather) :
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
    // Pas de DM ici : un autre bot du canal envoie déjà les instructions aux demandeurs (éviter le double message).
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
    },
  });
}
