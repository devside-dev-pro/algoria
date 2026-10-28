// 🎥 LE REPLAY DU WEBINAIRE SUR DEMANDE (28/10/2026, Mathieu). Server-only.
//
// Un membre écrit « REPLAY » en privé (au bot, ou à Mathieu sur son compte support = Telegram Business) : ~50 s plus
// tard il reçoit le texte d'accusé, puis tout de suite la vidéo du replay (le FICHIER, jamais un lien). Mathieu,
// 23:56 : « ~1 minute, sinon ça fait trop robot ».
//
// LA VIDÉO (~60 Mo, 25:29) : un bot ne peut pas TÉLÉVERSER plus de 50 Mo, mais il peut RENVOYER sans limite de taille
// un fichier déjà sur Telegram, par son file_id. Mathieu envoie donc la vidéo UNE fois au bot, en privé (un admin,
// adminTgIds) : le webhook garde son file_id (support_settings 'webinar_replay_file') et répond « Replay enregistré ✅ »
// en renvoyant la vidéo par ce file_id (la preuve que l'envoi marche). Un file_id appartient au bot, pas à une
// conversation : il sert aussi au compte de Mathieu via business_connection_id (sendVideo / sendDocument acceptent ce
// paramètre). C'est déjà ce qui envoie ses bulles d'accueil depuis le 16/10 (supportAuto.ts : sendVideoNote).
//
// LE DÉLAI (Vercel, fonction du webhook bornée à 60 s, maxDuration de app/api/telegram/route.ts) : la demande est
// mise en file (support_jobs kind 'replay', due_at = maintenant + 50 à 55 s), le webhook répond 200 tout de suite,
// puis after() attend l'échéance et envoie (texte, ~1,5 s, vidéo). Si la fonction meurt avant (ou s'il ne reste pas
// assez de temps), la cron des envois du support (chaque minute, /api/cron/support-jobs) la reprend : 1 à 2 min au
// lieu de ~50 s, rien n'est perdu. Chaque ligne est RÉSERVÉE avant l'envoi (pending → running) : jamais deux envois.
//
// LES RÈGLES (Support Algoria) :
//   · privé seulement, jamais un groupe ; un admin qui écrit « replay » au bot voit l'état (handleReplayAdmin) ;
//   · le support automatique ne répond PAS à ce message (pas de double réponse) : ses réponses prévues pour cette
//     conversation sont annulées, et rien n'est planifié pour ce message ;
//   · un envoi par personne et par 24 h ; redemandé dans les 24 h → un court rappel seulement (pas plus d'un par 10 min) ;
//   · pas de vidéo enregistrée → RIEN ne part chez le membre (pas d'accusé sans vidéo), Mathieu est prévenu ;
//   · un échec → un seul nouvel essai (à la minute suivante), puis alerte à Mathieu (notifyOwner, comme l'alerte
//     « sans réponse ») ; l'accusé déjà parti n'est jamais renvoyé, seule la vidéo est retentée ;
//   · chaque envoi est noté dans member_actions (compte support : biz_msg « from owner », comme les autres envois).
//
// LES TEXTES (CM Algoria, validés par Mathieu le 28/10 à 23:57, le rappel le 29/10 ; à garder tels quels) : anglais par défaut, allemand,
// italien. L'anglais est modifiable sans code dans l'admin (TOOLS → 🎥 SUPPORT — WEBINAR REPLAY, agent_docs
// 'support_replay' : accusé --- légende --- rappel), comme les autres textes du support ; l'allemand et l'italien restent
// ici, comme l'italien des autres textes.
import { adminTgIds, notifyOwner } from './notifyOwner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TgResult = { ok: boolean; result?: any; description?: string };

export type ReplayLang = 'en' | 'de' | 'it';
export const REPLAY_KIND = 'replay';
export const REPLAY_SETTING = 'webinar_replay_file';
export const REPLAY_DELAY_MIN_MS = 50_000;
export const REPLAY_DELAY_SPREAD_MS = 5_000;
/** after() ne réserve plus la ligne passé ce délai depuis la réception (fonction bornée à 60 s) : la cron s'en charge. */
export const REPLAY_AFTER_DEADLINE_MS = 56_000;
export const REPLAY_REPEAT_MS = 24 * 3_600_000;
const REPLAY_REMINDER_GAP_MS = 10 * 60_000;
export const REPLAY_STALE_RUNNING_MS = 90_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── LES TEXTES ─────────────────────────────────────────────────────────────────────────────────────────────────

