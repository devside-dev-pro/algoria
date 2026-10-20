// 🤖 LE SUPPORT EN PILOTE AUTOMATIQUE (16/10/2026, décision Mathieu). Server-only.
//
// LE CONSTAT (399 conversations depuis le 29/09) : 62 % des gens qui écrivent à Mathieu ont DÉJÀ un compte dans l'app,
// et on leur posait quand même 3 questions, puis un long pavé, puis on leur « offrait » l'accès à l'app : trois
// allers-retours avant d'ouvrir l'app. Délai médian de la première réponse : 23 min ; 1 personne sur 10 attendait
// plus de 6 h. Décisions de Mathieu : « Auto s'il est sûr » et « un accueil adapté à sa situation ».
//
// LE NOUVEAU PROCESS, depuis le compte de Mathieu (Telegram Business), sans rien d'autre à faire pour lui :
//   1. ACCUEIL, 3 à 4 min après le premier message : sa bulle vidéo (support_assets, il les envoie au bot) puis UNE
//      question, « Where are you from ? ». Jamais ce qu'on sait déjà de lui (16/10, Mathieu : « on sait que tu as
//      installé l'app, que tu es du UK, que tu es bloqué au broker… ça fait un peu peur ») : on lui demande, comme
//      Mathieu le faisait. Un compte déjà en copie ou en vérification n'a pas d'accueil : on lui répond directement.
//      Plus de 3 questions, plus de pavé, le budget n'est plus demandé.
//      Il dit son pays → le VOCAL de Mathieu pour ce pays (support_assets kind='country_voice', « 🌍 autres pays » à
//      défaut), puis la suite. Pas de réponse en 2 h et pas de compte → le lien de l'app part quand même.
//   2. RÉPONSES : ~75 s après le DERNIER message (on attend qu'il ait fini d'écrire), Claude rédige. Il LIT les
//      captures d'écran (jamais conservées). 🔥 Lead chaud (1 000 $ ou plus, trader expérimenté) → alerte à Mathieu
//      pour un vocal de lui. Le pays dit est gardé (fiche membre, tableau « pays » au bot). S'il est sûr
//      (question de routine couverte par le knowledge) et que rien n'est sensible, la réponse part seule. Sinon, la
//      carte « ⏳ À toi » arrive chez Mathieu comme avant : il envoie d'un tap, corrige en répondant (le bot retient), ou
//      répond lui-même dans la conversation.
//   3. MATHIEU REPREND LA MAIN quand il écrit lui-même : les envois prévus de la conversation sont annulés, et le bot
//      n'y envoie plus rien seul pendant 2 h (il propose seulement).
//
// Coupe-circuits (env Vercel, sans redéploiement de code) : SUPPORT_WELCOME=off (plus d'accueil auto),
// SUPPORT_AUTOPILOT=off (plus d'envoi seul : toutes les réponses redeviennent des cartes à valider).
import { draftReply, lastDraftIssue } from './replyDraft';
import { adminTgIds } from './notifyOwner';
import { APP_URL } from './i18n';
import { detectCountry } from './countries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// LES INTERRUPTEURS (19/10/2026, migration 0033) : table support_settings ('welcome', 'autopilot' : 'on' | 'off'),
// relue toutes les 30 s ; ligne absente = coupé. La variable Vercel à 'off' coupe quoi qu'il y ait en base.
const settingsCache = new Map<string, { at: number; on: boolean }>();
async function flag(db: Db, key: 'welcome' | 'autopilot'): Promise<boolean> {
  const env = process.env[key === 'welcome' ? 'SUPPORT_WELCOME' : 'SUPPORT_AUTOPILOT'];
  if ((env ?? '').trim().toLowerCase() === 'off') return false;
  const hit = settingsCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.on;
  const { data } = await db.from('support_settings').select('value').eq('key', key).limit(1);
  const on = String(data?.[0]?.value ?? 'off').trim().toLowerCase() === 'on';
  settingsCache.set(key, { at: Date.now(), on });
  return on;
}
const DEBOUNCE_MS = 75_000;
const WELCOME_MIN_MS = 180_000;
const WELCOME_SPREAD_MS = 60_000;
const HUMAN_HOLD_MS = 2 * 3_600_000;
const MAX_AUTO_PER_HOUR = 6;
const BIZ_KIND = 'biz_msg';
const STALE_RUNNING_MS = 5 * 60_000;
// déjà clients : pas d'accueil (ni bulle ni message), la réponse part directement
const NO_WELCOME = new Set(['live', 'paused', 'pending_copier']);
// ce que le bot envoie de lui-même et qui ne RÉPOND à rien : l'accueil, le vocal du pays, le lien différé
const NOT_AN_ANSWER = new Set(['welcome', 'country_voice', 'intro', 'link', 'live_welcome']);
const LINK_AFTER_MS = 2 * 3_600_000;
// LES CONVERSATIONS DU COMPTE SUPPORT NE SONT ENREGISTRÉES QUE DEPUIS LE 29/09/2026 (10 h 47 UTC). 19/10/2026 : Ben (compte
// de l'app depuis le 12/08, bulle et questions de Mathieu le 05/09) a reçu la bulle d'accueil « welcome to Algoria » comme
// un inconnu. Un compte de l'app créé avant cette date sans aucun message enregistré = peut-être un ancien contact : pas
// d'accueil, on lui répond comme à quelqu'un qu'on connaît.
const LOGGED_SINCE = Date.parse('2026-09-29T10:47:00Z');
// 19/10/2026, Nkosinathi (compte du 29/09 au matin) : le message du bouton de l'app (« book a quick call… », « skip the
// waiting list… ») est un PREMIER contact qui vient de l'app, il a toujours la bulle. L'exception « ancien contact » ne
// vaut que pour un message écrit à la main (Ben : « whats the minimum to start ? »).
// (19/10/2026 : le bouton devient « Contact Mathieu », « I already have the app, how do I get connected now ? » ; les anciens
// messages restent reconnus, des liens publiés avant circulent encore)
const APP_BUTTON = /book a quick call to activate|quick call to set up my algoria|skip the waiting list|already have the app, how do i get connected/i;
const legacyContact = (m: { created_at?: string | null } | null, firstText: string) => !!m?.created_at && Date.parse(m.created_at) < LOGGED_SINCE && !APP_BUTTON.test(firstText);
// 🔥 un montant de 1 000 ou plus en $, £, € (pas en rands : 1 000 ZAR ≈ 50 $)
const AMOUNT = /(?:[$£€]\s?(\d{1,3}(?:[,.\s]\d{3})+|\d{4,7}|\d{1,3}\s?k)|(\d{1,3}(?:[,.\s]\d{3})+|\d{4,7}|\d{1,3}\s?k)\s?(?:[$£€]|usd|usdt|eur|euros?|gbp|pounds?|dollars?|aud|nzd|chf)(?![a-z]))/gi;
export function hotAmount(text: string): boolean {
  for (const m of text.matchAll(AMOUNT)) {
    const raw = (m[1] ?? m[2] ?? '').toLowerCase().replace(/\s/g, '');
    const n = raw.endsWith('k') ? Number(raw.slice(0, -1)) * 1000 : Number(raw.replace(/[,.]/g, ''));
    if (n >= 1000 && n < 10_000_000) return true;
  }
  return false;
}

