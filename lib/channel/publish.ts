// PUBLIER SUR LES CANAUX (16/08/2026), sorti de app/api/member/admin/route.ts le 02/10/2026 pour servir aussi le
// récap du soir (lib/channel/recap.ts). Même chemin, même résultat : la source, le miroir UK à l'identique, le
// canal italien TRADUIT.
//
// ⚠️ POURQUOI ON PUBLIE SUR LES TROIS CANAUX D'ICI, et pas seulement sur la source.
// Première version : publier sur la source et laisser le fan-out habituel (miroir UK + pont italien)
// faire le reste. Ça n'a RIEN envoyé ailleurs, et la raison est une règle de fond du Bot API :
// UN BOT NE REÇOIT JAMAIS D'UPDATE POUR SES PROPRES MESSAGES. Le fan-out se déclenche sur
// `channel_post` ; quand c'est le bot qui publie, cet update n'existe pas. Le relais fonctionne pour
// les posts écrits À LA MAIN dans le canal, jamais pour ceux envoyés par l'API.
// On diffuse donc explicitement : source telle quelle, miroir UK à l'identique (même langue), canal
// italien avec le texte TRADUIT et le même bouton.
//
// ANTI-DOUBLON : on pose quand même les verrous dans channel_translations. Si un update arrivait
// malgré tout, mirrorChannelPost et bridgeChannelPost verraient la ligne déjà là et s'arrêteraient —
// c'est l'insert qui gagne la course dans leur logique, pas une lecture.

export type ChannelReport = Array<{ channel: string; ok: boolean; error?: string }>;
export type PublishResult = { ok: true; messageId: number | null; report: ChannelReport } | { ok: false; error: string; report: ChannelReport };

/** Le canal source (celui que le miroir et le pont italien relaient). */
export const sourceChannel = () => (process.env.TELEGRAM_CHANNEL_EN ?? '').trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function publishToChannels(db: any, p: { chatId: string; text: string; buttonText?: string; buttonUrl?: string }): Promise<PublishResult> {
  const report: ChannelReport = [];
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN missing', report };
  const chatId = p.chatId.trim();
  const text = p.text.trim().slice(0, 4000);
  const btnText = (p.buttonText ?? '').trim().slice(0, 60);
  const btnUrl = (p.buttonUrl ?? '').trim().slice(0, 300);
  const kb = btnText ? { reply_markup: { inline_keyboard: [[{ text: btnText, url: btnUrl }]] } } : {};
  const send = async (dst: string, body_: string): Promise<{ ok: boolean; messageId: number | null; error: string }> => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ chat_id: dst, text: body_, parse_mode: 'HTML', disable_web_page_preview: true, ...kb }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
      return d.ok ? { ok: true, messageId: d.result?.message_id ?? null, error: '' } : { ok: false, messageId: null, error: d.description ?? 'unknown' };
    } catch (e) {
      return { ok: false, messageId: null, error: String((e as { message?: string })?.message ?? e) };
    }
  };

  const src = sourceChannel();
  const mirror = (process.env.TELEGRAM_CHANNEL_MIRROR ?? '').trim();
  const it = (process.env.TELEGRAM_CHANNEL_IT ?? '').trim();

  // 1) le canal demandé
  const main = await send(chatId, text);
  report.push({ channel: 'source', ok: main.ok, ...(main.ok ? {} : { error: main.error }) });
  if (!main.ok) return { ok: false, error: `Telegram refused: ${main.error}`, report };

  // 2) les relais — UNIQUEMENT si on vient de publier sur la source (sinon on serait en train de
  //    rediffuser un post déjà destiné à un canal précis).
  if (chatId === src) {
    const lock = async (dst: string, messageId: number | null, kind: string, error?: string) => {
      try {
        await db.from('channel_translations').insert({
          src_chat_id: Number(chatId), src_message_id: Number(main.messageId ?? 0), dst_chat_id: Number(dst),
          dst_message_id: messageId, status: error ? 'failed' : 'sent', kind, error: error?.slice(0, 200) ?? null,
        });
      } catch { /* le verrou est un confort, pas une condition */ }
    };
    if (mirror) {
      const m = await send(mirror, text); // même langue : le miroir UK reçoit le texte tel quel
      report.push({ channel: 'mirror UK', ok: m.ok, ...(m.ok ? {} : { error: m.error }) });
      await lock(mirror, m.messageId, 'mirror_api', m.ok ? undefined : m.error);
    }
    if (it) {
      // Le canal italien reçoit une TRADUCTION, avec le même bouton (son libellé reste en anglais :
      // le traduire demanderait un second appel au modèle pour deux mots, avec le risque de bavardage
      // documenté dans lib/member/translate.ts).
      const { translateToItalian } = await import('@/lib/member/translate');
      const translated = await translateToItalian(text);
      if (!translated) {
        report.push({ channel: 'canale IT', ok: false, error: 'translation rejected — post it by hand' });
        await lock(it, null, 'text_api', 'translation rejected');
      } else {
        const i = await send(it, translated);
        report.push({ channel: 'canale IT', ok: i.ok, ...(i.ok ? {} : { error: i.error }) });
        await lock(it, i.messageId, 'text_api', i.ok ? undefined : i.error);
      }
    }
  }
  return { ok: true, messageId: main.messageId, report };
}
