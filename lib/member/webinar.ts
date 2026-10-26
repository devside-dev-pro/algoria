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
import { adminTgIds, notifyOwner } from './notifyOwner';

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

// ── LE PILOTE AUTOMATIQUE : LE CALENDRIER ET LES RÉGLAGES ───────────────────────────────────────────────────────
//
// Mathieu, 24/10/2026 : « il faut un système automatique qui se répète toutes les semaines, je vais pas à chaque fois
// te dire de déclencher les invitations, mettre la bonne date… ». Les sessions des 8 prochains jours se créent seules
// (WEEKLY), avec le lien de la réunion Zoom récurrente (le même chaque semaine). Une session annulée (active = false)
// n'est jamais recréée. Mathieu pilote en écrivant au bot (handleWebinarAdmin) : « webinar » pour l'état, « webinar
// off / on », « webinar invites on / off », « webinar skip », « webinar zoom <lien> ».

/** Les webinaires de chaque semaine, heure du Royaume-Uni (0 = dimanche, 3 = mercredi). */
const WEEKLY: Array<{ weekday: number; at: string }> = [{ weekday: 3, at: '19:00' }, { weekday: 0, at: '19:00' }];
const AHEAD_DAYS = 8;
/** Le premier webinaire (Mathieu : mercredi 28/10) : aucune session automatique avant. */
const FIRST_DAY = '2026-10-28';

async function setting(db: Db, key: string, fallback: string): Promise<string> {
  const { data } = await db.from('support_settings').select('value').eq('key', key).limit(1);
  return String((data?.[0] as { value?: string } | undefined)?.value ?? fallback).trim().toLowerCase();
}
const setSetting = (db: Db, key: string, value: string, by: string) =>
  db.from('support_settings').upsert({ key, value, updated_at: iso(Date.now()), updated_by: by }, { onConflict: 'key' });

/** Décalage de Londres par rapport à UTC, en minutes (0 l'hiver, +60 l'été). */
const londonOffsetMin = (ms: number) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ms);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - ms) / 60_000;
};
/** Instant (ms) d'une heure du Royaume-Uni 'HH:MM' le jour `day`, juste aussi les jours de changement d'heure. */
function ukTimeMs(day: string, hhmm: string): number {
  const naive = Date.parse(`${day}T${hhmm}:00Z`);
  return naive - londonOffsetMin(naive - londonOffsetMin(naive) * 60_000) * 60_000;
}

/** Crée les sessions des 8 prochains jours qui manquent (rien si Mathieu a coupé les webinaires). Appelé par la cron. */
export async function ensureSessions(db: Db): Promise<number> {
  if ((await setting(db, 'webinars', 'on')) === 'off') return 0;
  const now = Date.now();
  const want: Array<{ id: string; starts_at: string }> = [];
  for (let d = 0; d <= AHEAD_DAYS; d++) {
    const day = ukDate(now + d * 86_400_000);
    if (day < FIRST_DAY) continue;
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
    for (const w of WEEKLY) {
      const at = ukTimeMs(day, w.at);
      if (w.weekday === wd && at > now) want.push({ id: day, starts_at: iso(at) });
    }
  }
  if (!want.length) return 0;
  const { data: have } = await db.from('webinar_sessions').select('id').in('id', want.map((w) => w.id));
  const known = new Set(((have ?? []) as Array<{ id: string }>).map((h) => h.id));
  const missing = want.filter((w) => !known.has(w.id));
  if (!missing.length) return 0;
  // le lien de la réunion Zoom récurrente : celui de la dernière session qui en avait un
  const { data: last } = await db.from('webinar_sessions').select('zoom_url').not('zoom_url', 'is', null).order('starts_at', { ascending: false }).limit(1);
  const zoom = (last?.[0] as { zoom_url?: string } | undefined)?.zoom_url ?? null;
  await db.from('webinar_sessions').upsert(missing.map((m) => ({ ...m, zoom_url: zoom })), { onConflict: 'id', ignoreDuplicates: true });
  return missing.length;
}

// ── LE SUPPORT : CE QU'IL SAIT DU PROCHAIN WEBINAIRE ─────────────────────────────────────────────────────────────

