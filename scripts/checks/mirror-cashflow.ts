// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/mirror-cashflow.ts
//
// Le second miroir anglais (Cashflow, 28/10/2026 — lib/channel/mirrors.ts). Aucun appel réseau réel : fetch est
// remplacé par un faux Telegram (+ un faux PostgREST pour le webhook), la base par un faux client.
// Ce qu'on prouve :
//   1. variable non posée → exactement les mêmes envois, le même rapport, les mêmes verrous qu'avant ;
//   2. variable posée → Cashflow reçoit le texte tel quel, APRÈS la source, le miroir UK et l'italien, avec son verrou
//      et son libellé « mirror Cashflow » ;
//   3. Cashflow en panne → la source, l'UK et l'italien sont servis, la publication reste ok ;
//   4. Cashflow = UK / source / IT → ignoré (pas de doublon, pas d'auto-copie) ;
//   5. le webhook (channel_post écrit à la main) copie aussi vers Cashflow, avec son propre verrou, et une panne
//      Cashflow n'empêche pas la copie UK.

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

const SRC = '-1003996521450';
const UK = '-1003054846062';
const IT = '-1002511171041';
const CASH = '-1002137064398';

// ── faux Telegram ────────────────────────────────────────────────────────────
type Call = { method: string; chat: string; body: Record<string, unknown> };
let calls: Call[] = [];
let failChat: string | null = null; // ce canal répond une erreur réseau
let refuseChat: string | null = null; // ce canal répond ok:false
let nextId = 100;
const realFetch = globalThis.fetch;
// PostgREST minimal pour le webhook : inserts et updates de channel_translations, upsert de telegram_chats.
let pgRows: Array<Record<string, unknown>> = [];
let pgUpdates: Array<{ table: string; query: string; body: Record<string, unknown> }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.startsWith('https://api.telegram.org/')) {
    const method = url.split('/').pop() ?? '';
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const chat = String(body.chat_id ?? '');
    calls.push({ method, chat, body });
    if (chat === failChat) throw new Error('simulated network failure');
    if (chat === refuseChat) return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot is not a member of the channel chat' }), { status: 403 });
    return new Response(JSON.stringify({ ok: true, result: { message_id: nextId++ } }), { status: 200 });
  }
  if (url.startsWith('https://fake.supabase.local/')) {
    const u = new URL(url);
    const table = u.pathname.split('/').pop() ?? '';
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (table === 'channel_translations' && method === 'POST') {
      const row = Array.isArray(body) ? body[0] : body;
      const dup = pgRows.some((r) => r.src_chat_id === row.src_chat_id && r.src_message_id === row.src_message_id && r.dst_chat_id === row.dst_chat_id);
      if (dup) return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "channel_translations_src_dst_idx"' }), { status: 409, headers: { 'content-type': 'application/json' } });
      pgRows.push(row);
      return new Response('', { status: 201 });
    }
    if (method === 'PATCH') { pgUpdates.push({ table, query: u.search, body }); return new Response('', { status: 204 }); }
    return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('anthropic.com')) return new Response('{"error":"offline"}', { status: 500 });
  return realFetch(input, init);
}) as typeof fetch;

// ── faux client Supabase pour publishToChannels ──────────────────────────────
let inserts: Array<Record<string, unknown>> = [];
const fakeDb = { from: (t: string) => ({ insert: async (row: Record<string, unknown>) => { inserts.push({ table: t, ...row }); return { error: null }; } }) };

function setEnv(extra: Record<string, string | undefined>) {
  for (const k of ['TELEGRAM_CHANNEL_EN', 'TELEGRAM_CHANNEL_MIRROR', 'TELEGRAM_CHANNEL_IT', 'TELEGRAM_CHANNEL_MIRROR_CASHFLOW']) delete process.env[k];
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) process.env[k] = v;
}
function reset() { calls = []; inserts = []; failChat = null; refuseChat = null; nextId = 100; pgRows = []; pgUpdates = []; }

process.env.TELEGRAM_BOT_TOKEN = 'test-token-not-real';
delete process.env.ANTHROPIC_API_KEY; // la traduction échoue proprement : l'italien est « translation rejected », hors ligne

