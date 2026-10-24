// 🎤 LES WEBINAIRES (24/10/2026, décision Mathieu : deux par semaine, sur Zoom, en anglais). Server-only.
//
// L'INSCRIPTION PASSE PAR LE BOT, pas par un formulaire : la page /webinar ouvre t.me/<bot>?start=wb_<session>, la
// personne appuie sur START, c'est fait. Notre public est déjà sur Telegram, il n'a rien à taper, et surtout un bot ne
// peut écrire qu'à quelqu'un qui l'a démarré : c'est ce qui permet la confirmation, puis les rappels qui font venir
// les gens le jour J.
//
// LES RAPPELS (app/api/cron/webinar, toutes les 5 min) : 1 h avant avec le lien Zoom, puis pile à l'heure du début,
// encore avec le lien. Plus de rappel la veille (Mathieu, 24/10/2026 : « un rappel trop en avance ça ne sert à rien,
// les gens oublient et passent à autre chose »). Mathieu reçoit le nombre d'inscrits 1 h avant, et une alerte 3 h avant
// si la session n'a pas encore de lien Zoom (sans lien, ni le rappel d'1 h ni celui du début ne partent).
//
// LES SESSIONS : table webinar_sessions (migration 0035), une ligne par webinaire : id = sa date (ex. 2026-10-28),
// début en UTC, lien Zoom. Le lien Zoom n'est jamais sur la page publique : il part en privé aux inscrits.
import { APP_URL } from './i18n';
import { notifyOwner } from './notifyOwner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface WebinarSession { id: string; starts_at: string; zoom_url: string | null }

export const WEBINAR_START_RE = /^\/start\s+wb_([a-z0-9-]{4,40})$/i;
const HOUR = 3_600_000;
const LATE_JOIN_MS = 45 * 60_000; // on peut encore s'inscrire (et recevoir le lien) 45 min après le début
const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** La page d'inscription (aussi servie sous app.getalgoria.com/webinar). */
export const WEBINAR_PAGE = 'https://getalgoria.com/webinar';
export const seatLink = (id: string) => `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? ''}?start=wb_${id}`;
export const calendarLink = (id: string) => `${APP_URL}/api/webinar/ics?s=${encodeURIComponent(id)}`;

/** « Wednesday 28 October » et « 19:00 », à l'heure du Royaume-Uni (le public : UK, Afrique du Sud…). */
export const ukDay = (at: string) => new Date(at).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' });
export const ukHour = (at: string) => new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
/** L'heure en Afrique du Sud, le 2e public (« 21:00 in South Africa »). */
export const saHour = (at: string) => new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' });
const ukDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
/** « tonight », « tomorrow », « on Wednesday » : le jour de la session vu d'aujourd'hui (Royaume-Uni). */
export function relDay(at: string, now = Date.now()): string {
  const d = ukDate(Date.parse(at));
  if (d === ukDate(now)) return Number(ukHour(at).slice(0, 2)) >= 17 ? 'tonight' : 'today';
  if (d === ukDate(now + 86_400_000)) return 'tomorrow';
  return `on ${new Date(at).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long' })}`;
}

/** Les prochaines sessions ouvertes à l'inscription, la plus proche d'abord. */
export async function upcomingSessions(db: Db, limit = 2): Promise<WebinarSession[]> {
  const { data } = await db.from('webinar_sessions').select('id,starts_at,zoom_url').eq('active', true)
    .gt('starts_at', iso(Date.now() - LATE_JOIN_MS)).order('starts_at', { ascending: true }).limit(limit);
  return (data ?? []) as WebinarSession[];
}

type Button = { text: string; url: string };
async function send(chatId: number, text: string, buttons: Button[] = []): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(buttons.length ? { reply_markup: { inline_keyboard: buttons.map((b) => [b]) } } : {}) }),
  }).catch(() => null);
  return !!r?.ok;
}

