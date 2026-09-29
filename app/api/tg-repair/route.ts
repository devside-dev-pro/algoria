// RÉPARATION DU WEBHOOK BOT (GET, sans auth) — ré-applique la config CANONIQUE et rien d'autre :
// url /api/telegram + TELEGRAM_WEBHOOK_SECRET + allowed_updates complets. Volontairement ouvert :
// l'appeler ne peut que RÉPARER (idempotent, aucune entrée utilisateur) — jamais casser ni divulguer.
// Né de l'incident du 26/07 (webhook écrasé → login mort) : permet à l'assistant/au support de réparer
// à distance sans identifiants admin ni accès à l'ordi. Throttle 30 s pour ménager l'API Telegram.
import { NextResponse } from 'next/server';
import { TG_ALLOWED_UPDATES } from '@/lib/member/tgWebhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let lastRepair = 0;

export async function GET() {
  if (Date.now() - lastRepair < 30_000) return NextResponse.json({ ok: true, throttled: true });
  lastRepair = Date.now();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (!token) return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }, { status: 500 });
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: 'https://www.algoria.tech/api/telegram',
      ...(secret ? { secret_token: secret } : {}),
      // la liste canonique (channel_post, my_chat_member, callback_query, business_*…) : voir lib/member/tgWebhook.ts
      allowed_updates: TG_ALLOWED_UPDATES,
    }),
  });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((x) => x.json()).catch(() => ({}));
  const url = String((info as { result?: { url?: string } }).result?.url ?? '');
  return NextResponse.json({ ok: !!d.ok, description: d.description ?? null, webhook: url });
}