// Ce qui ne part JAMAIS seul, quoi qu'en pense le modèle : l'argent, les plaintes, les doutes, ce que Mathieu doit
// vérifier lui-même (un dépôt annoncé), quelqu'un prêt à PAYER la licence, les partenariats.
// 19/10/2026 (benchmark : 8 cartes sur 28 avaient une bonne réponse bloquée) : la demande d'appel (« book a quick call »
// préremplie par l'app), la QUESTION sur la licence ou la prop firm, et « partner broker » partent seules.
const SENSITIVE = /\b(withdraw\w*|refund\w*|money back|lost|losing|loss(es)?|scam\w*|fraud\w*|fake|stolen|hack\w*|police|lawyer|complain\w*|angry|disappointed|cheat\w*|liar|chargeback|partnership|collab\w*|deposited|funded|paid|payment|invoice|purchase\w*|(?:want|ready|like|how) to (?:pay|buy)|ritir\w*|truffa|rimbors\w*|pers[oi])\b/i;
// 🔁 UNE RELANCE (« Hi », « any update ? », « Mathieu ? ») : rien de nouveau à répondre, la question d'avant attend
const PING_WORDS = new Set(['hi', 'hii', 'hiii', 'hello', 'helo', 'hey', 'yo', 'bro', 'brother', 'mate', 'dear', 'mathieu', 'sir', 'any', 'update', 'updates', 'news', 'answer', 'reply', 'still', 'waiting', 'wait', 'i', 'im', "i'm", 'am', 'are', 'you', 'u', 'there', 'please', 'pls', 'plz', 'again', 'did', 'check', 'checked', 'it', 'so', 'what', 'about', 'good', 'morning', 'afternoon', 'evening', 'ciao', 'buongiorno']);
export function isPing(text: string): boolean {
  const words = text.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return /\?/.test(text);
  return words.length <= 6 && words.every((w) => PING_WORDS.has(w));
}
const HOLDING = /\b(let me check|i'?ll check|come back to you|get back to you|i'?ll look|look into it|i'?ll ask)\b/i;
// un lien broker ou un montant de dépôt : jamais avant l'intro de Mathieu (20/10/2026)
const BEFORE_INTRO = /partners\.raisefx|vtaffiliates|puprime\.partners|tradingsphere|xlence|\bdeposit\b|\$\s?\d{3}|\d{3}\s?\$/i;
const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── PLANIFIER (appelé par le webhook, lib/member/businessInbox.ts) ─────────────────────────────────────

/** Un client vient d'écrire : accueil (premier contact) et réponse, repoussée à ~75 s après son dernier message. */
export async function scheduleOnClientMessage(db: Db, o: { tgId: number; conn: string; firstContact: boolean; firstName: string | null; status: string | null }): Promise<void> {
  const now = Date.now();
  if (o.firstContact && (await flag(db, 'welcome')) && !NO_WELCOME.has(o.status ?? '')) {
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

type MemberRow = { member_no: number | null; status: string | null; broker: string | null; locale: string | null; strategy?: number | null; tg_name?: string | null; tg_username?: string | null; country?: string | null; connected_at?: string | null; created_at?: string | null };

/** Le message d'accueil : bonjour et UNE question, d'où il vient. Le même pour tous : on ne lui montre jamais ce qu'on
 *  sait déjà (app, broker, étape). Le style de Mathieu : une espace avant ? et !, pas de tiret long, un emoji.
 *  En italien : formules neutres (« piacere »), pas « benvenuto/a ». */
// 19/10/2026, Mathieu : « une bulle avec juste "Where are you from ?" derrière, c'est vraiment pas super… je demande
// moi directement dans la bulle, et en dessous on écrit : au cas où tu ne puisses pas regarder la vidéo, je voulais
// simplement te souhaiter la bienvenue et savoir d'où tu viens ». Le texte anglais est modifiable dans l'admin
// (TOOLS → 👋 SUPPORT WELCOME, agent_docs 'support_welcome', {name} = prénom) ; l'italien reste ici.
export const WELCOME_EN = "Hey {name}, welcome to Algoria ! 🙏🏼\nIn case you can't watch the video right now: I just wanted to welcome you personally and ask you where you're from ?";
const WELCOME_IT = 'Ciao {name}, piacere ! 🙏🏼\nSe non puoi guardare il video adesso: volevo solo darti il benvenuto di persona e chiederti di dove sei ?';
export function welcomeText(member: MemberRow | null, firstName: string | null, lang?: 'en' | 'it', doc?: string | null): string {
  const name = cleanName(firstName);
  const it = (lang ?? member?.locale) === 'it';
  const tpl = it ? WELCOME_IT : (doc?.trim() || WELCOME_EN);
  return tpl.replace(/\{name\}/g, name).replace(/ +,/g, ',').replace(/ {2,}/g, ' ');
}

// LE MESSAGE APRÈS LE PAYS (19/10/2026) : celui que Mathieu envoyait à la main (118 fois depuis le 29/09), juste après son
// vocal, avec la fin qui donne directement le lien de l'app au lieu de « Can I give you an access ? ». Modifiable dans
// l'admin (TOOLS → 💬 SUPPORT INTRO, agent_docs 'support_intro') ; l'italien reste ici.
// 19/10/2026, Mathieu : « le plus important de ce message : que la personne comprenne qu'elle a 400 $ de valeur aujourd'hui
// qu'elle peut avoir gratuitement… la façon dont je l'expliquais était un peu trop compliquée, simplifie ».
export const INTRO_EN = `So Algoria in a few words : it's an AI that trades gold for you. You connect your own trading account once, and every trade the AI takes is copied on it automatically. You don't touch anything, and your money stays on your account.

The Algoria access is normally $400 (lifetime). Today you can have it completely free 🆓 The only condition : open your trading account with one of our partner brokers. They pay for your access, so you never pay me a cent.

Here's your access to the app : ${APP_URL}/member
You log in with your Telegram in one tap. Inside, the app shows you step by step : pick the partner broker, open your account (5 min), fund it (minimum $200), and connect it to Algoria.

Any question, I'm here 🙏🏼`;
const INTRO_IT = `Allora, Algoria in poche parole : è un'IA che fa trading sull'oro per te. Colleghi una volta il tuo conto di trading, e ogni trade dell'IA viene copiato sul tuo conto in automatico. Tu non tocchi niente, e i tuoi soldi restano sul tuo conto.

L'accesso ad Algoria costa normalmente 400$ (a vita). Oggi puoi averlo completamente gratis 🆓 L'unica condizione : aprire il tuo conto di trading con uno dei nostri broker partner. Sono loro a pagare il tuo accesso, quindi non mi paghi mai niente.

Ecco il tuo accesso all'app : ${APP_URL}/member
Accedi con il tuo Telegram in un tocco. Dentro, l'app ti guida passo dopo passo : scegli il broker partner, apri il conto (5 minuti), alimentalo (minimo 200$) e collegalo ad Algoria.

Per qualsiasi domanda sono qui 🙏🏼`;

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
export async function runSupportJobs(db: Db): Promise<{ done: number; review: number; auto: number; welcome: number; link: number; failed: number }> {
  const out = { done: 0, review: 0, auto: 0, welcome: 0, link: 0, failed: 0 };
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
      const r = job.kind === 'welcome' ? await doWelcome(db, job) : job.kind === 'link' ? await doLink(db, job) : await doReply(db, job);
      if (r.status === 'later') { await db.from('support_jobs').update({ status: 'pending', due_at: iso(Date.now() + 60_000), updated_at: iso(Date.now()) }).eq('id', job.id); return; }
      await db.from('support_jobs').update({ status: r.status, result: r.result, updated_at: iso(Date.now()) }).eq('id', job.id);
      if (r.status === 'done') out.done++;
      if (r.status === 'failed') out.failed++;
      if (r.result?.outcome === 'review') out.review++;
      if (r.result?.outcome === 'auto') out.auto++;
      if (r.result?.outcome === 'welcome') out.welcome++;
      if (r.result?.outcome === 'link') out.link++;
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
  if (!(await flag(db, 'welcome'))) return { status: 'canceled', result: { reason: 'accueil coupé' } };
  const conn = await connection(job.conn);
  if (!conn || !conn.enabled) return { status: 'failed', result: { error: 'connexion Business absente ou coupée' } };
  if (!conn.canReply) return { status: 'failed', result: { error: 'droit « Reply to messages » coupé dans Telegram Business' } };
  const { data: mrow } = await db.from('members').select('member_no,status,broker,locale,created_at').eq('tg_id', job.tg_id).limit(1);
  const member = (mrow?.[0] ?? null) as MemberRow | null;
  if (NO_WELCOME.has(member?.status ?? '')) return { status: 'done', result: { outcome: 'skip', reason: `déjà client (${member?.status})` } };
  // déjà parti (passage repris après une coupure) : on ne renvoie rien deux fois
  const { data: sent } = await db.from('member_actions').select('detail').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).eq('detail->>via', 'welcome').limit(5);
  const already = ((sent ?? []) as Array<{ detail: Record<string, unknown> }>).map((r) => String(r.detail?.text ?? ''));
  if (already.some((t) => t !== '[video bubble]')) return { status: 'done', result: { outcome: 'welcome', resumed: true } };
  // sa langue : celle de l'app s'il a un compte, sinon celle de ses premiers messages
  let lang: Lang = member?.locale === 'it' ? 'it' : 'en';
  const { data: first } = await db.from('member_actions').select('detail').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).eq('detail->>from', 'client').order('created_at', { ascending: true }).limit(5);
  const firstTexts = ((first ?? []) as Array<{ detail: Record<string, unknown> }>).map((r) => String(r.detail?.text ?? ''));
  if (legacyContact(member, firstTexts[0] ?? '')) return { status: 'done', result: { outcome: 'skip', reason: 'ancien contact (compte de l’app d’avant le 29/09, message écrit à la main)' } };
  if (!member?.locale && firstTexts.some((t) => ITALIAN.test(t))) lang = 'it';
  // il a déjà dit d'où il vient (« I'm from UK… ») : pas de bulle qui le lui redemande, on passe à son vocal et au
  // message d'après (c'est la réponse qui s'en charge)
  const said = firstTexts.map(detectCountry).find(Boolean) ?? null;
  if (said) return { status: 'done', result: { outcome: 'skip', reason: 'pays déjà dit', country_said: said } };
  // JAMAIS D'ACCUEIL EN TEXTE SEUL (19/10/2026, Mathieu) : pas de bulle enregistrée, ou Telegram la refuse → rien ne
  // part, la réponse arrive chez Mathieu en carte
  const situation = situationOf(member);
  const video = !situation ? null : await pickAsset(db, situation, lang);
  if (!video) return { status: 'done', result: { outcome: 'skip', reason: 'aucune bulle d’accueil enregistrée' } };
  const base = { business_connection_id: job.conn, chat_id: job.tg_id };
  if (!already.includes('[video bubble]')) {
    await tg('sendChatAction', { ...base, action: 'record_video_note' });
    const v = await tg('sendVideoNote', { ...base, video_note: video.file_id });
    if (!v.ok) return { status: 'failed', result: { error: `bulle refusée par Telegram : ${v.description ?? '?'}` } };
    await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: member?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'welcome', text: '[video bubble]', conn: job.conn } });
    await sleep(2500);
  }
  const { getAgentDoc } = await import('./agentDocs');
  const text = welcomeText(member, String(job.payload?.firstName ?? '') || null, lang, await getAgentDoc('support_welcome'));
  await tg('sendChatAction', { ...base, action: 'typing' });
  await sleep(2000);
  const r = await tg('sendMessage', { ...base, text, disable_web_page_preview: true });
  if (!r.ok) return { status: 'failed', result: { error: r.description ?? 'refusé', video: video.id } };
  await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: member?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'welcome', text, conn: job.conn } });
  // pas de compte : s'il ne répond pas en 2 h, le lien de l'app part quand même
  if (!member) await db.from('support_jobs').insert({ tg_id: job.tg_id, conn: job.conn, kind: 'link', due_at: iso(Date.now() + LINK_AFTER_MS), payload: { lang } });
  return { status: 'done', result: { outcome: 'welcome', video: video.id, situation, lang, state: member?.status ?? 'no account' } };
}