/** /start wb_<session> : inscrit la personne (la session demandée, ou la prochaine si elle est passée) et confirme. */
export async function registerForWebinar(db: Db, from: { id: number; first_name?: string; last_name?: string; username?: string }, sessionId: string): Promise<void> {
  const now = Date.now();
  const { data } = await db.from('webinar_sessions').select('id,starts_at,zoom_url').eq('id', sessionId.toLowerCase()).eq('active', true).limit(1);
  let s = data?.[0] as WebinarSession | undefined;
  if (!s || Date.parse(s.starts_at) < now - LATE_JOIN_MS) s = (await upcomingSessions(db, 1))[0];
  if (!s) {
    await send(from.id, 'Thanks 🙏🏼 There’s no webinar scheduled right now: the next dates will be announced in the Algoria channel.');
    return;
  }
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || null;
  await db.from('webinar_registrations').upsert({ session_id: s.id, tg_id: from.id, name, username: from.username ?? null }, { onConflict: 'session_id,tg_id', ignoreDuplicates: true });

  const start = Date.parse(s.starts_at);
  // inscrit à moins d'une heure du début : le rappel d'1 h est déjà passé, le lien part tout de suite
  if (start - now < HOUR && s.zoom_url) {
    const live = start <= now;
    await send(from.id, live
      ? '✅ You’re in! The live webinar with Mathieu has started. Join now 👇'
      : `✅ You’re in! The live webinar with Mathieu starts at ${ukHour(s.starts_at)} (UK time). Here’s your Zoom link 👇`, [{ text: '🎥 Join the webinar', url: s.zoom_url }]);
    await db.from('webinar_registrations').update({ reminded_24h_at: iso(now), reminded_1h_at: iso(now), ...(live ? { reminded_live_at: iso(now) } : {}) }).eq('session_id', s.id).eq('tg_id', from.id);
    return;
  }
  await send(from.id,
    `✅ You’re in!\n\n🎤 Live webinar with Mathieu, founder of Algoria\n📅 ${ukDay(s.starts_at)}, ${ukHour(s.starts_at)} (UK time)\n⏱ 45 minutes, on Zoom, in English\n\nI’ll send you the Zoom link right here, 1 hour before. Stay until the end: there’s something reserved for 10 people 🙏🏼`,
    [{ text: '📅 Add to my calendar', url: calendarLink(s.id) }]);
}

