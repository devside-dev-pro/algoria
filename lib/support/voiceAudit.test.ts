// /check_voices : STT et envoi simulés. Aucune écriture, aucun prospect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkVoicesBlock, chunkLines, formatAuditRow, isCheckVoicesCommand, judgeAsset, loadActiveVoices, runCheckVoices, unrecordedScripts,
} from './voiceAudit';
import type { ScriptRef } from './voiceCheck';
import type { SttResult } from './voiceStt';

const scripts: ScriptRef[] = [
  { n: 1, key: 'faq_how_it_works', title: 'How it works', script: 'algoria trades gold on your own account open the app' },
  { n: 2, key: 'faq_broker', title: 'Broker / partner account', script: 'open a partner broker account through the link raise fx bonus' },
  { n: 3, key: 'faq_deposit', title: 'Deposit (minimum / how)', script: 'minimum deposit two hundred dollars fund the broker account' },
];

test('commande /check_voices, et message clair si le drapeau ou la clé manque', () => {
  assert.equal(isCheckVoicesCommand('/check_voices'), true);
  assert.equal(isCheckVoicesCommand('/check_voices@AlgoriaBot'), true);
  assert.equal(isCheckVoicesCommand('/check_voices now'), false);
  assert.match(checkVoicesBlock(false, false) ?? '', /SUPPORT_VOICE_STT_CHECK/);
  assert.match(checkVoicesBlock(false, false) ?? '', /ELEVENLABS_API_KEY/);
  assert.match(checkVoicesBlock(false, true) ?? '', /SUPPORT_VOICE_STT_CHECK/);
  assert.match(checkVoicesBlock(true, false) ?? '', /ELEVENLABS_API_KEY/);
  assert.equal(checkVoicesBlock(true, true), null);
});

test('verdicts : OK, ne correspond pas, incertain', () => {
  const ok = judgeAsset({ id: 10, situation: 'faq_how_it_works' }, { ok: true, text: scripts[0].script }, scripts, 0.6);
  assert.equal(ok.verdict, 'ok');
  assert.equal(ok.savedTitle, 'How it works');
  assert.match(formatAuditRow(ok), /10 · How it works · 1 — How it works · 100 % · ✅ OK/);

  const bad = judgeAsset({ id: 11, situation: 'faq_how_it_works' }, { ok: true, text: scripts[1].script }, scripts, 0.6);
  assert.equal(bad.verdict, 'mismatch');
  assert.equal(bad.bestN, 2);
  assert.match(formatAuditRow(bad), /⚠️ ne correspond pas \(ressemble à 2\)/);

  const unsure = judgeAsset({ id: 12, situation: 'faq_deposit' }, { ok: false, reason: 'timeout' }, scripts, 0.6);
  assert.equal(unsure.verdict, 'uncertain');
  assert.match(formatAuditRow(unsure), /❓ incertain/);
});

test('scripts sans vocal, et découpe sous 4096', () => {
  const missing = unrecordedScripts(['faq_how_it_works'], scripts);
  assert.deepEqual(missing.map((s) => s.n), [2, 3]);
  const lines = Array.from({ length: 80 }, (_, i) => `ligne ${i} ${'x'.repeat(80)}`);
  const parts = chunkLines(lines, 500);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 500));
  assert.equal(parts.join('\n'), lines.join('\n'));
});

test('parcours simulé : STT puis messages au propriétaire, lecture seule, dans l’ordre', async () => {
  const calls: string[] = [];
  const sent: Array<{ chatId: number; text: string }> = [];
  const ops: string[] = [];
  const rows = [
    { id: 4, kind: 'faq_voice', situation: 'faq_how_it_works', file_id: 'file-ok', lang: 'en', created_at: '2026-11-01' },
    { id: 9, kind: 'script_voice', situation: 'faq_broker', file_id: 'file-bad', lang: 'en', created_at: '2026-11-02' },
    { id: 2, kind: 'faq_voice', situation: 'faq_attente_5h9h', file_id: 'file-down', lang: 'en', created_at: '2026-11-03' },
  ];
  const db = {
    from(table: string) {
      const rec = { op: 'select', table };
      const q = {
        select() { rec.op = 'select'; return q; },
        eq() { return q; },
        in() { return q; },
        order() { return q; },
        limit() { return q; },
        update() { throw new Error('écriture interdite'); },
        insert() { throw new Error('écriture interdite'); },
        delete() { throw new Error('écriture interdite'); },
        upsert() { throw new Error('écriture interdite'); },
        then(res: (v: unknown) => void) { ops.push(`${rec.op}:${table}`); res({ data: rows, error: null }); },
      };
      return q;
    },
  };
  const transcribe = async (fileId: string): Promise<SttResult> => {
    calls.push(fileId);
    if (fileId === 'file-ok') return { ok: true, text: scripts[0].script };
    if (fileId === 'file-bad') return { ok: true, text: scripts[0].script };
    return { ok: false, reason: 'timeout' };
  };
  const token = 'super-secret-bot-token';
  await runCheckVoices({
    chatId: 111,
    enabled: true,
    hasKey: true,
    scripts,
    threshold: 0.6,
    loadAssets: () => loadActiveVoices(db),
    transcribe,
    send: async (chatId, text) => { sent.push({ chatId, text }); },
  });
  assert.deepEqual(calls, ['file-down', 'file-ok', 'file-bad']);
  assert.deepEqual(ops, ['select:support_assets']);
  assert.ok(sent.every((m) => m.chatId === 111));
  const body = sent.map((m) => m.text).join('\n');
  assert.ok(body.includes('✅ OK'));
  assert.ok(body.includes('⚠️ ne correspond pas (ressemble à 1)'));
  assert.ok(body.includes('❓ incertain'));
  assert.ok(body.includes('3 — Deposit (minimum / how)'));
  assert.equal(body.includes(token), false);
  assert.ok(sent.every((m) => m.text.length <= 4096));

  sent.length = 0;
  calls.length = 0;
  await runCheckVoices({
    chatId: 111, enabled: false, hasKey: false, scripts, loadAssets: async () => { throw new Error('ne doit pas lire'); },
    transcribe, send: async (chatId, text) => { sent.push({ chatId, text }); },
  });
  assert.equal(calls.length, 0);
  assert.match(sent[0].text, /SUPPORT_VOICE_STT_CHECK/);
  assert.match(sent[0].text, /ELEVENLABS_API_KEY/);
});
