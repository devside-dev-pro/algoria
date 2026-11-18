// GO LIVE : INVALID_ACCOUNT ne doit plus lancer la boucle join de ~50 s.
// Les réponses STH sont mockées — ce fichier n'appelle jamais l'API réelle.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.STH_PARTNER_LICENSE = 'license-test-value-DO-NOT-LOG';
process.env.STH_MASTER_ID = 'master-algoria';
process.env.STH_BASE_URL = 'https://sth.test.invalid';

const { sthConnectAndJoin } = await import('./sth');

const PASSWORD = 'MAIN-PASSWORD-NOT-INVESTOR-9f3c';
const REFUSED = 'identifiants refusés par STH : INVALID_ACCOUNT — vérifie le mot de passe principal (pas investor) et le nom exact du serveur.';
const BASE = 'https://sth.test.invalid';

const input = {
  userId: '652',
  login: 9000652,
  password: PASSWORD,
  server: 'Broker-Live-Exact',
  isMt4: false,
  lots: 0.01,
  strategy: 1,
};

type Json = Record<string, unknown>;

const realSetTimeout = globalThis.setTimeout;
const realDateNow = Date.now;
const realAbortTimeout = AbortSignal.timeout.bind(AbortSignal);

let clock = realDateNow();
Date.now = () => clock;
AbortSignal.timeout = (() => new AbortController().signal) as typeof AbortSignal.timeout;
globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
  // La boucle join attend 3 s entre deux essais. On l'avance pour qu'une régression
  // échoue tout de suite au lieu de bloquer le test ~50 s. Le code corrigé ne l'emprunte pas.
  if (ms === 3_000 && typeof fn === 'function') {
    clock += 3_000;
    return realSetTimeout(fn, 0, ...(args as []));
  }
  return realSetTimeout(fn as never, ms as never, ...(args as []));
}) as typeof setTimeout;

after(() => {
  globalThis.setTimeout = realSetTimeout;
  Date.now = realDateNow;
  AbortSignal.timeout = realAbortTimeout;
});

function installFetch(routes: Record<string, Json>) {
  const calls: string[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    assert.ok(href.startsWith(BASE), `appel hors mock : ${href}`);
    const route = href.slice(BASE.length);
    calls.push(route);
    const body = JSON.parse(String(init?.body ?? '{}')) as Json;
    assert.equal(body.MetatraderPassword, route.endsWith('connect-customer-copier') ? PASSWORD : undefined);
    const data = routes[route];
    assert.ok(data, `route STH non mockée : ${route}`);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return {
    calls,
    restore() { globalThis.fetch = prev; },
  };
}

function captureWarn() {
  const lines: string[] = [];
  const prev = console.warn;
  console.warn = (...args: unknown[]) => { lines.push(args.map((a) => String(a)).join(' ')); };
  return {
    lines,
    restore() { console.warn = prev; },
  };
}

function assertNoSecrets(lines: string[]) {
  const blob = lines.join('\n');
  assert.equal(blob.includes(PASSWORD), false, 'le journal ne doit pas contenir le mot de passe MT5');
  assert.equal(blob.includes('license-test-value-DO-NOT-LOG'), false, 'le journal ne doit pas contenir la licence');
  assert.equal(blob.includes('PartnerLicense'), false);
  assert.equal(blob.includes('MetatraderPassword'), false);
  assert.equal(blob.includes('Algoria Master NAME'), false, 'le journal ne doit pas contenir le corps du statut');
}

describe('sthConnectAndJoin', { concurrency: 1 }, () => {
  test('INVALID_ACCOUNT et pont non connecté : arrêt immédiat, message admin en français', async () => {
    const net = installFetch({
      '/Partner/connect-customer-copier': { errorMessage: 'INVALID_ACCOUNT' },
      // Statut pas ok + liste de masters non vide : l'ancien isApiKnown laissait passer et bouclait le join.
      '/Partner/get-user-status': {
        errorMessage: 'user not found',
        isTradingAccountConnected: false,
        tradingAccountConnected: false,
        masterAccountsList: [{ id: 'm-license', name: 'Algoria Master NAME' }],
      },
      '/Partner/join-master-account': { errorMessage: "MetaTrader account not connected, can't join this Master" },
    });
    const warn = captureWarn();
    const t0 = performance.now();
    try {
      const r = await sthConnectAndJoin(input);
      assert.ok(performance.now() - t0 < 1_500, 'ne doit pas attendre la boucle join');
      assert.deepEqual(r, { ok: false, error: REFUSED });
      assert.deepEqual(net.calls, ['/Partner/connect-customer-copier', '/Partner/get-user-status']);
      const statusLog = warn.lines.find((l) => l.includes('[sth] get-user-status'));
      assert.ok(statusLog, `journal get-user-status manquant : ${warn.lines.join(' | ')}`);
      assert.match(statusLog, /UserID=652/);
      assert.match(statusLog, /ok=false/);
      assert.match(statusLog, /isTradingAccountConnected=false/);
      assert.match(statusLog, /tradingAccountConnected=false/);
      assert.match(statusLog, /masterAccountsList=1/);
      assert.match(statusLog, /errorMessage=user not found/);
      assert.equal(statusLog.includes('retry'), false);
      assertNoSecrets(warn.lines);
    } finally {
      net.restore();
      warn.restore();
    }
  });

  test('INVALID_ACCOUNT mais pont connecté : filet déjà enregistré, on joint le master', async () => {
    const net = installFetch({
      '/Partner/connect-customer-copier': { errorMessage: 'Invalid account' },
      '/Partner/get-user-status': {
        errorMessage: '',
        isTradingAccountConnected: true,
        masterAccountsList: [{ id: 'master-algoria', name: 'Algoria Master NAME' }],
      },
      '/Partner/join-master-account': { errorMessage: '' },
    });
    const warn = captureWarn();
    try {
      const r = await sthConnectAndJoin(input);
      assert.deepEqual(r, { ok: true, error: '' });
      assert.deepEqual(net.calls, [
        '/Partner/connect-customer-copier',
        '/Partner/get-user-status',
        '/Partner/join-master-account',
      ]);
      const statusLog = warn.lines.find((l) => l.includes('[sth] get-user-status'));
      assert.ok(statusLog, `journal get-user-status manquant : ${warn.lines.join(' | ')}`);
      assert.match(statusLog, /UserID=652/);
      assert.match(statusLog, /ok=true/);
      assert.match(statusLog, /isTradingAccountConnected=true/);
      assert.match(statusLog, /masterAccountsList=1/);
      assert.match(statusLog, /errorMessage=$/);
      assertNoSecrets(warn.lines);
    } finally {
      net.restore();
      warn.restore();
    }
  });

  test('connect réussi : join direct, sans sonder le statut', async () => {
    const net = installFetch({
      '/Partner/connect-customer-copier': { errorMessage: '' },
      '/Partner/join-master-account': { errorMessage: '' },
    });
    const warn = captureWarn();
    const t0 = performance.now();
    try {
      const r = await sthConnectAndJoin(input);
      assert.ok(performance.now() - t0 < 1_500);
      assert.deepEqual(r, { ok: true, error: '' });
      assert.deepEqual(net.calls, ['/Partner/connect-customer-copier', '/Partner/join-master-account']);
      assert.equal(warn.lines.some((l) => l.includes('[sth] get-user-status')), false);
      assertNoSecrets(warn.lines);
    } finally {
      net.restore();
      warn.restore();
    }
  });
});