async function doReply(db: Db, job: Job): Promise<JobResult> {
  const { connection, reviewCard, sendAsOwner, stamp, tg } = await import('./businessInbox');
  // l'accueil d'abord
  const { data: wp } = await db.from('support_jobs').select('id').eq('tg_id', job.tg_id).eq('kind', 'welcome').in('status', ['pending', 'running']).limit(1);
  if (wp?.length) return { status: 'later' };
  const conn = await connection(job.conn);
  if (!conn || !conn.enabled) return { status: 'failed', result: { error: 'connexion Business absente ou coupée' } };

  const { data } = await db.from('member_actions').select('id,tg_id,member_no,done_by,created_at,detail').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).order('created_at', { ascending: false }).limit(30);
  const rows = ((data ?? []) as BizRow[]).reverse();
  // les messages du client depuis la dernière VRAIE réponse (l'accueil, le vocal du pays, le lien ne répondent à rien)
  let cut = -1;
  rows.forEach((r, k) => { if (r.detail?.from === 'owner' && !NOT_AN_ANSWER.has(String(r.detail?.via ?? ''))) cut = k; });
  const batch = rows.slice(cut + 1).filter((r) => r.detail?.from === 'client');
  if (!batch.length) return { status: 'done', result: { outcome: 'answered' } };
  const last = batch[batch.length - 1];
  const inBatch = new Set(batch.map((b) => b.id));
  const history = rows.filter((r) => !inBatch.has(r.id)).slice(-10)
    .map((h) => ({ from: h.detail?.from === 'owner' ? 'algoria' as const : 'member' as const, text: String(h.detail?.text ?? '') })).filter((h) => h.text);
  const texts = batch.map((b) => String(b.detail?.text ?? '')).filter((t) => t && !t.startsWith('['));
  // 📸 les captures d'écran : lues par le modèle (les 3 dernières), jamais conservées
  const photoIds = batch.map((b) => String(b.detail?.photo ?? '')).filter(Boolean).slice(-3);
  const images = (await Promise.all(photoIds.map(downloadPhoto))).filter((x): x is Img => !!x);
  const media = batch.map((b) => String(b.detail?.text ?? '')).filter((t) => t.startsWith('[') && !t.startsWith('[sticker') && !(t === '[photo]' && images.length));

  const { data: mrow } = await db.from('members').select('member_no,locale,status,strategy,broker,tg_name,tg_username,country,created_at').eq('tg_id', job.tg_id).limit(1);
  const member = (mrow?.[0] ?? null) as MemberRow | null;
  // « je suis connecté ? » : le modèle répond depuis le statut, avec la date de mise en copie (19/10/2026)
  if (member && NO_WELCOME.has(member.status ?? '')) {
    const { data: c } = await db.from('member_actions').select('done_at').eq('tg_id', job.tg_id).eq('kind', 'connect').eq('status', 'done').order('done_at', { ascending: true }).limit(1);
    member.connected_at = (c?.[0] as { done_at?: string } | undefined)?.done_at ?? null;
  }
  let base: Record<string, unknown> = { ...(last.detail ?? {}) };

  // 🔁 IL RELANCE (19/10/2026 : 4 cartes sur 28 étaient des « Hi », « Hello!!! », « Mathieu ? » de gens qui attendaient
  // déjà Mathieu) : sa carte ouverte de cette conversation redescend en bas de son fil, avec la relance, au lieu d'une
  // nouvelle proposition. La conversation reste non lue chez lui.
  const open = [...batch].reverse().find((r) => r.detail?.draft_msg_id && !r.detail.answered_at && !r.detail.draft_dismissed_at && !r.detail.draft_superseded_at);
  if (open && open.id !== last.id && !images.length && !media.length) {
    const after = batch.filter((b) => Date.parse(b.created_at) > Date.parse(open.created_at)).map((b) => String(b.detail?.text ?? '').trim()).filter(Boolean);
    if (after.length && after.every(isPing)) {
      const od = open.detail;
      const del = await tg('deleteMessage', { chat_id: Number(od.draft_chat_id), message_id: Number(od.draft_msg_id) });
      if (!del.ok) await stamp(od, '🔁 Il relance : carte redescendue plus bas.');
      const was = String(od.review_reason ?? 'à toi').replace(/^il relance .*?, toujours : /, '');
      await reviewCard(db, conn, open.id, od, member, od.draft ? String(od.draft) : null, `il relance (« ${after.join(' / ').slice(0, 60)} »), toujours : ${was}`);
      return { status: 'done', result: { outcome: 'review', reason: 'relance' } };
    }
  }

  if (!texts.length && !images.length) {
    if (!media.length) return { status: 'done', result: { outcome: 'skip', reason: 'sticker' } };
    await reviewCard(db, conn, last.id, base, member, null, `il a envoyé ${media.join(', ')}`);
    return { status: 'done', result: { outcome: 'review', reason: 'media' } };
  }
  const joined = texts.join('\n');
  // Mathieu a écrit lui-même ici il y a moins de 2 h : c'est sa conversation
  const manual = rows.some((r) => r.detail?.from === 'owner' && r.done_by === 'mathieu' && Date.now() - Date.parse(r.created_at) < HUMAN_HOLD_MS);
  const autopilot = await flag(db, 'autopilot');
  const canSend = autopilot && !manual && conn.canReply;
  const newbie = !NO_WELCOME.has(member?.status ?? '');
  const ownerSpoke = rows.some((r) => r.detail?.from === 'owner');
  const welcomed = rows.some((r) => r.detail?.via === 'welcome' && r.detail?.text !== '[video bubble]');
  // rien d'enregistré de Mathieu, mais un compte de l'app d'avant le 29/09 : sans doute un ancien contact
  const legacy = !ownerSpoke && !welcomed && legacyContact(member, String(rows.find((r) => r.detail?.from === 'client')?.detail?.text ?? ''));

  // 🌍 IL DIT D'OÙ IL VIENT : le vocal de Mathieu pour son pays, puis son message d'après (ce qu'est Algoria, gratuit, le
  // broker, le lien de l'app), une seule fois par conversation. Après l'accueil (bulle), ou dès son premier message
  // s'il l'y a dit — mais alors seulement si un vocal existe : jamais de premier contact en texte seul (Mathieu, 19/10).
  const said = detectCountry(joined);
  let note: string | null = null;
  let voiced = false;
  let introduced = false;
  const stepDone = rows.some((r) => r.detail?.via === 'country_voice' || r.detail?.via === 'intro');
  if (said && canSend && newbie && !stepDone && (welcomed || (!ownerSpoke && !legacy))) {
    const v = await pickVoice(db, said);
    if (v || welcomed) {
      const biz = { business_connection_id: job.conn, chat_id: job.tg_id };
      if (v) {
        await tg('sendChatAction', { ...biz, action: 'record_voice' });
        await sleep(3000);
        const r = await tg('sendVoice', { ...biz, voice: v.file_id });
        if (r.ok) {
          voiced = true;
          await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: member?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'country_voice', text: '[voice note about their country]', country: said, voice: v.id, conn: job.conn } });
          await sleep(2000);
        }
      }
      if (voiced || welcomed) {
        const { getAgentDoc } = await import('./agentDocs');
        const it = member?.locale === 'it' || ITALIAN.test(joined);
        const intro = it ? INTRO_IT : ((await getAgentDoc('support_intro'))?.trim() || INTRO_EN);
        await tg('sendChatAction', { ...biz, action: 'typing' });
        await sleep(4000);
        const r = await tg('sendMessage', { ...biz, text: intro, disable_web_page_preview: true });
        if (r.ok) {
          introduced = true;
          await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: member?.member_no ?? null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'intro', text: intro, conn: job.conn } });
        }
      }
      if (voiced || introduced) note = `Mathieu's ${voiced ? `personal voice note about their country (${countryName(said, 'en')}) and his ` : ''}intro message (what Algoria is, free access, the partner broker, the app link) were just sent from his account. Do not repeat any of it: it already answers how it works, how to start and the steps (the app walks them through the broker, the deposit and the connection), so no broker link and no deposit amount on top of it. If their message asks nothing else, intent "skip"; otherwise answer only what is left.`;
    }
  }

  // L'ACCUEIL VIENT DE PARTIR, EN RÉPONSE À SES PREMIERS MESSAGES. Un simple bonjour ou le message du bouton de l'app :
  // rien de plus, on attend qu'il dise d'où il vient (19/10/2026, Rahma : la 2e réponse redemandait son pays). Seule la
  // politesse a sa réponse sous l'accueil (« how are you ? » → « all good, and you ? », Mathieu 19/10). Tout ce qui
  // touche au fonctionnement, au broker, au dépôt, aux étapes attend son pays : c'est son intro qui y répond (20/10,
  // Riyaz : « guide me through the steps » → lien RaiseFX et « deposit $500 » juste sous la bulle, « en pleine figure »).
  const welcomeAt = rows.filter((r) => r.detail?.via === 'welcome' && r.detail?.text !== '[video bubble]').map((r) => Date.parse(r.created_at)).pop();
  const justWelcomed = welcomeAt != null && newbie && !stepDone && !introduced && batch.every((b) => Date.parse(b.created_at) < welcomeAt);
  if (justWelcomed) note = 'Mathieu\'s welcome (his video bubble + "Hey <name>, welcome to Algoria ! … ask you where you\'re from ?") was JUST sent in answer to these first messages. Only a plain hello ("hi", "hello") or the app\'s ready-made message ("I already have the app, how do I get connected now ?", "book a quick call…", "skip the waiting list…") → intent "skip". Small talk only ("how are you ?", "how is work ?") → a short friendly answer ("All good thanks, and you ? 🙏🏼"), WITHOUT asking where they are from again and without welcoming them again. ANY question about how it works, the steps, creating an account, the broker, depositing, the minimum, the price → intent "skip": Mathieu\'s intro (what Algoria is, free with a partner broker, the app) goes out as soon as they say where they are from, and it answers that. Never a broker link, a deposit amount or the setup steps now.';

  // PREMIER CONTACT SANS ACCUEIL (pas de bulle enregistrée, ou l'accueil coupé) : pas de réponse en texte seul à un
  // nouveau venu, la carte va à Mathieu (19/10/2026)
  const firstNoWelcome = newbie && !ownerSpoke && !introduced && !legacy;
  if (legacy) note = 'This person probably already talked with Mathieu before (those older messages are not in the Recent exchange): never welcome them as a newcomer and never ask where they are from, answer their message directly.';

  const draft = await draftReply({ text: joined || '(no text, only the screenshot)', locale: member?.locale ?? null, member, history, mode: 'business', timeoutMs: 30_000, images, note });
  // le pays (stats, fiche) et le lead chaud
  const country = said ?? draft?.country ?? null;
  if (country) {
    base = { ...base, country };
    if (member?.member_no != null && !member.country) await db.from('members').update({ country: countryLabel(country) }).eq('tg_id', job.tg_id);
  }
  // 🔥 un PROSPECT qui n'a pas encore commencé, jamais un membre déjà en copie ni une plainte (19/10/2026 : Chris,
  // membre live, « my balance on the app is 1061 but on my MT5 it's 978 » était sorti en lead chaud)
  const hot = newbie && !SENSITIVE.test(joined) && (hotAmount(joined) || !!draft?.hot);
  if (hot && !rows.some((r) => r.detail?.hot_at)) {
    base = { ...base, hot_at: iso(Date.now()) };
    await hotAlert(conn.userChatId, base, member, joined, country);
  }
  if (country || base.hot_at) await db.from('member_actions').update({ detail: base }).eq('id', last.id);
  const extra = { country, voiced, introduced, hot, images: images.length };

  if (!draft) {
    await reviewCard(db, conn, last.id, base, member, null, `pas de proposition (${lastDraftIssue() ?? 'modèle indisponible ou réponse refusée'})`);
    return { status: 'done', result: { outcome: 'review', reason: 'no draft', ...extra } };
  }
  // un nouveau venu qui n'a reçu AUCUN accueil ne reste jamais sans rien, même pour un simple « hello »
  if (draft.skip && legacy) {
    await reviewCard(db, conn, last.id, base, member, null, 'ancien contact (compte de l’app d’avant le 29/09), rien d’enregistré avec toi : à toi de voir');
    return { status: 'done', result: { outcome: 'review', reason: 'ancien contact', ...extra } };
  }
  if (draft.skip && firstNoWelcome) {
    await reviewCard(db, conn, last.id, base, member, null, 'premier contact : pas encore de bulle d’accueil, à toi de l’accueillir');
    return { status: 'done', result: { outcome: 'review', reason: 'premier contact sans accueil', ...extra } };
  }
  if (draft.spam || draft.skip) {
    await db.from('member_actions').update({ detail: { ...base, draft_intent: draft.spam ? 'spam' : 'skip' } }).eq('id', last.id);
    await markRead(conn, job.conn, job.tg_id, last);
    return { status: 'done', result: { outcome: draft.spam ? 'spam' : 'skip', ...extra } };
  }

  const { data: recentAuto } = await db.from('member_actions').select('id').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).eq('detail->>via', 'auto').gte('created_at', iso(Date.now() - 3_600_000)).limit(MAX_AUTO_PER_HOUR + 1);
  const why = !autopilot ? 'pilote automatique coupé'
    : manual ? 'tu as écrit dans cette conversation il y a moins de 2 h'
    : firstNoWelcome ? 'premier contact : pas encore de bulle d’accueil, à toi de l’accueillir'
    : !draft.auto ? 'Claude n’est pas sûr'
    : SENSITIVE.test(joined) ? 'sujet sensible (argent, plainte, paiement…)'
    : HOLDING.test(draft.text) ? 'réponse d’attente'
    : justWelcomed && /where (are|r) (you|u) from|which country|what country/i.test(draft.text) ? 'redemande son pays juste après l’accueil'
    // entre l'accueil et son intro : jamais de lien broker ni de montant de dépôt (20/10/2026, Riyaz)
    : welcomed && !stepDone && !introduced && BEFORE_INTRO.test(draft.text) ? 'lien broker ou dépôt avant son intro (il n’a pas encore dit d’où il vient)'
    : media.length ? `il a aussi envoyé ${media.join(', ')}`
    : (recentAuto ?? []).length >= MAX_AUTO_PER_HOUR ? 'beaucoup de réponses automatiques dans l’heure'
    : !conn.canReply ? 'droit « Reply to messages » coupé dans Telegram Business'
    : null;
  if (why) {
    await reviewCard(db, conn, last.id, base, member, draft.text, why);
    return { status: 'done', result: { outcome: 'review', reason: why, ...extra } };
  }
  // part seule, depuis le compte de Mathieu, après un « en train d'écrire… » réaliste
  await tg('sendChatAction', { business_connection_id: job.conn, chat_id: job.tg_id, action: 'typing' });
  await sleep(Math.min(6000, 1500 + draft.text.length * 25));
  // IL A RÉÉCRIT PENDANT QU'ON RÉDIGEAIT (20/10/2026, Riyaz : « I am from UK » arrivé 6 s avant l'envoi, la réponse est
  // partie sans en tenir compte, et son pays est passé pour « répondu » : ni vocal ni intro). On n'envoie pas : son
  // nouveau message a déjà programmé la réponse suivante, qui reprend tout le fil.
  const { data: newer } = await db.from('member_actions').select('id').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).eq('detail->>from', 'client').gt('created_at', last.created_at).limit(1);
  if (newer?.length) return { status: 'done', result: { outcome: 'skip', reason: 'nouveau message pendant la rédaction : la réponse suivante reprend tout', ...extra } };
  const detail = { ...base, draft: draft.text, draft_intent: 'auto' };
  await db.from('member_actions').update({ detail }).eq('id', last.id);
  const err = await sendAsOwner(db, { id: last.id, tg_id: job.tg_id, member_no: member?.member_no ?? null, detail }, draft.text, 'auto', 'algoria-ai');
  if (err) {
    await reviewCard(db, conn, last.id, base, member, draft.text, `envoi refusé par Telegram : ${err}`);
    return { status: 'done', result: { outcome: 'review', reason: err, ...extra } };
  }
  await markRead(conn, job.conn, job.tg_id, last);
  return { status: 'done', result: { outcome: 'auto', chars: draft.text.length, ...extra } };
}