/** Les rappels arrivés à échéance, et les deux alertes de Mathieu. Appelé toutes les 5 min. */
export async function runWebinarReminders(db: Db): Promise<{ sessions: number; sent: number }> {
  const now = Date.now();
  const { data: ss } = await db.from('webinar_sessions').select('id,starts_at,zoom_url,alert_zoom_at,alert_count_at').eq('active', true)
    .gt('starts_at', iso(now - LATE_JOIN_MS)).lt('starts_at', iso(now + 4 * HOUR));
  let sent = 0;
  for (const s of (ss ?? []) as Array<WebinarSession & { alert_zoom_at: string | null; alert_count_at: string | null }>) {
    const start = Date.parse(s.starts_at);
    const left = start - now;
    const when = `${ukDay(s.starts_at)}, ${ukHour(s.starts_at)} (UK time)`;

    if (!s.zoom_url && left <= 3 * HOUR && !s.alert_zoom_at) {
      await notifyOwner({ title: `🎤 Webinar de ${ukHour(s.starts_at)} (UK) : pas encore de lien Zoom`, lines: ['Sans lien, les inscrits ne reçoivent ni le rappel d’1 h ni celui du début.', 'Envoie-le moi et je l’ajoute.'], tag: 'webinar' });
      await db.from('webinar_sessions').update({ alert_zoom_at: iso(now) }).eq('id', s.id);
    }
    if (left <= HOUR && !s.alert_count_at) {
      const { count } = await db.from('webinar_registrations').select('id', { count: 'exact', head: true }).eq('session_id', s.id);
      await notifyOwner({ title: `🎤 Webinar dans 1 h : ${count ?? 0} inscrit${(count ?? 0) > 1 ? 's' : ''}`, lines: [when, s.zoom_url ? 'Le lien Zoom part maintenant aux inscrits.' : '⚠️ Toujours pas de lien Zoom.'], tag: 'webinar' });
      await db.from('webinar_sessions').update({ alert_count_at: iso(now) }).eq('id', s.id);
    }

    // pg_cron tourne à :00, :05… : le rappel d'1 h part à 18:00 pour 19:00, et celui du début à 19:00 (la marge d'une
    // minute couvre une cron qui arriverait une fraction de seconde avant l'heure)
    const stages: Array<{ col: 'reminded_1h_at' | 'reminded_live_at'; due: boolean; text: string; button: Button }> = [
      { col: 'reminded_1h_at', due: !!s.zoom_url && left <= HOUR && left > 60_000,
        text: `⏰ In 1 hour: live webinar with Mathieu, at ${ukHour(s.starts_at)} (UK time).\nHere’s your Zoom link 👇 Stay until the end: something is reserved for 10 people.`,
        button: { text: '🎥 Join the webinar', url: s.zoom_url ?? '' } },
      { col: 'reminded_live_at', due: !!s.zoom_url && left <= 60_000 && left > -30 * 60_000,
        text: '🔴 The live is starting now! Here’s your Zoom link 👇',
        button: { text: '🎥 Join the webinar', url: s.zoom_url ?? '' } },
    ];
    for (const st of stages) {
      if (!st.due) continue;
      const { data: regs } = await db.from('webinar_registrations').select('id').eq('session_id', s.id).is(st.col, null).limit(1000);
      const ids = ((regs ?? []) as Array<{ id: number }>).map((r) => r.id);
      // par paquets de 20 en parallèle (~25 messages/s, sous la limite de Telegram) : tout le monde reçoit le lien du
      // début dans la même minute, même avec quelques centaines d'inscrits
      for (let k = 0; k < ids.length && Date.now() - now < 40_000; k += 20) {
        // marqués AVANT l'envoi, et seulement s'ils ne l'étaient pas : deux passages en même temps n'envoient jamais deux fois
        const { data: mine } = await db.from('webinar_registrations').update({ [st.col]: iso(now) }).in('id', ids.slice(k, k + 20)).is(st.col, null).select('tg_id');
        const ok = await Promise.all(((mine ?? []) as Array<{ tg_id: number }>).map((r) => send(r.tg_id, st.text, [st.button])));
        sent += ok.filter(Boolean).length;
        await sleep(800);
      }
    }
  }
  return { sessions: (ss ?? []).length, sent };
}

// ── LE SUPPORT : CE QU'IL SAIT DU PROCHAIN WEBINAIRE ─────────────────────────────────────────────────────────────

let factCache: { at: number; text: string } | null = null;
/** Le bloc de faits du support (lib/member/replyDraft.ts) : la prochaine session, à l'heure près, et quand en parler.
 *  Calculé depuis la base (cache 60 s) : le knowledge de Mathieu n'a jamais une date en retard. */
export async function webinarFacts(db: Db): Promise<string> {
  if (factCache && Date.now() - factCache.at < 60_000) return factCache.text;
  const s = (await upcomingSessions(db, 1).catch(() => []))[0];
  const text = !s
    ? 'LIVE WEBINARS: no date is scheduled right now. Never invent one; if they ask, the next dates are announced in the Algoria channel.'
    : [
        `NEXT LIVE WEBINAR (Mathieu live on Zoom, in English, free, 45 minutes: his story, what the AI is and how it trades gold, the real app on screen, real past results, live questions): ${ukDay(s.starts_at)} at ${ukHour(s.starts_at)} UK time (${saHour(s.starts_at)} in South Africa)${Date.parse(s.starts_at) <= Date.now() ? '. IT IS LIVE RIGHT NOW: saving a seat sends the Zoom link straight away' : ''}. Seat: ${WEBINAR_PAGE} (one tap opens Telegram, START, done; the Zoom link comes privately 1 hour before). At the end, a pack reserved for 10 people who are there live: never say what is in it and never promise a spot, it is revealed live.`,
        'WHEN TO INVITE THEM: a prospect who hesitates, doubts (scam ? martingale ?), wants to "think about it", wants to see who is behind Algoria or how the AI works, or is not ready to start yet: one short line inviting them, with the link. At most once per conversation (check the recent exchange), never to a member who is live, never between the welcome and their country. Never send a Zoom link yourself.',
      ].join('\n');
  factCache = { at: Date.now(), text };
  return text;
}

