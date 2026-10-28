// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/webinar-replay.ts
//
// Le replay sur demande (lib/member/replay.ts) : le mot REPLAY, la vidéo enregistrée par un admin, la file
// (support_jobs 'replay'), l'envoi texte puis vidéo, l'anti-doublon 24 h, le nouvel essai unique puis l'alerte.
// Aucune base, aucun appel Telegram : une fausse base en mémoire, et fetch remplacé (rien ne sort de la machine).
import { readFileSync } from 'node:fs';
import {
  REPLAY_DELAY_MIN_MS, REPLAY_DELAY_SPREAD_MS, REPLAY_TEXTS, finishReplayJob, getReplayAsset, handleReplayAdmin, handleReplayUpload,
  isReplayRequest, replayLang, replayTexts, requestReplay, runReplayJob, runReplaySoon, type ReplayJob,
} from '../../lib/member/replay';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── une fausse base (juste ce que replay.ts utilise) ──
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let nextId = 1;
const T = (t: string) => (tables[t] ??= []);
class Q {
  f: Array<(r: Row) => boolean> = []; op = 'select'; payload: Row | null = null; head = false; ord: [string, boolean] | null = null; lim = 0; ret = false;
  constructor(public t: string) {}
  select(_c?: string, opt?: { head?: boolean }) { if (opt?.head) this.head = true; if (this.op !== 'select') this.ret = true; return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.f.push((r) => r[c] !== v); return this; }
  gte(c: string, v: string) { this.f.push((r) => String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.f.push((r) => String(r[c]) <= v); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.ord = [c, o?.ascending !== false]; return this; }
  limit(n: number) { this.lim = n; return this; }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: Row) { this.op = 'upsert'; this.payload = p; return this; }
  run(): unknown {
    const rows = T(this.t);
    const now = new Date().toISOString();
    if (this.op === 'insert') { const r = { id: nextId++, created_at: now, updated_at: now, status: 'pending', ...this.payload }; rows.push(r); return { data: [r], error: null }; }
    if (this.op === 'upsert') { const ex = rows.find((r) => r.key === this.payload?.key); if (ex) Object.assign(ex, this.payload); else rows.push({ ...this.payload }); return { error: null }; }
    let hit = rows.filter((r) => this.f.every((fn) => fn(r)));
    if (this.op === 'update') { for (const r of hit) Object.assign(r, this.payload); return { data: hit.map((r) => ({ ...r })), error: null }; }
    if (this.head) return { count: hit.length };
    if (this.ord) { const [c, asc] = this.ord; hit = [...hit].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (asc ? 1 : -1)); }
    return { data: (this.lim ? hit.slice(0, this.lim) : hit).map((r) => ({ ...r })), error: null };
  }
  then(res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
}
const db = { from: (t: string) => new Q(t) };

// ── fetch remplacé ──
const OWNER = 999, MEMBER = 4242, CONN = 'bizconn-test';
type Call = { method: string; body: Record<string, unknown> };
const calls: Call[] = [];
let failNext: Record<string, number> = {};
globalThis.fetch = (async (url: string, init?: { body?: string }) => {
  const method = String(url).split('/').pop() ?? '';
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  calls.push({ method, body });
  if (failNext[method]) { failNext[method]--; return new Response('{"ok":false,"description":"Bad Gateway"}', { status: 502 }); }
  return new Response('{"ok":true,"result":{}}', { status: 200 });
}) as typeof fetch;
process.env.TELEGRAM_BOT_TOKEN = 'test-token-not-real';
process.env.OWNER_TG_IDS = String(OWNER);
delete process.env.ADMIN_TG_USERNAMES;
for (const k of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];

const toMember = () => calls.filter((c) => Number(c.body.chat_id) === MEMBER && c.method !== 'sendChatAction');
const toOwner = () => calls.filter((c) => Number(c.body.chat_id) === OWNER);
const jobs = () => T('support_jobs').filter((r) => r.kind === 'replay');
const lockAndRun = async (id: number) => {
  const job = T('support_jobs').find((r) => r.id === id) as unknown as ReplayJob;
  (job as unknown as Row).status = 'running';
  const r = await runReplayJob(db, job);
  await finishReplayJob(db, job, r);
  return r;
};

