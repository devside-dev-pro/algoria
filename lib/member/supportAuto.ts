// 🤖 LE SUPPORT EN PILOTE AUTOMATIQUE (16/10/2026, décision Mathieu). Server-only.
//
// LE CONSTAT (399 conversations depuis le 29/09) : 62 % des gens qui écrivent à Mathieu ont DÉJÀ un compte dans l'app,
// et on leur posait quand même 3 questions, puis un long pavé, puis on leur « offrait » l'accès à l'app : trois
// allers-retours avant d'ouvrir l'app. Délai médian de la première réponse : 23 min ; 1 personne sur 10 attendait
// plus de 6 h. Décisions de Mathieu : « Auto s'il est sûr » et « un accueil adapté à sa situation ».
//
// LE NOUVEAU PROCESS, depuis le compte de Mathieu (Telegram Business), sans rien d'autre à faire pour lui :
//   1. ACCUEIL, 3 à 4 min après le premier message : sa bulle vidéo (support_assets, il les envoie au bot) puis un
//      message court qui dépend de ce qu'on sait déjà grâce à son Telegram : pas de compte → l'accès à l'app ; compte
//      sans broker → le choix du broker ; broker choisi → où il en est ; en vérification → on le prévient (sans bulle).
//      Un client déjà en copie (live, en pause) n'a pas d'accueil : il connaît Mathieu, on lui répond directement.
//      Plus de 3 questions, plus de pavé.
//   2. RÉPONSES : ~75 s après le DERNIER message (on attend qu'il ait fini d'écrire), Claude rédige. S'il est sûr
//      (question de routine couverte par le knowledge) et que rien n'est sensible, la réponse part seule. Sinon, la
//      carte « ⏳ À toi » arrive chez Mathieu comme avant : il envoie d'un tap, corrige en répondant (le bot retient), ou
//      répond lui-même dans la conversation.
//   3. MATHIEU REPREND LA MAIN quand il écrit lui-même : les envois prévus de la conversation sont annulés, et le bot
//      n'y envoie plus rien seul pendant 2 h (il propose seulement).
//
// Coupe-circuits (env Vercel, sans redéploiement de code) : SUPPORT_WELCOME=off (plus d'accueil auto),
// SUPPORT_AUTOPILOT=off (plus d'envoi seul : toutes les réponses redeviennent des cartes à valider).
import { draftReply } from './replyDraft';
import { adminTgIds } from './notifyOwner';
import { APP_URL } from './i18n';
import { PARTNER_BROKERS } from './brokers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const WELCOME_ON = () => (process.env.SUPPORT_WELCOME ?? 'on').trim().toLowerCase() !== 'off';
const AUTOPILOT_ON = () => (process.env.SUPPORT_AUTOPILOT ?? 'on').trim().toLowerCase() !== 'off';
const DEBOUNCE_MS = 75_000;
const WELCOME_MIN_MS = 180_000;
const WELCOME_SPREAD_MS = 60_000;
const HUMAN_HOLD_MS = 2 * 3_600_000;
const MAX_AUTO_PER_HOUR = 6;
const BIZ_KIND = 'biz_msg';
const STALE_RUNNING_MS = 5 * 60_000;
// déjà clients : pas d'accueil (ni bulle ni message), la réponse part directement
const NO_WELCOME = new Set(['live', 'paused']);

