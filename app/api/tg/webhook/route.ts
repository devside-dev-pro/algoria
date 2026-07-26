// BOÎTE DE RÉCEPTION DU BOT (webhook Telegram) — avant ça, les RÉPONSES des prospects au bot partaient
// dans le VIDE (vécu 27/07 : une prospect a « parlé au bot », zéro trace). Désormais chaque DM privé reçu :
//   1) est enregistré en base (member_actions kind='bot_reply', status='done' → jamais dans la file) ;
//   2) reçoit UN accusé de réception qui route vers l'humain (@mathieu_algoria) + l'app — dédupliqué 6 h
//      pour ne jamais spammer quelqu'un qui envoie plusieurs messages d'affilée.
// Sécurité : secret_token dérivé du bot token (sha256) — Telegram le renvoie dans chaque requête, on rejette
// tout le reste. Activation en un clic depuis l'admin (TOOLS → ENABLE BOT INBOX) : pas de nouvel env.
import { NextResponse, type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';
import { tgWebhookSecret } from '@/lib/member/tgwebhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TgUpdate {
  message?: {
    message_id: number;
    from?: { id: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string };
    chat?: { id: number; type?: string };
    text?: string;
    caption?: string;
  };
}

export async function POST(req: NextRequest) {
  const secret = tgWebhookSecret();
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return NextResponse.json({ ok: false }, { status: 403 });
  const update = (await req.json().catch(() => ({}))) as TgUpdate;
  const msg = update.message;
  // uniquement les DM PRIVÉS d'humains — le bot est admin du canal VIP : les posts de canal et les groupes
  // ne doivent JAMAIS atterrir ici (ni recevoir d'accusé de réception).
  if (!msg?.from || msg.from.is_bot || msg.chat?.type !== 'private') return NextResponse.json({ ok: true });
  const text = (msg.text ?? msg.caption ?? '').slice(0, 1500) || '[media]';
  const tgId = Number(msg.from.id);
  const db = sdb();

  const { data: m } = await db.from('members').select('member_no').eq('tg_id', tgId).limit(1);
  // accusé de réception : seulement si AUCUNE réponse enregistrée dans les 6 dernières heures (anti-spam)
  const { data: recent } = await db.from('member_actions').select('id').eq('tg_id', tgId).eq('kind', 'bot_reply')
    .gte('created_at', new Date(Date.now() - 6 * 3_600_000).toISOString()).limit(1);
  await db.from('member_actions').insert({
    tg_id: tgId, member_no: m?.[0]?.member_no ?? null, kind: 'bot_reply', status: 'done', done_by: 'telegram',
    detail: { text, username: msg.from.username ?? null, name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || null } as never,
  });
  if (!recent?.length) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    void fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgId,
        text: "Got your message 🙌 A real human reads these — Mathieu will get back to you personally.\n\nFor a faster answer, message him directly: @mathieu_algoria\nYour app: app.algoria.tech/member",
        disable_web_page_preview: true,
      }),
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