/** FINAUX (CM Algoria, validés par Mathieu le 28/10/2026 à 23:57) : ne pas réécrire. */
export const REPLAY_TEXTS: Record<ReplayLang, { ack: string; caption: string }> = {
  en: { ack: 'No problem 🙌🏻 I\'m sending you the replay 🎥', caption: '🎥 Here\'s the replay of the live (25 min). Any question after watching? Just reply here 👇' },
  de: { ack: 'Kein Problem 🙌🏻 Ich schicke dir gleich das Replay 🎥', caption: '🎥 Hier ist das Replay des Lives (25 Min.). Fragen nach dem Anschauen? Antworte einfach hier 👇' },
  it: { ack: 'Nessun problema 🙌🏻 Ti mando subito il replay 🎥', caption: '🎥 Ecco il replay del live (25 min). Domande dopo averlo visto? Rispondi pure qui 👇' },
};
/** FINAL (validé mot pour mot par Mathieu le 29/10/2026) : le rappel quand le replay a déjà été envoyé dans les 24 h. */
export const REPLAY_REMINDER: Record<ReplayLang, string> = {
  en: 'You already have it 🙌🏻 The replay is just above in our chat 👆 Any question after watching? Just reply here 👇',
  de: 'Du hast es schon 🙌🏻 Das Replay ist direkt oben in unserem Chat 👆 Fragen nach dem Anschauen? Antworte einfach hier 👇',
  it: 'Ce l\'hai già 🙌🏻 Il replay è qui sopra nella nostra chat 👆 Domande dopo averlo visto? Rispondi pure qui 👇',
};

/** Les textes d'une langue. `doc` (agent_docs 'support_replay', anglais seulement) : accusé --- légende --- rappel ;
 *  une partie vide garde le texte du code. */
export function replayTexts(lang: ReplayLang, doc?: string | null): { ack: string; caption: string; reminder: string } {
  const base = { ...REPLAY_TEXTS[lang], reminder: REPLAY_REMINDER[lang] };
  if (lang !== 'en' || !doc?.trim()) return base;
  const [ack, caption, reminder] = doc.split(/^\s*---\s*$/m).map((p) => p.trim());
  return { ack: ack || base.ack, caption: (caption || base.caption).slice(0, 1024), reminder: reminder || base.reminder };
}

const ITALIAN_HINT = /\b(il|lo|per favore|grazie|ciao|mandami|vorrei)\b/i;
const GERMAN_HINT = /\b(das|bitte|danke|hallo|schick|mir)\b/i;
/** La langue : la fiche (locale 'it'), puis la langue de son Telegram (language_code), puis les mots du message. Anglais sinon. */
export function replayLang(o: { locale?: string | null; languageCode?: string | null; text?: string | null }): ReplayLang {
  if (o.locale === 'it') return 'it';
  const lc = String(o.languageCode ?? '').toLowerCase().slice(0, 2);
  if (lc === 'de' || lc === 'it') return lc;
  const t = String(o.text ?? '');
  if (ITALIAN_HINT.test(t)) return 'it';
  if (GERMAN_HINT.test(t)) return 'de';
  return 'en';
}