/** Pas de réponse 2 h après l'accueil et pas de compte : le lien de l'app part quand même (une fois). */
async function doLink(db: Db, job: Job): Promise<JobResult> {
  const { connection, tg } = await import('./businessInbox');
  if (!(await flag(db, 'welcome')) || !(await flag(db, 'autopilot'))) return { status: 'canceled', result: { reason: 'coupé' } };
  const { data: mrow } = await db.from('members').select('member_no').eq('tg_id', job.tg_id).limit(1);
  if (mrow?.length) return { status: 'done', result: { outcome: 'skip', reason: 'a un compte' } };
  const { data } = await db.from('member_actions').select('created_at,detail').eq('tg_id', job.tg_id).eq('kind', BIZ_KIND).order('created_at', { ascending: true }).limit(60);
  const rows = (data ?? []) as Array<{ created_at: string; detail: Record<string, unknown> }>;
  const w = rows.findIndex((r) => r.detail?.via === 'welcome' && r.detail?.text !== '[video bubble]');
  const after = w < 0 ? rows : rows.slice(w + 1);
  if (after.some((r) => r.detail?.from === 'client' || (r.detail?.from === 'owner' && !NOT_AN_ANSWER.has(String(r.detail?.via ?? ''))))) return { status: 'done', result: { outcome: 'skip', reason: 'conversation en cours' } };
  if (after.some((r) => r.detail?.via === 'link')) return { status: 'done', result: { outcome: 'skip', reason: 'déjà envoyé' } };
  const conn = await connection(job.conn);
  if (!conn || !conn.enabled || !conn.canReply) return { status: 'failed', result: { error: 'connexion Business absente, coupée ou sans droit de réponse' } };
  const it = job.payload?.lang === 'it';
  const text = it
    ? `Intanto, ecco il tuo accesso all'app: ${APP_URL}/member\nAccedi con il tuo Telegram, un tocco, nessuna password 🙏🏼`
    : `In the meantime, here's your access to the app: ${APP_URL}/member\nYou log in with your Telegram, one tap, no password 🙏🏼`;
  await tg('sendChatAction', { business_connection_id: job.conn, chat_id: job.tg_id, action: 'typing' });
  await sleep(2000);
  const r = await tg('sendMessage', { business_connection_id: job.conn, chat_id: job.tg_id, text, disable_web_page_preview: true });
  if (!r.ok) return { status: 'failed', result: { error: r.description ?? 'refusé' } };
  await db.from('member_actions').insert({ tg_id: job.tg_id, member_no: null, kind: BIZ_KIND, status: 'done', done_by: 'algoria-ai', detail: { from: 'owner', via: 'link', text, conn: job.conn } });
  return { status: 'done', result: { outcome: 'link' } };
}