// Ce qui ne part JAMAIS seul, quoi qu'en pense le modèle : l'argent, les plaintes, les doutes, ce que Mathieu doit
// vérifier lui-même (un dépôt annoncé), ce qu'il vend lui-même (la licence), les rendez-vous.
const SENSITIVE = /\b(withdraw\w*|refund\w*|money back|lost|losing|loss(es)?|scam\w*|fraud\w*|fake|stolen|hack\w*|police|lawyer|complain\w*|angry|disappointed|cheat\w*|liar|chargeback|licen[cs]e|prop ?firm|partner(ship)?|collab\w*|call|deposited|funded|paid|payment|invoice|ritir\w*|truffa|rimbors\w*|pers[oi])\b/i;
const HOLDING = /\b(let me check|i'?ll check|come back to you|get back to you|i'?ll look|look into it|i'?ll ask)\b/i;
const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── PLANIFIER (appelé par le webhook, lib/member/businessInbox.ts) ─────────────────────────────────────

/** Un client vient d'écrire : accueil (premier contact) et réponse, repoussée à ~75 s après son dernier message. */
export async function scheduleOnClientMessage(db: Db, o: { tgId: number; conn: string; firstContact: boolean; firstName: string | null; status: string | null }): Promise<void> {
  const now = Date.now();
  if (o.firstContact && WELCOME_ON() && !NO_WELCOME.has(o.status ?? '')) {
    const { data: w } = await db.from('support_jobs').select('id').eq('tg_id', o.tgId).eq('kind', 'welcome').limit(1);
    if (!w?.length) await db.from('support_jobs').insert({ tg_id: o.tgId, conn: o.conn, kind: 'welcome', due_at: iso(now + WELCOME_MIN_MS + Math.floor(Math.random() * WELCOME_SPREAD_MS)), payload: { firstName: o.firstName } });
  }
  const { data: wp } = await db.from('support_jobs').select('due_at').eq('tg_id', o.tgId).eq('kind', 'welcome').eq('status', 'pending').limit(1);
  const due = Math.max(now + DEBOUNCE_MS, wp?.[0] ? Date.parse(wp[0].due_at) + 60_000 : 0);
  const { data: rp } = await db.from('support_jobs').select('id').eq('tg_id', o.tgId).eq('kind', 'reply').eq('status', 'pending').limit(1);
  if (rp?.length) await db.from('support_jobs').update({ due_at: iso(due), updated_at: iso(now) }).eq('id', rp[0].id);
  else await db.from('support_jobs').insert({ tg_id: o.tgId, conn: o.conn, kind: 'reply', due_at: iso(due) });
}

/** Mathieu a écrit lui-même dans la conversation : plus rien de prévu n'y part. */
export async function cancelPendingJobs(db: Db, tgId: number, reason: string): Promise<void> {
  await db.from('support_jobs').update({ status: 'canceled', result: { reason }, updated_at: iso(Date.now()) }).eq('tg_id', tgId).eq('status', 'pending');
}

// ── L'ACCUEIL ──────────────────────────────────────────────────────────────────────────────────────────

// Le prénom Telegram de la personne (« Hey Paul »). Ce qu'elle a mis n'est pas toujours un prénom : emojis, pseudo
// (« Crypto King »), civilité (« Mr Smith »). Dans ces cas, juste « Hey ». « PAUL » ou « paul » deviennent « Paul ».
const NOT_A_NAME = /^(mr|mrs|ms|miss|dr|sir|mister|the|crypto|trader|trading|forex|fx|gold|btc|bitcoin|money|rich|king|queen|boss|official|admin|investor|invest|bot|vip|signal|signals|team|support|user|deleted|account|business)$/i;
export const cleanName = (n: unknown) => {
  const s = String(n ?? '').replace(/[^\p{L}\p{M}' -]/gu, ' ').trim().split(/\s+/)[0] ?? '';
  if (s.length < 2 || s.length > 20 || NOT_A_NAME.test(s)) return '';
  const fix = s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase()) : s;
  return fix[0].toUpperCase() + fix.slice(1);
};

// La langue d'un prospect sans compte (on n'a pas encore sa langue dans l'app) : ses premiers messages.
const ITALIAN = /\b(ciao|salve|buongiorno|buonasera|grazie|vorrei|voglio|posso|sono|come funziona|informazioni|quanto|conto|ho visto|perch[eé])\b/i;

type MemberRow = { member_no: number | null; status: string | null; broker: string | null; locale: string | null; strategy?: number | null; tg_name?: string | null; tg_username?: string | null };

/** Le message d'accueil, selon ce qu'on sait déjà de la personne. Le style de Mathieu : une espace avant ? et !,
 *  pas de tiret long, un emoji. */
export function welcomeText(member: MemberRow | null, firstName: string | null, lang?: 'en' | 'it'): string {
  const name = cleanName(firstName);
  const it = (lang ?? member?.locale) === 'it'; // en italien : formules neutres (« piacere »), pas « benvenuto/a »
  const hi = it ? (name ? `Ciao ${name}` : 'Ciao') : (name ? `Hey ${name}` : 'Hey');
  const app = `${APP_URL}/member`;
  const broker = PARTNER_BROKERS.find((b) => b.key === member?.broker)?.name ?? member?.broker ?? '';
  const st = member?.status ?? null;
  if (!member) return it
    ? `${hi}, piacere ! Ecco il tuo accesso all'app: ${app}\nAccedi con il tuo Telegram, un tocco, nessuna password. Dimmi quando sei dentro e ti guido io 🙏🏼`
    : `${hi}, welcome ! Here's your access to the app: ${app}\nYou log in with your Telegram, one tap, no password. Tell me when you're in and I'll guide you 🙏🏼`;
  if (st === 'live' || st === 'paused') return it ? `${hi} ! Che piacere, come posso aiutarti ? 🙏🏼` : `${hi} ! Good to see you, how can I help ? 🙏🏼`;
  if (st === 'pending_copier') return it
    ? `${hi} ! Vedo che il tuo conto è collegato nell'app, lo stiamo verificando. Ti scrivo appena la copia è attiva 🙏🏼`
    : `${hi} ! I see your account is connected in the app, we're checking it now. I'll tell you as soon as the copy is on 🙏🏼`;
  if (st === 'onboarding' && broker) return it
    ? `${hi}, piacere ! Vedo che sei già nell'app e hai scelto ${broker}. Il conto è aperto ? Dimmi a che punto sei e lo finiamo insieme 🙏🏼`
    : `${hi}, welcome ! I see you're already in the app and you picked ${broker}. Is your account open ? Tell me where you're at and we finish it together 🙏🏼`;
  if (st === 'onboarding') return it
    ? `${hi}, piacere ! Vedo che hai già l'app. Prossimo passo, il broker: in che paese vivi ? Ti dico quale scegliere 🙏🏼`
    : `${hi}, welcome ! I see you already have the app. Next step is your broker: which country do you live in ? I'll tell you which one to pick 🙏🏼`;
  return it
    ? `${hi}, che bello risentirti ! Rientri nell'app da qui: ${app}\nDimmi a che punto sei 🙏🏼`
    : `${hi}, welcome back ! You can log back in the app here: ${app}\nTell me where you're at 🙏🏼`;
}

// ── LA BIBLIOTHÈQUE DE BULLES ──────────────────────────────────────────────────────────────────────────
// Chaque bulle a un public (situation) et une langue, choisis par Mathieu avec les boutons sous la bulle. À l'accueil,
// on prend la bulle de sa situation et de sa langue ; à défaut une bulle « tout le monde » ; à défaut l'autre langue.
// Parmi les bulles qui conviennent, la moins récemment envoyée (au hasard entre les 2 plus anciennes) : pas toujours la même.
export const SITUATIONS = { new: '🆕 Pas encore l’app', app: '📲 Déjà dans l’app', all: '🌍 Tout le monde' } as const;
export const LANGS = { en: '🇬🇧 Anglais', it: '🇮🇹 Italien' } as const;
type Situation = keyof typeof SITUATIONS;
type Lang = keyof typeof LANGS;
type Asset = { id: number; file_id: string; situation: string | null; lang: string | null; uses: number | null; last_used_at: string | null };

/** La situation de la personne pour le choix de la bulle (null = pas de bulle). */
export function situationOf(member: MemberRow | null): Situation | null {
  if (!member) return 'new';
  if (member.status === 'pending_copier' || NO_WELCOME.has(member.status ?? '')) return null;
  return 'app';
}

async function pickAsset(db: Db, situation: Situation, lang: Lang): Promise<Asset | null> {
  const { data } = await db.from('support_assets').select('id,file_id,situation,lang,uses,last_used_at').eq('kind', 'welcome_video').eq('active', true).limit(200);
  const all = (data ?? []) as Asset[];
  const sit = (a: Asset) => a.situation ?? 'all';
  const lg = (a: Asset) => a.lang ?? 'en';
  const tiers = [
    all.filter((a) => sit(a) === situation && lg(a) === lang),
    all.filter((a) => sit(a) === 'all' && lg(a) === lang),
    all.filter((a) => (sit(a) === situation || sit(a) === 'all') && lg(a) !== lang),
  ];
  const pool = (tiers.find((t) => t.length) ?? []).sort((a, b) => (a.last_used_at ? Date.parse(a.last_used_at) : 0) - (b.last_used_at ? Date.parse(b.last_used_at) : 0));
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * Math.min(2, pool.length))];
  await db.from('support_assets').update({ last_used_at: iso(Date.now()), uses: Number(pick.uses ?? 0) + 1 }).eq('id', pick.id);
  return pick;
}