// ── LE MOT « REPLAY » ──────────────────────────────────────────────────────────────────────────────────────────
// Comme LIVE (#556) : la demande seule, majuscules, accents et ponctuation indifférents. Quelques petites variantes
// (« replay pls », « the replay », « le replay », « can I get the replay ? », « replay du live ») ; jamais quand le mot
// est dans une phrase qui parle d'autre chose (« is there a replay of the part about brokers, I missed it »).
const REPLAY_FILLER = new Set([
  'the', 'a', 'an', 'le', 'la', 'l', 'il', 'lo', 'el', 'das', 'den', 'un', 'une', 'of', 'du', 'de', 'del', 'des', 'dello', 'dal', 'vom', 'des',
  'live', 'webinar', 'webinaire', 'video', 'zoom', 'session', 'pls', 'plz', 'please', 'svp', 'stp', 'per', 'favore', 'perfavore', 'bitte',
  'send', 'me', 'mir', 'moi', 'mi', 'can', 'could', 'i', 'have', 'get', 'want', 'you', 'the', 'hi', 'hello', 'hey', 'ciao', 'hallo', 'bonjour', 'salut', 'thanks', 'thank', 'merci', 'grazie', 'danke',
]);
export function isReplayRequest(text: string): boolean {
  const norm = String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (norm.length > 80) return false;
  const words = norm.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || words.length > 7) return false;
  if (words.filter((w) => w === 'replay').length !== 1) return false;
  return words.every((w) => w === 'replay' || REPLAY_FILLER.has(w));
}

// ── TELEGRAM ───────────────────────────────────────────────────────────────────────────────────────────────────

async function tg(method: string, payload: Record<string, unknown>, timeoutMs = 5000): Promise<TgResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN missing' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(payload) });
    return (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as TgResult;
  } catch (e) {
    return { ok: false, description: (e as { name?: string })?.name === 'TimeoutError' ? 'timeout' : ((e as { message?: string })?.message ?? 'network error') };
  }
}

// ── LA VIDÉO ENREGISTRÉE ───────────────────────────────────────────────────────────────────────────────────────

export interface ReplayAsset { file_id: string; type: 'video' | 'document'; file_unique_id?: string; duration?: number | null; size?: number | null; name?: string | null; at?: string; by?: string }

/** La vidéo du replay, ou null (jamais enregistrée, ou coupée par « replay off »). La valeur est lue telle quelle : un
 *  file_id est sensible à la casse. */
export async function getReplayAsset(db: Db): Promise<ReplayAsset | null> {
  const { data } = await db.from('support_settings').select('value').eq('key', REPLAY_SETTING).limit(1);
  const raw = String((data?.[0] as { value?: string } | undefined)?.value ?? '').trim();
  if (!raw || raw === 'off') return null;
  try {
    const a = JSON.parse(raw) as ReplayAsset;
    return a?.file_id && (a.type === 'video' || a.type === 'document') ? a : null;
  } catch { return null; }
}

const mmss = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '?');
const mb = (b?: number | null) => (b ? `${Math.round(b / 1_000_000)} Mo` : '? Mo');
const isVideoDoc = (d: { mime_type?: string } | undefined) => /^video\//.test(String(d?.mime_type ?? ''));

