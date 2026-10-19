// 🌙 LE RÉCAP DU SOIR DU SUPPORT (19/10/2026, Mathieu : « comment le former au mieux et au plus vite ? »).
//
// Le bot n'apprenait que quand Mathieu répondait À LA CARTE. Deux angles morts :
//   · ce que le bot envoie SEUL, Mathieu ne le voit jamais : une réponse fausse n'était corrigée par personne ;
//   · quand Mathieu répond directement dans la conversation (812 fois avant le pilote), sa réponse est gardée à côté de
//     la proposition (owner_reply) mais n'entrait jamais en mémoire.
// Chaque soir à 21 h (heure de Paris), dans son Telegram :
//   1. les réponses parties seules aujourd'hui, numérotées. Il répond au récap avec « 3 sa version » ou « 3 # remarque » :
//      la leçon entre en mémoire, rien ne repart chez le client ;
//   2. les règles tirées de SES réponses directes : le modèle compare la proposition et ce qu'il a vraiment écrit, et en
//      propose au plus 4, chacune avec ✅ Garder / ❌ Jeter (ou une réponse avec sa version corrigée). Rien n'entre en
//      mémoire sans son OK.
// Appelé par pg_cron à 19 h et 20 h UTC (app/api/cron/support-digest) : seule l'heure qui tombe à 21 h à Paris passe,
// été comme hiver, une fois par jour (ligne member_actions kind 'support_digest').
import Anthropic from '@anthropic-ai/sdk';
import { adminTgIds } from './notifyOwner';
import { appendAgentMemory, getAgentDoc } from './agentDocs';
import { parseModelJson } from './replyDraft';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type Row = { id: string; tg_id: number; member_no: number | null; created_at: string; detail: Record<string, unknown> };

const KIND = 'support_digest';
const BIZ_KIND = 'biz_msg';
const MAX_RULES = 4;
const SUPPORT_MODEL = process.env.ALGORIA_SUPPORT_MODEL ?? 'claude-sonnet-5-5';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const short = (t: unknown, n: number) => { const x = String(t ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };
const parisDay = (d = new Date()) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
const parisHour = (d = new Date()) => Number(d.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Paris' }));
const who = (d: Record<string, unknown>) => (d.username ? `@${String(d.username)}` : String(d.name ?? 'client'));

async function tg(method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; result?: { message_id?: number } }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    return (await r.json()) as { ok: boolean; result?: { message_id?: number } };
  } catch { return { ok: false }; }
}

/** Le chat de Mathieu : celui de la connexion Business (où arrivent ses cartes), sinon le premier admin. */
async function ownerChat(db: Db): Promise<number | null> {
  const { data } = await db.from('member_actions').select('detail').eq('kind', BIZ_KIND).not('detail->>draft_chat_id', 'is', null).order('created_at', { ascending: false }).limit(1);
  const id = Number((data?.[0] as { detail?: Record<string, unknown> } | undefined)?.detail?.draft_chat_id);
  if (id) return id;
  return (await adminTgIds())[0] ?? null;
}

type Rule = { rule: string; client: string; mine: string; state: 'pending' | 'kept' | 'dropped' | 'edited'; msg_id?: number | null };