// ── LE PASSAGE DE LA CRON ──────────────────────────────────────────────────────────────────────────────

type Job = { id: number; tg_id: number; conn: string; kind: string; due_at: string; payload: Record<string, unknown> | null };
type BizRow = { id: string; tg_id: number; member_no: number | null; done_by: string | null; created_at: string; detail: Record<string, unknown> };

/** Traite les envois arrivés à échéance. Appelé chaque minute par pg_cron (/api/cron/support-jobs). */
export async function runSupportJobs(db: Db): Promise<{ done: number; review: number; auto: number; welcome: number; failed: number }> {
  const out = { done: 0, review: 0, auto: 0, welcome: 0, failed: 0 };
  // un passage coupé net (timeout Vercel) laisse des lignes « running » : on les reprend. Sans risque de doublon : la
  // réponse ne repart pas si une réponse a déjà été enregistrée depuis, l'accueil vérifie ce qui est déjà parti.
  await db.from('support_jobs').update({ status: 'pending', updated_at: iso(Date.now()) }).eq('status', 'running').lte('updated_at', iso(Date.now() - STALE_RUNNING_MS));
  const { data } = await db.from('support_jobs').select('*').eq('status', 'pending').lte('due_at', iso(Date.now())).order('due_at', { ascending: true }).limit(12);
  // les conversations en parallèle (un jour de pub, 20 contacts arrivent en 10 min) ; dans une même conversation,
  // la réponse attend l'accueil (« later » tant qu'il est en cours)
  await Promise.all(((data ?? []) as Job[]).map(async (job) => {
    // verrou : un seul passage traite une ligne donnée
    const { data: locked } = await db.from('support_jobs').update({ status: 'running', updated_at: iso(Date.now()) }).eq('id', job.id).eq('status', 'pending').select('id');
    if (!locked?.length) return;
    try {
      const r = job.kind === 'welcome' ? await doWelcome(db, job) : await doReply(db, job);
      if (r.status === 'later') { await db.from('support_jobs').update({ status: 'pending', due_at: iso(Date.now() + 60_000), updated_at: iso(Date.now()) }).eq('id', job.id); return; }
      await db.from('support_jobs').update({ status: r.status, result: r.result, updated_at: iso(Date.now()) }).eq('id', job.id);
      if (r.status === 'done') out.done++;
      if (r.status === 'failed') out.failed++;
      if (r.result?.outcome === 'review') out.review++;
      if (r.result?.outcome === 'auto') out.auto++;
      if (r.result?.outcome === 'welcome') out.welcome++;
    } catch (e) {
      out.failed++;
      await db.from('support_jobs').update({ status: 'failed', result: { error: String((e as Error).message).slice(0, 300) }, updated_at: iso(Date.now()) }).eq('id', job.id);
    }
  }));
  return out;
}

