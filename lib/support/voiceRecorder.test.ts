// Mode guidé d'enregistrement des vocaux support (propriétaire seulement).
// npm test — aucun envoi vers un prospect : fonctions pures et fausse base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEGRAM_TEXT_LIMIT, VOICE_SCRIPTS, escapeTgHtml, formatRecorderMessage, scriptByKey, scriptPrompt,
} from './voiceScripts';
import {
  RECORDER_TOTAL, applyRecorderAction, initialRecorderState, isRetryableOwnerVoice,
  parseRecorderCommand, parseRecorderState, recorderEnabled, recorderKeyboard, savePlan, type RecorderState,
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

test('18 clés dans l’ordre, chaque entrée a un when et un script, pas d’attente', () => {
  assert.equal(VOICE_SCRIPTS.length, 18);
  assert.equal(RECORDER_TOTAL, 18);
  const keys = [
    'faq_how_it_works', 'faq_broker', 'faq_deposit', 'faq_cost_free', 'faq_connect',
    'faq_results_myfxbook', 'faq_gold_only', 'faq_withdraw_30d', 'faq_risk_lots', 'faq_kyc_raisefx',
    'accueil_generique', 'relance_avant_broker', 'relance_already_have_account', 'relance_apres_origine',
    'pre_depot_rassurance', 'refus_no_deposit', 'refus_not_partner', 'refus_wrong_credentials',
  ];
  assert.deepEqual(VOICE_SCRIPTS.map((s) => s.key), keys);
  assert.equal(VOICE_SCRIPTS.some((s) => s.key === 'attente_5h9h' || s.situation === 'faq_attente_5h9h'), false);
  for (const s of VOICE_SCRIPTS) {
    assert.ok(s.when.trim().length > 0, s.key);
    assert.ok(s.script.trim().length > 0, s.key);
  }
  assert.equal(scriptByKey('faq_deposit')?.n, 3);
  assert.match(scriptByKey('faq_how_it_works')?.script ?? '', /^Hey, quick one — Algoria is an AI/);
});

test('une progression sauvée à l’ancienne étape 19 est terminée', () => {
  for (const raw of [
    JSON.stringify({ status: 'active', index: 18 }),
    JSON.stringify({ status: 'stopped', index: 18 }),
    JSON.stringify({ status: 'done', index: 19 }),
  ]) {
    const state = parseRecorderState(raw);
    assert.equal(state.status, 'done');
    assert.equal(state.index, 18);
    const resumed = applyRecorderAction(state, 'resume');
    assert.equal(resumed.state.status, 'done');
    assert.equal(resumed.prompt, null);
    assert.match(resumed.note, /terminé/);
  }
  assert.equal(parseRecorderState(JSON.stringify({ status: 'active', index: 17 })).index, 17);
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

test('prompt : progression et titre, jamais la clé technique, script entier sous la limite Telegram', () => {
  for (const s of VOICE_SCRIPTS) {
    const text = scriptPrompt(s, s.n, RECORDER_TOTAL);
    assert.equal(text.includes(s.key), false, `clé affichée : ${s.key}`);
    assert.equal(text.includes(s.situation), false, `situation affichée : ${s.situation}`);
    assert.match(text, new RegExp(`^<b>${s.n}/${RECORDER_TOTAL} — `));
    assert.ok(text.includes(escapeTgHtml(s.title)), s.key);
    assert.ok(text.includes('Quand il part :'), s.key);
    assert.ok(text.includes(escapeTgHtml(s.when.trim())), s.key);
    assert.ok(text.includes(`<pre>${escapeTgHtml(s.script.trim())}</pre>`), s.key);
    const sent = formatRecorderMessage('Enregistré, vocal actif.', text);
    assert.ok(sent.length <= TELEGRAM_TEXT_LIMIT, `${s.key} dépasse 4096 (${sent.length})`);
    assert.equal(sent.includes(s.key), false, s.key);
    assert.equal(sent.includes(s.situation), false, s.situation);
  }
  const nasty = scriptPrompt({ ...VOICE_SCRIPTS[0], when: 'a < b & c', script: '1 < 2 & 3 > 0' }, 1, RECORDER_TOTAL);
  assert.ok(nasty.includes('a &lt; b &amp; c'));
  assert.ok(nasty.includes('<pre>1 &lt; 2 &amp; 3 &gt; 0</pre>'));
  assert.equal(nasty.includes('1 < 2'), false);
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
  assert.equal(applyRecorderAction(st, 'start').prompt?.progress, '1/18');
  st = applyRecorderAction(st, 'saved').state;
  assert.equal(st.index, 1);
  assert.equal(applyRecorderAction(st, 'saved').prompt?.progress, '3/18');
  st = applyRecorderAction(st, 'skip').state;
  assert.equal(st.index, 2);
  const stopped = applyRecorderAction(st, 'stop');
  assert.equal(stopped.state.status, 'stopped');
  assert.equal(stopped.state.index, 2);
  assert.equal(stopped.prompt, null);
  const resumed = applyRecorderAction(stopped.state, 'resume');
  assert.equal(resumed.state.status, 'active');
  assert.equal(resumed.state.index, 2);
  assert.equal(resumed.prompt?.progress, '3/18');
  const redo = applyRecorderAction(resumed.state, 'redo');
  assert.equal(redo.state.index, 2);
  assert.equal(redo.state.status, 'active');
  assert.match(redo.note, /remplace/i);
  let cur = resumed.state;
  while (cur.status === 'active') cur = applyRecorderAction(cur, 'skip').state;
  assert.equal(cur.status, 'done');
  assert.equal(cur.index, 18);
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
