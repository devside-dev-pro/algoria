// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/support-fiabilite.ts
//
// Sorties de modèle SIMULÉES. Aucun appel Anthropic, aucune base. Il montre le parseur, l'absence de fuite
// d'une raison d'échec d'un appel à l'autre, la règle résultats avant et après le 05/11, et que le lien
// Myfxbook du 27/10/2026 passe les garde-fous sans qu'un chiffre de résultat passe avec lui.
import { readFileSync } from 'node:fs';
import { HISTORY_RESULTS_NOTE, INCIDENT_NOTE, MYFXBOOK_URL, RESULTS_REPLY_NOTE, resultsPolicy } from '../../lib/member/incident';
import { assessModelOutput, buildDraftSystem, parseModelJson, settleAttempt } from '../../lib/member/replyDraft';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`ok  ${name}`);
    return;
  }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

const TRACK = 'REAL PAST RESULTS: the account did +12.4% in September. https://getalgoria.com/track-record';
const KNOWLEDGE = 'Ancien fait à ne pas citer : +40% et https://getalgoria.com/track-record pour les prospects.';
const GOOD = `The new version of Algoria AI started trading on 26 October on a new account, with new safeguards, a stop within 2 minutes, never more than 10 trades, and everything closes if the day reaches −5%. The track record is followed in full transparency by a third party on Myfxbook: ${MYFXBOOK_URL}`;

function sysOf(now: string, status: string | null, historyMaintenance: boolean, biz = true) {
  return buildDraftSystem({
    biz, locale: 'en', knowledge: KNOWLEDGE, memory: null, trackNow: TRACK, webinar: null,
    status, now: Date.parse(now), historyMaintenance,
  });
}

function held(now: string, status: string | null, biz = true) {
  return sysOf(now, status, true, biz);
}

// ── parseur ──────────────────────────────────────────────────────────────────
{
  const ok = parseModelJson('{"intent":"auto","reply":"Yes, the app is here."}');
  check('JSON valide', ok?.reply === 'Yes, the app is here.' && ok?.intent === 'auto');

  const nl = parseModelJson('{"intent":"auto","reply":"line one\nline two"}');
  check('retour à la ligne dans reply', nl?.reply === 'line one\nline two');

  const works = parseModelJson('{"intent":"auto","reply":"He said "it works" today."}');
  check('guillemets intérieurs « it works »', typeof works?.reply === 'string' && String(works.reply).includes('it works'));

  const yes = parseModelJson('{"intent":"auto","reply":"He said "yes", then we go."}');
  check('guillemets « yes », then', typeof yes?.reply === 'string' && String(yes.reply).includes('yes') && String(yes.reply).includes('then'));

  const empty = parseModelJson('{"intent":"auto","reply":""}');
  check('reply vide parsé', empty?.intent === 'auto' && empty?.reply === '');

  const fence = parseModelJson('```json\n{"intent":"skip","reply":""}\n```');
  check('balise markdown', fence?.intent === 'skip');

  const digest = parseModelJson('{"rules":[{"rule":"dire bonjour","from":1}]}');
  check('JSON du digest (rules) inchangé', Array.isArray(digest?.rules) && (digest?.rules as unknown[]).length === 1);

  check('déchet → null', parseModelJson('pas de json ici') === null);
  check('reply jamais fermé → null', parseModelJson('{"intent":"auto","reply":"this never ends') === null);
}

// ── 2e tentative, sans variable partagée ─────────────────────────────────────
{
  const src = readFileSync(new URL('../../lib/member/replyDraft.ts', import.meta.url), 'utf8');
  check('plus de lastIssue global', !src.includes('let lastIssue') && !src.includes('lastDraftIssue'));

  let releaseA!: () => void;
  const gateA = new Promise<void>((r) => { releaseA = r; });
  const a = settleAttempt<{ text: string } | null>('business', async (hint) => {
    if (!hint) {
      await gateA;
      return { value: null, issue: 'réponse vide du modèle' };
    }
    const own = /skip|empty/i.test(hint) && !/too long/i.test(hint);
    check('indice de A = reply vide, pas celui de B', own, hint);
    return { value: { text: 'ok' }, issue: null };
  });
  const b = settleAttempt<{ text: string } | null>('business', async (hint) => {
    if (!hint) {
      releaseA();
      return { value: null, issue: 'réponse trop longue' };
    }
    check('indice de B = trop longue', /too long/i.test(hint), hint);
    return { value: { text: 'short' }, issue: null };
  });
  const [ra, rb] = await Promise.all([a, b]);
  check('A et B ont chacun réessayé', ra.retried && rb.retried && ra.value?.text === 'ok' && rb.value?.text === 'short');

  let calls = 0;
  const bot = await settleAttempt('bot', async () => {
    calls++;
    return { value: null, issue: 'réponse vide du modèle' };
  });
  check('le bot ne réessaie pas', calls === 1 && bot.retried === false);
}