type JobResult = { status: 'done' | 'failed' | 'canceled' | 'later'; result?: Record<string, unknown> };

async function doWelcome(db: Db, job: Job): Promise<JobResult> {
  const { connection, tg } = await import('./businessInbox');
  const conn = await connection(job.conn);
  if (!conn || !conn.enabled) return { status: 'failed', result: { error: 'connexion Business absente ou coupée' } };
  if (!conn.canReply) return { status: 'failed', result: { error: 'droit « Reply to messages » coupé dans Telegram Business' } };
  const { data: mrow } = await db.from('members').select('member_no,status,broker,locale').eq('tg_id', job.tg_id).limit(1);
  const member = (mrow?.[0] ?? null) as MemberRow | null;
  if (NO_WELCOME.has(member?.status ?? '')) return { status: 'done', result: { outcome: 'skip', reason: `déjà client (${member?.status})` } };
  // déjà parti (passage repris après une coupure) : on ne renvoie rien deux fois
  const { data: sent } = await db.from('member_actions').select('detail').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).eq('detail->>via', 'welcome').limit(5);
  const already = ((sent ?? []) as Array<{ detail: Record<string, unknown> }>).map((r) => String(r.detail?.text ?? ''));
  if (already.some((t) => t !== '[video bubble]')) return { status: 'done', result: { outcome: 'welcome', resumed: true } };
  // sa langue : celle de l'app s'il a un compte, sinon celle de ses premiers messages
  let lang: Lang = member?.locale === 'it' ? 'it' : 'en';
  if (!member?.locale) {
    const { data: first } = await db.from('member_actions').select('detail').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).eq('detail->>from', 'client').order('created_at', { ascending: true }).limit(5);
    if (((first ?? []) as Array<{ detail: Record<string, unknown> }>).some((r) => ITALIAN.test(String(r.detail?.text ?? '')))) lang = 'it';
  }
  const text = welcomeText(member, String(job.payload?.firstName ?? '') || null, lang);
  const base = { business_connection_id: job.conn, chat_id: job.tg_id };
  // la bulle de sa situation et de sa langue (pas de bulle pour un compte déjà en vérification)
  const situation = situationOf(member);
  const video = !situation || already.includes('[video bubble]') ? null : await pickAsset(db, situation, lang);
  let videoSent = false;
  if (video) {
    await tg('sendChatAction', { ...base, action: 'record_video_note' });
    const v = await tg('sendVideoNote', { ...base, video_note: video.file_id });
    videoSent = v.ok;
    if (v.ok) await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: member?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'welcome', text: '[video bubble]', conn: job.conn } });
    await sleep(2500);
  }
  await tg('sendChatAction', { ...base, action: 'typing' });
  await sleep(2000);
  const r = await tg('sendMessage', { ...base, text, disable_web_page_preview: true });
  if (!r.ok) return { status: 'failed', result: { error: r.description ?? 'refusé', video: videoSent } };
  await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: member?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'welcome', text, conn: job.conn } });
  return { status: 'done', result: { outcome: 'welcome', video: videoSent ? video?.id : false, situation, lang, state: member?.status ?? 'no account' } };
}

