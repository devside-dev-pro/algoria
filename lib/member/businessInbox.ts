// BROUILLONS POUR LE COMPTE SUPPORT DE MATHIEU — Telegram Business (29/09/2026). Server-only.
//
// Mathieu répond aux prospects depuis son propre compte (@mathieu_algoria), pas depuis le bot. Ce qui lui prend
// du temps : réécrire la même procédure, retrouver le bon lien, le bon numéro d'affilié. Telegram Business
// (Premium) permet de brancher un bot à ce compte : le bot VOIT les messages reçus. C'est l'API officielle prévue
// pour ça — aucun « userbot », donc aucun risque pour le compte.
//
// Le flux, depuis le 16/10/2026 : PILOTE AUTOMATIQUE (lib/member/supportAuto.ts, décision Mathieu « Auto s'il est sûr ») :
//   1. un client écrit à Mathieu → business_message → on l'enregistre (member_actions kind='biz_msg') et on PRÉVOIT
//      (support_jobs) : l'accueil (premier contact : sa bulle vidéo + un message adapté à sa situation, 3 à 4 min
//      après) et la réponse (~75 s après son DERNIER message, pour répondre à tout d'un coup) ;
//   2. la cron (/api/cron/support-jobs, chaque minute) rédige COMME Mathieu (replyDraft, mode 'business') ;
//   3. Claude est sûr et rien n'est sensible → la réponse part seule depuis son compte ; sinon la carte « ⏳ À toi »
//      arrive dans sa conversation avec le bot (📋 Copier / ✅ Envoyer / ❌ Écarter, ou il répond lui-même) ;
//   4. Mathieu écrit lui-même dans une conversation → ce qui y était prévu est annulé, et rien n'y part seul pendant
//      2 h. Sa réponse réelle nous revient (business_message sortant) : la carte passe à « ✅ Tu as répondu » et le
//      couple proposition → réponse envoyée est gardé (owner_reply), matière de la mémoire de l'agent.
// Coupe-circuits (env Vercel) : SUPPORT_WELCOME=off, SUPPORT_AUTOPILOT=off (tout redevient des cartes à valider).
//
// FORMER L'AGENT — Mathieu RÉPOND à une carte (ou écrit au bot) :
//   · avec sa version → elle part depuis son compte, et la paire question → bonne réponse entre dans la mémoire ;
//   · avec « # » + une remarque → rien ne part, la remarque entre dans la mémoire (agent_docs key='memory',
//     relue à chaque brouillon, modifiable dans l'admin). Sans carte : « # … » seul = leçon générale.
//
// SÉCURITÉ : n'importe quel compte Premium peut brancher n'importe quel bot à son compte. On n'accepte QUE les
// connexions dont le propriétaire est un admin (adminTgIds) — sinon on ignore tout, sans rédiger ni rien envoyer.
import { adminTgIds } from './notifyOwner';
import { appendAgentMemory } from './agentDocs';
import { cancelPendingJobs, scheduleOnClientMessage } from './supportAuto';

export const BIZ_KIND = 'biz_msg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TgResult = { ok: boolean; result?: any; description?: string };

export async function tg(method: string, payload: Record<string, unknown>): Promise<TgResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN missing' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000), body: JSON.stringify(payload) });
    return (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as TgResult;
  } catch (e) {
    return { ok: false, description: (e as { message?: string })?.message ?? 'network error' };
  }
}

export interface Conn { ownerId: number; userChatId: number; canReply: boolean; enabled: boolean }
const conns = new Map<string, { at: number; conn: Conn | null }>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toConn(c: any): Conn | null {
  if (!c?.user?.id) return null;
  // Bot API 9.0 : rights.can_reply ; avant : can_reply (déprécié) — on accepte les deux.
  return { ownerId: Number(c.user.id), userChatId: Number(c.user_chat_id), canReply: Boolean(c.rights?.can_reply ?? c.can_reply), enabled: c.is_enabled !== false };
}

