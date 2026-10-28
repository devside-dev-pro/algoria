// RELIER LES CANAUX AU NOUVEAU DOMAINE (22/10/2026, GET, sans auth). algoria.tech a été suspendu par le registre du
// .tech ; tous les boutons et liens déjà publiés dans les canaux pointaient dessus. Mathieu : « tous les CTA du canal
// public et les liens vers l'app ne sont pas bons, il faut tout changer ».
//
// Ce que la route fait, et RIEN d'autre : dans les messages que le BOT a publiés (posts du CM, récaps du soir) sur la
// source, le miroir UK et le canal italien, remplacer algoria.tech par getalgoria.com — bouton et texte ; puis la même
// chose dans la description du bot et celle des canaux. Idempotente (un message déjà corrigé est sauté), sans entrée
// utilisateur : l'appeler ne peut que réparer, comme /api/tg-repair. ?dry=1 = ne fait que compter.
//
// PAR LOTS : Telegram limite à ~20 messages/minute par canal. Chaque appel traite au plus `limit` publications (12 par
// défaut, soit 12 éditions par canal) et dit combien il en reste ; on rappelle la route jusqu'à 0.
// Canal italien : son texte est une TRADUCTION qu'on n'a pas gardée — on y corrige le bouton, pas le texte.
// Les CTA envoyés à la main depuis l'admin (member_actions 'channel_post', bouton seulement) sont repris aussi.
//
// ?strip=1 (22/10/2026, Mathieu : « retire-les ») : RETIRE le bouton des bonjours, How it works et cartes de gain déjà
// publiés — la règle du CM est désormais deux boutons par jour, seulement sur les CTA (lib/channel/cm.ts).
// Dans les deux modes, le dernier lot contrôle aussi le message épinglé de chaque canal.
import { NextResponse, type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';
import { sourceChannel } from '@/lib/channel/publish';
import { extraMirrors } from '@/lib/channel/mirrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OLD = /algoria\.tech/g;
const NEW = 'getalgoria.com';
const has = (s: string | null | undefined) => !!s && /algoria\.tech/.test(s);
const fix = (s: string) => s.replace(OLD, NEW);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let lastRun = 0;

type Target = { chat: string; id: number; it: boolean };
type Row = { kind: 'post' | 'recap' | 'admin' | 'strip'; key: string; messageId: number; text: string; html: string; photo: boolean; btnText: string | null; btnUrl: string | null; detail?: Record<string, unknown> };

export async function GET(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const strip = req.nextUrl.searchParams.get('strip') === '1';
  const limit = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 12) || 12));
  if (!dry && Date.now() - lastRun < 55_000) return NextResponse.json({ ok: true, throttled: true, retryInSec: Math.ceil((55_000 - (Date.now() - lastRun)) / 1000) });
  if (!dry) lastRun = Date.now();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }, { status: 500 });
  const tg = async (method: string, body: Record<string, unknown>) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown; parameters?: { retry_after?: number } } | undefined;
    return d ?? { ok: false, description: 'network error' };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = sdb() as any;
  const src = sourceChannel();
  const mirror = (process.env.TELEGRAM_CHANNEL_MIRROR ?? '').trim();
  const it = (process.env.TELEGRAM_CHANNEL_IT ?? '').trim();
  // MIROIRS SUPPLÉMENTAIRES (28/10/2026, Cashflow — lib/channel/mirrors.ts) : leurs copies se corrigent comme celles du
  // miroir UK, sous leur propre nom dans le rapport. Non posés → liste vide, la route fait exactement ce qu'elle faisait.
  const extras = extraMirrors();
  const extraName = new Map(extras.map((x) => [x.chat, x.name]));
  const chatName = (t: Target) => (t.it ? 'IT' : t.chat === src ? 'source' : extraName.get(t.chat) ?? 'mirror');

  // ── ce qu'il reste à corriger ────────────────────────────────────────────────────────────────────────────
  const [{ data: posts }, { data: recaps }, { data: admin }] = await Promise.all([
    db.from('channel_posts').select('id,kind,message_id,text,button_text,button_url,photo_url').eq('status', 'published').not('message_id', 'is', null).limit(1000),
    db.from('channel_recaps').select('day,message_id,text').eq('status', 'published').not('message_id', 'is', null).limit(1000),
    db.from('member_actions').select('id,detail').eq('kind', 'channel_post').eq('status', 'done').limit(1000),
  ]);
  type PostRow = { id: number; kind: string; message_id: number; text: string | null; button_text: string | null; button_url: string | null; photo_url: string | null };
  const rows: Row[] = strip ? ((posts ?? []) as PostRow[])
    .filter((p) => ['morning', 'howto', 'tp'].includes(p.kind) && !!p.button_url)
    .map((p) => ({ kind: 'strip' as const, key: String(p.id), messageId: Number(p.message_id), text: '', html: '', photo: false, btnText: null, btnUrl: null })) : [
    ...((posts ?? []) as Array<{ id: number; message_id: number; text: string | null; button_text: string | null; button_url: string | null; photo_url: string | null }>)
      .filter((p) => has(p.button_url) || has(p.text))
      .map((p) => ({ kind: 'post' as const, key: String(p.id), messageId: Number(p.message_id), text: p.text ?? '', html: p.text ?? '', photo: !!p.photo_url, btnText: p.button_text, btnUrl: p.button_url })),
    ...((recaps ?? []) as Array<{ day: string; message_id: number; text: string | null }>)
      .filter((r) => has(r.text))
      .map((r) => ({ kind: 'recap' as const, key: String(r.day), messageId: Number(r.message_id), text: r.text ?? '', html: esc(r.text ?? ''), photo: false, btnText: null, btnUrl: null })),
    // le texte gardé est tronqué à 500 caractères : on ne touche qu'au bouton
    ...((admin ?? []) as Array<{ id: string; detail: Record<string, unknown> | null }>)
      .filter((a) => a.detail && String(a.detail.chat_id) === String(src) && a.detail.message_id && a.detail.button && has(String(a.detail.url ?? '')))
      .map((a) => ({ kind: 'admin' as const, key: String(a.id), messageId: Number(a.detail!.message_id), text: '', html: '', photo: false, btnText: String(a.detail!.button), btnUrl: String(a.detail!.url), detail: a.detail! })),
  ];
  const batch = rows.slice(0, limit);

  const report: Array<{ kind: string; key: string; edits: Array<{ chat: string; ok: boolean; error?: string }> }> = [];
  let rateLimited = false;
  if (!dry) {
    for (const row of batch) {
      if (rateLimited) break;
      // les copies du miroir et du canal italien : retrouvées par le verrou anti-doublon de publishToChannels
      const { data: copies } = await db.from('channel_translations').select('dst_chat_id,dst_message_id').eq('src_chat_id', Number(src)).eq('src_message_id', row.messageId).eq('status', 'sent').not('dst_message_id', 'is', null);
      const targets: Target[] = [
        { chat: src, id: row.messageId, it: false },
        ...((copies ?? []) as Array<{ dst_chat_id: number; dst_message_id: number }>)
          .filter((c) => String(c.dst_chat_id) === mirror || String(c.dst_chat_id) === it || extraName.has(String(c.dst_chat_id)))
          .map((c) => ({ chat: String(c.dst_chat_id), id: Number(c.dst_message_id), it: String(c.dst_chat_id) === it })),
      ];
      const markup = row.btnText && row.btnUrl ? { inline_keyboard: [[{ text: row.btnText, url: fix(row.btnUrl) }]] } : undefined;
      const edits: Array<{ chat: string; ok: boolean; error?: string }> = [];
      for (const t of targets) {
        const textChanged = has(row.text) && !t.it;
        let d;
        if (row.kind === 'strip') d = await tg('editMessageReplyMarkup', { chat_id: t.chat, message_id: t.id, reply_markup: { inline_keyboard: [] } });
        else if (textChanged && row.photo) d = await tg('editMessageCaption', { chat_id: t.chat, message_id: t.id, caption: fix(row.html).slice(0, 1024), parse_mode: 'HTML', ...(markup ? { reply_markup: markup } : {}) });
        else if (textChanged) d = await tg('editMessageText', { chat_id: t.chat, message_id: t.id, text: fix(row.html).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
        else if (markup && has(row.btnUrl)) d = await tg('editMessageReplyMarkup', { chat_id: t.chat, message_id: t.id, reply_markup: markup });
        else { edits.push({ chat: chatName(t), ok: true, error: 'nothing to change here' }); continue; }
        const notModified = /not modified|message to edit not found/i.test(d.description ?? ''); // supprimé : plus rien à corriger
        if (d.parameters?.retry_after) rateLimited = true;
        edits.push({ chat: chatName(t), ok: !!d.ok || notModified, ...(d.ok || notModified ? {} : { error: d.description }) });
      }
      report.push({ kind: row.kind, key: row.key, edits });
      // la source est corrigée → la ligne aussi (elle ne sera plus reprise ; le texte stocké suit le message)
      if (edits[0]?.ok && !rateLimited) {
        if (row.kind === 'strip') await db.from('channel_posts').update({ button_text: null, button_url: null }).eq('id', Number(row.key));
        else if (row.kind === 'post') await db.from('channel_posts').update({ text: row.text ? fix(row.text) : row.text, button_url: row.btnUrl ? fix(row.btnUrl) : row.btnUrl }).eq('id', Number(row.key));
        else if (row.kind === 'recap') await db.from('channel_recaps').update({ text: fix(row.text) }).eq('day', row.key);
        else await db.from('member_actions').update({ detail: { ...row.detail, url: fix(row.btnUrl ?? '') } }).eq('id', row.key);
      }
    }
  }

  // ── la vitrine : description du bot et des canaux (une fois, au dernier lot) ────────────────────────────────
  const profile: Array<{ what: string; ok: boolean; changed: boolean; error?: string }> = [];
  if (!dry && rows.length <= batch.length && !rateLimited) {
    for (const [getM, setM, field] of [['getMyDescription', 'setMyDescription', 'description'], ['getMyShortDescription', 'setMyShortDescription', 'short_description']] as const) {
      const g = await tg(getM, {});
      const cur = String((g.result as Record<string, string> | undefined)?.[field] ?? '');
      if (!has(cur)) { profile.push({ what: field, ok: true, changed: false }); continue; }
      const s = await tg(setM, { [field]: fix(cur) });
      profile.push({ what: field, ok: !!s.ok, changed: true, ...(s.ok ? {} : { error: s.description }) });
    }
    for (const [name, chat] of [['source', src], ['mirror', mirror], ['IT', it], ...extras.map((x) => [x.name, x.chat] as const)] as const) {
      if (!chat) continue;
      const g = await tg('getChat', { chat_id: chat });
      const cur = String((g.result as { description?: string } | undefined)?.description ?? '');
      if (!has(cur)) { profile.push({ what: `${name} description`, ok: true, changed: false }); continue; }
      const s = await tg('setChatDescription', { chat_id: chat, description: fix(cur) });
      profile.push({ what: `${name} description`, ok: !!s.ok, changed: true, ...(s.ok ? {} : { error: s.description }) });
    }
    // LE MESSAGE ÉPINGLÉ : son bouton est corrigé si on peut l'éditer ; un lien dans son TEXTE est seulement signalé
    // (le reconstruire avec sa mise en forme demanderait ses entités — à corriger à la main)
    for (const [name, chat] of [['source', src], ['mirror', mirror], ['IT', it], ...extras.map((x) => [x.name, x.chat] as const)] as const) {
      if (!chat) continue;
      const g = await tg('getChat', { chat_id: chat });
      const pin = (g.result as { pinned_message?: { message_id: number; text?: string; caption?: string; reply_markup?: { inline_keyboard?: Array<Array<{ text: string; url?: string }>> } } } | undefined)?.pinned_message;
      if (!pin) { profile.push({ what: `${name} pinned`, ok: true, changed: false, error: 'no pinned message' }); continue; }
      const kb = pin.reply_markup?.inline_keyboard ?? [];
      const textOld = has(pin.text) || has(pin.caption);
      if (kb.some((r) => r.some((x) => has(x.url)))) {
        const s = await tg('editMessageReplyMarkup', { chat_id: chat, message_id: pin.message_id, reply_markup: { inline_keyboard: kb.map((r) => r.map((x) => (x.url ? { ...x, url: fix(x.url) } : x))) } });
        profile.push({ what: `${name} pinned button`, ok: !!s.ok, changed: true, ...(s.ok ? {} : { error: s.description }) });
      }
      profile.push({ what: `${name} pinned text`, ok: !textOld, changed: false, ...(textOld ? { error: 'the pinned text still has algoria.tech: edit it by hand' } : {}) });
    }
  }

  return NextResponse.json({
    ok: true, dry, toFix: rows.length, done: dry ? 0 : report.filter((r) => r.edits[0]?.ok).length,
    remaining: dry ? rows.length : Math.max(0, rows.length - report.filter((r) => r.edits[0]?.ok).length),
    rateLimited, report, profile,
  });
}
