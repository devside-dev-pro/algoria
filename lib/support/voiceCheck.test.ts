// Vérification script ↔ vocal. STT simulé : aucun appel réseau, aucun envoi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_SCRIPTS } from './voiceScripts';
import {
  DEFAULT_STT_THRESHOLD, STT_FAIL_NOTICE, STT_SKIP_LOG, allScriptRefs, assessRecording, compareTranscript,
  envOn, mismatchAlert, parseSttThreshold, sttCheckEnabled, tokenSimilarity, type ScriptRef,
} from './voiceCheck';

const tiny: ScriptRef[] = [
  { n: 1, key: 'faq_how_it_works', title: 'How it works', script: 'algoria trades gold on your own account open the app' },
  { n: 2, key: 'faq_broker', title: 'Broker', script: 'open a partner broker account through the link raise fx bonus' },
];

test('SUPPORT_VOICE_STT_CHECK coupé par défaut, seuil 0,6', () => {
  for (const v of [undefined, null, '', 'off', '0', 'false', 'no']) assert.equal(envOn(v), false);
  assert.equal(sttCheckEnabled('off'), false);
  assert.equal(sttCheckEnabled('on'), true);
  assert.equal(DEFAULT_STT_THRESHOLD, 0.6);
  assert.equal(parseSttThreshold(undefined), 0.6);
  assert.equal(parseSttThreshold(''), 0.6);
  assert.equal(parseSttThreshold('nope'), 0.6);
  assert.equal(parseSttThreshold('0'), 0.6);
  assert.equal(parseSttThreshold('1.2'), 0.6);
  assert.equal(parseSttThreshold('0.75'), 0.75);
});

test('similarité : le même texte vaut 1, un autre script est reconnu', () => {
  assert.equal(tokenSimilarity(tiny[0].script, tiny[0].script), 1);
  assert.ok(tokenSimilarity(tiny[0].script, tiny[1].script) < 0.6);
  const same = compareTranscript(tiny[0].script, tiny[0], tiny, 0.6);
  assert.equal(same.ok, true);
  const other = compareTranscript(tiny[1].script, tiny[0], tiny, 0.6);
  assert.equal(other.ok, false);
  if (!other.ok) {
    assert.equal(other.best?.n, 2);
    assert.match(mismatchAlert(tiny[0], other.score, other.best), /script 1 — How it works/);
    assert.match(mismatchAlert(tiny[0], other.score, other.best), /script 2 — Broker/);
    assert.match(mismatchAlert(tiny[0], other.score, other.best), /similarité \d+ %/);
  }
});

test('les 18 scripts : une transcription exacte colle au bon numéro', () => {
  const all = allScriptRefs();
  assert.equal(all.length, 18);
  const expected = all[0];
  const hit = compareTranscript(VOICE_SCRIPTS[0].script, expected, all, 0.6);
  assert.equal(hit.ok, true);
  const neighbour = compareTranscript(VOICE_SCRIPTS[1].script, expected, all, 0.6);
  assert.equal(neighbour.ok, false);
  if (!neighbour.ok) assert.equal(neighbour.best?.n, 2);
});

test('drapeau coupé ou clé absente : pas d’appel STT, enregistrement comme avant', async () => {
  let calls = 0;
  const logs: string[] = [];
  const transcribe = async () => { calls++; return { ok: true as const, text: 'nope' }; };
  const base = { fileId: 'f', expected: tiny[0], all: tiny, threshold: 0.6, transcribe, log: (m: string) => logs.push(m) };
  const off = await assessRecording({ ...base, enabled: false, hasKey: true });
  const nokey = await assessRecording({ ...base, enabled: true, hasKey: false });
  assert.equal(calls, 0);
  assert.equal(off.action, 'save');
  assert.equal(nokey.action, 'save');
  assert.ok(logs.every((l) => l === STT_SKIP_LOG));
});

test('correspondance : on enregistre, sans alerte', async () => {
  const r = await assessRecording({
    enabled: true, hasKey: true, fileId: 'f', expected: tiny[0], all: tiny, threshold: 0.6,
    transcribe: async () => ({ ok: true, text: tiny[0].script }),
  });
  assert.equal(r.action, 'save');
  assert.equal(r.notice, undefined);
});

test('écart vers le script voisin : on ne sauve pas, l’alerte cite les deux', async () => {
  const r = await assessRecording({
    enabled: true, hasKey: true, fileId: 'f', expected: tiny[0], all: tiny, threshold: 0.6,
    transcribe: async () => ({ ok: true, text: tiny[1].script }),
  });
  assert.equal(r.action, 'hold');
  if (r.action === 'hold') {
    assert.equal(r.bestN, 2);
    assert.match(r.notice, /script 1 — How it works/);
    assert.match(r.notice, /script 2 — Broker/);
    assert.match(r.notice, /Rien n’est enregistré/);
  }
});

test('échec STT : on enregistre quand même et on le dit', async () => {
  const r = await assessRecording({
    enabled: true, hasKey: true, fileId: 'f', expected: tiny[0], all: tiny, threshold: 0.6,
    transcribe: async () => { throw new Error('timeout'); },
  });
  assert.deepEqual(r, { action: 'save', failed: true, notice: STT_FAIL_NOTICE });
});