async function main() {
  const { extraMirrors, allMirrors, ukMirror } = await import('../../lib/channel/mirrors');
  const { publishToChannels } = await import('../../lib/channel/publish');

  // ── 1. configuration ───────────────────────────────────────────────────────
  {
    check('non posé → aucun miroir en plus', extraMirrors({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK }).length === 0);
    check('vide / espaces → aucun miroir en plus', extraMirrors({ TELEGRAM_CHANNEL_MIRROR_CASHFLOW: '   ' }).length === 0);
    const x = extraMirrors({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: ` ${CASH} ` });
    check('posé → Cashflow, id rogné, libellé « mirror Cashflow »', x.length === 1 && x[0].chat === CASH && x[0].label === 'mirror Cashflow');
    check('Cashflow = miroir UK → ignoré', extraMirrors({ TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: UK }).length === 0);
    check('Cashflow = source → ignoré (pas d’auto-copie)', extraMirrors({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: SRC }).length === 0);
    check('Cashflow = italien → ignoré', extraMirrors({ TELEGRAM_CHANNEL_IT: IT, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: IT }).length === 0);
    check('miroir UK inchangé', ukMirror({ TELEGRAM_CHANNEL_MIRROR: UK })?.label === 'mirror UK' && ukMirror({}) === null);
    check('allMirrors : UK puis Cashflow', allMirrors({ TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: CASH }).map((m) => m.chat).join() === `${UK},${CASH}`);
    check('Cashflow sans miroir UK → fonctionne seul', extraMirrors({ TELEGRAM_CHANNEL_MIRROR_CASHFLOW: CASH }).length === 1);
  }

  const post = { chatId: SRC, text: '<b>Hello</b> traders', buttonText: 'OPEN THE APP', buttonUrl: 'https://app.getalgoria.com/member' };

  // ── 2. variable non posée : à l'identique d'avant ──────────────────────────
  {
    reset(); setEnv({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_IT: IT });
    const out = await publishToChannels(fakeDb, post);
    check('avant : ok', out.ok === true);
    check('avant : envois source puis UK, et rien d’autre (l’italien échoue hors ligne)', calls.map((c) => c.chat).join() === `${SRC},${UK}`, calls.map((c) => c.chat).join());
    check('avant : rapport source / mirror UK / canale IT', out.report.map((r) => r.channel).join('|') === 'source|mirror UK|canale IT', JSON.stringify(out.report));
    check('avant : verrous UK + IT seulement', inserts.map((i) => `${i.dst_chat_id}:${i.kind}`).join() === `${UK}:mirror_api,${IT}:text_api`, JSON.stringify(inserts));
    check('avant : aucun envoi vers Cashflow', !calls.some((c) => c.chat === CASH));
  }

  // ── 3. variable posée ──────────────────────────────────────────────────────
  {
    reset(); setEnv({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_IT: IT, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: CASH });
    const out = await publishToChannels(fakeDb, post);
    check('Cashflow : ok', out.ok === true);
    check('Cashflow : servi en dernier, après source et UK', calls.map((c) => c.chat).join() === `${SRC},${UK},${CASH}`, calls.map((c) => c.chat).join());
    const c = calls.find((x) => x.chat === CASH);
    const uk = calls.find((x) => x.chat === UK);
    check('Cashflow : même texte et même bouton que l’UK', !!c && !!uk && JSON.stringify({ ...c.body, chat_id: 0 }) === JSON.stringify({ ...uk.body, chat_id: 0 }));
    check('Cashflow : rapport « mirror Cashflow » ok, après canale IT', out.report.map((r) => `${r.channel}:${r.ok}`).join('|') === 'source:true|mirror UK:true|canale IT:false|mirror Cashflow:true', JSON.stringify(out.report));
    const lock = inserts.find((i) => String(i.dst_chat_id) === CASH);
    check('Cashflow : son propre verrou (mirror_api, sent, message_id)', !!lock && lock.kind === 'mirror_api' && lock.status === 'sent' && lock.dst_message_id === 102 && String(lock.src_chat_id) === SRC, JSON.stringify(lock));
  }

  // photo : légende, même chemin
  {
    reset(); setEnv({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: CASH });
    const out = await publishToChannels(fakeDb, { ...post, photoUrl: 'https://example.com/card.png' });
    check('photo : sendPhoto vers les trois canaux EN', out.ok && calls.map((c) => `${c.method}:${c.chat}`).join() === `sendPhoto:${SRC},sendPhoto:${UK},sendPhoto:${CASH}`, calls.map((c) => `${c.method}:${c.chat}`).join());
  }

  // ── 4. Cashflow en panne ───────────────────────────────────────────────────
  {
    reset(); setEnv({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_IT: IT, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: CASH });
    failChat = CASH;
    const out = await publishToChannels(fakeDb, post);
    check('panne réseau Cashflow : la publication reste ok', out.ok === true);
    check('panne réseau Cashflow : source et UK servis', out.report.find((r) => r.channel === 'source')?.ok === true && out.report.find((r) => r.channel === 'mirror UK')?.ok === true);
    const r = out.report.find((x) => x.channel === 'mirror Cashflow');
    check('panne réseau Cashflow : sa ligne seule en échec, avec la raison', !!r && r.ok === false && /simulated/.test(r.error ?? ''), JSON.stringify(r));
    check('panne réseau Cashflow : verrou « failed »', inserts.some((i) => String(i.dst_chat_id) === CASH && i.status === 'failed'));

    reset(); refuseChat = CASH;
    const out2 = await publishToChannels(fakeDb, post);
    check('Telegram refuse Cashflow (bot pas admin) : ok, UK servi', out2.ok === true && out2.report.find((r) => r.channel === 'mirror UK')?.ok === true && out2.report.find((r) => r.channel === 'mirror Cashflow')?.ok === false);

    reset(); failChat = UK;
    const out3 = await publishToChannels(fakeDb, post);
    check('UK en panne : Cashflow servi quand même', out3.report.find((r) => r.channel === 'mirror Cashflow')?.ok === true);
  }

  // ── 5. pas de relais si on ne publie pas sur la source ─────────────────────
  {
    reset(); setEnv({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: CASH });
    const out = await publishToChannels(fakeDb, { ...post, chatId: UK });
    check('post direct sur un autre canal : aucun relais', out.ok && calls.length === 1 && calls[0].chat === UK);
    reset(); setEnv({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: UK });
    const out2 = await publishToChannels(fakeDb, post);
    check('Cashflow = UK par erreur : un seul envoi UK', out2.ok && calls.filter((c) => c.chat === UK).length === 1 && calls.length === 2);
  }

  // ── 6. le webhook : channel_post écrit à la main dans la source ─────────────
  {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.local';
    process.env.SUPABASE_SERVICE_KEY = 'fake-service-key';
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    // Node 20 n'a pas de WebSocket natif et supabase-js en exige un à la construction (Realtime, jamais ouvert ici)
    const g = globalThis as unknown as { WebSocket?: unknown };
    if (!g.WebSocket) g.WebSocket = class {};
    const { POST } = await import('../../app/api/telegram/route');
    const update = (id: number, extra: Record<string, unknown> = {}) => ({
      update_id: id,
      channel_post: { message_id: id, chat: { id: Number(SRC), type: 'channel', title: 'ALGORIA AI' }, date: 0, text: 'hi', reply_markup: { inline_keyboard: [[{ text: 'GO', url: 'https://app.getalgoria.com' }]] }, ...extra },
    });
    const send = (u: unknown) => POST(new Request('https://x/api/telegram', { method: 'POST', body: JSON.stringify(u) }));

    reset(); setEnv({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK });
    await send(update(500));
    check('webhook non posé : copie UK seule', calls.map((c) => `${c.method}:${c.chat}`).join() === `copyMessage:${UK}`, calls.map((c) => `${c.method}:${c.chat}`).join());

    reset(); setEnv({ TELEGRAM_CHANNEL_EN: SRC, TELEGRAM_CHANNEL_MIRROR: UK, TELEGRAM_CHANNEL_MIRROR_CASHFLOW: CASH });
    await send(update(501));
    check('webhook posé : copie UK puis Cashflow', calls.map((c) => `${c.method}:${c.chat}`).join() === `copyMessage:${UK},copyMessage:${CASH}`, calls.map((c) => `${c.method}:${c.chat}`).join());
    const cc = calls.find((c) => c.chat === CASH);
    check('webhook : Cashflow garde le bouton de la source', JSON.stringify(cc?.body.reply_markup) === JSON.stringify(update(0).channel_post.reply_markup));
    check('webhook : deux verrous distincts (UK, Cashflow)', pgRows.map((r) => String(r.dst_chat_id)).join() === `${UK},${CASH}`, JSON.stringify(pgRows));

    // Telegram rejoue le même update (webhook lent) : les verrous arrêtent les deux copies
    calls = [];
    await send(update(501));
    check('webhook rejoué : aucune copie en double', calls.length === 0, calls.map((c) => c.chat).join());

    // témoignage transféré : forwardMessage, comme l'UK
    reset();
    await send(update(502, { forward_origin: { type: 'user' } }));
    check('webhook témoignage : forwardMessage vers UK et Cashflow', calls.map((c) => `${c.method}:${c.chat}`).join() === `forwardMessage:${UK},forwardMessage:${CASH}`);

    // panne Cashflow : l'UK est servi, le webhook répond 200
    reset(); failChat = CASH;
    const res = await send(update(503));
    check('webhook panne Cashflow : UK servi, réponse 200', res.status === 200 && calls.some((c) => c.chat === UK));
    check('webhook panne Cashflow : verrou marqué failed', pgUpdates.some((u) => u.table === 'channel_translations' && u.query.includes(CASH) && u.body?.status === 'failed'), JSON.stringify(pgUpdates));

    // un post écrit À LA MAIN dans Cashflow lui-même n'est relayé nulle part
    reset();
    await send({ update_id: 9, channel_post: { message_id: 9, chat: { id: Number(CASH), type: 'channel', title: 'CASHFLOW' }, date: 0, text: 'old post' } });
    check('post écrit dans Cashflow : aucun relais', calls.length === 0);
  }

  if (failed) {
    console.error(`\n${failed} contrôle(s) en échec`);
    process.exit(1);
  }
  console.log('\ntous les contrôles passent');
}

main().catch((e) => { console.error(e); process.exit(1); });
