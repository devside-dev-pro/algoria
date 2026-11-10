// Tests de la banque de vocaux FAQ (lib/member/faqVoice.ts) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAQ_CARD_ONLY, FAQ_LABELS, FAQ_LINES, FAQ_MIN_CONFIDENCE, FAQ_TOPICS, classifyFaq, faqCardButton, faqKeyboard,
  faqRecentlySent, faqVoiceDecision, parseAssetCallback, tagFaqVoice, type FaqClass, type FaqContext,
} from './faqVoice';
import { MYFXBOOK_URL } from './myfxbook';

const high = (t: string) => { const c = classifyFaq(t); return c.confidence >= FAQ_MIN_CONFIDENCE ? c.topic : null; };

test('détection : une question type par thème passe le seuil', () => {
  const cases: Array<[string, string]> = [
    ['Hello how does this work?', 'faq_how_it_works'],
    ['I am in the UK, which broker do you use?', 'faq_broker'],
    ["What's the minimum deposit?", 'faq_deposit'],
    ['Is it really free?', 'faq_cost_free'],
    ['How do I connect my MT5?', 'faq_connect'],
    ['Do you have any records on Myfxbook?', 'faq_results_myfxbook'],
    ['Which currency it trades, just gold?', 'faq_gold_only'],
    ['How are the withdrawals?', 'faq_withdraw_30d'],
    ['What lot size should I use?', 'faq_risk_lots'],
    ["I can't upload my documents for KYC", 'faq_kyc_raisefx'],
    ["I can't open the app", 'faq_app_login'],
    ['No trades yet on my account', 'faq_not_copying_yet'],
    ['Any updates on the incident?', 'faq_incident'],
  ];
  for (const [text, topic] of cases) assert.equal(high(text), topic, `« ${text} » → ${JSON.stringify(classifyFaq(text))}`);
});

test('seuil : deux questions, message long ou simple mot-clé = pas de vocal', () => {
  assert.equal(high('What is the minimum deposit and how do I connect my MT5?'), null);
  assert.equal(high('broker'), null); // mot-clé faible seul : 0,55
  const long = `${'I have been looking at many trading bots for a long time and I am not sure about anything. '.repeat(6)}How does it work?`;
  assert.ok(long.length > 500);
  assert.equal(high(long), null);
  assert.equal(classifyFaq('').topic, null);
  assert.equal(classifyFaq('Thanks bro 🙏').topic, null);
});

test('seuil : les mots-clés voisins de la même famille ne cassent pas la confiance', () => {
  assert.equal(high('What is the minimum to start with RaiseFX?'), 'faq_deposit');
  assert.equal(high('How do I connect my account in the app?'), 'faq_connect');
});

test('les messages tout faits de l’app et les identifiants ne déclenchent jamais de vocal', () => {
  assert.equal(classifyFaq('I already have the app, how do I get connected now ? 🙏🏼').topic, null);
  assert.equal(classifyFaq('how do I connect? my password: Abc123!').topic, null);
  assert.equal(classifyFaq('token = 8f7e6d').topic, null);
});

test('garde-fou incident : seulement si l’incident est explicitement évoqué', () => {
  assert.equal(high('What happened in October with the accounts?'), 'faq_incident');
  assert.equal(high('My account was blown, what happened?'), 'faq_incident');
  // pas explicite : ni vocal incident, ni vocal d'un autre thème sous un message qui parle de pertes
  assert.equal(classifyFaq('I lost money, how do withdrawals work?').topic, null);
  assert.equal(classifyFaq('Is this a scam? which broker?').topic, null);
  // « results » seul n'est jamais l'incident
  assert.notEqual(classifyFaq('Can you show me your results?').topic, 'faq_incident');
  // « stop loss » n'est pas une perte
  assert.equal(high('What lot size and stop loss do you use?'), 'faq_risk_lots');
});

const ok: FaqContext = { modelSure: true, reviewReason: null, webinarLead: false, beforeIntro: false, introJustSent: false, brokerLinkAsk: false, hasMedia: false, assetExists: true, recentlySent: false };
const cls = (topic: FaqClass['topic'], confidence = 0.9): FaqClass => ({ topic, confidence, scores: {} });

