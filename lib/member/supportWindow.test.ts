import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFaq, FAQ_MIN_CONFIDENCE } from './faqVoice';
import { hardRuleIssue, replyTextIssue } from './replyDraft';
import {
  FAQ_WAIT_KIND, FAQ_WAIT_TOPIC, WINDOW_AUTO_VIA, WINDOW_TOPIC_ALLOWLIST, WINDOW_WAIT_TEXT, WINDOW_WAIT_VIA,
  CLEAR_AUTO_TOPICS, REVIEW_HOLD_TEXT, chooseAutoBody, clearIntentBypass, clearIntentsEnabled, decideSupportWindow,
  dubaiDayStartMs, faqSheetFallbackEnabled, faqVoiceSingleTopicEnabled, howItWorksAfterWelcomeEnabled, howItWorksChain,
  howItWorksVoiceAllowed, isInSupportAutoWindow,
  isWindowTopic, parseSheetFlags, parseSupportAutoWindow, parseWindowTopics, reviewHoldingEnabled, sheetKnownPct,
  supportAutoWindowBounds, waitSentInWindow, windowReviewReason, type WindowConfig,
} from './supportWindow';

const on: WindowConfig = { enabled: true, start: '05:00', end: '09:00' };
const off: WindowConfig = { enabled: false, start: '05:00', end: '09:00' };

// 18/11/2026, instants UTC dont l'heure à Dubaï (UTC+4) est connue.
const at = (dubaiHm: string) => Date.parse(`2026-11-18T${dubaiHm}:00+04:00`);

const sheets = (ok: string[], body?: Record<string, string>) => {
  const s: Record<string, string> = { faq_auto_ok: ok.join(',') };
  for (const [k, v] of Object.entries(body ?? {})) s[`faq_sheet_${k}`] = v;
  return parseSheetFlags(s);
};

const how = 'How does Algoria work?';
const faqHow = classifyFaq(how);

describe('interrupteur et fenêtre', () => {
  test('coupé par défaut, y compris une valeur inconnue', () => {
    for (const v of [undefined, null, '', 'off', 'OFF', '0', 'false', 'no', 'maybe', '05:00']) {
      assert.equal(parseSupportAutoWindow(v).enabled, false);
    }
  });
  test('on / true / une plage HH:MM-HH:MM l’allument', () => {
    assert.deepEqual(parseSupportAutoWindow('on'), { enabled: true, start: '05:00', end: '09:00' });
    assert.equal(parseSupportAutoWindow('true').enabled, true);
    assert.deepEqual(parseSupportAutoWindow('06:30-08:00'), { enabled: true, start: '06:30', end: '08:00' });
  });
  test('bornes 05:00 incluse, 09:00 exclue, heure de Dubaï', () => {
    assert.equal(isInSupportAutoWindow(at('04:59'), on), false);
    assert.equal(isInSupportAutoWindow(at('05:00'), on), true);
    assert.equal(isInSupportAutoWindow(at('08:59'), on), true);
    assert.equal(isInSupportAutoWindow(at('09:00'), on), false);
    assert.equal(isInSupportAutoWindow(at('12:00'), on), false);
    assert.equal(isInSupportAutoWindow(at('05:00'), off), false);
  });
  test('debut de journée Dubaï = 20:00 UTC la veille (UTC+4, sans heure d’été)', () => {
    assert.equal(dubaiDayStartMs(at('05:00')), Date.parse('2026-11-17T20:00:00Z'));
    const b = supportAutoWindowBounds(at('07:00'), on);
    assert.equal(b.startMs, at('05:00'));
    assert.equal(b.endMs, at('09:00'));
  });
});

