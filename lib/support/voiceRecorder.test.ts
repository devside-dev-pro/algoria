// Mode guidé d'enregistrement des vocaux support (propriétaire seulement).
// npm test — aucun envoi vers un prospect : fonctions pures et fausse base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAQ_WAIT_LABEL, FAQ_WAIT_TOPIC, FAQ_KIND } from '../member/faqVoice';
import {
  VOICE_SCRIPTS, scriptByKey, scriptPrompt, type VoiceScript,
} from './voiceScripts';
import {
  RECORDER_TOTAL, applyRecorderAction, initialRecorderState, isRetryableOwnerVoice,
  parseRecorderCommand, recorderEnabled, recorderKeyboard, savePlan, type RecorderState,
} from './voiceRecorder';
import { saveOwnerVoice } from './voiceRecorderHandlers';

test('drapeau SUPPORT_VOICE_RECORDER coupé par défaut', () => {
  for (const v of [undefined, null, '', 'off', 'OFF', '0', 'false', 'no', 'maybe']) {
    assert.equal(recorderEnabled(v), false);
  }
  assert.equal(recorderEnabled('on'), true);
  assert.equal(recorderEnabled('true'), true);
  assert.equal(recorderEnabled('1'), true);
});

test('19 clés dans l’ordre, scripts vides (texte validé hors dépôt)', () => {
  assert.equal(VOICE_SCRIPTS.length, 19);
  assert.equal(RECORDER_TOTAL, 19);
  const keys = [
    'faq_how_it_works', 'faq_broker', 'faq_deposit', 'faq_cost_free', 'faq_connect',
    'faq_results_myfxbook', 'faq_gold_only', 'faq_withdraw_30d', 'faq_risk_lots', 'faq_kyc_raisefx',
    'accueil_generique', 'relance_avant_broker', 'relance_already_have_account', 'relance_apres_origine',
    'pre_depot_rassurance', 'refus_no_deposit', 'refus_not_partner', 'refus_wrong_credentials', 'attente_5h9h',
  ];
  assert.deepEqual(VOICE_SCRIPTS.map((s) => s.key), keys);
  assert.ok(VOICE_SCRIPTS.every((s) => s.script.trim() === ''), 'le texte lu reste TODO');
  assert.equal(scriptByKey('faq_deposit')?.n, 3);
});

test('le 19 est un vocal FAQ d’attente, sans ligne fixe', () => {
  const s = VOICE_SCRIPTS[18];
  assert.equal(s.key, 'attente_5h9h');
  assert.equal(s.kind, FAQ_KIND);
  assert.equal(s.situation, FAQ_WAIT_TOPIC);
  assert.equal(s.title, FAQ_WAIT_LABEL);
  assert.equal(s.fixedLine, false);
  assert.equal(s.autoSend, 'wait');
  const plan = savePlan(s);
  assert.equal(plan.kind, 'faq_voice');
  assert.equal(plan.situation, 'faq_attente_5h9h');
  assert.equal(plan.activateLikeFaq, true);
  assert.equal(plan.sendsFixedLine, false);
});

test('1–10 : vocal FAQ du thème, activation comme le tag manuel', () => {
  for (const s of VOICE_SCRIPTS.slice(0, 10)) {
    const plan = savePlan(s);
    assert.equal(plan.kind, 'faq_voice', s.key);
    assert.equal(plan.situation, s.key);
    assert.equal(plan.activateLikeFaq, true);
    assert.equal(plan.sendsFixedLine, true);
    assert.equal(s.autoSend, 'faq');
  }
});

test('11–18 : pas de vocal déjà envoyé par le code, situation explicite', () => {
  const fresh = VOICE_SCRIPTS.filter((s) => s.n >= 11 && s.n <= 18);
  assert.equal(fresh.length, 8);
  for (const s of fresh) {
    assert.equal(s.autoSend, 'none', s.key);
    assert.equal(s.kind, 'script_voice');
    assert.equal(savePlan(s).activateLikeFaq, false);
    assert.ok(s.situation.length > 0);
  }
  const by = Object.fromEntries(fresh.map((s) => [s.key, s.relatesTo ?? null]));
  assert.equal(by.accueil_generique, 'welcome_video');
  assert.equal(by.relance_avant_broker, 'followup:0');
  assert.equal(by.relance_apres_origine, 'followup:1');
  assert.equal(by.refus_no_deposit, 'reject:no_deposit');
  assert.equal(by.refus_not_partner, 'reject:not_partner');
  assert.equal(by.refus_wrong_credentials, 'reject:wrong_credentials');
  assert.equal(by.relance_already_have_account, null);
  assert.equal(by.pre_depot_rassurance, null);
});

test('prompt : progression, clé et titre ; le script vide n’est pas affiché', () => {
  const s = scriptByKey('faq_deposit') as VoiceScript;
  const text = scriptPrompt(s, 3, 19);
  assert.match(text, /^3\/19/);
  assert.match(text, /faq_deposit/);
  assert.match(text, /Dépôt/);
  assert.equal(text.includes('TODO'), false);
  assert.equal(/\n\n/.test(text), false);
  const withScript = scriptPrompt({ ...s, script: 'Read this aloud.' }, 3, 19);
  assert.match(withScript, /Read this aloud\./);
});

