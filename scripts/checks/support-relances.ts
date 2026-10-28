// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/support-relances.ts
//
// 28/10/2026, audit du support, partie fiabilité. Aucun appel Anthropic, aucune base, aucun envoi :
//   · le lot de messages : le dernier d'abord, un message de la veille passe en historique (tg 8036168859) ;
//   · le 2e essai : réponse vide (déjà là depuis #554), erreur passagère oui, délai dépassé et 400 non ;
//   · l'alerte « sans réponse » : réglage, ce qui compte comme répondu ou traité ;
//   · aucune temperature dans les appels Anthropic (#555).
import { readFileSync } from 'node:fs';
import { assessModelOutput, settleAttempt, transientModelError } from '../../lib/member/replyDraft';
import { BURST_GAP_MS, STALE_BATCH_MS, batchPromptText, splitBatch } from '../../lib/member/supportBatch';
import { UNANSWERED_DEFAULT_HOURS, parseAlertHours, unansweredChats, type ChatRow } from '../../lib/member/supportUnanswered';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`ok  ${name}`);
    return;
  }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  // ── 7. le lot : le dernier message d'abord ────────────────────────────────
  {
    // tg 8036168859 : « Uk » le 21/10, « Why I can't log in sir? » le 22/10 15:10 → la réponse commençait par « UK, nice »
    const lot = [
      { created_at: '2026-10-21T11:50:10Z', text: 'Uk' },
      { created_at: '2026-10-21T11:50:40Z', text: 'Am Portuguese but living in UK' },
      { created_at: '2026-10-22T10:55:30Z', text: 'I was waiting for the information from any of you' },
      { created_at: '2026-10-22T15:10:20Z', text: "Why I can't log in sir?" },
    ];
    const { fresh, stale } = splitBatch(lot);
    check('message de la veille (> 12 h) → historique', stale.length === 2 && fresh.length === 2 && fresh[fresh.length - 1].text.startsWith('Why'), JSON.stringify(stale));
    const p = batchPromptText(fresh);
    check('le dernier message est marqué LATEST', /LATEST \(answer this first\):\nWhy I can't log in sir\?$/.test(p) && p.indexOf('EARLIER') < p.indexOf('I was waiting'), p);
    check('« Uk » n\'est plus dans le texte du modèle', !/\bUk\b/.test(p));

    const burst = [
      { created_at: '2026-10-27T19:12:00Z', text: 'how' },
      { created_at: '2026-10-27T19:12:20Z', text: 'are' },
      { created_at: '2026-10-27T19:12:40Z', text: 'you ?' },
    ];
    check('une rafale reste UN message, sans étiquette', batchPromptText(burst) === 'how\nare\nyou ?');
    check('écart de rafale 5 min, historique 12 h', BURST_GAP_MS === 5 * 60_000 && STALE_BATCH_MS === 12 * 3_600_000);
    check('lot vide', splitBatch([]).fresh.length === 0 && batchPromptText([]) === '');
    const prompt = readFileSync('lib/member/replyDraft.ts', 'utf8');
    check('le prompt dit de répondre d\'abord au LATEST', /answer the LATEST first/.test(prompt));
  }

  // ── 6. le 2e essai ────────────────────────────────────────────────────────
  {
    const vide = assessModelOutput('{"intent":"auto","reply":""}', { biz: true, locale: 'en', sys: '', userText: 'did you close?', holdResults: false });
    check('réponse vide → issue « réponse vide du modèle »', vide.issue === 'réponse vide du modèle' && vide.draft === null);
    let calls = 0;
    const emptyThenOk = await settleAttempt<string>('business', async (hint) => (++calls === 1 ? { value: null, issue: 'réponse vide du modèle' } : { value: hint ? 'ok' : null, issue: hint ? null : 'sans indice' }));
    check('réponse vide → 2e essai avec l\'indice (#554)', emptyThenOk.value === 'ok' && emptyThenOk.retried && calls === 2);

    calls = 0;
    const over = await settleAttempt<string>('business', async () => (++calls === 1 ? { value: null, issue: 'modèle indisponible (529 {"type":"error","error":{"type":"overloaded_error"}})' } : { value: 'ok', issue: null }));
    check('529 surchargé → 2e essai', over.value === 'ok' && over.retried && calls === 2);

    calls = 0;
    const slow = await settleAttempt<string>('business', async () => { calls++; return { value: null, issue: 'modèle indisponible (Request timed out.)' }; });
    check('délai dépassé → pas de 2e essai (60 s de Vercel)', calls === 1 && !slow.retried);

    calls = 0;
    await settleAttempt<string>('business', async () => { calls++; return { value: null, issue: 'modèle indisponible (400 temperature: Extra inputs are not permitted)' }; });
    check('400 → pas de 2e essai', calls === 1);

    calls = 0;
    let t = 0;
    await settleAttempt<string>('business', async () => { calls++; t += 20_000; return { value: null, issue: 'modèle indisponible (503 Service Unavailable)' }; }, () => t);
    check('erreur passagère après 20 s → pas de 2e essai (budget)', calls === 1);

    calls = 0;
    await settleAttempt<string>('bot', async () => { calls++; return { value: null, issue: 'modèle indisponible (529 overloaded)' }; });
    check('bot de l\'app : inchangé, pas de 2e essai', calls === 1);
    check('transientModelError : connexion coupée oui, garde-fou non', transientModelError('modèle indisponible (Connection error.)') && !transientModelError('délai promis') && !transientModelError(null));

    const src = ['lib/member/replyDraft.ts', 'lib/member/supportAuto.ts', 'lib/member/supportBatch.ts', 'lib/member/supportUnanswered.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    check('aucun paramètre temperature (#555)', !/\btemperature\s*:/.test(src));
  }

  // ── 6. l'alerte « sans réponse » ──────────────────────────────────────────
  {
    check('réglage absent → 3 h', parseAlertHours(null) === UNANSWERED_DEFAULT_HOURS && UNANSWERED_DEFAULT_HOURS === 3);
    check('réglage « off » / « 0 » → coupé', parseAlertHours('off') === null && parseAlertHours(' OFF ') === null && parseAlertHours('0') === null);
    check('réglage « 2 », « 1,5 », « 100 », « abc »', parseAlertHours('2') === 2 && parseAlertHours('1,5') === 1.5 && parseAlertHours('100') === 48 && parseAlertHours('abc') === 3);

    const now = Date.parse('2026-10-28T12:00:00Z');
    const h = (x: number) => new Date(now - x * 3_600_000).toISOString();
    let n = 0;
    const row = (tg: number, ago: number, detail: Record<string, unknown>): ChatRow => ({ id: `r${++n}`, tg_id: tg, member_no: null, created_at: h(ago), detail });
    const rows: ChatRow[] = [
      row(1, 5, { from: 'client', text: 'how do I connect?', name: 'Sipho' }), // attend depuis 5 h → alerte
      row(2, 6, { from: 'client', text: 'hi' }), row(2, 5.9, { from: 'owner', via: 'welcome', text: 'Hey…' }), // l'accueil ne répond à rien
      row(3, 5, { from: 'client', text: 'price?' }), row(3, 4.9, { from: 'owner', via: 'auto', text: 'It is free…' }), // répondu
      row(4, 5, { from: 'client', text: 'ok thanks', draft_intent: 'skip' }), // rien à répondre
      row(5, 5, { from: 'client', text: 'casino', draft_intent: 'spam' }),
      row(6, 5, { from: 'client', text: '[sticker 👍]' }),
      row(7, 1, { from: 'client', text: 'still there?' }), // 1 h : trop tôt
      row(8, 5, { from: 'client', text: 'card', draft_intent: 'review', draft_dismissed_at: h(4) }), // carte écartée
      row(9, 8, { from: 'client', text: 'q1' }), row(9, 7, { from: 'owner', done_by: 'mathieu', text: 'answer' }), row(9, 4, { from: 'client', text: 'and q2?', draft_intent: 'review' }), // carte ouverte → alerte
    ];
    const w = unansweredChats(rows, now, 3);
    check('alerte : en attente (5 h), accueil seul, carte ouverte', JSON.stringify(w.map((x) => x.tgId).sort()) === '[1,2,9]', JSON.stringify(w.map((x) => x.tgId)));
    check('non signalés : répondu, skip, spam, sticker, trop tôt, carte écartée', !w.some((x) => [3, 4, 5, 6, 7, 8].includes(x.tgId)));
    check('le plus ancien en premier', w[0].tgId === 9 || Date.parse(w[0].since) <= Date.parse(w[w.length - 1].since));
    check('seuil 6 h → seulement les plus anciens', unansweredChats(rows, now, 6).map((x) => x.tgId).join() === '2');

    const auto = readFileSync('lib/member/supportAuto.ts', 'utf8');
    check('branché sur la cron, toutes les 15 min', /getUTCMinutes\(\) % 15 === 1\) await runUnansweredAlert\(db\)/.test(auto));
    const un = readFileSync('lib/member/supportUnanswered.ts', 'utf8');
    check('alerte par notifyOwner, aucune écriture dans support_settings', /notifyOwner\(/.test(un) && !/from\('support_settings'\)\.(?:upsert|insert|update)/.test(un));
  }

  console.log(failed ? `\n${failed} contrôle(s) en échec` : '\ntous les contrôles passent');
  process.exit(failed ? 1 : 0);
}

void main();