/** Les règles que le modèle tire des réponses que Mathieu a écrites lui-même. [] si rien de neuf (ou modèle absent). */
async function proposeRules(pairs: Row[]): Promise<Array<Pick<Rule, 'rule' | 'client' | 'mine'>>> {
  if (!pairs.length || !process.env.ANTHROPIC_API_KEY) return [];
  const memory = (await getAgentDoc('memory')) ?? '';
  const list = pairs.map((p, i) => `[${i + 1}] Client : « ${short(p.detail.text, 300)} »\nProposition du bot : « ${short(p.detail.draft, 300)} »\nCe que Mathieu a vraiment écrit : « ${short(p.detail.owner_reply, 400)} »`).join('\n\n');
  const system = `Tu formes le bot de support d'Algoria (une IA de copy trading sur l'or). Le bot propose des réponses ; Mathieu, le fondateur, a répondu lui-même à la place. Ta mission : trouver ce que le bot doit RETENIR pour répondre comme Mathieu la prochaine fois.

MÉMOIRE ACTUELLE DU BOT (ne repropose rien qui y est déjà) :
${memory || '(vide)'}

RÈGLES
- Une règle = un fait, une consigne ou une façon de répondre, GÉNÉRALE (elle servira à d'autres clients), en français, une ou deux phrases ; tu peux citer la formule de Mathieu en anglais entre « ».
- Seulement quand la réponse de Mathieu contredit ou complète vraiment la proposition. Rien quand ils disent la même chose, rien pour un « Yes », un « Hello », un merci, ni pour ce qui dépend du compte d'un client précis (vérifier son dossier, son broker, son solde).
- Jamais de chiffre de gains, de promesse ni de projection.
- Au plus ${MAX_RULES} règles, les plus utiles d'abord. Aucune si rien ne vaut la peine.
- Réponds UNIQUEMENT en JSON sur une ligne : {"rules": [{"rule": "...", "from": <numéro de l'échange>}]}`;
  try {
    const client = new Anthropic({ timeout: 30_000, maxRetries: 0 });
    const res = await client.messages.create({ model: SUPPORT_MODEL, max_tokens: 900, system, messages: [{ role: 'user', content: `Les échanges du jour :\n\n${list}\n\nRenvoie le JSON.` }] });
    const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    const j = parseModelJson(raw);
    const rules = Array.isArray(j?.rules) ? (j!.rules as Array<{ rule?: unknown; from?: unknown }>) : [];
    return rules.slice(0, MAX_RULES).map((r) => {
      const p = pairs[Number(r.from) - 1];
      return { rule: short(r.rule, 500), client: short(p?.detail.text, 160), mine: short(p?.detail.owner_reply, 200) };
    }).filter((r) => r.rule.length > 10);
  } catch (e) {
    console.error('[supportDigest] règles :', (e as { message?: string })?.message ?? e);
    return [];
  }
}