let factCache: { at: number; text: string } | null = null;
/** Le bloc de faits du support (lib/member/replyDraft.ts) : la prochaine session, à l'heure près, et quand en parler.
 *  Calculé depuis la base (cache 60 s) : le support n'a jamais une date en retard, et les règles du webinaire vivent
 *  ici, avec le webinaire, plutôt que dans le knowledge. */
export async function webinarFacts(db: Db): Promise<string> {
  if (factCache && Date.now() - factCache.at < 60_000) return factCache.text;
  const s = (await upcomingSessions(db, 1).catch(() => []))[0];
  const text = [
    !s
      ? 'LIVE WEBINARS: no date is scheduled right now. Never invent one; if they ask, the next dates are announced in the Algoria channel.'
      : `NEXT LIVE WEBINAR (Mathieu live on Zoom, in English, free, 45 minutes: his story, gold trader since 2016, what the AI is and why 2026 changes everything, how Algoria works with real screenshots of the app and MetaTrader, real past results, live questions): ${ukDay(s.starts_at)} at ${ukHour(s.starts_at)} UK time (${saHour(s.starts_at)} in South Africa)${Date.parse(s.starts_at) <= Date.now() ? '. IT IS LIVE RIGHT NOW: saving a seat sends the Zoom link straight away' : ''}. Seat: ${WEBINAR_PAGE} (one tap opens Telegram, START, done; the Zoom link comes privately 1 hour before, then again when it starts). At the end, a pack reserved for 10 people who are there live: never say what is in it and never promise a spot, it is revealed live. After the webinar, people who want it write WEBINAR to Mathieu.`,
    'WHEN TO INVITE THEM: a prospect who hesitates, doubts (scam ? martingale ?), wants to "think about it", wants to see who is behind Algoria or how the AI works, or is not ready to start yet: one short line inviting them, with the link. At most once per conversation (check the recent exchange), never to a member who is live, never between the welcome and their country. Someone who missed it: invite them to the next one. Never send a Zoom link yourself. (The knowledge rule "do not talk about the lives yet" is about TikTok lives only: these Zoom webinars are to be talked about.)',
  ].join('\n');
  factCache = { at: Date.now(), text };
  return text;
}

// ── L'INVITATION DES PROSPECTS PAR LE BOT ────────────────────────────────────────────────────────────────────────
//
// LES RÈGLES (Mathieu : « qu'on ne se fasse pas ban le bot à spammer des milliers de gens, il faut être méthodique ») :
//   · dès la veille au soir, de 25 h à 2 h avant le début (à partir de 18h UK la veille pour 19h) : la campagne part en
//     quelques minutes, donc le mardi vers 18h UK (20h en Afrique du Sud) pour le mercredi. Mathieu, 26/10/2026 :
//     « lance les invitations dès mardi soir », pour laisser une soirée de plus pour s'inscrire (c'était le jour même,
//     de 12h à 17h UK) ; le rappel d'1 h puis celui du début ramènent les inscrits le jour J ;
//   · seulement les prospects (status 'onboarding'), les plus récents d'abord (les plus chauds) ;
//   · une invitation par personne toutes les 3 semaines au plus, jamais quelqu'un qui a bloqué le bot
//     (webinar_invite_batch, migration 0036) ;
//   · 500 par session au plus : en 3 semaines, tout le fichier a reçu une invitation, les nouveaux inscrits d'abord ;
//   · ~8 messages par seconde (Telegram en tolère 30) ;
//   · COUPE-CIRCUIT : si plus de 4 % des invités d'une session bloquent le bot dans la foulée, la campagne s'arrête et
//     Mathieu est prévenu. C'est le taux de blocage qui fait passer un bot pour du spam, pas le volume.
// Chaque personne est réservée dans webinar_invites AVANT l'envoi : jamais deux invitations pour la même session. Le
// bouton inscrit en un tap, sans quitter la conversation (handleWebinarCallback). Mathieu reçoit le bilan à la fin.
// L'interrupteur 'webinar_invites' coupe tout ; il reste sur 'off' tant que Mathieu n'a pas validé.

const INVITE_FROM = 25 * HOUR; // la veille, 18h UK pour un webinaire à 19h (7 h avant jusqu'au 26/10/2026)
const INVITE_UNTIL = 2 * HOUR;
const INVITE_CAP = 500;
const INVITE_BATCH = 100;
const BREAKER = { minSent: 80, rate: 0.04 };
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

