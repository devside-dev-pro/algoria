// 🎉 LE MESSAGE DE PASSAGE EN LIVE (16/10/2026, Mathieu : « dès que moi je la passe live, il faudrait qu'elle reçoive
// automatiquement un message lui expliquant que les fonds ne doivent pas être retirés… et le lien du VIP. Ça, c'est
// les choses que je fais manuellement encore »). Server-only.
//
// Les 30 jours ne se disent plus AVANT (le support ne les évoque plus aux prospects, lib/member/replyDraft.ts) : on
// les explique ici, au moment où la copie démarre, « pour le bon fonctionnement ».
//
// LE TEXTE : agent_docs key='live_welcome', écrit par Mathieu dans l'admin (TOOLS → 🎉 GO-LIVE MESSAGE), modifiable sans
// redéploiement. Plusieurs messages : une ligne « --- » entre chaque. {name} = son prénom (vide → retiré proprement).
// Document vide → rien ne part.
// L'ENVOI : une fois par membre (member_actions kind='live_welcome'), au ✓ DONE de sa première connexion (aussi via
// GO LIVE). Depuis le compte de Mathieu (Telegram Business) si sa conversation avec lui est encore ouverte côté
// Telegram (message du client depuis moins de 24 h), sinon par le bot Algoria. En cas d'échec : Mathieu est prévenu.
import { getAgentDoc } from './agentDocs';
import { notifyOwner } from './notifyOwner';
import { cleanName } from './supportAuto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const BIZ_KIND = 'biz_msg';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Les messages à envoyer, prénom compris. [] si le document est vide. */
export function liveWelcomeMessages(doc: string | null, firstName: string | null): string[] {
  const name = cleanName(firstName);
  return String(doc ?? '').split(/^\s*---\s*$/m)
    .map((m) => m.trim().replace(/\{name\}/g, name).replace(/[ \t]+([,!?.])/g, (_x, p) => (p === '?' || p === '!' ? ` ${p}` : p)).replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean);
}

async function bot(method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN missing' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000), body: JSON.stringify(payload) });
    return (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as { ok: boolean; description?: string };
  } catch (e) {
    return { ok: false, description: (e as { message?: string })?.message ?? 'network error' };
  }
}

/** Envoie le message de passage en live à ce membre, une seule fois. Ne lève jamais. */
export async function sendLiveWelcome(db: Db, tgId: number, by: string): Promise<{ status: 'sent' | 'skipped' | 'failed'; via?: 'business' | 'bot'; reason?: string }> {
  try {
    const { data: done } = await db.from('member_actions').select('id').eq('tg_id', tgId).eq('kind', 'live_welcome').limit(1);
    if (done?.length) return { status: 'skipped', reason: 'déjà envoyé' };
    const msgs = liveWelcomeMessages(await getAgentDoc('live_welcome'), null);
    if (!msgs.length) return { status: 'skipped', reason: 'pas de texte dans l’admin' };
    const { data: mrow } = await db.from('members').select('member_no,tg_name,tg_username').eq('tg_id', tgId).limit(1);
    const member = (mrow?.[0] ?? null) as { member_no: number | null; tg_name: string | null; tg_username: string | null } | null;
    const texts = liveWelcomeMessages(await getAgentDoc('live_welcome'), member?.tg_name ?? null);

    // depuis le compte de Mathieu si sa conversation avec lui est encore ouverte (Telegram : 24 h)
    let via: 'business' | 'bot' = 'bot';
    let conn: string | null = null;
    const { data: last } = await db.from('member_actions').select('created_at,detail').eq('tg_id', tgId).eq('kind', BIZ_KIND).eq('detail->>from', 'client').order('created_at', { ascending: false }).limit(1);
    const lastClient = last?.[0] as { created_at: string; detail: Record<string, unknown> } | undefined;
    if (lastClient?.detail?.conn && Date.now() - Date.parse(lastClient.created_at) < 23 * 3_600_000) {
      const { connection } = await import('./businessInbox');
      const c = await connection(String(lastClient.detail.conn));
      if (c?.enabled && c.canReply) { via = 'business'; conn = String(lastClient.detail.conn); }
    }
    const send = (text: string) => bot('sendMessage', { chat_id: tgId, text, ...(conn ? { business_connection_id: conn } : {}) });
    let sent = 0; let error: string | undefined;
    for (const text of texts) {
      if (conn) { await bot('sendChatAction', { business_connection_id: conn, chat_id: tgId, action: 'typing' }); await sleep(1500); }
      let r = await send(text);
      // le compte de Mathieu refuse (conversation trop ancienne, droit coupé) : le bot prend le relais pour tout le reste
      if (!r.ok && conn && sent === 0) { conn = null; via = 'bot'; r = await send(text); }
      if (!r.ok) { error = r.description ?? 'refusé'; break; }
      sent++;
      if (via === 'business') await db.from('member_actions').insert({ tg_id: tgId, member_no: member?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'live_welcome', text, conn } });
    }
    await db.from('member_actions').insert({ tg_id: tgId, member_no: member?.member_no ?? null, kind: 'live_welcome', status: 'done', done_by: by, detail: { via, sent, of: texts.length, ...(error ? { error } : {}) } });
    if (sent < texts.length) {
      const who = member?.tg_username ? `@${member.tg_username}` : (member?.tg_name ?? String(tgId));
      await notifyOwner({ title: '⚠️ Message de passage en live pas parti', lines: [`${who}${member?.member_no != null ? ` · #${member.member_no}` : ''}`, `${sent}/${texts.length} envoyé(s) · ${error ?? ''}`, 'Envoie-le-lui à la main.'], tag: 'live-welcome' });
      return { status: 'failed', via, reason: error };
    }
    return { status: 'sent', via };
  } catch (e) {
    return { status: 'failed', reason: (e as Error).message };
  }
}