// ── L'INVITATION DES PROSPECTS PAR LE BOT ────────────────────────────────────────────────────────────────────────
//
// Mathieu, 24/10/2026 : « un message du bot pour prévenir les prospects du webinaire ». Les prospects (status
// 'onboarding', ~3 100) ont tous démarré le bot pour se connecter à l'app : il peut leur écrire. Rien ne part tant que
// la session n'a pas d'invite_at (posé quand Mathieu a validé le texte et l'heure). Ensuite la cron du webinaire envoie
// par lots (~45 s par passage, toutes les 5 min), les plus récents d'abord ; chaque personne est réservée dans
// webinar_invites AVANT l'envoi : jamais deux invitations pour la même session. Le bouton inscrit en un tap, sans
// quitter la conversation (handleWebinarCallback). Mathieu reçoit le bilan quand tout le monde est passé.

const INVITE_BATCH = 150;
const firstName = (n: string | null) => { const f = String(n ?? '').trim().split(/\s+/)[0] ?? ''; return /^[\p{L}][\p{L}'-]{1,20}$/u.test(f) ? f : ''; };

/** Le texte de l'invitation (anglais, la voix de Mathieu). */
export function inviteText(s: WebinarSession, name: string | null, now = Date.now()): string {
  const rel = relDay(s.starts_at, now);
  const when = rel.startsWith('on ') ? `on ${ukDay(s.starts_at)}` : rel;
  const hey = firstName(name);
  return [
    `🎤 ${hey ? `Hey ${hey}, I’m` : 'I’m'} going live ${when} at ${ukHour(s.starts_at)} UK time (${saHour(s.starts_at)} in South Africa), on Zoom.`,
    '',
    '45 minutes with me: how the AI trades gold, the real app on screen, real past results, and your questions, live.',
    '',
    '🎁 At the end, something reserved for the 10 people who are there live.',
    '',
    'It’s free. One tap and your seat is saved 👇',
  ].join('\n');
}

type TgResult = { ok: true } | { ok: false; error: string; retry?: boolean };
async function sendInvite(token: string, chatId: number, text: string, sessionId: string): Promise<TgResult> {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: '✅ Save my seat', callback_data: `wb:${sessionId}` }]] } }),
  }).catch(() => null);
  if (!r) return { ok: false, error: 'network', retry: true };
  if (r.ok) return { ok: true };
  const j = (await r.json().catch(() => ({}))) as { description?: string };
  // 429 (trop vite) ou 5xx : on s'arrête là, la personne sera reprise au passage suivant
  return { ok: false, error: j.description ?? `HTTP ${r.status}`, retry: r.status === 429 || r.status >= 500 };
}