test('décision : auto seulement si tout est vert', () => {
  assert.equal(faqVoiceDecision(cls('faq_deposit'), ok).mode, 'auto');
  assert.equal(faqVoiceDecision(cls('faq_deposit', 0.75), ok).mode, 'none');
  assert.equal(faqVoiceDecision(cls(null, 0), ok).mode, 'none');
  assert.equal(faqVoiceDecision(cls('faq_deposit'), { ...ok, assetExists: false }).mode, 'none');
  assert.equal(faqVoiceDecision(cls('faq_deposit'), { ...ok, webinarLead: true }).mode, 'none');
  assert.equal(faqVoiceDecision(cls('faq_deposit'), { ...ok, beforeIntro: true }).mode, 'none');
  assert.equal(faqVoiceDecision(cls('faq_deposit'), { ...ok, introJustSent: true }).mode, 'none');
  assert.equal(faqVoiceDecision(cls('faq_broker'), { ...ok, brokerLinkAsk: true }).mode, 'none');
  assert.equal(faqVoiceDecision(cls('faq_deposit'), { ...ok, hasMedia: true }).mode, 'none');
});

test('décision : aucun garde-fou relâché (une carte reste une carte)', () => {
  const d = faqVoiceDecision(cls('faq_deposit'), { ...ok, reviewReason: 'sujet sensible (argent, plainte, paiement…)' });
  assert.equal(d.mode, 'card');
  assert.equal(faqVoiceDecision(cls('faq_deposit'), { ...ok, modelSure: false }).mode, 'card');
});

test('décision : incident et retraits ne partent jamais seuls', () => {
  assert.ok(FAQ_CARD_ONLY.has('faq_incident'));
  assert.equal(faqVoiceDecision(cls('faq_incident'), ok).mode, 'card');
  assert.equal(faqVoiceDecision(cls('faq_withdraw_30d'), ok).mode, 'card');
});

test('anti-spam : un thème par personne en 30 jours, 2 vocaux FAQ max en 24 h', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();
  assert.equal(faqRecentlySent([], 'faq_deposit', now), false);
  assert.equal(faqRecentlySent([{ created_at: ago(10), topic: 'faq_deposit' }], 'faq_deposit', now), true);
  assert.equal(faqRecentlySent([{ created_at: ago(31), topic: 'faq_deposit' }], 'faq_deposit', now), false);
  assert.equal(faqRecentlySent([{ created_at: ago(0.1), topic: 'faq_broker' }], 'faq_deposit', now), false);
  assert.equal(faqRecentlySent([{ created_at: ago(0.1), topic: 'faq_broker' }, { created_at: ago(0.2), topic: 'faq_connect' }], 'faq_deposit', now), true);
  assert.equal(faqVoiceDecision(cls('faq_deposit'), { ...ok, recentlySent: true }).mode, 'none');
});

test('lignes fixes : un libellé et une ligne par thème, liens autorisés seulement', () => {
  const allowed = [/^https:\/\/app\.getalgoria\.com(?:\/[a-z/]*)?$/, new RegExp(`^${MYFXBOOK_URL.replace(/[.?/]/g, '\\$&')}$`)];
  for (const t of FAQ_TOPICS) {
    assert.ok(FAQ_LABELS[t] && FAQ_LINES[t], t);
    for (const url of (FAQ_LINES[t].match(/https?:\/\/[^\s—]+/g) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ""))) assert.ok(allowed.some((re) => re.test(url)), `${t} : lien non autorisé ${url}`);
    // jamais demander un mot de passe ou un token
    assert.ok(!/\b(?:send|give|share|tell)\b[^.]*\b(?:password|token)\b/i.test(FAQ_LINES[t]) || /\bnever\b/i.test(FAQ_LINES[t]), t);
    // or uniquement : la crypto n'apparaît que pour dire « pas de crypto »
    if (/crypto|bitcoin|btc/i.test(FAQ_LINES[t])) assert.match(FAQ_LINES[t], /not crypto/i);
    // aucune promesse de résultat
    assert.ok(!/\bguaranteed? (?:profit|return)|you will (?:make|earn)\b/i.test(FAQ_LINES[t]), t);
  }
  // le seul lien de résultats est le Myfxbook officiel
  assert.ok(FAQ_LINES.faq_results_myfxbook.includes(MYFXBOOK_URL));
  assert.ok(FAQ_LINES.faq_incident.includes(MYFXBOOK_URL));
  assert.ok(!/refund|compensat/i.test(FAQ_LINES.faq_incident));
});