/** La connexion, SI son propriétaire est un admin. Mémorisée 10 min (une erreur réseau n'est pas mémorisée). */
export async function connection(id: string): Promise<Conn | null> {
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

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Met à jour la carte du brouillon chez Mathieu (et retire ses boutons). Best effort. */
export async function stamp(detail: Record<string, unknown>, line: string): Promise<void> {
  const chat_id = Number(detail.draft_chat_id), message_id = Number(detail.draft_msg_id);
  if (!chat_id || !message_id) return;
  await tg('editMessageText', { chat_id, message_id, parse_mode: 'HTML', text: `${String(detail.draft_notice ?? '')}\n\n${esc(line)}`.slice(0, 4000), disable_web_page_preview: true });
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
        'Quand un client t’écrit :',
        '🎥 premier message → 3 à 4 min après, ta bulle vidéo d’accueil + un message adapté à sa situation (app, broker, copie…)',
        '🤖 question de routine → je réponds seul depuis ton compte',
        '⏳ question sensible ou si j’hésite → je te la mets ici : ✅ Envoyer, ❌ Écarter, ou tu réponds toi-même',
        '✋ tu écris toi-même dans une conversation → je n’y envoie plus rien seul pendant 2 h',
        '',
        'Pour me former : réponds à ma proposition',
        '✏️ avec ta version → elle part depuis ton compte et je retiens la bonne réponse',
        '🧠 avec # + une remarque (ex. « # la démo, c’est seulement avec la licence ») → rien ne part, je retiens',
        '',
        '🎥 Tes bulles d’accueil : envoie-moi une bulle vidéo ici, elle entre dans la rotation (« retire » en réponse pour la sortir).',
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
  // Si c'est du texte, c'est sa réponse à la dernière proposition en attente : la carte passe à « répondu » et on
  // garde ce qu'il a VRAIMENT envoyé à côté du brouillon (la leçon).
  if (Number(m.from?.id) === conn.ownerId) {
    await db.from('member_actions').insert({ tg_id: chatId, kind: BIZ_KIND, status: 'done', done_by: 'mathieu', detail: { from: 'owner', text, conn: connId } });
    // Mathieu a écrit lui-même : il a repris la main, l'accueil et la réponse prévus n'ont plus lieu d'être
    await cancelPendingJobs(db, chatId, 'owner wrote');
    if (text.startsWith('[')) return;
    const { data: pend } = await db.from('member_actions').select('id,detail').eq('tg_id', chatId).eq('kind', BIZ_KIND)
      .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString()).order('created_at', { ascending: false }).limit(10);
    const open = ((pend ?? []) as Array<{ id: string; detail: Record<string, unknown> }>).find((o) => o.detail?.draft && !o.detail.answered_at && !o.detail.draft_dismissed_at && !o.detail.draft_superseded_at);
    if (open) {
      await db.from('member_actions').update({ detail: { ...open.detail, answered_at: new Date().toISOString(), owner_reply: text } }).eq('id', open.id);
      await stamp(open.detail, '✅ Tu as répondu.');
    }
    return;
  }
  if (m.from?.is_bot) return;

  // LE PILOTE AUTOMATIQUE (16/10/2026, lib/member/supportAuto.ts) : on enregistre le message et on PLANIFIE. Le premier
  // message d'une conversation programme l'accueil (bulle vidéo + message adapté) 3 à 4 min plus tard ; chaque message
  // repousse la réponse à ~75 s après le dernier (on attend que la personne ait fini d'écrire). C'est la cron
  // /api/cron/support-jobs qui rédige, puis envoie seule si le modèle est sûr, ou montre la carte à Mathieu sinon.
  const { data: past } = await db.from('member_actions').select('id').eq('tg_id', chatId).eq('kind', BIZ_KIND).limit(1);
  const { data: mrow } = await db.from('members').select('member_no,status').eq('tg_id', chatId).limit(1);
  const base = { from: 'client', text, conn: connId, name, username };
  await db.from('member_actions').insert({ tg_id: chatId, member_no: mrow?.[0]?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'telegram', detail: base });
  await scheduleOnClientMessage(db, { tgId: chatId, conn: connId, firstContact: !(past ?? []).length, firstName: m.chat.first_name ?? null, status: mrow?.[0]?.status ?? null });
}

/** La carte « à toi » chez Mathieu : la proposition, avec 📋 Copier / ✅ Envoyer / ❌ Écarter, pour un message client
 *  (`rowId` = sa ligne member_actions). `why` dit pourquoi elle n'est pas partie seule. */