async function doReply(db: Db, job: Job): Promise<JobResult> {
  const { connection, reviewCard, sendAsOwner, tg } = await import('./businessInbox');
  // l'accueil d'abord
  const { data: wp } = await db.from('support_jobs').select('id').eq('tg_id', job.tg_id).eq('kind', 'welcome').in('status', ['pending', 'running']).limit(1);
  if (wp?.length) return { status: 'later' };
  const conn = await connection(job.conn);
  if (!conn || !conn.enabled) return { status: 'failed', result: { error: 'connexion Business absente ou coupée' } };

  const { data } = await db.from('member_actions').select('id,tg_id,member_no,done_by,created_at,detail').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).order('created_at', { ascending: false }).limit(30);
  const rows = ((data ?? []) as BizRow[]).reverse();
  // les messages du client depuis la dernière VRAIE réponse (l'accueil automatique ne répond à rien)
  let cut = -1;
  rows.forEach((r, k) => { if (r.detail?.from === 'owner' && r.detail?.via !== 'welcome') cut = k; });
  const batch = rows.slice(cut + 1).filter((r) => r.detail?.from === 'client');
  if (!batch.length) return { status: 'done', result: { outcome: 'answered' } };
  const last = batch[batch.length - 1];
  const inBatch = new Set(batch.map((b) => b.id));
  const history = rows.filter((r) => !inBatch.has(r.id)).slice(-10)
    .map((h) => ({ from: h.detail?.from === 'owner' ? 'algoria' as const : 'member' as const, text: String(h.detail?.text ?? '') })).filter((h) => h.text);
  const texts = batch.map((b) => String(b.detail?.text ?? '')).filter((t) => t && !t.startsWith('['));
  const media = batch.map((b) => String(b.detail?.text ?? '')).filter((t) => t.startsWith('[') && !t.startsWith('[sticker'));

  const { data: mrow } = await db.from('members').select('member_no,locale,status,strategy,broker,tg_name,tg_username').eq('tg_id', job.tg_id).limit(1);
  const member = (mrow?.[0] ?? null) as MemberRow | null;
  const base = last.detail ?? {};

  if (!texts.length) {
    if (!media.length) return { status: 'done', result: { outcome: 'skip', reason: 'sticker' } };
    await reviewCard(db, conn, last.id, base, member, null, `il a envoyé ${media.join(', ')}`);
    return { status: 'done', result: { outcome: 'review', reason: 'media' } };
  }
  const joined = texts.join('\n');
  const draft = await draftReply({ text: joined, locale: member?.locale ?? null, member, history, mode: 'business', timeoutMs: 30_000 });
  if (!draft) {
    await reviewCard(db, conn, last.id, base, member, null, 'pas de proposition (modèle indisponible ou réponse refusée par les garde-fous)');
    return { status: 'done', result: { outcome: 'review', reason: 'no draft' } };
  }
  if (draft.spam || draft.skip) {
    await db.from('member_actions').update({ detail: { ...base, draft_intent: draft.spam ? 'spam' : 'skip' } }).eq('id', last.id);
    return { status: 'done', result: { outcome: draft.spam ? 'spam' : 'skip' } };
  }

  // Mathieu a écrit lui-même ici il y a moins de 2 h : c'est sa conversation
  const manual = rows.some((r) => r.detail?.from === 'owner' && r.done_by === 'mathieu' && Date.now() - Date.parse(r.created_at) < HUMAN_HOLD_MS);
  const { data: recentAuto } = await db.from('member_actions').select('id').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).eq('detail->>via', 'auto').gte('created_at', iso(Date.now() - 3_600_000)).limit(MAX_AUTO_PER_HOUR + 1);
  const why = !AUTOPILOT_ON() ? 'pilote automatique coupé'
    : manual ? 'tu as écrit dans cette conversation il y a moins de 2 h'
    : !draft.auto ? 'Claude n’est pas sûr'
    : SENSITIVE.test(joined) ? 'sujet sensible (argent, plainte, licence, appel…)'
    : HOLDING.test(draft.text) ? 'réponse d’attente'
    : media.length ? `il a aussi envoyé ${media.join(', ')}`
    : (recentAuto ?? []).length >= MAX_AUTO_PER_HOUR ? 'beaucoup de réponses automatiques dans l’heure'
    : !conn.canReply ? 'droit « Reply to messages » coupé dans Telegram Business'
    : null;
  if (why) {
    await reviewCard(db, conn, last.id, base, member, draft.text, why);
    return { status: 'done', result: { outcome: 'review', reason: why } };
  }
  // part seule, depuis le compte de Mathieu, après un « en train d'écrire… » réaliste
  await tg('sendChatAction', { business_connection_id: job.conn, chat_id: job.tg_id, action: 'typing' });
  await sleep(Math.min(6000, 1500 + draft.text.length * 25));
  const detail = { ...base, draft: draft.text, draft_intent: 'auto' };
  await db.from('member_actions').update({ detail }).eq('id', last.id);
  const err = await sendAsOwner(db, { id: last.id, tg_id: job.tg_id, member_no: member?.member_no ?? null, detail }, draft.text, 'auto', 'algoria-ai');
  if (err) {
    await reviewCard(db, conn, last.id, base, member, draft.text, `envoi refusé par Telegram : ${err}`);
    return { status: 'done', result: { outcome: 'review', reason: err } };
  }
  return { status: 'done', result: { outcome: 'auto', chars: draft.text.length } };
}