/** Le récap du soir. `force` : hors de 21 h (tests). */
export async function runSupportDigest(db: Db, opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  if (!opts.force && parisHour() !== 21) return { skipped: 'pas 21 h à Paris' };
  const day = parisDay();
  const { data: prev } = await db.from('member_actions').select('id,created_at,detail').eq('kind', KIND).order('created_at', { ascending: false }).limit(1);
  const last = (prev?.[0] ?? null) as Row | null;
  if (last && last.detail?.day === day) return { skipped: 'déjà envoyé aujourd’hui' };
  const since = last ? last.created_at : new Date(Date.now() - 24 * 3_600_000).toISOString();
  const chat = await ownerChat(db);
  if (!chat) return { skipped: 'pas de chat admin' };

  // 1. ce qui est parti seul
  const { data: autoRows } = await db.from('member_actions').select('id,tg_id,member_no,created_at,detail').eq('kind', BIZ_KIND).eq('detail->>draft_intent', 'auto').gte('detail->>draft_sent_at', since).order('created_at', { ascending: true }).limit(60);
  const autos = ((autoRows ?? []) as Row[]).filter((r) => r.detail?.draft_sent_at && r.detail?.draft);
  // 2. ses réponses directes (pas via la carte : pas de draft_sent_at), à côté d'une vraie proposition
  const { data: ownRows } = await db.from('member_actions').select('id,tg_id,member_no,created_at,detail').eq('kind', BIZ_KIND).gte('detail->>answered_at', since).order('created_at', { ascending: false }).limit(60);
  const pairs = ((ownRows ?? []) as Row[]).filter((r) => r.detail?.draft && r.detail?.owner_reply && !r.detail?.draft_sent_at && String(r.detail.owner_reply).trim().length >= 12).slice(0, 25);
  // les chiffres du jour (le pilote)
  const { data: jobs } = await db.from('support_jobs').select('kind,status,result').gte('updated_at', since).limit(1000);
  const count = (o: string) => ((jobs ?? []) as Array<{ result?: { outcome?: string } }>).filter((j) => j.result?.outcome === o).length;
  const cards = count('review'), welcomes = count('welcome'), skips = count('skip');
  if (!autos.length && !pairs.length && !cards && !welcomes) {
    await db.from('member_actions').insert({ tg_id: chat, kind: KIND, status: 'done', done_by: 'algoria-ai', detail: { day, items: [], msgs: [], rules: [] } });
    return { sent: 0, reason: 'journée vide' };
  }

  const rules = await proposeRules(pairs);
  // la ligne d'abord (une seule par jour, même si Telegram traîne), complétée avec les messages envoyés
  const { data: ins } = await db.from('member_actions').insert({ tg_id: chat, kind: KIND, status: 'done', done_by: 'algoria-ai', detail: { day, items: [], msgs: [], rules: [] } }).select('id');
  const digestId = String((ins?.[0] as { id?: string } | undefined)?.id ?? '');

  const head = `🌙 <b>Récap du support · ${day}</b>\n🤖 Réponses parties seules : <b>${autos.length}</b> · 🎥 accueils : ${welcomes} · ⏳ cartes pour toi : ${cards} · 🙈 ignorés (ok, merci…) : ${skips}`;
  const items = autos.map((r, k) => ({ n: k + 1, id: r.id }));
  const lines = autos.map((r, k) => `<b>${k + 1}.</b> ${esc(who(r.detail))} : « ${esc(short(r.detail.text, 140))} »\n→ ${esc(short(r.detail.draft, 260))}`);
  const foot = autos.length
    ? '\n\n✏️ Une réponse à corriger ? Réponds à ce message avec son numéro et ta version (« 3 Yes, … »), ou le numéro et # + une remarque. Je retiens, rien ne repart chez le client.'
    : '';
  // découpé en messages de moins de 4 000 caractères
  const chunks: string[] = [];
  let cur = autos.length ? `${head}\n\n` : head;
  for (const l of lines) {
    if ((cur + l).length > 3500) { chunks.push(cur.trimEnd()); cur = ''; }
    cur += `${l}\n\n`;
  }
  chunks.push(`${cur.trimEnd()}${foot}`);
  const msgs: number[] = [];
  for (const c of chunks) {
    const r = await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true, text: c });
    if (r.result?.message_id) msgs.push(r.result.message_id);
  }

  const kept: Rule[] = [];
  if (rules.length) {
    await tg('sendMessage', { chat_id: chat, text: `🧠 ${rules.length} règle${rules.length > 1 ? 's' : ''} tirée${rules.length > 1 ? 's' : ''} de tes réponses directes d'aujourd'hui (celles écrites dans la conversation, pas sur la carte). Garde ce qui est juste : ça entre dans sa mémoire.` });
    for (const [i, r] of rules.entries()) {
      const m = await tg('sendMessage', {
        chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true,
        text: `🧠 <b>Règle ${i + 1}</b>\n${esc(r.rule)}\n\n<i>Client : « ${esc(r.client)} »\nToi : « ${esc(r.mine)} »</i>\n\n✏️ Pas tout à fait ça ? Réponds à ce message avec la bonne règle.`,
        reply_markup: { inline_keyboard: [[{ text: '✅ Garder', callback_data: `sd:k:${digestId}:${i}` }, { text: '❌ Jeter', callback_data: `sd:x:${digestId}:${i}` }]] },
      });
      kept.push({ ...r, state: 'pending', msg_id: m.result?.message_id ?? null });
    }
  }
  if (digestId) await db.from('member_actions').update({ detail: { day, items, msgs, rules: kept, pairs: pairs.length } }).eq('id', digestId);
  return { sent: msgs.length, autos: autos.length, rules: kept.length, cards };
}

async function digestFor(db: Db, pick: (d: Record<string, unknown>) => boolean): Promise<Row | null> {
  const { data } = await db.from('member_actions').select('id,tg_id,member_no,created_at,detail').eq('kind', KIND).gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(10);
  return ((data ?? []) as Row[]).find((r) => pick(r.detail ?? {})) ?? null;
}