// ── « LU » CHEZ MATHIEU ────────────────────────────────────────────────────────────────────────────────
// 19/10/2026, Mathieu : « le bot est actif mais j'ai encore plus de 20 messages non lus ». Telegram laissait en « non lu »
// les conversations auxquelles le bot avait répondu seul. On marque lu ce que le bot a traité SANS lui (réponse partie
// seule, rien à répondre, spam) : ses non-lus = ce qui a besoin de lui. Les cartes, elles, restent non lues.
// Il faut le droit « can_read_messages » du bot dans Telegram Business ; sans lui, rien ne se passe.
async function markRead(conn: { canRead?: boolean } | null, connId: string, tgId: number, row: { detail?: Record<string, unknown> } | undefined): Promise<void> {
  const msgId = Number(row?.detail?.msg_id ?? 0);
  if (!conn?.canRead || !msgId) return;
  const { tg } = await import('./businessInbox');
  await tg('readBusinessMessage', { business_connection_id: connId, chat_id: tgId, message_id: msgId }).catch(() => null);
}

// ── LES CAPTURES, LE PAYS, LE LEAD CHAUD ───────────────────────────────────────────────────────────────

type Img = { media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };

/** Télécharge une capture envoyée par le client (5 Mo max). null si Telegram refuse : la carte part alors sans lecture. */
async function downloadPhoto(fileId: string): Promise<Img | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const { tg } = await import('./businessInbox');
    const f = await tg('getFile', { file_id: fileId });
    const path = String(f.result?.file_path ?? '');
    if (!f.ok || !path || Number(f.result?.file_size ?? 0) > 5_000_000) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 5_000_000) return null;
    const media_type = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
    return { media_type, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

export const flagOf = (cc: string) => /^[A-Z]{2}$/.test(cc) && cc !== 'XX' ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌍';
export function countryName(cc: string, lang: 'en' | 'fr'): string {
  if (cc === 'XX') return lang === 'fr' ? 'Autres pays' : 'other countries';
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(cc) ?? cc; } catch { return cc; }
}
/** Le pays tel qu'on l'écrit sur la fiche membre (comme l'admin le saisit au passage en copie : « UK », « UAE »). */
export const countryLabel = (cc: string) => ({ GB: 'UK', AE: 'UAE', US: 'USA' } as Record<string, string>)[cc] ?? countryName(cc, 'en');