// ── LES BULLES D'ACCUEIL DE MATHIEU ────────────────────────────────────────────────────────────────────

/** Les boutons sous une bulle : à qui elle va, sa langue, la retirer. La coche ✓ montre le choix actuel. */
export function assetKeyboard(a: { id: number; situation?: string | null; lang?: string | null; active?: boolean | null }) {
  if (a.active === false) return { inline_keyboard: [[{ text: '↩️ Remettre dans les bulles', callback_data: `sa:${a.id}:on` }]] };
  const sit = a.situation ?? 'all', lg = a.lang ?? 'en';
  return {
    inline_keyboard: [
      (Object.keys(SITUATIONS) as Situation[]).map((k) => ({ text: `${sit === k ? '✓ ' : ''}${SITUATIONS[k]}`, callback_data: `sa:${a.id}:s:${k}` })),
      [...(Object.keys(LANGS) as Lang[]).map((k) => ({ text: `${lg === k ? '✓ ' : ''}${LANGS[k]}`, callback_data: `sa:${a.id}:l:${k}` })), { text: '🗑 Retirer', callback_data: `sa:${a.id}:x` }],
    ],
  };
}

async function libraryLine(db: Db): Promise<string> {
  const { data } = await db.from('support_assets').select('situation,lang').eq('kind', 'welcome_video').eq('active', true).limit(200);
  const all = (data ?? []) as Array<{ situation: string | null; lang: string | null }>;
  if (!all.length) return '📚 Aucune bulle pour l’instant.';
  const by = (Object.keys(SITUATIONS) as Situation[]).map((k) => {
    const n = all.filter((a) => (a.situation ?? 'all') === k);
    return n.length ? `${SITUATIONS[k]} : ${n.length}${n.some((a) => a.lang === 'it') ? ` (dont ${n.filter((a) => a.lang === 'it').length} 🇮🇹)` : ''}` : null;
  }).filter(Boolean);
  return `📚 ${all.length} bulle${all.length > 1 ? 's' : ''} · ${by.join(' · ')}`;
}