test('ingestion : boutons de thème et callbacks', () => {
  const kb = faqKeyboard({ id: 42, situation: 'faq_deposit', active: true });
  const all = kb.inline_keyboard.flat();
  assert.equal(all.filter((b) => b.callback_data.includes(':t:')).length, FAQ_TOPICS.length);
  assert.ok(all.some((b) => b.callback_data === 'sa:42:cv'));
  assert.ok(all.some((b) => b.callback_data === 'sa:42:x'));
  assert.ok(all.find((b) => b.callback_data === 'sa:42:t:faq_deposit')?.text.startsWith('✓ '));
  for (const b of all) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
  const card = faqCardButton(42, '0b6f7a52-2b0e-4c55-9d7b-6c1d2e3f4a5b', 'faq_deposit').inline_keyboard[0][0];
  assert.ok(Buffer.byteLength(card.callback_data) <= 64);
  assert.deepEqual(parseAssetCallback(card.callback_data), { id: 42, op: 'send', rowId: '0b6f7a52-2b0e-4c55-9d7b-6c1d2e3f4a5b' });
  assert.deepEqual(parseAssetCallback('sa:42:faq'), { id: 42, op: 'faq' });
  assert.deepEqual(parseAssetCallback('sa:42:cv'), { id: 42, op: 'country_voice' });
  assert.deepEqual(parseAssetCallback('sa:42:t:faq_broker'), { id: 42, op: 'topic', value: 'faq_broker' });
  assert.equal(parseAssetCallback('sa:42:t:faq_unknown'), null);
  // les anciens boutons de la bibliothèque marchent toujours
  assert.deepEqual(parseAssetCallback('sa:7:c:GB'), { id: 7, op: 'country', value: 'GB' });
  assert.deepEqual(parseAssetCallback('sa:7:s:new'), { id: 7, op: 'situation', value: 'new' });
  assert.deepEqual(parseAssetCallback('sa:7:x'), { id: 7, op: 'active', value: false });
  assert.deepEqual(parseAssetCallback('sa:7:on'), { id: 7, op: 'active', value: true });
  assert.equal(parseAssetCallback('bs:whatever'), null);
  const off = faqKeyboard({ id: 42, situation: 'faq_deposit', active: false }).inline_keyboard.flat();
  assert.deepEqual(off.map((b) => b.callback_data), ['sa:42:on']);
});

test('ingestion : un nouveau vocal sur un thème désactive l’ancien (pas de suppression), avant de s’activer', async () => {
  const ops: Array<{ table: string; op: string; patch?: unknown; filters: Array<[string, string, unknown]> }> = [];
  const db = {
    from(table: string) {
      const rec = { table, op: 'select', patch: undefined as unknown, filters: [] as Array<[string, string, unknown]> };
      const q = {
        update(p: unknown) { rec.op = 'update'; rec.patch = p; return q; },
        delete() { rec.op = 'delete'; return q; },
        select() { return q; },
        eq(c: string, v: unknown) { rec.filters.push(['eq', c, v]); return q; },
        neq(c: string, v: unknown) { rec.filters.push(['neq', c, v]); return q; },
        then(res: (v: unknown) => void) { ops.push(rec); res({ data: rec.op === 'update' && rec.filters.some((f) => f[0] === 'neq') ? [{ id: 3 }] : null, error: null }); },
      };
      return q;
    },
  };
  const r = await tagFaqVoice(db, 9, 'faq_deposit');
  assert.equal(r.replaced, 1);
  assert.equal(ops.length, 2);
  assert.ok(ops.every((o) => o.op === 'update' && o.table === 'support_assets'), 'jamais de suppression');
  assert.deepEqual(ops[0].patch, { active: false });
  assert.deepEqual(ops[0].filters, [['eq', 'kind', 'faq_voice'], ['eq', 'situation', 'faq_deposit'], ['eq', 'active', true], ['neq', 'id', 9]]);
  assert.deepEqual(ops[1].patch, { kind: 'faq_voice', situation: 'faq_deposit', lang: 'en', active: true });
  assert.deepEqual(ops[1].filters, [['eq', 'id', 9]]);
});