/** Le vocal de Mathieu pour ce pays (sinon celui des « autres pays »), le moins récemment envoyé. */
async function pickVoice(db: Db, cc: string): Promise<{ id: number; file_id: string } | null> {
  const { data } = await db.from('support_assets').select('id,file_id,countries,uses,last_used_at').eq('kind', 'country_voice').eq('active', true).limit(100);
  const all = (data ?? []) as Array<{ id: number; file_id: string; countries: string[] | null; uses: number | null; last_used_at: string | null }>;
  const has = (code: string) => all.filter((a) => (a.countries ?? []).includes(code));
  const pool = (has(cc).length ? has(cc) : has('XX')).sort((a, b) => (a.last_used_at ? Date.parse(a.last_used_at) : 0) - (b.last_used_at ? Date.parse(b.last_used_at) : 0));
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * Math.min(2, pool.length))];
  await db.from('support_assets').update({ last_used_at: iso(Date.now()), uses: Number(pick.uses ?? 0) + 1 }).eq('id', pick.id);
  return pick;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 🔥 Lead chaud : Mathieu est prévenu une fois par conversation, pour lui faire un vocal lui-même. */
async function hotAlert(chatId: number, base: Record<string, unknown>, member: MemberRow | null, text: string, country: string | null): Promise<void> {
  const { tg } = await import('./businessInbox');
  const username = base.username ? String(base.username) : '';
  const who = username ? `@${username}` : String(base.name ?? 'Client');
  const tag = member?.member_no != null ? ` · #${member.member_no} ${member.status ?? ''}`.trimEnd() : ' · prospect';
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true,
    text: `🔥 <b>Lead chaud</b> · ${esc(who)}${country ? ` ${flagOf(country)}` : ''}${esc(tag)}\n« ${esc(text.slice(0, 400))} »\n\nUn vocal de toi dans sa conversation ? Le bot continue de lui répondre normalement.`,
    ...(username ? { reply_markup: { inline_keyboard: [[{ text: '💬 Ouvrir la conversation', url: `https://t.me/${username}` }]] } } : {}),
  });
}

// ── LA BIBLIOTHÈQUE DE MATHIEU : BULLES D'ACCUEIL ET VOCAUX PAR PAYS ─────────────────────────────────────
// Il les envoie au bot en privé : une bulle vidéo = une bulle d'accueil ; un vocal = un vocal pays. Les boutons sous
// chacun disent à qui il va. « bulles » au bot : toute la bibliothèque ; « pays » : le tableau par pays.