/** Une bulle vidéo envoyée au bot en privé par un admin : elle entre dans la bibliothèque (pour tout le monde, en
 *  anglais, tant que Mathieu ne choisit pas autre chose avec les boutons). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportVideo(db: Db, msg: any): Promise<boolean> {
  if (msg?.chat?.type !== 'private' || !msg?.video_note || msg.reply_to_message || msg.business_connection_id) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const { tg } = await import('./businessInbox');
  const v = msg.video_note as { file_id: string; file_unique_id: string };
  const { error } = await db.from('support_assets').insert({ kind: 'welcome_video', file_id: v.file_id, file_unique_id: v.file_unique_id, chat_id: Number(msg.chat.id), message_id: Number(msg.message_id) });
  const dup = error && /duplicate|unique/i.test(error.message);
  // renvoyée après un « retire » : elle revient dans la rotation
  if (dup) await db.from('support_assets').update({ active: true }).eq('file_unique_id', v.file_unique_id);
  if (error && !dup) {
    await tg('sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: `⨯ Pas enregistrée (${error.message.slice(0, 80)}), renvoie-la.` });
    return true;
  }
  const { data: row } = await db.from('support_assets').select('id,situation,lang,active').eq('file_unique_id', v.file_unique_id).limit(1);
  const a = row?.[0];
  await tg('sendMessage', {
    chat_id: msg.chat.id, reply_to_message_id: msg.message_id,
    text: `🎥 ${dup ? 'Déjà dans tes bulles (remise dans la rotation si tu l’avais retirée).' : 'Bulle d’accueil enregistrée.'}\nPour qui ? Touche en dessous (sinon : tout le monde, en anglais).\n\n${await libraryLine(db)}\nÉcris « bulles » pour revoir toute ta bibliothèque.`,
    ...(a ? { reply_markup: assetKeyboard(a) } : {}),
  });
  return true;
}

/** « bulles » écrit au bot par un admin : la bibliothèque, chaque bulle avec ses boutons. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportLibrary(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (msg?.chat?.type !== 'private' || msg.reply_to_message || !/^\/?(bulles?|biblioth[eè]que)$/i.test(text)) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const { tg } = await import('./businessInbox');
  const { data } = await db.from('support_assets').select('id,file_id,situation,lang,active,uses').eq('kind', 'welcome_video').eq('active', true).order('id', { ascending: true }).limit(20);
  const all = (data ?? []) as Array<Asset & { active: boolean }>;
  await tg('sendMessage', {
    chat_id: msg.chat.id,
    text: `${await libraryLine(db)}\n\nÀ l’accueil, je prends une bulle de sa situation et de sa langue, sinon une « tout le monde », et je les fais tourner.\nSous chaque bulle : à qui elle va, sa langue, 🗑 pour la retirer. Pour en ajouter une : envoie-la-moi.`,
  });
  for (const a of all) await tg('sendVideoNote', { chat_id: msg.chat.id, video_note: a.file_id, reply_markup: assetKeyboard(a) });
  return true;
}

/** Les boutons sous une bulle (sa:<id>:s:<situation> · sa:<id>:l:<langue> · sa:<id>:x · sa:<id>:on). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportAssetCallback(db: Db, cq: any): Promise<boolean> {
  const m = /^sa:(\d+):(s:(new|app|all)|l:(en|it)|x|on)$/.exec(String(cq?.data ?? ''));
  if (!m) return false;
  const { tg } = await import('./businessInbox');
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text });
  if (!(await adminTgIds()).includes(Number(cq.from?.id))) { await answer('Réservé aux admins.'); return true; }
  const id = Number(m[1]);
  const patch = m[3] ? { situation: m[3] } : m[4] ? { lang: m[4] } : { active: m[2] === 'on' };
  const { data } = await db.from('support_assets').update(patch).eq('id', id).select('id,situation,lang,active');
  const a = data?.[0];
  if (!a) { await answer('Bulle introuvable.'); return true; }
  await tg('editMessageReplyMarkup', { chat_id: cq.message?.chat?.id, message_id: cq.message?.message_id, reply_markup: assetKeyboard(a) });
  await answer(m[3] ? `✓ ${SITUATIONS[m[3] as Situation]}` : m[4] ? `✓ ${LANGS[m[4] as Lang]}` : a.active ? '↩️ Remise dans les bulles' : '🗑 Retirée');
  return true;
}

/** « retire » en réponse à une bulle d'accueil : elle n'est plus envoyée. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportVideoRemove(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (msg?.chat?.type !== 'private' || !msg?.reply_to_message?.video_note || !/^(retire|supprime|enl[eè]ve|remove|delete)\b/i.test(text)) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const { tg } = await import('./businessInbox');
  const { data } = await db.from('support_assets').update({ active: false }).eq('chat_id', Number(msg.chat.id)).eq('message_id', Number(msg.reply_to_message.message_id)).select('id');
  await tg('sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: (data ?? []).length ? '🗑 Bulle retirée.' : 'Cette bulle n’est pas dans les bulles d’accueil (sous les bulles de « bulles », utilise 🗑).' });
  return true;
}
