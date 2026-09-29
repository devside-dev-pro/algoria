// BROUILLONS POUR LE COMPTE SUPPORT DE MATHIEU — Telegram Business (29/09/2026). Server-only.
//
// Mathieu répond aux prospects depuis son propre compte (@mathieu_algoria), pas depuis le bot. Ce qui lui prend
// du temps : réécrire la même procédure, retrouver le bon lien, le bon numéro d'affilié. Telegram Business
// (Premium) permet de brancher un bot à ce compte : le bot VOIT les messages reçus et peut RÉPONDRE en son nom.
// C'est l'API officielle prévue pour ça — aucun « userbot », donc aucun risque pour le compte.
//
// Le flux, sans aucun envoi automatique :
//   1. un client écrit à Mathieu → business_message → on l'enregistre (member_actions kind='biz_msg') ;
//   2. on rédige un brouillon COMME Mathieu (replyDraft, mode 'business' : ses liens, ses codes, pas de signature) ;
//   3. le brouillon arrive dans la conversation de Mathieu avec le bot : ✅ Envoyer / ❌ Écarter, et pour corriger
//      il RÉPOND au brouillon avec sa version ;
//   4. ✅ ou la version corrigée part depuis SON compte (sendMessage + business_connection_id).
// Rien ne part sans son geste. Le premier « hello » d'un prospect n'a pas de brouillon : sa vidéo d'accueil et ses
// 3 questions restent à la main (décision Mathieu). Chaque correction est gardée (draft_corrected) : c'est la
// matière de la future mémoire de l'agent.
//
// SÉCURITÉ : n'importe quel compte Premium peut brancher n'importe quel bot à son compte. On n'accepte QUE les
// connexions dont le propriétaire est un admin (adminTgIds) — sinon on ignore tout, sans rédiger ni rien envoyer.
import { adminTgIds } from './notifyOwner';
import { draftReply } from './replyDraft';

export const BIZ_KIND = 'biz_msg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TgResult = { ok: boolean; result?: any; description?: string };

async function tg(method: string, payload: Record<string, unknown>): Promise<TgResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN missing' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000), body: JSON.stringify(payload) });
    return (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as TgResult;
  } catch (e) {
    return { ok: false, description: (e as { message?: string })?.message ?? 'network error' };
  }
}

interface Conn { ownerId: number; userChatId: number; canReply: boolean; enabled: boolean }
const conns = new Map<string, { at: number; conn: Conn | null }>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toConn(c: any): Conn | null {
  if (!c?.user?.id) return null;
  // Bot API 9.0 : rights.can_reply ; avant : can_reply (déprécié) — on accepte les deux.
  return { ownerId: Number(c.user.id), userChatId: Number(c.user_chat_id), canReply: Boolean(c.rights?.can_reply ?? c.can_reply), enabled: c.is_enabled !== false };
}