describe('liste blanche et fiches (sans contenu figé dans le code)', () => {
  test('les sujets hors liste sont refusés ; la liste env est filtrée', () => {
    assert.equal(isWindowTopic('faq_how_it_works'), true);
    assert.equal(isWindowTopic('faq_incident'), false);
    assert.equal(isWindowTopic('faq_withdraw_30d'), false);
    assert.equal(isWindowTopic('faq_app_login'), false);
    const only = parseWindowTopics('faq_broker, faq_incident, unknown');
    assert.deepEqual([...only], ['faq_broker']);
    assert.equal(parseWindowTopics('').size, WINDOW_TOPIC_ALLOWLIST.length);
  });
  test('auto_ok est faux tant qu’on n’a pas branché la fiche', () => {
    const empty = parseSheetFlags({});
    assert.equal(empty.faq_how_it_works.autoOk, false);
    assert.equal(empty.faq_how_it_works.body, null);
    const wired = parseSheetFlags({ faq_auto_ok: '{"faq_how_it_works":true,"faq_incident":true}', faq_sheet_faq_how_it_works: 'Short official answer.' });
    assert.equal(wired.faq_how_it_works.autoOk, true);
    assert.equal(wired.faq_how_it_works.body, 'Short official answer.');
    assert.equal(wired.faq_broker.autoOk, false);
    // un sujet sensible dans le JSON n'entre pas (liste fermée)
    assert.equal(wired.faq_incident, undefined);
  });
});

describe('relecture : argent, incident, accès, identifiants, KYC, ambigu', () => {
  test('les cas sensibles vont en relecture', () => {
    assert.equal(windowReviewReason('I already deposited 500', classifyFaq('I already deposited 500')), '« I already deposited »');
    assert.equal(windowReviewReason('My deposit was refused by the broker', classifyFaq('My deposit was refused')), 'dépôt refusé ou qui ne s’affiche pas');
    assert.equal(windowReviewReason('How do I withdraw my money?', classifyFaq('How do I withdraw my money?')), 'retrait / cash out');
    assert.equal(windowReviewReason('What happened in October with the accounts?', classifyFaq('What happened in October with the accounts?')), 'incident, pertes, remboursement ou plainte');
    assert.equal(windowReviewReason('Can you connect me to my MT5?', classifyFaq('Can you connect me to my MT5?')), 'demande d’accès ou de connexion manuelle');
    assert.equal(windowReviewReason('password is Abc123xyz', classifyFaq('password is Abc123xyz')), 'identifiants envoyés dans le chat');
    assert.equal(windowReviewReason('My KYC was rejected by RaiseFX', classifyFaq('My KYC was rejected by RaiseFX')), 'KYC refusé par le broker');
    assert.equal(windowReviewReason('Here is my passport, please check', classifyFaq('Here is my passport, please check')), 'documents d’identité dans le chat');
  });
  test('une question de parcours claire n’est pas sensible à elle seule', () => {
    assert.equal(windowReviewReason(how, faqHow), null);
    assert.equal(windowReviewReason('Which broker do you use in the UK?', classifyFaq('Which broker do you use in the UK?')), null);
    assert.equal(windowReviewReason("What's the minimum deposit?", classifyFaq("What's the minimum deposit?")), null);
    assert.equal(windowReviewReason('How do I connect my MT5?', classifyFaq('How do I connect my MT5?')), null);
  });
});