/** Une vidéo envoyée au bot, en privé, par un admin (pas en réponse, pas via le compte support) : elle devient le
 *  replay. Le bot confirme et renvoie la vidéo par son file_id : si Mathieu la reçoit, les membres la recevront. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleReplayUpload(db: Db, msg: any): Promise<boolean> {
  if (msg?.chat?.type !== 'private' || msg.business_connection_id || msg.reply_to_message) return false;
  const doc = isVideoDoc(msg.document) ? msg.document : null;
  const v = msg.video ?? doc;
  if (!v?.file_id) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const by = msg.from?.username ? `@${msg.from.username}` : String(msg.from?.id ?? 'admin');
  const asset: ReplayAsset = { file_id: String(v.file_id), type: msg.video ? 'video' : 'document', file_unique_id: v.file_unique_id ?? undefined, duration: v.duration ?? null, size: v.file_size ?? null, name: v.file_name ?? null, at: iso(Date.now()), by };
  await db.from('support_settings').upsert({ key: REPLAY_SETTING, value: JSON.stringify(asset), updated_at: iso(Date.now()), updated_by: by }, { onConflict: 'key' });
  const head = `✅ Replay enregistré · ${mmss(asset.duration)} · ${mb(asset.size)}${asset.type === 'document' ? ' (envoyé en fichier : il partira en fichier)' : ''}`;
  const echo = await tg(asset.type === 'video' ? 'sendVideo' : 'sendDocument', { chat_id: msg.chat.id, [asset.type]: asset.file_id, caption: 'Aperçu : c’est exactement ce que recevra un membre qui écrit REPLAY.', ...(asset.type === 'video' ? { supports_streaming: true } : {}) }, 15000);
  await tg('sendMessage', {
    chat_id: msg.chat.id, reply_to_message_id: msg.message_id,
    text: echo.ok
      ? `${head}\n\nÀ partir de maintenant, un membre qui t’écrit REPLAY (au bot ou sur ton compte) reçoit cette vidéo ~1 min après. Une nouvelle vidéo envoyée ici remplace celle-ci. « replay » pour l’état, « replay off » pour couper.`
      : `⚠️ Vidéo reçue mais Telegram refuse de la renvoyer (${echo.description ?? '?'}). Rien n’est activé : renvoie-la (en vidéo, pas en lien).`,
  });
  if (!echo.ok) await db.from('support_settings').upsert({ key: REPLAY_SETTING, value: 'off', updated_at: iso(Date.now()), updated_by: `${by} (renvoi refusé)` }, { onConflict: 'key' });
  return true;
}

/** « replay » (l'état) ou « replay off » (couper), écrits au bot en privé par un admin. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleReplayAdmin(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const m = /^\/?replay(?:\s+(off|status|etat|état))?$/i.exec(text);
  if (msg?.chat?.type !== 'private' || msg.reply_to_message || !m) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  if (/^off$/i.test(m[1] ?? '')) {
    const by = msg.from?.username ? `@${msg.from.username}` : String(msg.from?.id ?? 'admin');
    await db.from('support_settings').upsert({ key: REPLAY_SETTING, value: 'off', updated_at: iso(Date.now()), updated_by: by }, { onConflict: 'key' });
    await tg('sendMessage', { chat_id: msg.chat.id, text: '⏸ Replay coupé : plus rien ne part sur REPLAY (tu es prévenu à chaque demande). Envoie-moi une vidéo pour le rallumer.' });
    return true;
  }
  const a = await getReplayAsset(db);
  const { count } = await db.from('support_jobs').select('id', { count: 'exact', head: true }).eq('kind', REPLAY_KIND).eq('status', 'done').gte('created_at', iso(Date.now() - 7 * 86_400_000));
  await tg('sendMessage', {
    chat_id: msg.chat.id,
    text: a
      ? `🎥 Replay actif · ${mmss(a.duration)} · ${mb(a.size)} · enregistré ${a.at ? new Date(a.at).toLocaleString('fr-FR', { timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?'} (Dubaï)\n${count ?? 0} envoi(s) sur 7 jours.\n\nUne nouvelle vidéo envoyée ici remplace celle-ci · « replay off » pour couper.`
      : '🎥 Aucun replay enregistré : envoie-moi la vidéo ici (en vidéo, pas en lien), je réponds « Replay enregistré ✅ ».',
  });
  return true;
}

// ── LA DEMANDE ─────────────────────────────────────────────────────────────────────────────────────────────────

export type ReplayRequest = { tgId: number; conn: string | null; lang: ReplayLang; who: string; memberNo?: number | null };
export type ReplayOutcome = { status: 'scheduled' | 'reminder' | 'ignored' | 'no_video'; jobId?: number; dueMs?: number };

/** Met la demande en file (ou rien). Le texte + la vidéo partent à l'échéance (runReplayJob). */
export async function requestReplay(db: Db, r: ReplayRequest, now = Date.now()): Promise<ReplayOutcome> {
  const { data: recent } = await db.from('support_jobs').select('id,status,payload,created_at,updated_at').eq('tg_id', r.tgId).eq('kind', REPLAY_KIND)
    .gte('created_at', iso(now - REPLAY_REPEAT_MS)).order('created_at', { ascending: false }).limit(20);
  const rows = (recent ?? []) as Array<{ id: number; status: string; payload: Record<string, unknown> | null; created_at: string; updated_at: string }>;
  // déjà en route : rien de plus
  if (rows.some((x) => x.status === 'pending' || x.status === 'running')) return { status: 'ignored' };
  const sent = rows.some((x) => x.status === 'done' && !x.payload?.reminder);
  if (sent) {
    // déjà reçu dans les 24 h : un court rappel, pas plus d'un par 10 min
    if (rows.some((x) => x.payload?.reminder && Date.parse(x.created_at) > now - REPLAY_REMINDER_GAP_MS)) return { status: 'ignored' };
  } else if (!(await getReplayAsset(db))) {
    // pas de vidéo : rien chez le membre, Mathieu prévenu (une fois par personne et par 24 h)
    if (!rows.some((x) => x.payload?.no_video)) {
      await db.from('support_jobs').insert({ tg_id: r.tgId, conn: r.conn ?? '', kind: REPLAY_KIND, due_at: iso(now), status: 'canceled', payload: { no_video: true, lang: r.lang }, result: { reason: 'aucune vidéo de replay enregistrée' } });
      await notifyOwner({ title: '🎥 REPLAY demandé, mais aucune vidéo enregistrée', lines: [`${r.who} a écrit REPLAY ${r.conn ? 'sur ton compte' : 'au bot'} : rien ne lui est parti.`, 'Envoie la vidéo au bot en privé (elle sera enregistrée), puis envoie-lui le replay toi-même.'], tag: 'replay' }).catch(() => null);
    }
    return { status: 'no_video' };
  }
  const dueMs = now + REPLAY_DELAY_MIN_MS + Math.floor(Math.random() * REPLAY_DELAY_SPREAD_MS);
  const { data: ins } = await db.from('support_jobs').insert({ tg_id: r.tgId, conn: r.conn ?? '', kind: REPLAY_KIND, due_at: iso(dueMs), payload: { lang: r.lang, who: r.who, member_no: r.memberNo ?? null, reminder: sent, attempts: 0, requested_at: iso(now) } }).select('id');
  const jobId = Number((ins as Array<{ id: number }> | null)?.[0]?.id ?? 0) || undefined;
  return { status: sent ? 'reminder' : 'scheduled', jobId, dueMs };
}