// les pays des boutons (les plus fréquents chez nous) ; un autre : répondre au message avec son nom ou son drapeau
export const VOICE_COUNTRIES: Array<[string, string]> = [
  ['GB', 'UK'], ['ZA', 'Af. du Sud'], ['AU', 'Australie'], ['NZ', 'N.-Zélande'], ['NL', 'Pays-Bas'], ['BE', 'Belgique'],
  ['IT', 'Italie'], ['IE', 'Irlande'], ['AE', 'Émirats'], ['NG', 'Nigeria'], ['DE', 'Allemagne'], ['XX', 'Autres pays'],
];

type AssetRow = { id: number; kind?: string | null; situation?: string | null; lang?: string | null; countries?: string[] | null; active?: boolean | null };

/** Les boutons sous une bulle (public, langue) ou sous un vocal (ses pays, plusieurs possibles). ✓ = choix actuel. */
export function assetKeyboard(a: AssetRow) {
  if (a.active === false) return { inline_keyboard: [[{ text: '↩️ Remettre dans la bibliothèque', callback_data: `sa:${a.id}:on` }]] };
  if (a.kind === 'country_voice') {
    const on = new Set(a.countries ?? []);
    const btns = VOICE_COUNTRIES.map(([cc, label]) => ({ text: `${on.has(cc) ? '✓ ' : ''}${flagOf(cc)} ${label}`, callback_data: `sa:${a.id}:c:${cc}` }));
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let k = 0; k < btns.length; k += 3) rows.push(btns.slice(k, k + 3));
    rows.push([{ text: '🗑 Retirer', callback_data: `sa:${a.id}:x` }]);
    return { inline_keyboard: rows };
  }
  const sit = a.situation ?? 'all', lg = a.lang ?? 'en';
  return {
    inline_keyboard: [
      (Object.keys(SITUATIONS) as Situation[]).map((k) => ({ text: `${sit === k ? '✓ ' : ''}${SITUATIONS[k]}`, callback_data: `sa:${a.id}:s:${k}` })),
      [...(Object.keys(LANGS) as Lang[]).map((k) => ({ text: `${lg === k ? '✓ ' : ''}${LANGS[k]}`, callback_data: `sa:${a.id}:l:${k}` })), { text: '🗑 Retirer', callback_data: `sa:${a.id}:x` }],
    ],
  };
}

const countriesLine = (cs: string[] | null | undefined) => (cs ?? []).length ? (cs ?? []).map((c) => `${flagOf(c)} ${countryName(c, 'fr')}`).join(', ') : 'aucun pays choisi';

async function libraryLine(db: Db): Promise<string> {
  const { data } = await db.from('support_assets').select('kind,situation,lang,countries').eq('active', true).limit(300);
  const all = (data ?? []) as Array<{ kind: string; situation: string | null; lang: string | null; countries: string[] | null }>;
  const videos = all.filter((a) => a.kind === 'welcome_video');
  const voices = all.filter((a) => a.kind === 'country_voice');
  const by = (Object.keys(SITUATIONS) as Situation[]).map((k) => {
    const n = videos.filter((a) => (a.situation ?? 'all') === k);
    return n.length ? `${SITUATIONS[k]} : ${n.length}${n.some((a) => a.lang === 'it') ? ` (dont ${n.filter((a) => a.lang === 'it').length} 🇮🇹)` : ''}` : null;
  }).filter(Boolean);
  const covered = [...new Set(voices.flatMap((v) => v.countries ?? []))];
  return [
    videos.length ? `🎥 ${videos.length} bulle${videos.length > 1 ? 's' : ''} d’accueil · ${by.join(' · ')}` : '🎥 Aucune bulle d’accueil.',
    voices.length ? `🎙 ${voices.length} ${voices.length > 1 ? 'vocaux' : 'vocal'} pays · ${covered.length ? covered.map(flagOf).join(' ') : 'aucun pays choisi'}` : '🎙 Aucun vocal pays.',
  ].join('\n');
}