// ── politique résultats ──────────────────────────────────────────────────────
{
  const before = '2026-11-04T12:00:00Z';
  const at = '2026-11-05T00:00:01Z';
  const after = '2026-11-06T12:00:00Z';
  check('avant le 05/11, prospect → incident', resultsPolicy({ now: Date.parse(before), status: 'onboarding', historyMaintenance: true }) === 'incident');
  check('avant le 05/11, live → incident', resultsPolicy({ now: Date.parse(before), status: 'live', historyMaintenance: true }) === 'incident');
  check('juste après le 05/11, prospect + maintenance → maintenance', resultsPolicy({ now: Date.parse(at), status: null, historyMaintenance: true }) === 'maintenance');
  check('le 06/11, prospect + maintenance → maintenance', resultsPolicy({ now: Date.parse(after), status: 'onboarding', historyMaintenance: true }) === 'maintenance');
  check('le 06/11, live + maintenance → ouvert', resultsPolicy({ now: Date.parse(after), status: 'live', historyMaintenance: true }) === 'open');
  check('le 06/11, prospect sans maintenance → ouvert', resultsPolicy({ now: Date.parse(after), status: null, historyMaintenance: false }) === 'open');
}

// ── prompt ───────────────────────────────────────────────────────────────────
{
  check('RESULTS_REPLY_NOTE porte le Myfxbook et le 26 octobre', RESULTS_REPLY_NOTE.includes(MYFXBOOK_URL) && /26 October/.test(RESULTS_REPLY_NOTE) && /third party/i.test(RESULTS_REPLY_NOTE) && !RESULTS_REPLY_NOTE.includes('getalgoria.com/track-record') && !/few weeks/i.test(RESULTS_REPLY_NOTE));

  const inc = held('2026-11-04T12:00:00Z', null);
  check('avant le 05/11, politique incident', inc.policy === 'incident');
  check('avant le 05/11, le prompt a 85 %, Myfxbook, 26 octobre', inc.system.includes('85%') && inc.system.includes(MYFXBOOK_URL) && inc.system.includes('26 October'));
  check('avant le 05/11, ni +12.4 %, ni page, ni « you MAY quote »', !inc.system.includes('+12.4%') && !inc.system.includes('track-record') && !inc.system.includes('you MAY quote') && inc.system.includes(INCIDENT_NOTE.slice(0, 40)));

  const maint = held('2026-11-06T12:00:00Z', 'onboarding');
  check('après le 05/11, prospect → maintenance', maint.policy === 'maintenance');
  check('maintenance : 26 octobre, tiers, 85 %, perte non appelée maintenance', maint.system.includes('26 October') && maint.system.includes(MYFXBOOK_URL) && /third party/i.test(maint.system) && maint.system.includes('85%') && /never call that loss/i.test(maint.system));
  check('maintenance : pas les chiffres du track, pas la page, pas « few weeks »', !maint.system.includes('+12.4%') && !maint.system.includes('track-record') && !maint.system.includes('you MAY quote') && !/few weeks/i.test(maint.system) && maint.system.includes(HISTORY_RESULTS_NOTE.slice(0, 40)));
  check('le +40 % du knowledge n\'est pas dans les % autorisés', !maint.knownPct.includes('40%'));

  const live = held('2026-11-06T12:00:00Z', 'live');
  check('après le 05/11, live → ouvert, chiffres et page', live.policy === 'open' && live.system.includes('+12.4%') && live.system.includes('you MAY quote') && live.system.includes('track-record'));

  const opened = sysOf('2026-11-06T12:00:00Z', null, false);
  check('maintenance coupée → ouvert même pour un prospect', opened.policy === 'open' && opened.system.includes('+12.4%'));

  const bot = held('2026-11-06T12:00:00Z', null, false);
  check('bot de l\'app, prospect après le 05/11 : même retenue', bot.policy === 'maintenance' && bot.system.includes(MYFXBOOK_URL) && !bot.system.includes('+12.4%') && !bot.system.includes('track-record') && !bot.system.includes('you MAY quote'));
}