/** Le chemin rapide : appelé dans after() du webhook. Attend l'échéance puis réserve et envoie, s'il reste le temps
 *  (sinon la cron, à la minute suivante). `t0` = réception du webhook. */
export async function runReplaySoon(db: Db, jobId: number, dueMs: number, t0: number): Promise<'sent' | 'left_to_cron' | 'taken'> {
  const wait = dueMs - Date.now();
  if (wait > 0) await sleep(wait);
  if (Date.now() - t0 > REPLAY_AFTER_DEADLINE_MS) return 'left_to_cron';
  const { data: locked } = await db.from('support_jobs').update({ status: 'running', updated_at: iso(Date.now()) }).eq('id', jobId).eq('status', 'pending').select('*');
  const job = (locked ?? [])[0] as ReplayJob | undefined;
  if (!job) return 'taken';
  const r = await runReplayJob(db, job);
  await finishReplayJob(db, job, r);
  return 'sent';
}

export type ReplayJob = { id: number; tg_id: number; conn: string; kind: string; due_at: string; payload: Record<string, unknown> | null };
export type ReplayJobResult = { status: 'done' | 'failed' | 'canceled' | 'later'; result?: Record<string, unknown> };

/** L'état final d'une ligne (même écriture que runSupportJobs : « later » = de nouveau en attente, dans 1 min). */
export async function finishReplayJob(db: Db, job: ReplayJob, r: ReplayJobResult): Promise<void> {
  if (r.status === 'later') { await db.from('support_jobs').update({ status: 'pending', due_at: iso(Date.now() + 60_000), updated_at: iso(Date.now()) }).eq('id', job.id); return; }
  await db.from('support_jobs').update({ status: r.status, result: r.result ?? null, updated_at: iso(Date.now()) }).eq('id', job.id);
}