/** ✅ Garder / ❌ Jeter sous une règle proposée (callback_data `sd:k|x:<digest>:<i>`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleDigestCallback(db: Db, cq: any): Promise<boolean> {
  const m = /^sd:([kx]):([0-9a-f-]{36}):(\d+)$/i.exec(String(cq?.data ?? ''));
  if (!m) return false;
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text });
  if (!(await adminTgIds()).includes(Number(cq.from?.id))) { await answer(''); return true; }
  const { data } = await db.from('member_actions').select('id,detail').eq('id', m[2]).eq('kind', KIND).limit(1);
  const row = data?.[0] as { id: string; detail: Record<string, unknown> } | undefined;
  const rules = (row?.detail?.rules ?? []) as Rule[];
  const r = rules[Number(m[3])];
  if (!row || !r) { await answer('Règle introuvable.'); return true; }
  if (r.state !== 'pending') { await answer(r.state === 'dropped' ? 'Déjà jetée.' : 'Déjà gardée.'); return true; }
  const by = cq.from?.username ? `@${cq.from.username}` : String(cq.from?.id ?? 'admin');
  const keep = m[1] === 'k';
  if (keep && !(await appendAgentMemory(db, `${parisDay()} · ${r.rule}`, by))) { await answer('Pas pu l’enregistrer, réessaie.'); return true; }
  rules[Number(m[3])] = { ...r, state: keep ? 'kept' : 'dropped' };
  await db.from('member_actions').update({ detail: { ...row.detail, rules } }).eq('id', row.id);
  const orig = typeof cq.message?.text === 'string' ? cq.message.text : '';
  if (cq.message?.chat?.id && cq.message?.message_id) await tg('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: `${orig.replace(/\n\n✏️ Pas tout à fait ça.*$/s, '')}\n\n${keep ? '✅ Gardée : elle est dans sa mémoire.' : '❌ Jetée.'}`.slice(0, 4000), disable_web_page_preview: true });
  await answer(keep ? '🧠 Gardée' : 'Jetée');
  return true;
}

/** Mathieu répond au récap : « 3 sa version » / « 3 # remarque » (une réponse partie seule), ou sa version d'une règle. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleDigestReply(db: Db, msg: any): Promise<boolean> {
  const replyTo = Number(msg?.reply_to_message?.message_id) || 0;
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!replyTo || !text || msg?.chat?.type !== 'private' || msg?.business_connection_id) return false;
  const row = await digestFor(db, (d) => ((d.msgs ?? []) as number[]).includes(replyTo) || ((d.rules ?? []) as Rule[]).some((r) => r.msg_id === replyTo));
  if (!row) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const by = msg.from?.username ? `@${msg.from.username}` : String(msg.from?.id ?? 'admin');
  const reply = (t: string) => tg('sendMessage', { chat_id: msg.chat.id, text: t, reply_to_message_id: msg.message_id });

  // sa version d'une règle proposée
  const rules = (row.detail.rules ?? []) as Rule[];
  const ri = rules.findIndex((r) => r.msg_id === replyTo);
  if (ri >= 0) {
    const ok = await appendAgentMemory(db, `${parisDay()} · ${text.replace(/^#+\s*/, '')}`, by);
    if (ok) {
      rules[ri] = { ...rules[ri], rule: text, state: 'edited' };
      await db.from('member_actions').update({ detail: { ...row.detail, rules } }).eq('id', row.id);
    }
    await reply(ok ? '🧠 Ta version est dans sa mémoire.' : '⨯ Pas pu l’enregistrer, réessaie.');
    return true;
  }

  // une réponse partie seule : « 3 sa version » ou « 3 # remarque »
  const items = (row.detail.items ?? []) as Array<{ n: number; id: string }>;
  const m = /^(\d{1,2})\s*[.):\-–]?\s*([\s\S]+)$/.exec(text);
  const n = m ? Number(m[1]) : items.length === 1 ? 1 : 0;
  const body = (m ? m[2] : text).trim();
  const it = items.find((x) => x.n === n);
  if (!it || !body) {
    await reply(items.length ? `Mets le numéro de la réponse devant (de 1 à ${items.length}), ex. « 3 ta version » ou « 3 # ta remarque ».` : 'Rien à corriger dans ce récap.');
    return true;
  }
  const { data } = await db.from('member_actions').select('detail').eq('id', it.id).limit(1);
  const d = ((data?.[0] as { detail?: Record<string, unknown> } | undefined)?.detail ?? {});
  const isNote = body.startsWith('#');
  const note = body.replace(/^#+\s*/, '');
  const lesson = isNote
    ? `${parisDay()} · Client : « ${short(d.text, 160)} » · parti seul : « ${short(d.draft, 160)} » → Mathieu : ${note}`
    : `${parisDay()} · Client : « ${short(d.text, 160)} » → la bonne réponse de Mathieu : « ${short(body, 400)} »`;
  const ok = await appendAgentMemory(db, lesson, by);
  await reply(ok ? `🧠 Noté pour la n°${n}. Rien n’est reparti chez le client : s’il faut le corriger, écris-lui directement.` : '⨯ Pas pu l’enregistrer, réessaie.');
  return true;
}