/** La connexion, SI son propriétaire est un admin. Mémorisée 10 min (une erreur réseau n'est pas mémorisée). */
async function connection(id: string): Promise<Conn | null> {
  const hit = conns.get(id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.conn;
  const d = await tg('getBusinessConnection', { business_connection_id: id });
  if (!d.ok) return null;
  let conn = toConn(d.result);
  if (conn && !(await adminTgIds()).includes(conn.ownerId)) conn = null;
  conns.set(id, { at: Date.now(), conn });
  return conn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageText(m: any): string {
  if (typeof m?.text === 'string') return m.text;
  if (typeof m?.caption === 'string') return m.caption;
  if (m?.voice) return '[voice message]';
  if (m?.video_note) return '[video bubble]';
  if (m?.photo) return '[photo]';
  if (m?.video) return '[video]';
  if (m?.document) return '[file]';
  if (m?.sticker) return `[sticker ${m.sticker.emoji ?? ''}]`.trim();
  return '[media]';
}

/** Met à jour la carte du brouillon chez Mathieu (et retire ses boutons). Best effort. */
async function stamp(detail: Record<string, unknown>, line: string): Promise<void> {
  const chat_id = Number(detail.draft_chat_id), message_id = Number(detail.draft_msg_id);
  if (!chat_id || !message_id) return;
  await tg('editMessageText', { chat_id, message_id, text: `${String(detail.draft_notice ?? '')}\n\n${line}`.slice(0, 4000), disable_web_page_preview: true });
}

// ===== business_connection : Mathieu branche (ou débranche) le bot dans Telegram Business → Chatbots.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleBusinessConnection(bc: any): Promise<void> {
  const conn = toConn(bc);
  if (!conn || !bc?.id) return;
  if (!(await adminTgIds()).includes(conn.ownerId)) {
    console.warn(`[business] connexion ignorée : ${conn.ownerId} n'est pas admin`);
    return;
  }
  conns.set(String(bc.id), { at: Date.now(), conn });
  const text = conn.enabled
    ? [
        '✅ Algoria AI est branché à ton compte support.',
        '',
        'Quand un client t’écrit, je te propose ici une réponse :',
        '✅ Envoyer : elle part depuis ton compte',
        '✏️ Corriger : réponds à ma proposition avec ta version, c’est elle qui part',
        '❌ Écarter : rien ne part',
        '',
        'Rien ne part sans toi. Le premier « hello » d’un prospect, c’est toujours toi (vidéo + 3 questions).',
        ...(conn.canReply ? [] : ['', '⚠️ Autorise-moi à répondre aux messages (Telegram Business → Chatbots → Algoria), sinon je ne pourrai rien envoyer.']),
      ].join('\n')
    : '⏸ Algoria AI est débranché de ton compte support : plus aucune proposition.';
  await tg('sendMessage', { chat_id: conn.userChatId, text });
}

// ===== business_message : un message dans une conversation du compte support (reçu OU envoyé par Mathieu).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleBusinessMessage(db: Db, m: any): Promise<void> {
  const connId = String(m?.business_connection_id ?? '');
  if (!connId || m?.chat?.type !== 'private') return;
  if (m.sender_business_bot) return; // envoyé par nous au nom de Mathieu : déjà enregistré à l'envoi
  const conn = await connection(connId);
  if (!conn || !conn.enabled) return;
  const chatId = Number(m.chat.id);
  const text = messageText(m).slice(0, 1500);
  const name = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || null;
  const username = m.chat.username ?? null;

  // Message tapé par Mathieu lui-même : il sert de contexte aux prochains brouillons.
  if (Number(m.from?.id) === conn.ownerId) {
    await db.from('member_actions').insert({ tg_id: chatId, kind: BIZ_KIND, status: 'done', done_by: 'mathieu', detail: { from: 'owner', text, conn: connId } });
    return;
  }
  if (m.from?.is_bot) return;

  // Contexte lu AVANT d'insérer le message courant : les 10 derniers échanges de cette conversation.
  const { data: past } = await db.from('member_actions').select('detail').eq('tg_id', chatId).eq('kind', BIZ_KIND).order('created_at', { ascending: false }).limit(10);
  const { data: mrow } = await db.from('members').select('member_no,locale,status,strategy,broker,tg_name,tg_username').eq('tg_id', chatId).limit(1);
  const member = mrow?.[0] ?? null;
  const base = { from: 'client', text, conn: connId, name, username };
  const { data: ins } = await db.from('member_actions').insert({ tg_id: chatId, member_no: member?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'telegram', detail: base }).select('id');
  const rowId = String(ins?.[0]?.id ?? '');
  if (!rowId || text.startsWith('[')) return; // un vocal, une photo… : rien à rédiger, Mathieu voit le message dans son Telegram

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = ((past ?? []) as Array<{ detail: any }>).reverse()
    .map((h) => ({ from: h.detail?.from === 'owner' ? 'algoria' as const : 'member' as const, text: String(h.detail?.text ?? '') }))
    .filter((h) => h.text);
  const draft = await draftReply({ text, locale: member?.locale ?? null, member, history, mode: 'business' });
  if (!draft || draft.spam || draft.skip) {
    await db.from('member_actions').update({ detail: { ...base, draft_intent: draft?.spam ? 'spam' : draft?.skip ? 'skip' : 'none' } }).eq('id', rowId);
    return;
  }

  // Le client a réécrit : la proposition précédente de cette conversation n'est plus la bonne.
  const { data: older } = await db.from('member_actions').select('id,detail').eq('tg_id', chatId).eq('kind', BIZ_KIND).neq('id', rowId)
    .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString()).order('created_at', { ascending: false }).limit(10);
  for (const o of (older ?? []) as Array<{ id: string; detail: Record<string, unknown> }>) {
    const d = o.detail ?? {};
    if (!d.draft || d.draft_sent_at || d.draft_dismissed_at || d.draft_superseded_at) continue;
    await db.from('member_actions').update({ detail: { ...d, draft_superseded_at: new Date().toISOString() } }).eq('id', o.id);
    await stamp(d, '↪️ Remplacée : il a réécrit, nouvelle proposition plus bas.');
  }

  const who = username ? `@${username}` : name ?? 'Client';
  const tag = member?.member_no != null ? ` · #${member.member_no} ${member.status ?? ''}`.trimEnd() : ' · prospect';
  const notice = `💬 ${who}${tag}\n« ${text.slice(0, 500)} »\n\n✍️ Proposition :\n\n${draft.text}`;
  const card = await tg('sendMessage', {
    chat_id: conn.userChatId,
    text: `${notice}\n\n✏️ Pour corriger : réponds à ce message avec ta version.`.slice(0, 4000),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: '✅ Envoyer', callback_data: `bs:${rowId}` }, { text: '❌ Écarter', callback_data: `bx:${rowId}` }]] },
  });
  await db.from('member_actions').update({ detail: { ...base, draft: draft.text, draft_intent: 'draft', draft_notice: notice, draft_chat_id: conn.userChatId, draft_msg_id: card.result?.message_id ?? null } }).eq('id', rowId);
}