export async function reviewCard(db: Db, conn: Conn, rowId: string, base: Record<string, unknown>, member: { member_no?: number | null; status?: string | null } | null, draftText: string | null, why: string): Promise<void> {
  const chatId = Number((await db.from('member_actions').select('tg_id').eq('id', rowId).limit(1)).data?.[0]?.tg_id ?? 0);
  // le client a réécrit : la proposition précédente de cette conversation n'est plus la bonne
  const { data: older } = await db.from('member_actions').select('id,detail').eq('tg_id', chatId).eq('kind', BIZ_KIND).neq('id', rowId)
    .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString()).order('created_at', { ascending: false }).limit(10);
  for (const o of (older ?? []) as Array<{ id: string; detail: Record<string, unknown> }>) {
    const d = o.detail ?? {};
    if (!d.draft || d.answered_at || d.draft_dismissed_at || d.draft_superseded_at) continue;
    await db.from('member_actions').update({ detail: { ...d, draft_superseded_at: new Date().toISOString() } }).eq('id', o.id);
    await stamp(d, '↪️ Remplacée : il a réécrit, nouvelle proposition plus bas.');
  }
  const who = base.username ? `@${String(base.username)}` : String(base.name ?? 'Client');
  const tag = member?.member_no != null ? ` · #${member.member_no} ${member.status ?? ''}`.trimEnd() : ' · prospect';
  const text = String(base.text ?? '');
  const notice = `⏳ <b>À toi</b> · ${esc(why)}\n💬 <b>${esc(who)}</b>${esc(tag)}\n« ${esc(text.slice(0, 500))} »${draftText ? `\n\n✍️ Proposition :\n<pre>${esc(draftText)}</pre>` : ''}`;
  const buttons = draftText
    ? [[...(draftText.length <= 256 ? [{ text: '📋 Copier', copy_text: { text: draftText } }] : []), { text: '✅ Envoyer', callback_data: `bs:${rowId}` }, { text: '❌ Écarter', callback_data: `bx:${rowId}` }]]
    : [];
  const card = await tg('sendMessage', {
    chat_id: conn.userChatId, parse_mode: 'HTML', disable_web_page_preview: true,
    text: `${notice}\n\n<i>${draftText ? '✏️ Réponds à ce message avec ta version pour l’envoyer, ou avec # + une remarque pour me corriger.' : 'Réponds-lui directement dans la conversation.'}</i>`,
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
  await db.from('member_actions').update({ detail: { ...base, ...(draftText ? { draft: draftText } : {}), draft_intent: 'review', review_reason: why, draft_notice: notice, draft_chat_id: conn.userChatId, draft_msg_id: card.result?.message_id ?? null } }).eq('id', rowId);
}

export type Row = { id: string; tg_id: number; member_no: number | null; detail: Record<string, unknown> };

/** Envoie `text` au client DEPUIS le compte de Mathieu (Telegram n'étiquette le bot que chez lui). null = parti. */
export async function sendAsOwner(db: Db, row: Row, text: string, via: 'draft' | 'corrected' | 'auto', by: string): Promise<string | null> {
  const d = row.detail ?? {};
  const r = await tg('sendMessage', { business_connection_id: d.conn, chat_id: row.tg_id, text, disable_web_page_preview: true });
  // Refus typiques : conversation inactive depuis plus de 24 h, ou « Reply to Messages » décoché dans Chat Automation.
  if (!r.ok) return r.description ?? 'refusé';
  const now = new Date().toISOString();
  // l'écho de ce message (sender_business_bot) est ignoré à la réception : on l'enregistre ici
  await db.from('member_actions').insert({ tg_id: row.tg_id, member_no: row.member_no, kind: BIZ_KIND, status: 'done', done_by: by, detail: { from: 'owner', via, text, conn: d.conn } });
  await db.from('member_actions').update({ detail: { ...d, draft_sent_at: now, draft_sent_by: by, answered_at: now, owner_reply: text, ...(via === 'corrected' ? { draft_corrected: text } : {}) } }).eq('id', row.id);
  return null;
}

async function loadRow(db: Db, id: string) {
  const { data } = await db.from('member_actions').select('id,tg_id,member_no,detail').eq('kind', BIZ_KIND).eq('id', id).limit(1);
  return (data?.[0] ?? null) as Row | null;
}

// ===== Boutons ✅ / ❌ sous une proposition. Renvoie false si le bouton n'est pas le nôtre.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleBusinessCallback(db: Db, cq: any): Promise<boolean> {
  const m = /^b([sx]):([0-9a-f-]{36})$/i.exec(String(cq?.data ?? ''));
  if (!m) return false;
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190) });
  if (!(await adminTgIds()).includes(Number(cq.from?.id))) { await answer('Réservé aux admins.'); return true; }
  const row = await loadRow(db, m[2]);
  if (!row) { await answer('Message introuvable.'); return true; }
  const d = row.detail ?? {};
  const by = cq.from?.username ? `@${cq.from.username}` : String(cq.from?.id ?? 'admin');
  if (d.draft_sent_at || d.answered_at) { await answer('Déjà répondu.'); return true; }
  if (m[1].toLowerCase() === 's') {
    if (d.draft_superseded_at) { await answer('Il a réécrit : utilise la proposition plus récente.'); return true; }
    const draft = String(d.draft ?? '').trim();
    if (!draft) { await answer('Pas de proposition sur ce message.'); return true; }
    const why = await sendAsOwner(db, row, draft, 'draft', by);
    if (why) {
      await answer(`Échec : ${why}`);
      await stamp(d, `⨯ Telegram a refusé : ${why} — copie le texte et envoie-le toi-même.`);
      return true;
    }
    await stamp(d, '✅ Envoyée depuis ton compte.');
    await answer('Envoyée ✓');
    return true;
  }
  await db.from('member_actions').update({ detail: { ...d, draft_dismissed_at: new Date().toISOString(), draft_dismissed_by: by } }).eq('id', row.id);
  await stamp(d, '❌ Écartée.');
  await answer('Écartée.');
  return true;
}