describe('décision dans la fenêtre', () => {
  const wired = sheets(['faq_how_it_works'], { faq_how_it_works: 'Algoria is an AI that trades gold. Open https://app.getalgoria.com and log in with Telegram.' });
  const base = { cfg: on, now: at('07:00'), text: how, faq: faqHow, modelSure: true, sheets: wired };

  test('hors fenêtre ou interrupteur coupé : outside, le chemin habituel reste', () => {
    assert.equal(decideSupportWindow({ ...base, cfg: off }).action, 'outside');
    assert.equal(decideSupportWindow({ ...base, now: at('09:00') }).action, 'outside');
  });
  test('vocal tagué : on envoie le vocal, pas le texte de la fiche', () => {
    const d = decideSupportWindow({ ...base, voiceExists: true });
    assert.equal(d.action, 'auto_voice');
    assert.equal(d.topic, 'faq_how_it_works');
    assert.equal(d.body, undefined);
  });
  test('pas de vocal, fiche branchée : texte seul', () => {
    const d = decideSupportWindow({ ...base, voiceExists: false });
    assert.equal(d.action, 'auto_text');
    assert.ok(d.body?.includes('app.getalgoria.com'));
  });
  test('auto_ok faux ou pas de contenu : relecture + attente, une seule fois par fenêtre', () => {
    const unwired = decideSupportWindow({ ...base, sheets: parseSheetFlags({}), voiceExists: true });
    assert.equal(unwired.action, 'review_wait');
    assert.match(unwired.reason, /auto_ok/);
    const again = decideSupportWindow({ ...base, sheets: parseSheetFlags({}), voiceExists: true, waitAlreadySent: true });
    assert.equal(again.action, 'review_silent');
  });
  test('confiance faible, modèle pas sûr, ou sujet hors liste : relecture', () => {
    assert.equal(decideSupportWindow({ ...base, modelSure: false }).action, 'review_wait');
    assert.equal(decideSupportWindow({ ...base, faq: { ...faqHow, confidence: FAQ_MIN_CONFIDENCE - 0.05 } }).action, 'review_wait');
    const inc = classifyFaq('Any updates on the incident?');
    assert.equal(decideSupportWindow({ ...base, text: 'Any updates on the incident?', faq: inc, sheets: sheets(['faq_how_it_works']) }).action, 'review_wait');
    const app = classifyFaq("I can't open the app");
    const d = decideSupportWindow({ ...base, text: "I can't open the app", faq: app, sheets: sheets(['faq_app_login'] as unknown as string[]) });
    assert.equal(d.action, 'review_wait');
    assert.match(d.reason, /hors liste|auto_ok|aucun thème/i);
  });
  test('identifiants, dépôt déjà fait, Mathieu déjà en ligne', () => {
    const cred = decideSupportWindow({ ...base, text: 'password is Secret12', faq: classifyFaq('password is Secret12') });
    assert.equal(cred.action, 'review_wait');
    assert.equal(cred.reason, 'identifiants envoyés dans le chat');
    const dep = decideSupportWindow({ ...base, text: 'I already deposited', faq: classifyFaq('I already deposited') });
    assert.equal(dep.action, 'review_wait');
    const hold = decideSupportWindow({ ...base, modelSure: false, manualHold: true });
    assert.equal(hold.action, 'review_silent');
  });
  test('anti-spam : un envoi dans la fenêtre compte, pas celui de la veille', () => {
    assert.equal(waitSentInWindow([at('07:10')], at('08:00'), on), true);
    assert.equal(waitSentInWindow([at('04:50')], at('07:00'), on), false);
    assert.equal(waitSentInWindow([Date.parse('2026-11-17T07:10:00+04:00')], at('07:00'), on), false);
  });
});

describe('texte d’attente et constantes du vocal 19', () => {
  test('le texte d’attente officiel n’a pas de délai chiffré et pointe vers l’app', () => {
    assert.ok(!/\b(?:in \d+|within \d+|before \d|in an hour|before 9)\b/i.test(WINDOW_WAIT_TEXT));
    assert.ok(WINDOW_WAIT_TEXT.includes('https://app.getalgoria.com'));
    assert.match(WINDOW_WAIT_TEXT, /don.?t send any passwords/i);
  });
  test('constantes d’enregistrement du vocal 19', () => {
    assert.equal(FAQ_WAIT_KIND, 'faq_voice');
    assert.equal(FAQ_WAIT_TOPIC, 'faq_attente_5h9h');
    assert.equal(WINDOW_WAIT_VIA, 'window_wait');
    assert.equal(WINDOW_AUTO_VIA, 'window_auto');
    assert.ok(FAQ_WAIT_TOPIC.startsWith('faq_'));
  });
});

describe('drapeaux des correctifs, tous coupés par défaut', () => {
  for (const fn of [faqSheetFallbackEnabled, reviewHoldingEnabled, clearIntentsEnabled, howItWorksAfterWelcomeEnabled, faqVoiceSingleTopicEnabled]) {
    test(`${fn.name} absent = coupé`, () => {
      for (const v of [undefined, null, '', 'off', '0', 'false', 'no']) assert.equal(fn(v), false);
      assert.equal(fn('on'), true);
    });
  }
});