async function main() {
  // 1. le mot
  for (const t of ['REPLAY', 'replay', 'Replay 🙏', 'réplay', 'replay?', 'the replay', 'le replay', 'il replay per favore', 'can I get the replay ?', 'replay please', 'replay du live', 'Replay bitte'])
    check(`mot reconnu : « ${t} »`, isReplayRequest(t));
  for (const t of ['', 'live', 'replay replay', 'is there a replay of the part about brokers, I missed it', 'I watched the replay, when do I start?', 'replays are boring', 'my broker is replaying trades'])
    check(`pas une demande : « ${t} »`, !isReplayRequest(t));

  // 2. la langue
  check('langue : fiche italienne', replayLang({ locale: 'it', languageCode: 'de' }) === 'it');
  check('langue : Telegram en allemand', replayLang({ locale: 'en', languageCode: 'de-DE', text: 'replay' }) === 'de');
  check('langue : anglais par défaut', replayLang({ locale: null, languageCode: 'fr', text: 'REPLAY' }) === 'en');
  check('langue : « il replay »', replayLang({ text: 'il replay per favore' }) === 'it');

  // 3. les textes FINAUX (validés par Mathieu le 28/10 23:57) : mot pour mot
  check('textes EN finaux', REPLAY_TEXTS.en.ack === 'No problem 🙌🏻 I\'m sending you the replay 🎥' && REPLAY_TEXTS.en.caption === '🎥 Here\'s the replay of the live (25 min). Any question after watching? Just reply here 👇');
  check('textes DE finaux', REPLAY_TEXTS.de.ack === 'Kein Problem 🙌🏻 Ich schicke dir gleich das Replay 🎥' && REPLAY_TEXTS.de.caption === '🎥 Hier ist das Replay des Lives (25 Min.). Fragen nach dem Anschauen? Antworte einfach hier 👇');
  check('textes IT finaux', REPLAY_TEXTS.it.ack === 'Nessun problema 🙌🏻 Ti mando subito il replay 🎥' && REPLAY_TEXTS.it.caption === '🎥 Ecco il replay del live (25 min). Domande dopo averlo visto? Rispondi pure qui 👇');
  const ov = replayTexts('en', 'Sure 🙌🏻\n---\n\n---\nAlready sent 👆');
  check('admin : le document remplace l’anglais partie par partie', ov.ack === 'Sure 🙌🏻' && ov.caption === REPLAY_TEXTS.en.caption && ov.reminder === 'Already sent 👆', JSON.stringify(ov));
  check('admin : jamais l’italien ni l’allemand', replayTexts('it', 'Sure').ack === REPLAY_TEXTS.it.ack && replayTexts('de', 'Sure').ack === REPLAY_TEXTS.de.ack);

  // 4. pas de vidéo : rien chez le membre, Mathieu prévenu une seule fois
  const req = { tgId: MEMBER, conn: CONN, lang: 'en' as const, who: '@member', memberNo: 7 };
  const o0 = await requestReplay(db, req);
  check('sans vidéo : rien de planifié', o0.status === 'no_video' && !jobs().some((j) => j.status === 'pending') && toMember().length === 0, JSON.stringify(o0));
  check('sans vidéo : Mathieu prévenu', toOwner().some((c) => /aucune vidéo/.test(String(c.body.text))));
  calls.length = 0;
  await requestReplay(db, req);
  check('sans vidéo : pas de 2e alerte pour la même personne', toOwner().length === 0);

  // 5. Mathieu enregistre la vidéo (un non-admin n'est pas pris)
  calls.length = 0;
  const video = { file_id: 'BAACAgTEST', file_unique_id: 'u1', duration: 1529, file_size: 60_123_456 };
  check('vidéo d’un non-admin ignorée', !(await handleReplayUpload(db, { chat: { id: MEMBER, type: 'private' }, from: { id: MEMBER }, message_id: 1, video })));
  check('vidéo de Mathieu prise', await handleReplayUpload(db, { chat: { id: OWNER, type: 'private' }, from: { id: OWNER, username: 'mathieu_algoria' }, message_id: 2, video }));
  const a = await getReplayAsset(db);
  check('file_id gardé tel quel', a?.file_id === 'BAACAgTEST' && a.type === 'video', JSON.stringify(a));
  check('aperçu renvoyé par file_id', calls.some((c) => c.method === 'sendVideo' && c.body.video === 'BAACAgTEST' && Number(c.body.chat_id) === OWNER));
  const conf = String(calls.find((c) => c.method === 'sendMessage')?.body.text ?? '');
  check('confirmation « Replay enregistré ✅ · 25:29 · 60 Mo »', conf.includes('Replay enregistré') && conf.includes('25:29') && conf.includes('60 Mo'), conf);
  calls.length = 0;
  check('« replay » de Mathieu : l’état', await handleReplayAdmin(db, { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, text: 'replay' }) && /Replay actif/.test(String(calls[0]?.body.text)));

  // 6. la demande : planifiée à +50..55 s, une 2e demande pendant l'attente ne fait rien
  const t0 = Date.now();
  const o1 = await requestReplay(db, req, t0);
  check('planifié à +50..55 s', o1.status === 'scheduled' && !!o1.jobId && o1.dueMs! >= t0 + REPLAY_DELAY_MIN_MS && o1.dueMs! < t0 + REPLAY_DELAY_MIN_MS + REPLAY_DELAY_SPREAD_MS, JSON.stringify(o1));
  check('2e demande pendant l’attente : rien', (await requestReplay(db, req)).status === 'ignored');
  // after() arrivé trop tard (fonction presque à 60 s) : la ligne reste à la cron
  check('after() trop tard : laissé à la cron', (await runReplaySoon(db, o1.jobId!, Date.now() - 1, Date.now() - 57_000)) === 'left_to_cron' && T('support_jobs').find((r) => r.id === o1.jobId)?.status === 'pending');

  // 7. l'envoi (compte support) : texte puis vidéo, par business_connection_id, le file_id du bot
  calls.length = 0;
  check('after() à temps : envoyé', (await runReplaySoon(db, o1.jobId!, Date.now() - 1, Date.now() - 50_000)) === 'sent');
  const m = toMember();
  check('ordre : accusé puis vidéo', m.length === 2 && m[0].method === 'sendMessage' && m[1].method === 'sendVideo', m.map((c) => c.method).join());
  check('accusé = texte final EN', m[0]?.body.text === REPLAY_TEXTS.en.ack);
  check('vidéo par file_id + légende finale', m[1]?.body.video === 'BAACAgTEST' && m[1]?.body.caption === REPLAY_TEXTS.en.caption);
  check('les deux via le compte de Mathieu (business_connection_id)', m.every((c) => c.body.business_connection_id === CONN));
  check('ligne terminée', T('support_jobs').find((r) => r.id === o1.jobId)?.status === 'done');
  const acts = T('member_actions').filter((r) => r.tg_id === MEMBER);
  check('member_actions : biz_msg owner (accusé + vidéo) et webinar_replay (ack, video)', acts.filter((r) => r.kind === 'biz_msg').length === 2 && acts.filter((r) => r.kind === 'webinar_replay').map((r) => (r.detail as Row).step).join() === 'ack,video', JSON.stringify(acts.map((r) => [r.kind, (r.detail as Row).step])));
  calls.length = 0;
  check('rejouer la même ligne : rien (déjà réservée)', (await runReplaySoon(db, o1.jobId!, Date.now() - 1, Date.now())) === 'taken' && toMember().length === 0);

  // 8. redemandé dans les 24 h : un court rappel seulement, puis plus rien pendant 10 min
  const o2 = await requestReplay(db, req);
  check('dans les 24 h : rappel', o2.status === 'reminder');
  calls.length = 0;
  await lockAndRun(o2.jobId!);
  check('rappel seul (pas de vidéo)', toMember().length === 1 && toMember()[0].method === 'sendMessage' && /just above/.test(String(toMember()[0].body.text)));
  check('rappel répété aussitôt : rien', (await requestReplay(db, req)).status === 'ignored');

  // 9. bot (sans compte support), en italien : un échec de la vidéo → un nouvel essai, sans renvoyer l'accusé
  const B = 5151;
  const reqB = { tgId: B, conn: null, lang: 'it' as const, who: '@bot_user' };
  const oB = await requestReplay(db, reqB);
  calls.length = 0; failNext = { sendVideo: 1 };
  const r1 = await lockAndRun(oB.jobId!);
  const rowB = T('support_jobs').find((r) => r.id === oB.jobId)!;
  check('1er échec : remis en attente (1 min), accusé noté', r1.status === 'later' && rowB.status === 'pending' && !!(rowB.payload as Row).ack_sent_at && (rowB.payload as Row).attempts === 1, JSON.stringify(rowB));
  check('bot : pas de business_connection_id, texte italien', calls.filter((c) => Number(c.body.chat_id) === B).every((c) => !('business_connection_id' in c.body)) && calls.some((c) => c.body.text === REPLAY_TEXTS.it.ack));
  calls.length = 0;
  const r2 = await lockAndRun(oB.jobId!);
  const toB = calls.filter((c) => Number(c.body.chat_id) === B && c.method !== 'sendChatAction');
  check('2e essai : la vidéo seule, pas un 2e accusé', r2.status === 'done' && toB.length === 1 && toB[0].method === 'sendVideo' && toB[0].body.caption === REPLAY_TEXTS.it.caption, toB.map((c) => c.method).join());

  // 10. deux échecs → échec + alerte à Mathieu (accusé parti, pas la vidéo)
  const C = 6161;
  const oC = await requestReplay(db, { tgId: C, conn: null, lang: 'de', who: '@de_user' });
  calls.length = 0; failNext = { sendVideo: 2 };
  await lockAndRun(oC.jobId!);
  await lockAndRun(oC.jobId!);
  check('2 échecs : ligne en échec', T('support_jobs').find((r) => r.id === oC.jobId)?.status === 'failed');
  check('2 échecs : Mathieu prévenu « l’accusé est parti, PAS la vidéo »', toOwner().some((c) => /PAS la vidéo/.test(String(c.body.text))), toOwner().map((c) => c.body.text).join(' | '));
  check('2 échecs : texte allemand envoyé une seule fois', calls.filter((c) => c.body.text === REPLAY_TEXTS.de.ack).length === 1);

  // 11. « replay off » : plus d'accusé sans vidéo
  await handleReplayAdmin(db, { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, text: 'replay off' });
  check('replay off : plus de vidéo', (await getReplayAsset(db)) === null);
  const D = 7171;
  check('replay off : nouvelle demande non planifiée', (await requestReplay(db, { tgId: D, conn: null, lang: 'en', who: 'x' })).status === 'no_video');

  // 12. le câblage (lecture du code) : pas de réponse de l'IA au mot, le replay jamais annulé par Mathieu qui écrit
  const route = readFileSync('app/api/telegram/route.ts', 'utf8');
  const biz = readFileSync('lib/member/businessInbox.ts', 'utf8');
  const auto = readFileSync('lib/member/supportAuto.ts', 'utf8');
  check('route : REPLAY avant la boîte de réception de l’IA', route.indexOf('isReplayRequest(msg.text)') > 0 && route.indexOf('isReplayRequest(msg.text)') < route.indexOf('BOT_BATCH_MS));'));
  check('compte support : REPLAY sort avant scheduleOnClientMessage', /isReplayRequest\(m\.text\)[\s\S]*?return;\n  \}[\s\S]*scheduleOnClientMessage\(db, \{ tgId: chatId/.test(biz));
  check('cancelPendingJobs épargne le replay', /cancelPendingJobs[\s\S]{0,300}\.neq\('kind', REPLAY_KIND\)/.test(auto));
  check('cron : le replay est traité par runSupportJobs', /job\.kind === REPLAY_KIND \? await runReplayJob/.test(auto));
  check('jamais de setWebhook ni de temperature', !/setWebhook|temperature/.test(readFileSync('lib/member/replay.ts', 'utf8')));

  console.log(failed ? `\n${failed} échec(s)` : '\ntout est bon');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
