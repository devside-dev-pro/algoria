// /play_voice : lecture seule, privé du propriétaire. Aucun envoi vers un prospect, aucune écriture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlayTokens, dispatchPlayVoice, parsePlayVoiceCommand } from './voicePlay';
import { handleVoiceRecorderCommand } from './voiceRecorderHandlers';

const OFF = 'Mode enregistrement coupé (SUPPORT_VOICE_RECORDER est off).';

type Row = {
  id: number;
  kind: string;
  situation: string | null;
  file_id: string;
  chat_id?: number;
  uses?: number;
  message_id?: number;
  lang?: string;
};

type Sent = { method: string; payload: Record<string, unknown> };

function memoryDb(rows: Row[]) {
  const ops: string[] = [];
  const selects: string[] = [];
  const db = {
    ops,
    selects,
    from(table: string) {
      const rec = { op: 'select', table, id: null as number | null };
      const q = {
        select(cols: string) { rec.op = 'select'; selects.push(cols); return q; },
        eq(col: string, val: unknown) {
          if (col !== 'id') throw new Error(`filtre interdit: ${col}`);
          rec.id = Number(val);
          return q;
        },
        in() { throw new Error('filtre interdit'); },
        order() { throw new Error('filtre interdit'); },
        update(patch: unknown) { ops.push(`update:${JSON.stringify(patch)}`); throw new Error('écriture interdite'); },
        insert(patch: unknown) { ops.push(`insert:${JSON.stringify(patch)}`); throw new Error('écriture interdite'); },
        delete() { ops.push('delete'); throw new Error('écriture interdite'); },
        upsert(patch: unknown) { ops.push(`upsert:${JSON.stringify(patch)}`); throw new Error('écriture interdite'); },
        rpc() { ops.push('rpc'); throw new Error('écriture interdite'); },
        limit() { return q; },
        then(resolve: (v: unknown) => void) {
          ops.push(`${rec.op}:${rec.table}:${rec.id}`);
          const row = rows.find((r) => r.id === rec.id);
          resolve({ data: row ? [row] : [], error: null });
        },
      };
      return q;
    },
  };
  return db;
}

const owner = (text: string, id: unknown = 111) => ({
  text,
  chat: { type: 'private', id },
  from: { id },
});

async function run(msg: ReturnType<typeof owner> | Record<string, unknown>, opts: {
  rows?: Row[];
  owner?: boolean;
  enabled?: boolean;
  isOwner?: (fromId: unknown) => Promise<boolean>;
  send?: (method: string, payload: Record<string, unknown>) => Promise<{ ok?: boolean } | void>;
}) {
  const sent: Sent[] = [];
  const db = memoryDb(opts.rows ?? []);
  const handled = await dispatchPlayVoice({
    db,
    msg,
    isOwner: opts.isOwner ?? (async () => opts.owner !== false),
    enabled: opts.enabled !== false,
    send: opts.send ?? (async (method, payload) => { sent.push({ method, payload }); return { ok: true }; }),
  });
  return { handled, sent, db };
}

test('parsing : plusieurs ids, ids invalides, plus de 10, sans argument', () => {
  assert.equal(parsePlayVoiceCommand('bonjour'), null);
  assert.equal(parsePlayVoiceCommand('/check_voices'), null);
  assert.equal(parsePlayVoiceCommand('/record_voices'), null);
  assert.equal(parsePlayVoiceCommand('/play_voices 23'), null);
  assert.deepEqual(parsePlayVoiceCommand('/play_voice')?.tokens, []);
  assert.deepEqual(parsePlayVoiceCommand('/play_voice@AlgoriaBot')?.tokens, []);
  assert.deepEqual(parsePlayVoiceCommand('  /PLAY_VOICE   23   25  ')?.tokens, ['23', '25']);
  assert.deepEqual(parsePlayVoiceCommand('/play_voice@AlgoriaBot 23 25')?.tokens, ['23', '25']);

  const mixed = classifyPlayTokens(['23', 'abc', '0', '-3', '25.5', '23,25', '00', '25']);
  assert.equal(mixed.tooMany, false);
  assert.deepEqual(mixed.ids, [23, 25]);
  assert.deepEqual(mixed.invalid, ['abc', '0', '-3', '25.5', '23,25', '00']);

  const ten = classifyPlayTokens(Array.from({ length: 10 }, (_, i) => String(i + 1)));
  assert.equal(ten.tooMany, false);
  assert.equal(ten.ids.length, 10);

  const many = classifyPlayTokens(Array.from({ length: 11 }, (_, i) => String(i + 1)));
  assert.equal(many.tooMany, true);
  assert.deepEqual(many.ids, []);
  assert.deepEqual(many.invalid, []);
});

test('un non-owner est refusé et rien n’est envoyé', async () => {
  let reads = 0;
  const db = {
    from() { reads += 1; throw new Error('aucune lecture'); },
  };
  const handled = await dispatchPlayVoice({
    db,
    msg: owner('/play_voice 23 25', 222),
    isOwner: async () => false,
    enabled: true,
    send: async () => { throw new Error('rien ne doit partir'); },
  });
  assert.equal(handled, false);
  assert.equal(reads, 0);
});