describe('(b) intentions claires : ne plus tomber en « pas sûr »', () => {
  const opened = 'I have opened the account since yesterday';
  const faqOpened = classifyFaq(opened);
  test('drapeau coupé : le contournement est faux', () => {
    assert.equal(clearIntentBypass(opened, faqOpened, false), false);
    assert.equal(clearIntentBypass(how, faqHow, false), false);
  });
  test('compte déjà ouvert, comment ça marche, dépôt minimum, Myfxbook, connexion', () => {
    assert.equal(clearIntentBypass(opened, faqOpened, true), true);
    assert.equal(clearIntentBypass(how, faqHow, true), true);
    assert.equal(clearIntentBypass("What's the minimum deposit?", classifyFaq("What's the minimum deposit?"), true), true);
    assert.equal(clearIntentBypass('Do you have any records on Myfxbook?', classifyFaq('Do you have any records on Myfxbook?'), true), true);
    assert.equal(clearIntentBypass('How do I connect my MT5?', classifyFaq('How do I connect my MT5?'), true), true);
    const clear = CLEAR_AUTO_TOPICS as readonly string[];
    assert.ok(clear.includes('faq_existing_account'));
    assert.ok(!clear.includes('faq_activation'));
    assert.ok(!clear.includes('faq_withdraw_30d'));
  });
  test('les sujets sensibles restent en relecture, drapeau allumé ou non', () => {
    const cases = [
      'How do I withdraw my money?',
      'I already deposited 500',
      'My deposit was refused by the broker',
      'What happened in October with the accounts?',
      'I lost money last month',
      'I want a refund',
      'This is a scam',
      'password is Abc123xyz',
      'My KYC was rejected by RaiseFX',
      'Here is my passport, please check',
    ];
    for (const text of cases) {
      const faq = classifyFaq(text);
      assert.equal(clearIntentBypass(text, faq, true), false, text);
      assert.ok(windowReviewReason(text, faq), text);
    }
  });
  test('dans la fenêtre, une intention claire part même si le modèle n’est pas sûr', () => {
    const wired = sheets(['faq_how_it_works', 'faq_existing_account'], {
      faq_how_it_works: 'Algoria copies gold trades. Open https://app.getalgoria.com and log in with Telegram.',
      faq_existing_account: 'Now connect the account in the app: https://app.getalgoria.com/member/onboarding',
    });
    const baseClear = { cfg: on, now: at('07:00'), text: how, faq: faqHow, sheets: wired, voiceExists: false as boolean };
    const held = decideSupportWindow({ ...baseClear, modelSure: false, clearIntents: false });
    assert.equal(held.action, 'review_wait');
    const go = decideSupportWindow({ ...baseClear, modelSure: false, clearIntents: true });
    assert.equal(go.action, 'auto_text');
    assert.equal(go.body?.includes('app.getalgoria.com'), true);
    const voice = decideSupportWindow({ cfg: on, now: at('07:00'), text: how, faq: faqHow, modelSure: false, sheets: wired, voiceExists: true, clearIntents: true });
    assert.equal(voice.action, 'auto_voice');
    assert.equal(voice.body, undefined);
    const sensitive = decideSupportWindow({
      cfg: on, now: at('07:00'), text: 'How do I withdraw my money?', faq: classifyFaq('How do I withdraw my money?'),
      modelSure: false, sheets: wired, voiceExists: true, clearIntents: true,
    });
    assert.equal(sensitive.action, 'review_wait');
  });
});

describe('(a) fiche à la place de « pas de vocal » — vocal et texte jamais ensemble', () => {
  const body = 'Connect it in the app only.';
  test('drapeau coupé : le brouillon reste le texte, comme aujourd’hui hors fenêtre', () => {
    assert.equal(chooseAutoBody({ sheetFallback: false, autoOk: true, body, voiceExists: false, eligible: true }), 'draft');
  });
  test('drapeau allumé, pas de vocal, fiche branchée : texte seul', () => {
    assert.equal(chooseAutoBody({ sheetFallback: true, autoOk: true, body, voiceExists: false, eligible: true }), 'sheet');
  });
  test('un vocal actif gagne, la fiche ne part pas avec', () => {
    assert.equal(chooseAutoBody({ sheetFallback: true, autoOk: true, body, voiceExists: true, eligible: true }), 'voice');
  });
  test('pas éligible, ou fiche pas branchée : rien de ce chemin', () => {
    assert.equal(chooseAutoBody({ sheetFallback: true, autoOk: true, body, voiceExists: false, eligible: false }), 'none');
    assert.equal(chooseAutoBody({ sheetFallback: true, autoOk: false, body, voiceExists: false, eligible: true }), 'draft');
    assert.equal(chooseAutoBody({ sheetFallback: true, autoOk: true, body: '  ', voiceExists: false, eligible: true }), 'draft');
  });
});

