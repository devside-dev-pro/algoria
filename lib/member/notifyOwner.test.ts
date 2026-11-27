// Diagnostic des alertes propriétaire. Aucun appel réseau : fetch et push sont injectés.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { pushFailureCode } from '../push/send';
import {
  OWNER_DIAGNOSTIC_MS,
  adminUsernameOrFilter,
  claimOwnerDiagnostic,
  formatOwnerDiagnostic,
  idsFromUsernameRows,
  maskChatId,
  notifyOwner,
  parseAdminUsernames,
  parseOwnerTgIds,
  resetOwnerDiagnosticLog,
  sanitizeTelegramDescription,
  type OwnerAlert,
} from './notifyOwner';

const CHAT = 111222333;
const TOKEN = 'test-token-not-a-secret';
const alert: OwnerAlert = { title: '🚨 MetaApi en panne', lines: ['Cause : test.'], tag: 'metaapi-owner', path: '/' };

function env(over: { token?: string; ownerIdsRaw?: string; adminUsernamesRaw?: string } = {}) {
  return {
    token: TOKEN,
    ownerIdsRaw: String(CHAT),
    adminUsernamesRaw: '',
    ...over,
  };
}

describe('diagnostic alerte propriétaire', { concurrency: false }, () => {
  test('les identifiants et les pseudos se parsent sans élargir qui est admin', () => {
    assert.deepEqual(parseOwnerTgIds('111, 222'), { ids: [111, 222], rejected: 0 });
    assert.deepEqual(parseOwnerTgIds('"333"'), { ids: [333], rejected: 0 });
    assert.deepEqual(parseOwnerTgIds('+444; 555'), { ids: [444, 555], rejected: 0 });
    assert.deepEqual(parseOwnerTgIds('1e2'), { ids: [], rejected: 1 });
    assert.deepEqual(parseOwnerTgIds('mathieu, 12'), { ids: [12], rejected: 1 });
    assert.deepEqual(parseOwnerTgIds(''), { ids: [], rejected: 0 });
    assert.deepEqual(parseOwnerTgIds('12, 12'), { ids: [12], rejected: 0 });

    const names = parseAdminUsernames('@Mathieu_Algoria, mathieu_algoria foo');
    assert.deepEqual(names.names, ['mathieu_algoria', 'foo']);
    assert.deepEqual(names.queryable, ['mathieu_algoria', 'foo']);
    assert.deepEqual(parseAdminUsernames('bad.name').queryable, []);
    assert.equal(adminUsernameOrFilter(['mathieu_algoria']), 'tg_username.ilike.mathieu_algoria');
    assert.equal(adminUsernameOrFilter(['mathieu_algoria']).includes('%'), false);
    assert.equal(adminUsernameOrFilter(['mathieu_algoria']).includes('*'), false);
  });

  test('un pseudo ne résout que la fiche exacte, quelle que soit la casse', () => {
    const names = ['mathieu_algoria'];
    assert.deepEqual(
      idsFromUsernameRows(names, [{ tg_id: CHAT, tg_username: 'Mathieu_Algoria' }]),
      [CHAT],
    );
    assert.deepEqual(
      idsFromUsernameRows(names, [{ tg_id: 42, tg_username: 'mathieuXalgoria' }]),
      [],
    );
    assert.deepEqual(
      idsFromUsernameRows(names, [{ tg_id: '0', tg_username: 'mathieu_algoria' }, { tg_id: '99', tg_username: 'autre' }]),
      [],
    );
    assert.equal(maskChatId(CHAT), '••••2333');
    assert.equal(maskChatId(CHAT).includes('111222'), false);
  });

  test('la description perd le token, l’URL et les longs identifiants', () => {
    const raw = 'voir https://api.telegram.org/bot123456:AAHabcdefghij/sendMessage chat 111222333';
    const cleaned = sanitizeTelegramDescription(raw);
    assert.equal(cleaned.includes('AAHabcdefghij'), false);
    assert.equal(cleaned.includes('api.telegram.org'), false);
    assert.equal(cleaned.includes('111222333'), false);
    assert.equal(cleaned.includes('[token]') || cleaned.includes('[url]'), true);
  });

  test('un push raté ne conserve que le code, pas l’URL de l’appareil', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/secret-endpoint';
    assert.equal(pushFailureCode({ statusCode: 410, message: endpoint, endpoint }), '410');
    assert.equal(pushFailureCode({ statusCode: '401', body: endpoint }), '401');
    assert.equal(pushFailureCode(new Error(endpoint)), 'reseau');
    const timeout = new Error('The operation was aborted');
    timeout.name = 'TimeoutError';
    assert.equal(pushFailureCode(timeout), 'delai');
    assert.equal(pushFailureCode(timeout).includes('aborted'), false);
  });

  test('la ligne dit le motif, masque le chat, et ne contient ni token ni identifiant complet', () => {
    const line = formatOwnerDiagnostic({
      tokenPresent: true,
      ownerIds: 1,
      ownerRejected: 2,
      adminUsernames: 1,
      adminResolved: 0,
      lookup: 'sans_base',
      failures: [{
        chat: maskChatId(CHAT),
        http: 403,
        errorCode: 403,
        description: sanitizeTelegramDescription("Forbidden: bot can't initiate conversation 123456:AAHabcdefghij 111222333"),
      }],
      pushAttempted: true,
      pushSubscriptions: 0,
      pushCodes: ['vapid_absent'],
    });
    assert.match(line, /token=oui/);
    assert.match(line, /owner_ids=1/);
    assert.match(line, /owner_illisibles=2/);
    assert.match(line, /admin_resolus=0\/1/);
    assert.match(line, /lookup=sans_base/);
    assert.match(line, /http=403/);
    assert.match(line, /error_code=403/);
    assert.match(line, /chat=••••2333/);
    assert.match(line, /push_subs=0/);
    assert.match(line, /push_codes=vapid_absent/);
    assert.equal(line.includes('AAHabcdefghij'), false);
    assert.equal(line.includes(TOKEN), false);
    assert.equal(line.includes(String(CHAT)), false);
    assert.equal(line.includes('\n'), false);
  });

  test('Telegram 403 : DM à 0, le chat part en entier, le log est masqué et ne se répète pas', async () => {
    resetOwnerDiagnosticLog();
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    const calls: Array<{ url: string; chat: unknown }> = [];
    let pushed = 0;
    try {
      const first = await notifyOwner(alert, {
        now: 1_000,
        env: env(),
        fetchImpl: async (url, init) => {
          const body = JSON.parse(String(init?.body)) as { chat_id?: unknown };
          calls.push({ url, chat: body.chat_id });
          return new Response(JSON.stringify({
            ok: false,
            error_code: 403,
            description: "Forbidden: bot can't initiate conversation with a user",
          }), { status: 403 });
        },
        push: async () => { pushed++; return { sent: 0, subscriptions: 0, errors: ['aucune_souscription'] }; },
      });
      assert.equal(first.dm, 0);
      assert.equal(first.push, 0);
      assert.equal(pushed, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].chat, CHAT);
      assert.equal(calls[0].url.includes(TOKEN), true);
      assert.match(first.diagnostic, /token=oui/);
      assert.match(first.diagnostic, /owner_ids=1/);
      assert.match(first.diagnostic, /admin_resolus=0\/0/);
      assert.match(first.diagnostic, /http=403/);
      assert.match(first.diagnostic, /error_code=403/);
      assert.match(first.diagnostic, /chat=••••2333/);
      assert.match(first.diagnostic, /push_subs=0/);
      assert.match(first.diagnostic, /push_codes=aucune_souscription/);
      assert.equal(first.diagnostic.includes(TOKEN), false);
      assert.equal(first.diagnostic.includes(String(CHAT)), false);
      assert.equal(logs.length, 1);
      assert.equal(logs[0].includes(TOKEN), false);
      assert.equal(logs[0].includes(String(CHAT)), false);
      assert.match(logs[0], /alerte propriétaire non délivrée/);

      logs.length = 0;
      await notifyOwner(alert, {
        now: 1_000 + OWNER_DIAGNOSTIC_MS - 1,
        env: env(),
        fetchImpl: async () => new Response(JSON.stringify({ ok: false, error_code: 403, description: 'chat not found' }), { status: 403 }),
        push: async () => ({ sent: 0, subscriptions: 0, errors: ['aucune_souscription'] }),
      });
      assert.equal(logs.length, 1, 'un motif différent part tout de suite');

      logs.length = 0;
      await notifyOwner(alert, {
        now: 1_000 + OWNER_DIAGNOSTIC_MS - 1,
        env: env(),
        fetchImpl: async () => new Response(JSON.stringify({ ok: false, error_code: 403, description: 'chat not found' }), { status: 403 }),
        push: async () => ({ sent: 0, subscriptions: 0, errors: ['aucune_souscription'] }),
      });
      assert.equal(logs.length, 0);

      await notifyOwner(alert, {
        now: 1_000 + 2 * OWNER_DIAGNOSTIC_MS - 1,
        env: env(),
        fetchImpl: async () => new Response(JSON.stringify({ ok: false, error_code: 403, description: 'chat not found' }), { status: 403 }),
        push: async () => ({ sent: 0, subscriptions: 0, errors: ['aucune_souscription'] }),
      });
      assert.equal(logs.length, 1);
    } finally {
      console.error = orig;
      resetOwnerDiagnosticLog();
    }
  });

  test('le runner silencieux ne double pas la ligne, un corps illisible ne fuite pas', async () => {
    resetOwnerDiagnosticLog();
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    const marker = 'SECRET-BODY-MARKER';
    try {
      const silent = await notifyOwner(alert, {
        silent: true,
        now: 5_000,
        env: env({ token: '' }),
        push: async () => ({ sent: 0, subscriptions: 0, errors: ['vapid_absent'] }),
      });
      assert.match(silent.diagnostic, /token=non/);
      assert.match(silent.diagnostic, /push_codes=vapid_absent/);
      assert.equal(logs.length, 0);

      const ugly = await notifyOwner(alert, {
        now: 6_000,
        env: env(),
        fetchImpl: async () => { throw new Error(`connect ${marker} https://api.telegram.org/bot${TOKEN}/sendMessage`); },
        push: async () => ({ sent: 0, subscriptions: 1, errors: ['401'] }),
      });
      assert.match(ugly.diagnostic, /description="reseau"/);
      assert.match(ugly.diagnostic, /http=absent/);
      assert.match(ugly.diagnostic, /push_subs=1/);
      assert.match(ugly.diagnostic, /push_codes=401/);
      assert.equal(ugly.diagnostic.includes(marker), false);
      assert.equal(ugly.diagnostic.includes(TOKEN), false);
      assert.equal(logs.some((l) => l.includes(marker) || l.includes(TOKEN)), false);

      const html = await notifyOwner(alert, {
        now: 7_000,
        env: env(),
        fetchImpl: async () => new Response(`<html>${marker}</html>`, { status: 500 }),
        push: async () => ({ sent: 0, subscriptions: 0, errors: ['aucune_souscription'] }),
      });
      assert.match(html.diagnostic, /http=500/);
      assert.match(html.diagnostic, /description="reponse_illisible"/);
      assert.equal(html.diagnostic.includes(marker), false);
      assert.equal(logs.some((l) => l.includes(marker)), false);

      const badId = await notifyOwner(alert, {
        now: 8_000,
        env: env({ ownerIdsRaw: 'not-a-number' }),
        fetchImpl: async () => { throw new Error(marker); },
        push: async () => ({ sent: 0, subscriptions: 0, errors: ['aucune_souscription'] }),
      });
      assert.match(badId.diagnostic, /owner_ids=0/);
      assert.match(badId.diagnostic, /owner_illisibles=1/);
      assert.match(badId.diagnostic, /tg=aucun_envoi/);
      assert.equal(badId.diagnostic.includes('not-a-number'), false);
      assert.equal(badId.diagnostic.includes(marker), false);
    } finally {
      console.error = orig;
      resetOwnerDiagnosticLog();
    }
  });

  test('un DM délivré n’envoie pas le push ; un délai ne recopie pas le message d’exception', async () => {
    resetOwnerDiagnosticLog();
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    let pushed = 0;
    try {
      const ok = await notifyOwner(alert, {
        now: 9_000,
        env: env({ ownerIdsRaw: `${CHAT}, ${CHAT + 1}` }),
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { chat_id?: number };
          if (body.chat_id === CHAT) return new Response(JSON.stringify({ ok: true }), { status: 200 });
          const err = new Error('The operation was aborted due to timeout SECRET-DELAY');
          err.name = 'TimeoutError';
          throw err;
        },
        push: async () => { pushed++; return { sent: 1, subscriptions: 1, errors: [] }; },
      });
      assert.equal(ok.dm, 1);
      assert.equal(ok.push, 0);
      assert.equal(pushed, 0);
      assert.match(ok.diagnostic, /description="delai"/);
      assert.match(ok.diagnostic, /push=non_tente/);
      assert.equal(ok.diagnostic.includes('SECRET-DELAY'), false);
      assert.equal(logs.length, 1);
      assert.match(logs[0], /envoi Telegram incomplet/);
    } finally {
      console.error = orig;
      resetOwnerDiagnosticLog();
    }
  });

  test('le plafond de 30 minutes est par motif', () => {
    resetOwnerDiagnosticLog();
    assert.equal(claimOwnerDiagnostic('x', 0), true);
    assert.equal(claimOwnerDiagnostic('x', OWNER_DIAGNOSTIC_MS - 1), false);
    assert.equal(claimOwnerDiagnostic('y', 10), true);
    assert.equal(claimOwnerDiagnostic('x', OWNER_DIAGNOSTIC_MS), true);
    resetOwnerDiagnosticLog();
  });
});