test('un groupe ou un chat non privé est refusé, même pour le propriétaire', async () => {
  const cases = [
    { text: '/play_voice 23', chat: { type: 'group', id: -100 }, from: { id: 111 } },
    { text: '/play_voice 23', chat: { type: 'supergroup', id: -100 }, from: { id: 111 } },
    { text: '/play_voice 23', chat: { type: 'channel', id: -100 }, from: { id: 111 } },
    { text: '/play_voice 23', chat: { type: 'private', id: 111 }, from: { id: 111 }, business_connection_id: 'biz' },
    { text: '/play_voice 23', chat: { type: 'private', id: 111 }, from: { id: 333 } },
    { text: '/play_voice 23', chat: { type: 'private', id: -5 }, from: { id: -5 } },
  ];
  for (const msg of cases) {
    let ownerChecks = 0;
    const handled = await dispatchPlayVoice({
      db: { from() { throw new Error('aucune lecture'); } },
      msg,
      isOwner: async () => { ownerChecks += 1; return true; },
      enabled: true,
      send: async () => { throw new Error('rien ne doit partir'); },
    });
    assert.equal(handled, false, JSON.stringify(msg.chat));
    assert.equal(ownerChecks, 0, JSON.stringify(msg.chat));
  }
});

test('drapeau SUPPORT_VOICE_RECORDER coupé : aucun vocal', async () => {
  const { handled, sent, db } = await run(owner('/play_voice 23 25'), {
    enabled: false,
    rows: [{ id: 23, kind: 'faq_voice', situation: 'refus_not_partner', file_id: 'FILE', chat_id: 999001, uses: 4 }],
  });
  assert.equal(handled, true);
  assert.equal(db.ops.length, 0);
  assert.equal(sent.some((s) => s.method === 'sendVoice'), false);
  assert.deepEqual(sent.map((s) => s.payload.text), [OFF]);
  assert.equal(sent[0].payload.chat_id, 111);
});

test('sans argument : une aide, aucun vocal ; plus de 10 ids : rien n’est lu ni envoyé', async () => {
  const empty = await run(owner('/play_voice'), { rows: [{ id: 23, kind: 'faq_voice', situation: 'refus_not_partner', file_id: 'FILE', uses: 1 }] });
  assert.equal(empty.handled, true);
  assert.equal(empty.db.ops.length, 0);
  assert.equal(empty.sent.some((s) => s.method === 'sendVoice'), false);
  assert.match(String(empty.sent[0].payload.text), /\/play_voice <id>/);
  assert.equal(empty.sent[0].payload.chat_id, 111);

  const ids = Array.from({ length: 11 }, (_, i) => i + 1).join(' ');
  const tooMany = await run(owner(`/play_voice ${ids}`), {
    rows: [{ id: 1, kind: 'faq_voice', situation: 'faq_deposit', file_id: 'FILE', uses: 2 }],
  });
  assert.equal(tooMany.handled, true);
  assert.equal(tooMany.db.ops.length, 0);
  assert.equal(tooMany.sent.filter((s) => s.method === 'sendVoice').length, 0);
  assert.match(String(tooMany.sent[0].payload.text), /10/);
  assert.match(String(tooMany.sent[0].payload.text), /Rien n’a été envoyé/);
  assert.equal(tooMany.sent[0].payload.chat_id, 111);
});

test('chat_id du message propriétaire, lecture seule, uses inchangé, légende', async () => {
  const row23 = {
    id: 23, kind: 'faq_voice', situation: 'refus_not_partner', file_id: 'FILE23',
    chat_id: 999001, uses: 7, message_id: 55, lang: 'en',
  };
  const row25 = {
    id: 25, kind: 'script_voice', situation: 'accueil_generique', file_id: 'FILE25',
    chat_id: 888002, uses: 3, message_id: 9, lang: 'en',
  };
  const { handled, sent, db } = await run(owner('/play_voice 23 25', '111'), { rows: [row23, row25] });
  assert.equal(handled, true);
  assert.deepEqual(db.selects, ['id,kind,situation,file_id', 'id,kind,situation,file_id']);
  assert.deepEqual(db.ops, ['select:support_assets:23', 'select:support_assets:25']);
  assert.equal(row23.uses, 7);
  assert.equal(row25.uses, 3);
  assert.deepEqual(sent.map((s) => s.method), ['sendVoice', 'sendVoice']);
  assert.deepEqual(sent[0].payload, {
    chat_id: 111,
    voice: 'FILE23',
    caption: 'id 23 · refus_not_partner (faq_voice)',
  });
  assert.deepEqual(sent[1].payload, {
    chat_id: 111,
    voice: 'FILE25',
    caption: 'id 25 · accueil_generique (script_voice)',
  });
  assert.equal(JSON.stringify(sent).includes('999001'), false);
  assert.equal(JSON.stringify(sent).includes('888002'), false);
  assert.equal(JSON.stringify(sent).includes('"uses"'), false);
});