// ── garde-fous, dont le lien prévu ───────────────────────────────────────────
{
  const built = held('2026-11-06T12:00:00Z', null);
  const judge = (raw: string, userText: string, stopReason?: string) => assessModelOutput(raw, {
    biz: true, locale: 'en', sys: built.system, userText, holdResults: true, knowledge: KNOWLEDGE, knownPct: built.knownPct, stopReason,
  });

  const broken = judge('{"intent":"auto","reply":"He said "it works" and the app explains the steps."}', 'how do I start?');
  check('JSON aux guillemets cassés → brouillon', broken.draft != null && broken.issue === null && broken.draft!.text.includes('it works') && broken.draft!.auto === true);

  const vide = judge('{"intent":"auto","reply":""}', 'hello');
  check('reply vide → issue, pas de brouillon', vide.issue === 'réponse vide du modèle' && vide.draft === null);

  const skip = judge('{"intent":"skip","reply":""}', 'hi');
  check('skip vide accepté', skip.issue === null && skip.draft?.skip === true);

  const nl = judge('{"intent":"auto","reply":"All good\nthanks"}', 'how are you?');
  check('reply sur deux lignes', nl.issue === null && (nl.draft?.text.includes('All good') ?? false));

  const good = judge(JSON.stringify({ intent: 'auto', reply: GOOD }), 'what are your results?');
  check('réponse prévue (26/10 + Myfxbook, aucun chiffre de résultat) passe', good.issue === null && good.draft != null && good.draft.text.includes(MYFXBOOK_URL) && good.draft.auto === true, good.issue ?? '');
  console.log('--- réponse prévue ---');
  console.log(good.draft?.text ?? '(aucune)');
  console.log('--- fin ---');

  const invented = judge(JSON.stringify({ intent: 'auto', reply: `We did +40% and the link is ${MYFXBOOK_URL}` }), 'show me the results');
  check('+40 % refusé', invented.issue === 'pourcentage introuvable dans les faits' && invented.draft === null);

  const old = judge(JSON.stringify({ intent: 'auto', reply: `September was +12.4%. ${MYFXBOOK_URL}` }), 'results?');
  check('+12.4 % refusé', old.issue === 'pourcentage introuvable dans les faits');

  const page = judge(JSON.stringify({ intent: 'auto', reply: `See https://getalgoria.com/track-record and ${MYFXBOOK_URL}` }), 'track record?');
  check('page track record refusée', page.issue === 'lien du track record');

  const other = judge(JSON.stringify({ intent: 'auto', reply: 'Here it is: https://www.myfxbook.com/members/someone/other/1' }), 'proof of results');
  check('autre Myfxbook refusé', other.issue === 'lien de résultats non autorisé');

  const future = judge(JSON.stringify({ intent: 'auto', reply: `You will make money every week. ${MYFXBOOK_URL}` }), 'what are the results?');
  check('promesse de gains refusée', future.issue === 'parle de gains futurs' && future.draft === null);

  const eighty = judge(JSON.stringify({ intent: 'auto', reply: `We lost about 85%. ${MYFXBOOK_URL}` }), 'what are your results?');
  check('85 % sur une question de résultats refusé', eighty.issue === 'chiffre de résultat');

  const loss = judge(JSON.stringify({ intent: 'auto', reply: `On 21-22 October the main account lost about 85%. The new version started on 26 October. ${MYFXBOOK_URL}` }), 'what happened in October?');
  check('85 % gardé si on demande octobre', loss.issue === null && (loss.draft?.text.includes('85%') ?? false), loss.issue ?? '');

  const missing = judge(JSON.stringify({ intent: 'auto', reply: 'The new version started on 26 October on a new account, with new safeguards.' }), 'can you prove the results?');
  check('question de preuve sans le lien → refusé', missing.issue === 'lien myfxbook manquant');

  const named = judge(JSON.stringify({ intent: 'auto', reply: `I am Claude. ${MYFXBOOK_URL}` }), 'results');
  check('nom du modèle refusé', named.issue === 'nomme le modèle');

  const cut = judge('{"intent":"auto","reply":"The new version', 'what are your results?', 'max_tokens');
  check('max_tokens ne sauve pas un JSON coupé', cut.issue === 'réponse coupée (max_tokens)' && cut.draft === null);

  const refused = judge(JSON.stringify({ intent: 'auto', reply: GOOD }), 'results', 'refusal');
  check('refus du modèle', refused.issue === 'modèle a refusé');

  const openBuilt = held('2026-11-06T12:00:00Z', 'live');
  const openReply = 'The account did +12.4% in September. https://getalgoria.com/track-record Past results don\'t guarantee future results.';
  const open = assessModelOutput(JSON.stringify({ intent: 'auto', reply: openReply }), {
    biz: true, sys: openBuilt.system, userText: 'what are your results?', holdResults: false, knowledge: KNOWLEDGE, knownPct: openBuilt.knownPct,
  });
  check('mode ouvert : le vrai +12.4 % et la page passent, l\'avertissement n\'est pas une promesse', open.issue === null && (open.draft?.text.includes('+12.4%') ?? false) && (open.draft?.text.includes('track-record') ?? false), open.issue ?? '');
}

if (failed) {
  console.error(`\n${failed} contrôle(s) en échec`);
  process.exit(1);
}
console.log('\ntous les contrôles passent');