/** Une bulle vidéo (→ accueil) ou un vocal (→ vocal pays) envoyé au bot en privé par un admin. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportVideo(db: Db, msg: any): Promise<boolean> {
  if (msg?.chat?.type !== 'private' || !(msg?.video_note || msg?.voice) || msg.reply_to_message || msg.business_connection_id) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const { tg } = await import('./businessInbox');
  const voice = !!msg.voice;
  const v = (msg.video_note ?? msg.voice) as { file_id: string; file_unique_id: string };
  const kind = voice ? 'country_voice' : 'welcome_video';
  const { error } = await db.from('support_assets').insert({ kind, file_id: v.file_id, file_unique_id: v.file_unique_id, chat_id: Number(msg.chat.id), message_id: Number(msg.message_id) });
  const dup = error && /duplicate|unique/i.test(error.message);
  // renvoyé après un « retire » : il revient dans la rotation
  if (dup) await db.from('support_assets').update({ active: true }).eq('file_unique_id', v.file_unique_id);
  if (error && !dup) {
    await tg('sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: `⨯ Pas enregistré (${error.message.slice(0, 80)}), renvoie-le.` });
    return true;
  }
  const { data: row } = await db.from('support_assets').select('id,kind,situation,lang,countries,active').eq('file_unique_id', v.file_unique_id).limit(1);
  const a = row?.[0] as AssetRow | undefined;
  const head = voice
    ? `🎙 ${dup ? 'Déjà dans ta bibliothèque (remis dans la rotation si tu l’avais retiré).' : 'Vocal pays enregistré.'}\nPour quel(s) pays ? Touche en dessous (plusieurs possibles). Un autre pays : réponds à ce message avec son nom ou son drapeau.\nIl part quand la personne dit qu’elle vient de ce pays, juste avant la réponse écrite.`
    : `🎥 ${dup ? 'Déjà dans tes bulles (remise dans la rotation si tu l’avais retirée).' : 'Bulle d’accueil enregistrée.'}\nPour qui ? Touche en dessous (sinon : tout le monde, en anglais).`;
  await tg('sendMessage', {
    chat_id: msg.chat.id, reply_to_message_id: msg.message_id,
    text: `${head}\n\n${await libraryLine(db)}\nÉcris « bulles » pour revoir toute ta bibliothèque, « pays » pour le tableau par pays.`,
    ...(a ? { reply_markup: assetKeyboard(a) } : {}),
  });
  return true;
}

/** Réponse (nom ou drapeau d'un pays) au message de confirmation d'un vocal : ce pays est ajouté au vocal. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportAssetReply(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const kb = msg?.reply_to_message?.reply_markup?.inline_keyboard as Array<Array<{ callback_data?: string }>> | undefined;
  const m = /^sa:(\d+):c:/.exec(String(kb?.flat().find((b) => /^sa:\d+:c:/.test(String(b.callback_data ?? '')))?.callback_data ?? ''));
  if (msg?.chat?.type !== 'private' || !text || !m) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const { tg } = await import('./businessInbox');
  const cc = detectCountry(text);
  if (!cc) {
    await tg('sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: 'Je ne reconnais pas ce pays : envoie son drapeau (ex. 🇨🇦), c’est le plus sûr.' });
    return true;
  }
  const id = Number(m[1]);
  const { data } = await db.from('support_assets').select('id,kind,countries,active').eq('id', id).limit(1);
  const a = data?.[0] as AssetRow | undefined;
  if (!a) return false;
  const countries = [...new Set([...(a.countries ?? []), cc])];
  await db.from('support_assets').update({ countries }).eq('id', id);
  await tg('editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.reply_to_message.message_id, reply_markup: assetKeyboard({ ...a, countries }) });
  await tg('sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: `✓ ${flagOf(cc)} ${countryName(cc, 'fr')} ajouté. Ce vocal part pour : ${countriesLine(countries)}.` });
  return true;
}

/** « bulles » écrit au bot par un admin : la bibliothèque, chaque bulle et chaque vocal avec ses boutons.
 *  « pays » : le tableau par pays (contacts → app → broker → copie). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportLibrary(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const lib = /^\/?(bulles?|biblioth[eè]que|vocaux)$/i.test(text);
  const stats = /^\/?(pays|stats? pays)$/i.test(text);
  if (msg?.chat?.type !== 'private' || msg.reply_to_message || !(lib || stats)) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const { tg } = await import('./businessInbox');
  if (stats) {
    await tg('sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', text: await countryStatsText(db) });
    return true;
  }
  const { data } = await db.from('support_assets').select('id,kind,file_id,situation,lang,countries,active,uses').eq('active', true).order('id', { ascending: true }).limit(40);
  const all = (data ?? []) as Array<AssetRow & { file_id: string; uses: number | null }>;
  await tg('sendMessage', {
    chat_id: msg.chat.id,
    text: `${await libraryLine(db)}\n\n🎥 À l’accueil : une bulle de sa situation et de sa langue, sinon une « tout le monde », en rotation.\n🎙 Quand il dit son pays : le vocal de ce pays, sinon celui des « autres pays ».\nSous chacun : à qui il va, 🗑 pour le retirer. Pour en ajouter : envoie-le-moi.`,
  });
  for (const a of all) {
    if (a.kind === 'country_voice') await tg('sendVoice', { chat_id: msg.chat.id, voice: a.file_id, caption: `🎙 ${countriesLine(a.countries)} · envoyé ${a.uses ?? 0} fois`, reply_markup: assetKeyboard(a) });
    else await tg('sendVideoNote', { chat_id: msg.chat.id, video_note: a.file_id, reply_markup: assetKeyboard(a) });
  }
  return true;
}

/** Le tableau par pays, depuis le 29/09 (support_country_stats, migration 0030). */
async function countryStatsText(db: Db): Promise<string> {
  const { data, error } = await db.rpc('support_country_stats');
  if (error) return `⨯ Tableau indisponible (${esc(String(error.message).slice(0, 80))}).`;
  const rows = (data ?? []) as Array<{ country: string; contacts: number; app: number; broker: number; live: number }>;
  if (!rows.length) return 'Pas encore de contacts.';
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
  const known = rows.filter((r) => r.country !== '??');
  const unknown = rows.find((r) => r.country === '??');
  const tot = rows.reduce((t, r) => ({ c: t.c + Number(r.contacts), a: t.a + Number(r.app), b: t.b + Number(r.broker), l: t.l + Number(r.live) }), { c: 0, a: 0, b: 0, l: 0 });
  const line = (label: string, c: number, a: number, b: number, l: number) => `${label.padEnd(5)}${String(c).padStart(5)}${String(a).padStart(5)}${String(b).padStart(5)}${String(l).padStart(4)}  ${pct(l, c).padStart(4)}`;
  const body = known.slice(0, 14).map((r) => line(`${flagOf(r.country)}${r.country}`, Number(r.contacts), Number(r.app), Number(r.broker), Number(r.live)));
  return [
    '🌍 <b>Tunnel par pays</b> · contacts sur ton compte support depuis le 29/09',
    '<pre>',
    `${'Pays'.padEnd(5)}${'Cont'.padStart(5)}${' App'.padStart(5)}${'Brok'.padStart(5)}${'Cop'.padStart(4)}  ${'Conv'.padStart(4)}`,
    ...body,
    ...(unknown ? [line('❔ ?', Number(unknown.contacts), Number(unknown.app), Number(unknown.broker), Number(unknown.live))] : []),
    line('Total', tot.c, tot.a, tot.b, tot.l),
    '</pre>',
    '<i>Pays : celui qu’il a dit, sinon sa fiche, sinon son pays de connexion à l’app (un VPN peut tromper). Conv = en copie / contacts.</i>',
  ].join('\n');
}

/** Les boutons sous une bulle ou un vocal (sa:<id>:s:<situation> · sa:<id>:l:<langue> · sa:<id>:c:<pays> · sa:<id>:x · sa:<id>:on). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportAssetCallback(db: Db, cq: any): Promise<boolean> {
  const m = /^sa:(\d+):(s:(new|app|all)|l:(en|it)|c:([A-Z]{2})|x|on)$/.exec(String(cq?.data ?? ''));
  if (!m) return false;
  const { tg } = await import('./businessInbox');
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text });
  if (!(await adminTgIds()).includes(Number(cq.from?.id))) { await answer('Réservé aux admins.'); return true; }
  const id = Number(m[1]);
  const { data: cur } = await db.from('support_assets').select('id,kind,situation,lang,countries,active').eq('id', id).limit(1);
  const before = cur?.[0] as AssetRow | undefined;
  if (!before) { await answer('Introuvable.'); return true; }
  let toggledOn = false;
  const patch = m[3] ? { situation: m[3] } : m[4] ? { lang: m[4] } : m[5]
    ? (() => { const set = new Set(before.countries ?? []); toggledOn = !set.has(m[5]); if (toggledOn) set.add(m[5]); else set.delete(m[5]); return { countries: [...set] }; })()
    : { active: m[2] === 'on' };
  const { data } = await db.from('support_assets').update(patch).eq('id', id).select('id,kind,situation,lang,countries,active');
  const a = (data?.[0] ?? { ...before, ...patch }) as AssetRow;
  await tg('editMessageReplyMarkup', { chat_id: cq.message?.chat?.id, message_id: cq.message?.message_id, reply_markup: assetKeyboard(a) });
  await answer(m[3] ? `✓ ${SITUATIONS[m[3] as Situation]}` : m[4] ? `✓ ${LANGS[m[4] as Lang]}`
    : m[5] ? `${toggledOn ? '✓' : '✗'} ${flagOf(m[5])} ${countryName(m[5], 'fr')}`
    : a.active ? '↩️ Remis dans la bibliothèque' : '🗑 Retiré');
  return true;
}

/** « retire » en réponse à une bulle d'accueil : elle n'est plus envoyée. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSupportVideoRemove(db: Db, msg: any): Promise<boolean> {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (msg?.chat?.type !== 'private' || !(msg?.reply_to_message?.video_note || msg?.reply_to_message?.voice) || !/^(retire|supprime|enl[eè]ve|remove|delete)\b/i.test(text)) return false;
  if (!(await adminTgIds()).includes(Number(msg.from?.id))) return false;
  const { tg } = await import('./businessInbox');
  const { data } = await db.from('support_assets').update({ active: false }).eq('chat_id', Number(msg.chat.id)).eq('message_id', Number(msg.reply_to_message.message_id)).select('id');
  await tg('sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: (data ?? []).length ? '🗑 Retiré de la bibliothèque.' : 'Pas dans ta bibliothèque (sous ceux de « bulles », utilise 🗑).' });
  return true;
}
