// 🎤 LES WEBINAIRES (24/10/2026, décision Mathieu : deux par semaine, sur Zoom, en anglais). Server-only.
//
// L'INSCRIPTION PASSE PAR LE BOT, pas par un formulaire : la page /webinar ouvre t.me/<bot>?start=wb_<session>, la
// personne appuie sur START, c'est fait. Notre public est déjà sur Telegram, il n'a rien à taper, et surtout un bot ne
// peut écrire qu'à quelqu'un qui l'a démarré : c'est ce qui permet la confirmation, puis les rappels qui font venir
// les gens le jour J.
//
// LES RAPPELS (app/api/cron/webinar, toutes les 5 min) : la veille (seulement pour qui s'est inscrit plus de 24 h
// avant), 1 h avant avec le lien Zoom, puis au début. Mathieu reçoit le nombre d'inscrits 1 h avant, et une alerte
// 3 h avant si la session n'a pas encore de lien Zoom (sans lien, ni le rappel d'1 h ni celui du début ne partent).
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

export const seatLink = (id: string) => `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? ''}?start=wb_${id}`;
export const calendarLink = (id: string) => `${APP_URL}/api/webinar/ics?s=${encodeURIComponent(id)}`;

/** « Wednesday 28 October » et « 19:00 », à l'heure du Royaume-Uni (le public : UK, Afrique du Sud…). */
export const ukDay = (at: string) => new Date(at).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' });
export const ukHour = (at: string) => new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });

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
    .gt('starts_at', iso(now - LATE_JOIN_MS)).lt('starts_at', iso(now + 25 * HOUR));
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

    const stages: Array<{ col: 'reminded_24h_at' | 'reminded_1h_at' | 'reminded_live_at'; due: boolean; text: string; button: Button }> = [
      { col: 'reminded_24h_at', due: left <= 24 * HOUR && left > 2 * HOUR,
        text: `📅 Reminder: live webinar with Mathieu, ${when}.\n45 minutes: how an AI trades gold, and how your own account can copy it.\n\nI’ll send you the Zoom link here, 1 hour before 🙏🏼`,
        button: { text: '📅 Add to my calendar', url: calendarLink(s.id) } },
      { col: 'reminded_1h_at', due: !!s.zoom_url && left <= HOUR && left > 5 * 60_000,
        text: `⏰ In about an hour: live webinar with Mathieu, at ${ukHour(s.starts_at)} (UK time).\nHere’s your Zoom link 👇 Stay until the end: something is reserved for 10 people.`,
        button: { text: '🎥 Join the webinar', url: s.zoom_url ?? '' } },
      { col: 'reminded_live_at', due: !!s.zoom_url && left <= 5 * 60_000 && left > -30 * 60_000,
        text: '🔴 We’re going live! Join now 👇',
        button: { text: '🎥 Join the webinar', url: s.zoom_url ?? '' } },
    ];
    for (const st of stages) {
      if (!st.due) continue;
      const { data: regs } = await db.from('webinar_registrations').select('id,tg_id,created_at').eq('session_id', s.id).is(st.col, null).limit(200);
      for (const r of (regs ?? []) as Array<{ id: number; tg_id: number; created_at: string }>) {
        // marqué AVANT l'envoi, et seulement s'il ne l'était pas : deux passages en même temps n'envoient jamais deux fois
        const { data: mine } = await db.from('webinar_registrations').update({ [st.col]: iso(now) }).eq('id', r.id).is(st.col, null).select('id');
        if (!mine?.length) continue;
        // la veille : seulement pour qui s'est inscrit plus de 24 h avant (sinon il vient de recevoir sa confirmation)
        if (st.col === 'reminded_24h_at' && Date.parse(r.created_at) > start - 24 * HOUR) continue;
        if (await send(r.tg_id, st.text, [st.button])) sent++;
        await sleep(60);
      }
    }
  }
  return { sessions: (ss ?? []).length, sent };
}