describe('SUPPORT_FAQ_VOICE_SINGLE_TOPIC : vocal auto seulement pour un seul sujet clair', () => {
  const depositSheet = 'Recommended start is about $500 on your own broker account.';
  const wired = sheets(['faq_deposit', 'faq_broker', 'faq_cost_free', 'faq_how_it_works', 'faq_kyc_raisefx'], {
    faq_deposit: depositSheet,
    faq_broker: 'Open the app and tap the partner broker step.',
    faq_cost_free: 'Partner broker = free access.',
    faq_how_it_works: 'Algoria is an AI that trades gold.',
    faq_kyc_raisefx: 'Finish broker KYC first, then connect in the app.',
  });
  const atWindow = { cfg: on, now: at('07:00'), modelSure: true, sheets: wired, voiceExists: true };

  test('une question claire : le vocal part, interrupteur allumé', () => {
    const text = "What's the minimum deposit?";
    const faq = classifyFaq(text);
    assert.equal(faq.voiceFit, 'single');
    const d = decideSupportWindow({ ...atWindow, text, faq, strictSingleTopic: true });
    assert.equal(d.action, 'auto_voice');
    assert.equal(d.topic, 'faq_deposit');
  });

  test('dépôt + 400, ou broker + abonnement : pas de vocal, le texte de fiche part', () => {
    const text = "What's the minimum deposit and what about the 400?";
    const faq = classifyFaq(text);
    assert.equal(faq.voiceFit, 'multiple', JSON.stringify(faq));
    assert.ok(faq.confidence >= FAQ_MIN_CONFIDENCE, JSON.stringify(faq));
    const off = decideSupportWindow({ ...atWindow, text, faq, strictSingleTopic: false });
    assert.equal(off.action, 'auto_voice');
    const strict = decideSupportWindow({ ...atWindow, text, faq, strictSingleTopic: true });
    assert.equal(strict.action, 'auto_text');
    assert.equal(strict.body, depositSheet);
    assert.notEqual(strict.action, 'auto_voice');

    const broker = 'Which broker do you use and the subscription?';
    const faqBroker = classifyFaq(broker);
    assert.equal(decideSupportWindow({ ...atWindow, text: broker, faq: faqBroker, strictSingleTopic: false }).action, 'auto_voice');
    const textOnly = decideSupportWindow({ ...atWindow, text: broker, faq: faqBroker, strictSingleTopic: true });
    assert.equal(textOnly.action, 'auto_text');
    assert.match(textOnly.body ?? '', /broker/i);
  });

  test('dépôt + retrait, ou broker + prix + résultats : pas de vocal, relecture ou texte', () => {
    for (const text of [
      "What's the minimum deposit and how do I withdraw my money?",
      'Which broker do you use, is it free, and do you have any records on Myfxbook?',
    ]) {
      const faq = classifyFaq(text);
      assert.equal(faq.voiceFit, 'multiple', JSON.stringify(faq));
      for (const strictSingleTopic of [false, true]) {
        const d = decideSupportWindow({ ...atWindow, text, faq, strictSingleTopic });
        assert.notEqual(d.action, 'auto_voice', `${text} strict=${strictSingleTopic} ${d.action}`);
        assert.ok(d.action === 'auto_text' || d.action === 'review_wait' || d.action === 'review_silent', d.action);
      }
    }
  });

  test('un mot seul : pas de vocal. « kyc » partait seul avant, plus maintenant', () => {
    const text = 'kyc';
    const faq = classifyFaq(text);
    assert.equal(faq.voiceFit, 'ambiguous');
    assert.equal(decideSupportWindow({ ...atWindow, text, faq, strictSingleTopic: false }).action, 'auto_voice');
    const strict = decideSupportWindow({ ...atWindow, text, faq, strictSingleTopic: true });
    assert.notEqual(strict.action, 'auto_voice');
    assert.equal(strict.action, 'auto_text');
    assert.match(strict.body ?? '', /KYC/i);
    for (const word of ['broker', 'deposit', 'gold', 'results', 'free']) {
      const w = classifyFaq(word);
      assert.equal(w.voiceFit, 'ambiguous', word);
      assert.notEqual(decideSupportWindow({ ...atWindow, text: word, faq: w, strictSingleTopic: true }).action, 'auto_voice', word);
    }
  });

  test('sans fiche, un message ambigu ou mêlé va en relecture, pas en vocal', () => {
    const text = "What's the minimum deposit and what about the 400?";
    const faq = classifyFaq(text);
    const d = decideSupportWindow({
      ...atWindow, text, faq, strictSingleTopic: true,
      sheets: sheets(['faq_deposit']),
    });
    assert.equal(d.action, 'review_wait');
    assert.notEqual(d.action, 'auto_voice');
  });
});