/** Les chiffres de la campagne d'une session. */
async function inviteStats(db: Db, sessionId: string): Promise<{ total: number; sent: number; unreachable: number; blocked: number; registered: number }> {
  const count = async (q: (b: Db) => Db) => (await q(db.from('webinar_invites').select('tg_id', { count: 'exact', head: true }).eq('session_id', sessionId))).count ?? 0;
  const [total, sent, blocked, reg] = await Promise.all([
    count((b) => b), count((b) => b.is('error', null)), count((b) => b.not('blocked_at', 'is', null)),
    db.from('webinar_registrations').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
  ]);
  return { total, sent, unreachable: total - sent, blocked, registered: reg.count ?? 0 };
}

/** Un passage d'invitations, jusqu'à `until` (ms). Appelé par la cron du webinaire, après les rappels. */
export async function runWebinarInvites(db: Db, until: number): Promise<{ invited: number; failed: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const now = Date.now();
  if (!token || (await setting(db, 'webinar_invites', 'off')) !== 'on') return { invited: 0, failed: 0 };
  const { data: ss } = await db.from('webinar_sessions').select('id,starts_at,zoom_url').eq('active', true).is('invite_done_at', null)
    .gt('starts_at', iso(now + INVITE_UNTIL)).lte('starts_at', iso(now + INVITE_FROM)).order('starts_at', { ascending: true }).limit(1);
  const s = ss?.[0] as WebinarSession | undefined;
  if (!s) return { invited: 0, failed: 0 };
  // la campagne se ferme une seule fois, et Mathieu reçoit le bilan
  const close = async (note: string, title: string) => {
    const { data: closed } = await db.from('webinar_sessions').update({ invite_done_at: iso(Date.now()), invite_note: note }).eq('id', s.id).is('invite_done_at', null).select('id');
    if (!closed?.length) return;
    const st = await inviteStats(db, s.id);
    await notifyOwner({ title, lines: [`${ukDay(s.starts_at)}, ${ukHour(s.starts_at)} (UK)`, `${st.sent} invitations envoyées · ${st.unreachable} injoignables (bot déjà bloqué, compte supprimé)`, `${st.blocked} ont bloqué le bot après l’invitation`, `Inscrits à ce jour : ${st.registered}`], tag: 'webinar' });
  };
  let invited = 0, failed = 0;
  while (Date.now() < until) {
    const st = await inviteStats(db, s.id);
    if (st.sent >= BREAKER.minSent && st.blocked / st.sent > BREAKER.rate) {
      await close('coupe-circuit', `⚠️ Invitations au webinar arrêtées : ${Math.round((100 * st.blocked) / st.sent)} % des invités ont bloqué le bot`);
      break;
    }
    const room = INVITE_CAP - st.total;
    const { data: batch, error } = room > 0 ? await db.rpc('webinar_invite_batch', { p_session: s.id, p_limit: Math.min(INVITE_BATCH, room) }) : { data: [], error: null };
    if (error) throw new Error(error.message);
    const people = (batch ?? []) as Array<{ tg_id: number; tg_name: string | null }>;
    if (!people.length) { await close(room > 0 ? 'tout le monde' : 'plafond', '🎤 Invitations au webinar terminées'); break; }
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

/** Quelqu'un a bloqué le bot (my_chat_member « kicked », webhook) : noté sur ses invitations des 3 derniers jours. Il
 *  n'en recevra plus, et la campagne en cours le compte pour son coupe-circuit. */
export async function noteBotBlocked(db: Db, tgId: number): Promise<void> {
  await db.from('webinar_invites').update({ blocked_at: iso(Date.now()) }).eq('tg_id', tgId).is('blocked_at', null).gt('sent_at', iso(Date.now() - 3 * 86_400_000));
}

// ── LES COMMANDES DE MATHIEU (en écrivant au bot) ────────────────────────────────────────────────────────────────

const parisDubai = (at: string) => ['Europe/Paris', 'Asia/Dubai'].map((tz) => new Date(at).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }));
const frDay = (at: string) => new Date(at).toLocaleDateString('fr-FR', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' });

/** « webinar », « webinar off / on », « webinar invites on / off », « webinar skip », « webinar zoom <lien> » : écrits au
 *  bot, en privé, par un admin. Renvoie false si le message n'est pas une de ces commandes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleWebinarAdmin(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const m = /^\/?webina(?:r|ire)s?(?:\s+(.+))?$/i.exec(text);
  if (msg?.chat?.type !== 'private' || msg.reply_to_message || !m) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const by = msg.from?.username ? `@${msg.from.username}` : String(msg.from?.id ?? 'admin');
  const arg = String(m[1] ?? '').trim();
  const reply = (t: string) => send(Number(msg.chat.id), t);
  let note = '';
  if (/^(off|on)$/i.test(arg)) {
    await setSetting(db, 'webinars', arg.toLowerCase(), by);
    note = arg.toLowerCase() === 'on' ? '✅ Webinaires automatiques rallumés : les sessions se recréent chaque mercredi et dimanche.' : '⏸ Webinaires automatiques coupés : plus aucune nouvelle session. Celles déjà prévues restent (« webinar skip » pour annuler la prochaine).';
  } else if (/^invit\w*\s+(on|off)$/i.test(arg)) {
    const v = /on$/i.test(arg) ? 'on' : 'off';
    await setSetting(db, 'webinar_invites', v, by);
    note = v === 'on' ? '✅ Invitations allumées : le bot invite les prospects la veille de chaque session, à partir de 18h UK.' : '⏸ Invitations coupées : le bot n’invite plus personne.';
  } else if (/^(skip|annule\w*|cancel)$/i.test(arg)) {
    const next = (await upcomingSessions(db, 1))[0];
    if (!next || Date.parse(next.starts_at) <= Date.now()) note = 'Aucune session à venir à annuler.';
    else {
      await db.from('webinar_sessions').update({ active: false }).eq('id', next.id);
      const { data: regs } = await db.from('webinar_registrations').select('tg_id').eq('session_id', next.id);
      let told = 0;
      for (const r of (regs ?? []) as Array<{ tg_id: number }>) { if (await send(r.tg_id, `⚠️ Sorry, the live webinar of ${ukDay(next.starts_at)} is cancelled 🙏🏼 I’ll send you the next date right here.`)) told++; await sleep(60); }
      note = `🗑 Session du ${frDay(next.starts_at)} annulée${told ? `, ${told} inscrit${told > 1 ? 's' : ''} prévenu${told > 1 ? 's' : ''}` : ''}.`;
    }
  } else if (/^zoom\s+https:\/\/\S*zoom\.us\/\S+$/i.test(arg)) {
    const url = arg.replace(/^zoom\s+/i, '');
    const { data } = await db.from('webinar_sessions').update({ zoom_url: url }).eq('active', true).gt('starts_at', iso(Date.now())).select('id');
    note = `✅ Lien Zoom mis à jour sur ${(data ?? []).length} session${(data ?? []).length > 1 ? 's' : ''} à venir.`;
  } else if (arg) note = 'Commande inconnue.';
  // l'état, toujours
  const [auto, inv, ss] = await Promise.all([setting(db, 'webinars', 'on'), setting(db, 'webinar_invites', 'off'), upcomingSessions(db, 2)]);
  const lines = [note, note ? '' : null, `🎤 Webinaires · automatiques ${auto === 'off' ? '⏸ OFF' : '✅ ON'} · invitations ${inv === 'on' ? '✅ ON' : '⏸ OFF'}`].filter((l) => l != null) as string[];
  for (const [i, s] of ss.entries()) {
    const [paris, dubai] = parisDubai(s.starts_at);
    lines.push('', `${i === 0 ? 'Prochaine' : 'Ensuite'} : ${frDay(s.starts_at)}, ${ukHour(s.starts_at)} UK (${paris} Paris · ${dubai} Dubaï)${s.zoom_url ? '' : ' · ⚠️ pas de lien Zoom'}`);
    if (i === 0) { const st = await inviteStats(db, s.id); lines.push(`${st.registered} inscrit${st.registered > 1 ? 's' : ''} · ${st.sent} invitation${st.sent > 1 ? 's' : ''} envoyée${st.sent > 1 ? 's' : ''}`); }
  }
  if (!ss.length) lines.push('', 'Aucune session prévue.');
  lines.push('', 'Commandes : « webinar off » / « webinar on » · « webinar invites on » / « off » · « webinar skip » (annule la prochaine) · « webinar zoom <lien> »');
  await reply(lines.join('\n'));
  return true;
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