/** Envoie le texte puis la vidéo (ou le rappel seul). Une ligne déjà réservée (running). */
export async function runReplayJob(db: Db, job: ReplayJob): Promise<ReplayJobResult> {
  const p = { ...(job.payload ?? {}) } as { lang?: ReplayLang; who?: string; member_no?: number | null; reminder?: boolean; attempts?: number; ack_sent_at?: string; requested_at?: string };
  const lang: ReplayLang = p.lang === 'de' || p.lang === 'it' ? p.lang : 'en';
  const conn = job.conn ? String(job.conn) : null;
  const base = { chat_id: job.tg_id, ...(conn ? { business_connection_id: conn } : {}) };
  const { getAgentDoc } = await import('./agentDocs');
  const texts = replayTexts(lang, lang === 'en' ? await getAgentDoc('support_replay').catch(() => null) : null);
  const asset = p.reminder ? null : await getReplayAsset(db);
  // la vidéo a été coupée entre la demande et l'échéance : pas d'accusé sans vidéo
  if (!p.reminder && !asset && !p.ack_sent_at) {
    await alert(job, p, 'aucune vidéo de replay enregistrée au moment de l’envoi (« replay off » ?)', false);
    return { status: 'canceled', result: { reason: 'no_video' } };
  }
  const log = async (text: string, step: string) => {
    if (conn) {
      const { BIZ_KIND } = await import('./businessInbox');
      await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: p.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'replay', text, conn } });
    }
    await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: p.member_no ?? null, kind: 'webinar_replay', status: 'done', done_by: 'algoria-ai', detail: { via: conn ? 'business' : 'bot', step, lang, job: job.id } });
  };
  const fail = async (step: string, why: string): Promise<ReplayJobResult> => {
    const attempts = Number(p.attempts ?? 0) + 1;
    if (attempts < 2) {
      // un seul nouvel essai, à la minute suivante (l'accusé déjà parti n'est pas renvoyé)
      await db.from('support_jobs').update({ payload: { ...p, attempts, last_error: `${step}: ${why}`.slice(0, 200) } }).eq('id', job.id);
      return { status: 'later' };
    }
    await alert(job, { ...p, attempts }, `${step} refusé deux fois : ${why}`, Boolean(p.ack_sent_at));
    await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: p.member_no ?? null, kind: 'webinar_replay', status: 'failed', done_by: 'algoria-ai', detail: { via: conn ? 'business' : 'bot', step, error: why.slice(0, 200), job: job.id } });
    return { status: 'failed', result: { step, error: why.slice(0, 200), attempts } };
  };

  if (p.reminder) {
    const r = await tg('sendMessage', { ...base, text: texts.reminder, disable_web_page_preview: true });
    if (!r.ok) return fail('rappel', r.description ?? 'refusé');
    await log(texts.reminder, 'reminder');
    return { status: 'done', result: { outcome: 'reminder' } };
  }
  if (!p.ack_sent_at) {
    if (conn) await tg('sendChatAction', { ...base, action: 'typing' });
    const r = await tg('sendMessage', { ...base, text: texts.ack, disable_web_page_preview: true });
    if (!r.ok) return fail('accusé', r.description ?? 'refusé');
    p.ack_sent_at = iso(Date.now());
    await db.from('support_jobs').update({ payload: p }).eq('id', job.id); // repris plus tard : seule la vidéo repart
    await log(texts.ack, 'ack');
    await sleep(1500);
  }
  const a = asset ?? (await getReplayAsset(db));
  if (!a) return fail('vidéo', 'aucune vidéo de replay enregistrée');
  await tg('sendChatAction', { ...base, action: a.type === 'video' ? 'upload_video' : 'upload_document' });
  const v = await tg(a.type === 'video' ? 'sendVideo' : 'sendDocument', { ...base, [a.type]: a.file_id, caption: texts.caption, ...(a.type === 'video' ? { supports_streaming: true } : {}) }, 10000);
  if (!v.ok) return fail('vidéo', v.description ?? 'refusé');
  await log(`[video] ${texts.caption}`, 'video');
  const delayS = p.requested_at ? Math.round((Date.now() - Date.parse(p.requested_at)) / 1000) : null;
  return { status: 'done', result: { outcome: 'replay', delay_s: delayS } };
}

async function alert(job: ReplayJob, p: { who?: string; ack_sent_at?: string; attempts?: number }, why: string, half: boolean): Promise<void> {
  await notifyOwner({
    title: half ? '⚠️ Replay : l’accusé est parti, PAS la vidéo' : '⚠️ Replay pas parti',
    lines: [`${p.who ?? String(job.tg_id)} · ${job.conn ? 'ton compte support' : 'le bot'}`, why, half ? 'Envoie-lui la vidéo toi-même, il l’attend.' : 'Rien ne lui est parti : envoie-lui le replay toi-même.'],
    tag: 'replay',
  }).catch(() => null);
}