test('ids invalides, inconnus ou illisibles : un texte clair, la suite continue', async () => {
  const rows: Row[] = [
    { id: 23, kind: 'faq_voice', situation: 'refus_not_partner', file_id: 'FILE23', chat_id: 999001, uses: 7 },
    { id: 30, kind: 'faq_voice', situation: 'faq_deposit', file_id: 'BAD', chat_id: 999001, uses: 1 },
    { id: 31, kind: 'script_voice', situation: 'refus_no_deposit', file_id: 'THROW', chat_id: 999001, uses: 1 },
    { id: 32, kind: 'country_voice', situation: 'GB', file_id: 'VIDEO', chat_id: 999001, uses: 9 },
    { id: 25, kind: 'script_voice', situation: 'accueil_generique', file_id: 'FILE25', chat_id: 888002, uses: 3 },
  ];
  const sent: Sent[] = [];
  const db = memoryDb(rows);
  const handled = await dispatchPlayVoice({
    db,
    msg: owner('/play_voice 23 abc 99 30 31 32 25'),
    isOwner: async () => true,
    enabled: true,
    send: async (method, payload) => {
      sent.push({ method, payload });
      if (method === 'sendVoice' && payload.voice === 'BAD') return { ok: false };
      if (method === 'sendVoice' && payload.voice === 'THROW') throw new Error('réseau');
      return { ok: true };
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(sent.map((s) => [s.method, s.payload.voice ?? s.payload.text]), [
    ['sendVoice', 'FILE23'],
    ['sendMessage', 'Id invalide : abc.'],
    ['sendMessage', 'Vocal id 99 inconnu.'],
    ['sendVoice', 'BAD'],
    ['sendMessage', 'Vocal id 30 illisible'],
    ['sendVoice', 'THROW'],
    ['sendMessage', 'Vocal id 31 illisible'],
    ['sendMessage', 'Vocal id 32 inconnu.'],
    ['sendVoice', 'FILE25'],
  ]);
  assert.ok(sent.every((s) => s.payload.chat_id === 111));
  assert.equal(sent.some((s) => s.payload.voice === 'VIDEO'), false);
  assert.ok(db.ops.every((op) => op.startsWith('select:support_assets:')));
  assert.equal(rows.every((r) => r.uses === (r.id === 32 ? 9 : r.id === 25 ? 3 : r.id === 23 ? 7 : 1)), true);
});

test('le handler Telegram garde les mêmes contrôles et le chat du message', async () => {
  const prev = {
    owners: process.env.OWNER_TG_IDS,
    admins: process.env.ADMIN_TG_USERNAMES,
    recorder: process.env.SUPPORT_VOICE_RECORDER,
    token: process.env.TELEGRAM_BOT_TOKEN,
    retry: process.env.SUPPORT_TG_SEND_RETRY,
  };
  process.env.OWNER_TG_IDS = '111';
  delete process.env.ADMIN_TG_USERNAMES;
  process.env.SUPPORT_VOICE_RECORDER = 'on';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-not-a-secret';
  delete process.env.SUPPORT_TG_SEND_RETRY;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(input).split('/').pop() ?? '';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ method, body });
    if (method === 'sendVoice' && body.voice === 'BAD') {
      return new Response(JSON.stringify({ ok: false, description: 'bad file' }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  }) as typeof fetch;
  const row = { id: 23, kind: 'faq_voice', situation: 'refus_not_partner', file_id: 'FILE23', chat_id: 999001, uses: 7, message_id: 55 };
  const db = memoryDb([row]);
  try {
    const played = await handleVoiceRecorderCommand(db, owner('/play_voice 23'));
    assert.equal(played, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'sendVoice');
    assert.equal(calls[0].body.chat_id, 111);
    assert.equal(calls[0].body.voice, 'FILE23');
    assert.equal(calls[0].body.caption, 'id 23 · refus_not_partner (faq_voice)');
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['caption', 'chat_id', 'voice']);
    assert.equal(row.uses, 7);
    assert.ok(db.ops.every((op) => op.startsWith('select:')));

    const beforeDeny = calls.length;
    const denied = await handleVoiceRecorderCommand(db, owner('/play_voice 23', 222));
    assert.equal(denied, false);
    const grouped = await handleVoiceRecorderCommand(db, {
      text: '/play_voice 23', chat: { type: 'group', id: -100 }, from: { id: 111 },
    });
    assert.equal(grouped, false);
    assert.equal(calls.length, beforeDeny);

    calls.length = 0;
    delete process.env.SUPPORT_VOICE_RECORDER;
    const stopped = await handleVoiceRecorderCommand(memoryDb([row]), owner('/play_voice 23'));
    assert.equal(stopped, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'sendMessage');
    assert.equal(calls[0].body.text, OFF);
    assert.equal(calls[0].body.chat_id, 111);
    assert.equal(calls.some((c) => c.method === 'sendVoice'), false);
  } finally {
    globalThis.fetch = previousFetch;
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('OWNER_TG_IDS', prev.owners);
    restore('ADMIN_TG_USERNAMES', prev.admins);
    restore('SUPPORT_VOICE_RECORDER', prev.recorder);
    restore('TELEGRAM_BOT_TOKEN', prev.token);
    restore('SUPPORT_TG_SEND_RETRY', prev.retry);
  }
});