describe('(d) « How does it work? » après l’accueil', () => {
  test('drapeau coupé : ce n’est pas un enchaînement', () => {
    assert.equal(howItWorksChain('How does it work?', false), false);
    assert.equal(howItWorksChain('How does Algoria work?', false), false);
  });
  test('drapeau allumé : seulement cette question, pas le dépôt ni le bonjour', () => {
    assert.equal(howItWorksChain('How does it work?', true), true);
    assert.equal(howItWorksChain('Hello how does this work?', true), true);
    assert.equal(howItWorksChain("What's the minimum deposit?", true), false);
    assert.equal(howItWorksChain('hi', true), false);
    assert.equal(howItWorksChain('How do I withdraw?', true), false);
  });
  test('vocal de l’enchaînement : une question claire seulement, si l’interrupteur single-topic est allumé', () => {
    const mixed = 'How does it work? Explain the process. Also gold.';
    const c = classifyFaq(mixed);
    assert.equal(c.topic, 'faq_how_it_works', JSON.stringify(c));
    assert.ok(c.confidence >= FAQ_MIN_CONFIDENCE, JSON.stringify(c));
    assert.equal(c.voiceFit, 'multiple', JSON.stringify(c));
    assert.equal(howItWorksChain(mixed, true), true);
    assert.equal(howItWorksVoiceAllowed(mixed, false), true);
    assert.equal(howItWorksVoiceAllowed(mixed, true), false);
    assert.equal(howItWorksVoiceAllowed('How does it work?', false), true);
    assert.equal(howItWorksVoiceAllowed('How does it work?', true), true);
    assert.equal(howItWorksVoiceAllowed('kyc', true), false);
  });
});

describe('(e) accusé de relecture sans délai promis', () => {
  test('le texte ne promet ni délai, ni heure, ni chiffre, et passe les règles dures', () => {
    assert.equal(/\bshortly\b|\bget back\b|\bin an hour\b|\b\d+\s*(?:h|min|hour|day)/i.test(REVIEW_HOLD_TEXT), false);
    assert.equal(/\b(?:today|tomorrow|monday|asap)\b/i.test(REVIEW_HOLD_TEXT), false);
    assert.equal(hardRuleIssue(REVIEW_HOLD_TEXT), null);
    assert.match(REVIEW_HOLD_TEXT, /don.?t send any passwords/i);
    assert.ok(REVIEW_HOLD_TEXT.includes('https://app.getalgoria.com'));
  });
  test('le texte d’attente historique de la fenêtre ne change pas', () => {
    assert.match(WINDOW_WAIT_TEXT, /get back to you shortly/i);
  });
});

describe('sheetKnownPct : % déjà présents dans une fiche validée', () => {
  const broker = 'I usually recommend RaiseFX — and with RaiseFX you can use the code ALGORIA100 for a +100% deposit bonus from the broker. That bonus is trading credit under RaiseFX’s own conditions, not cash you can withdraw and not a profit.';
  const risk = 'There’s also a daily safety rule: if the day reaches -5%, all positions are closed. That limits a bad day, it doesn’t remove the risk.';
  const issue = (text: string, knownPct: string[]) =>
    replyTextIssue(text, { biz: true, sys: '', userText: 'which broker?', holdResults: false, knowledge: null, knownPct })
    ?? hardRuleIssue(text);

  test('extrait les pourcentages de la fiche, pas le signe + ou −', () => {
    assert.deepEqual(sheetKnownPct(broker), ['100%']);
    assert.deepEqual(sheetKnownPct(risk), ['5%']);
    assert.deepEqual(sheetKnownPct('no percentages here'), []);
  });
  test('sans ces faits, les fiches broker et lot sont refusées ; avec, elles passent', () => {
    assert.equal(issue(broker, []), 'pourcentage introuvable dans les faits');
    assert.equal(issue(risk, []), 'pourcentage introuvable dans les faits');
    assert.equal(issue(broker, sheetKnownPct(broker)), null);
    assert.equal(issue(risk, sheetKnownPct(risk)), null);
  });
  test('un pourcentage ajouté en plus du texte validé reste refusé', () => {
    const invented = `${broker} You can expect 40% a month.`;
    assert.equal(issue(invented, sheetKnownPct(broker)), 'pourcentage introuvable dans les faits');
  });
});