const short = (t: unknown, n: number) => { const x = String(t ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };
const today = () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });

// ===== FORMER L'AGENT : Mathieu répond à une carte (ou écrit « # … » au bot). Renvoie false si ce n'est pas pour nous
// (le webhook poursuit alors son traitement normal).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleBusinessCorrection(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!text || msg?.chat?.type !== 'private' || msg?.business_connection_id) return false;
  const replyTo = Number(msg.reply_to_message?.message_id) || 0;
  const isNote = text.startsWith('#');
  if (!replyTo && !isNote) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const by = msg.from?.username ? `@${msg.from.username}` : String(msg.from?.id ?? 'admin');
  const reply = (t: string) => tg('sendMessage', { chat_id: msg.chat.id, text: t, reply_to_message_id: msg.message_id });
  const note = text.replace(/^#+\s*/, '');

  const row = replyTo
    ? ((await db.from('member_actions').select('id,tg_id,member_no,detail').eq('kind', BIZ_KIND).eq('detail->>draft_msg_id', String(replyTo)).eq('detail->>draft_chat_id', String(msg.chat.id))
        .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(1)).data?.[0] ?? null) as Row | null
    : null;
  if (!row) {
    if (!isNote) return false; // une réponse à autre chose qu'une carte : pas pour nous
    if (!note) return true;
    const ok = await appendAgentMemory(db, `${today()} · ${note}`, by);
    await reply(ok ? '🧠 Noté, je m’en souviendrai pour toutes mes réponses.' : '⨯ Pas pu l’enregistrer, réessaie.');
    return true;
  }

  const d = row.detail ?? {};
  const context = `Client : « ${short(d.text, 160)} » · proposé : « ${short(d.draft, 160)} »`;
  if (isNote) {
    if (!note) return true;
    const ok = await appendAgentMemory(db, `${today()} · ${context} → Mathieu : ${note}`, by);
    await reply(ok ? '🧠 Noté. Rien n’est parti chez le client.' : '⨯ Pas pu l’enregistrer, réessaie.');
    return true;
  }
  // Sa version : elle part depuis son compte (sauf s'il a déjà répondu), et la bonne réponse entre en mémoire.
  const lesson = `${today()} · Client : « ${short(d.text, 160)} » → la bonne réponse de Mathieu : « ${short(text, 400)} »`;
  if (d.draft_sent_at || d.answered_at) {
    await appendAgentMemory(db, lesson, by);
    await reply('Déjà répondu à ce client : rien n’est parti, mais je retiens ta version 🧠');
    return true;
  }
  const why = await sendAsOwner(db, row, text.slice(0, 4000), 'corrected', by);
  if (why) {
    await appendAgentMemory(db, lesson, by);
    await reply(`⨯ Telegram a refusé l’envoi (${why}) : copie ton texte et envoie-le toi-même. Je retiens quand même ta version 🧠`);
    return true;
  }
  await appendAgentMemory(db, lesson, by);
  await stamp(d, `✏️ Ta version est partie :\n${text.slice(0, 1500)}`);
  await reply('✅ Partie depuis ton compte · 🧠 je retiens ta version.');
  return true;
}
