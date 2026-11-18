// Nouvel essai d'un envoi Telegram coupé (timeout / abort). Aucun message réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TG_RETRY_MAX, isRetryableTelegramFailure, outboundSendGate, runTelegramAttempts, telegramRetryDelayMs, tgSendRetryEnabled,
} from './tgRetry';

test('SUPPORT_TG_SEND_RETRY coupé par défaut', () => {
  for (const v of [undefined, null, '', 'off', '0', 'false']) assert.equal(tgSendRetryEnabled(v), false);
  assert.equal(tgSendRetryEnabled('on'), true);
});

test('seul un timeout ou un abort est retenté, pas un refus Telegram', () => {
  for (const d of ['The operation was aborted', 'TimeoutError', 'timed out', 'network error', 'fetch failed', 'socket hang up']) {
    assert.equal(isRetryableTelegramFailure(d), true, d);
  }
  for (const d of ['Forbidden: bot was blocked by the user', 'Bad Request: message is too long', 'chat not found', 'TELEGRAM_BOT_TOKEN missing', '']) {
    assert.equal(isRetryableTelegramFailure(d), false, d);
  }
});

test('délais bornés : 0 puis backoff, pas plus de TG_RETRY_MAX essais', () => {
  assert.equal(TG_RETRY_MAX, 3);
  assert.deepEqual([0, 1, 2].map(telegramRetryDelayMs), [0, 400, 1200]);
  assert.equal(telegramRetryDelayMs(5), 1200);
});

test('idempotence : déjà envoyé ou envoi en cours → pas un second envoi', () => {
  const now = 1_000_000;
  assert.equal(outboundSendGate({}, now), 'send');
  assert.equal(outboundSendGate({ answered_at: 'x' }, now), 'already_sent');
  assert.equal(outboundSendGate({ draft_sent_at: 'x' }, now), 'already_sent');
  assert.equal(outboundSendGate({ tg_send_lock: now - 1_000 }, now), 'in_flight');
  assert.equal(outboundSendGate({ tg_send_lock: now - 120_000 }, now), 'send');
});

test('retries : un succès n’est pas renvoyé ; un refus métier non plus ; un timeout est borné', async () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => { sleeps.push(ms); };
  let n = 0;
  const ok = await runTelegramAttempts(async () => ({ ok: true }), { enabled: true, method: 'sendMessage', sleep });
  assert.equal(ok.ok, true);
  assert.equal(sleeps.length, 0);

  n = 0;
  const blocked = await runTelegramAttempts(async () => { n++; return { ok: false, description: 'Forbidden: bot was blocked by the user' }; }, { enabled: true, method: 'sendMessage', sleep });
  assert.equal(n, 1);
  assert.equal(blocked.ok, false);

  n = 0;
  const sleeps2: number[] = [];
  const recovered = await runTelegramAttempts(async () => {
    n++;
    return n < 3 ? { ok: false, description: 'The operation was aborted' } : { ok: true };
  }, { enabled: true, method: 'sendVoice', sleep: async (ms) => { sleeps2.push(ms); } });
  assert.equal(recovered.ok, true);
  assert.equal(n, 3);
  assert.deepEqual(sleeps2, [400, 1200]);

  n = 0;
  const gaveUp = await runTelegramAttempts(async () => { n++; return { ok: false, description: 'timed out' }; }, { enabled: true, method: 'sendMessage', sleep: async () => {} });
  assert.equal(n, TG_RETRY_MAX);
  assert.equal(gaveUp.ok, false);

  n = 0;
  await runTelegramAttempts(async () => { n++; return { ok: false, description: 'timed out' }; }, { enabled: false, method: 'sendMessage', sleep: async () => {} });
  assert.equal(n, 1, 'drapeau coupé : un seul essai, comme avant');

  n = 0;
  await runTelegramAttempts(async () => { n++; return { ok: false, description: 'timed out' }; }, { enabled: true, method: 'answerCallbackQuery', sleep: async () => {} });
  assert.equal(n, 1, 'pas un envoi de contenu : pas de retry');
});