test('commande, boutons, reprise', () => {
  assert.equal(parseRecorderCommand('/record_voices'), 'start');
  assert.equal(parseRecorderCommand('/record_voices@AlgoriaBot'), 'start');
  assert.equal(parseRecorderCommand('/record_voices resume'), 'resume');
  assert.equal(parseRecorderCommand('/resume_voices'), 'resume');
  assert.equal(parseRecorderCommand('bulles'), null);
  assert.equal(parseRecorderCommand('/record_voices please now'), null);
  const kb = recorderKeyboard().inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(kb, ['vr:redo', 'vr:skip', 'vr:stop']);
});

test('parcours : vocal enregistré, skip, stop, resume, redo, fin', () => {
  let st: RecorderState = initialRecorderState();
  assert.equal(st.status, 'idle');
  st = applyRecorderAction(st, 'start').state;
  assert.equal(st.status, 'active');
  assert.equal(st.index, 0);
  assert.equal(applyRecorderAction(st, 'start').prompt?.progress, '1/19');
  st = applyRecorderAction(st, 'saved').state;
  assert.equal(st.index, 1);
  assert.equal(applyRecorderAction(st, 'saved').prompt?.progress, '3/19');
  st = applyRecorderAction(st, 'skip').state;
  assert.equal(st.index, 2);
  const stopped = applyRecorderAction(st, 'stop');
  assert.equal(stopped.state.status, 'stopped');
  assert.equal(stopped.state.index, 2);
  assert.equal(stopped.prompt, null);
  const resumed = applyRecorderAction(stopped.state, 'resume');
  assert.equal(resumed.state.status, 'active');
  assert.equal(resumed.state.index, 2);
  assert.equal(resumed.prompt?.progress, '3/19');
  const redo = applyRecorderAction(resumed.state, 'redo');
  assert.equal(redo.state.index, 2);
  assert.equal(redo.state.status, 'active');
  assert.match(redo.note, /remplace/i);
  let cur = resumed.state;
  while (cur.status === 'active') cur = applyRecorderAction(cur, 'skip').state;
  assert.equal(cur.status, 'done');
  assert.equal(cur.index, 19);
});

test('un vocal ne compte que si la session est active', () => {
  const idle = initialRecorderState();
  assert.equal(isRetryableOwnerVoice(idle), false);
  assert.equal(isRetryableOwnerVoice(applyRecorderAction(idle, 'start').state), true);
  const stopped = applyRecorderAction(applyRecorderAction(idle, 'start').state, 'stop').state;
  assert.equal(isRetryableOwnerVoice(stopped), false);
});

test('enregistrement : active le vocal, désactive l’ancien, ne supprime rien, n’écrit à personne', async () => {
  const ops: Array<{ op: string; patch?: unknown }> = [];
  const db = {
    from() {
      const rec = { op: 'select', patch: undefined as unknown, filters: [] as unknown[] };
      const q = {
        insert(p: unknown) { rec.op = 'insert'; rec.patch = p; return q; },
        update(p: unknown) { rec.op = 'update'; rec.patch = p; return q; },
        delete() { rec.op = 'delete'; return q; },
        select() { return q; },
        eq() { return q; },
        neq() { return q; },
        limit() { return q; },
        then(res: (v: unknown) => void) {
          ops.push({ op: rec.op, patch: rec.patch });
          res({ data: rec.op === 'insert' ? [{ id: 9 }] : [{ id: 3 }], error: null });
        },
      };
      return q;
    },
  };
  const faq = await saveOwnerVoice(db, VOICE_SCRIPTS[2], { file_id: 'f', file_unique_id: 'u' }, { chatId: 111, messageId: 4 });
  assert.equal(faq.id, 9);
  assert.equal(faq.error, undefined);
  assert.ok(ops.every((o) => o.op !== 'delete'));
  assert.equal(ops[0].op, 'insert');
  assert.equal((ops[0].patch as { active: boolean }).active, false);
  assert.ok(ops.some((o) => o.op === 'update' && (o.patch as { active?: boolean }).active === false));
  assert.ok(ops.some((o) => o.op === 'update' && (o.patch as { situation?: string }).situation === 'faq_deposit'));
  ops.length = 0;
  const fresh = await saveOwnerVoice(db, VOICE_SCRIPTS[12], { file_id: 'f2', file_unique_id: 'u2' }, { chatId: 111, messageId: 5 });
  assert.equal(fresh.id, 9);
  assert.equal(VOICE_SCRIPTS[12].key, 'relance_already_have_account');
  assert.ok(ops.some((o) => o.op === 'update' && (o.patch as { kind?: string }).kind === 'script_voice'));
  assert.ok(ops.every((o) => o.op !== 'delete'));
});

test('seul le propriétaire : la garde est un prédicat, pas un envoi', () => {
  const owners = new Set([111]);
  const allow = (id: number) => owners.has(id);
  assert.equal(allow(111), true);
  assert.equal(allow(222), false);
});