/** Envoie `text` au client DEPUIS le compte de Mathieu. Renvoie l'erreur Telegram, ou null si c'est parti. */
async function sendAsOwner(db: Db, row: { id: string; tg_id: number; member_no: number | null; detail: Record<string, unknown> }, text: string, via: 'draft' | 'corrected', by: string): Promise<string | null> {
  const d = row.detail;
  const r = await tg('sendMessage', { business_connection_id: d.conn, chat_id: row.tg_id, text, disable_web_page_preview: true });
  if (!r.ok) {
    const why = r.description ?? 'refusé';
    // Telegram ne laisse un bot répondre au nom du compte que dans les conversations actives depuis moins de 24 h.
    return /peer|24|expired|not allowed|forbidden/i.test(why) ? `${why} (conversation inactive depuis plus de 24 h ? réponds à la main)` : why;
  }
  const now = new Date().toISOString();
  await db.from('member_actions').insert({ tg_id: row.tg_id, member_no: row.member_no, kind: BIZ_KIND, status: 'done', done_by: by, detail: { from: 'owner', via, text, conn: d.conn } });
  await db.from('member_actions').update({ detail: { ...d, draft_sent_at: now, draft_sent_by: by, ...(via === 'corrected' ? { draft_corrected: text } : {}) } }).eq('id', row.id);
  return null;
}

async function loadRow(db: Db, filter: (q: Db) => Db) {
  const { data } = await filter(db.from('member_actions').select('id,tg_id,member_no,detail').eq('kind', BIZ_KIND)).limit(1);
  return (data?.[0] ?? null) as { id: string; tg_id: number; member_no: number | null; detail: Record<string, unknown> } | null;
}

// ===== Boutons ✅ / ❌ sous un brouillon. Renvoie false si le bouton n'est pas le nôtre.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleBusinessCallback(db: Db, cq: any): Promise<boolean> {
  const m = /^b([sx]):([0-9a-f-]{36})$/i.exec(String(cq?.data ?? ''));
  if (!m) return false;
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190) });
  if (!(await adminTgIds()).includes(Number(cq.from?.id))) { await answer('Réservé aux admins.'); return true; }
  const row = await loadRow(db, (q) => q.eq('id', m[2]));
  if (!row) { await answer('Message introuvable.'); return true; }
  const d = row.detail ?? {};
  const by = cq.from?.username ? `@${cq.from.username}` : String(cq.from?.id ?? 'admin');
  if (d.draft_sent_at) { await answer('Déjà envoyée.'); return true; }
  if (m[1].toLowerCase() === 'x') {
    await db.from('member_actions').update({ detail: { ...d, draft_dismissed_at: new Date().toISOString(), draft_dismissed_by: by } }).eq('id', row.id);
    await stamp(d, '❌ Écartée.');
    await answer('Écartée.');
    return true;
  }
  if (d.draft_superseded_at) { await answer('Il a réécrit : utilise la proposition plus récente.'); return true; }
  const draft = String(d.draft ?? '').trim();
  if (!draft) { await answer('Pas de proposition sur ce message.'); return true; }
  const err = await sendAsOwner(db, row, draft, 'draft', by);
  if (err) { await stamp(d, `⨯ Telegram a refusé : ${err}`); await answer(`Échec : ${err}`); return true; }
  await stamp(d, '✅ Envoyée depuis ton compte.');
  await answer('Envoyée ✓');
  return true;
}

// ===== ✏️ Correction : Mathieu RÉPOND à une carte de brouillon avec sa version → c'est elle qui part.
// Renvoie false si ce message n'est pas une correction (le webhook poursuit alors son traitement normal).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleBusinessCorrection(db: Db, msg: any): Promise<boolean> {
  const replyTo = Number(msg?.reply_to_message?.message_id);
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!replyTo || !text || msg?.chat?.type !== 'private' || msg?.business_connection_id) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const row = await loadRow(db, (q) => q.eq('detail->>draft_msg_id', String(replyTo)).eq('detail->>draft_chat_id', String(msg.chat.id))
    .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()));
  if (!row) return false;
  const reply = (t: string) => tg('sendMessage', { chat_id: msg.chat.id, text: t, reply_to_message_id: msg.message_id });
  const d = row.detail ?? {};
  if (d.draft_sent_at) { await reply('Déjà envoyée : ta version n’est pas partie.'); return true; }
  const by = msg.from?.username ? `@${msg.from.username}` : String(msg.from?.id ?? 'admin');
  const err = await sendAsOwner(db, row, text.slice(0, 4000), 'corrected', by);
  if (err) { await reply(`⨯ Telegram a refusé : ${err}`); return true; }
  await stamp(d, `✏️ Ta version est partie :\n${text.slice(0, 1500)}`);
  await reply('✅ Partie depuis ton compte. Je garde ta correction pour apprendre.');
  return true;
}