/** Un passage d'invitations, jusqu'à `until` (ms). Appelé par la cron du webinaire, après les rappels. */
export async function runWebinarInvites(db: Db, until: number): Promise<{ invited: number; failed: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const now = Date.now();
  // pas d'invitation à moins de 2 h du début : les inscrits de dernière minute viennent du canal et de l'app
  const { data: ss } = await db.from('webinar_sessions').select('id,starts_at,zoom_url').eq('active', true).not('invite_at', 'is', null)
    .lte('invite_at', iso(now)).is('invite_done_at', null).gt('starts_at', iso(now + 2 * HOUR)).order('starts_at', { ascending: true }).limit(1);
  const s = ss?.[0] as WebinarSession | undefined;
  if (!s || !token) return { invited: 0, failed: 0 };
  let invited = 0, failed = 0;
  while (Date.now() < until) {
    const { data: batch, error } = await db.rpc('webinar_invite_batch', { p_session: s.id, p_limit: INVITE_BATCH });
    if (error) throw new Error(error.message);
    const people = (batch ?? []) as Array<{ tg_id: number; tg_name: string | null }>;
    if (!people.length) {
      // tout le monde est passé : marqué une seule fois, et Mathieu reçoit le bilan
      const { data: closed } = await db.from('webinar_sessions').update({ invite_done_at: iso(Date.now()) }).eq('id', s.id).is('invite_done_at', null).select('id');
      if (closed?.length) {
        const count = async (q: (b: Db) => Db) => (await q(db.from('webinar_invites').select('tg_id', { count: 'exact', head: true }).eq('session_id', s.id))).count ?? 0;
        const [ok, ko] = await Promise.all([count((b) => b.is('error', null)), count((b) => b.not('error', 'is', null))]);
        const { count: regs } = await db.from('webinar_registrations').select('id', { count: 'exact', head: true }).eq('session_id', s.id);
        await notifyOwner({ title: `🎤 Invitations au webinar envoyées : ${ok} prospects`, lines: [`${ukDay(s.starts_at)}, ${ukHour(s.starts_at)} (UK)`, `${ko} injoignables (bot bloqué ou compte supprimé).`, `Inscrits à ce jour : ${regs ?? 0}.`], tag: 'webinar' });
      }
      break;
    }
    // réservés AVANT l'envoi : seules les lignes réellement créées ici partent
    const { data: claimed } = await db.from('webinar_invites').upsert(people.map((p) => ({ session_id: s.id, tg_id: p.tg_id })), { onConflict: 'session_id,tg_id', ignoreDuplicates: true }).select('tg_id');
    const mine = new Set(((claimed ?? []) as Array<{ tg_id: number }>).map((r) => Number(r.tg_id)));
    const unsent: number[] = [];
    let stop = false;
    for (const p of people) {
      if (!mine.has(Number(p.tg_id))) continue;
      if (stop || Date.now() >= until) { unsent.push(p.tg_id); continue; }
      const r = await sendInvite(token, Number(p.tg_id), inviteText(s, p.tg_name), s.id);
      if (r.ok) invited++;
      else if (r.retry) { stop = true; unsent.push(p.tg_id); }
      else { failed++; await db.from('webinar_invites').update({ error: r.error.slice(0, 200) }).eq('session_id', s.id).eq('tg_id', p.tg_id); }
      await sleep(45);
    }
    // réservés mais pas envoyés (temps écoulé, Telegram qui freine) : rendus au passage suivant
    if (unsent.length) await db.from('webinar_invites').delete().eq('session_id', s.id).in('tg_id', unsent);
    if (stop) break;
  }
  return { invited, failed };
}

/** « ✅ Save my seat » sous l'invitation : inscrit en un tap, sans quitter la conversation. Renvoie false si le bouton
 *  n'est pas le nôtre. */
export async function handleWebinarCallback(db: Db, cq: { id: string; data?: string; from?: { id: number; first_name?: string; last_name?: string; username?: string }; message?: { chat?: { id?: number }; message_id?: number } }): Promise<boolean> {
  const m = /^wb:([a-z0-9-]{4,40})$/.exec(String(cq?.data ?? ''));
  if (!m || !cq.from?.id) return false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const tg = (method: string, payload: Record<string, unknown>) => token ? fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000), body: JSON.stringify(payload) }).catch(() => null) : null;
  const { data: already } = await db.from('webinar_registrations').select('id').eq('session_id', m[1]).eq('tg_id', cq.from.id).limit(1);
  if (already?.length) await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'You’re already in ✅' });
  else {
    await registerForWebinar(db, cq.from, m[1]); // la confirmation (et le lien Zoom si c'est dans moins d'1 h) part en message
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'You’re in ✅' });
  }
  // le bouton disparaît de l'invitation : la confirmation juste en dessous fait foi
  if (cq.message?.chat?.id && cq.message.message_id) await tg('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  return true;
}
