// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/support-garde-fous.ts
//
// 28/10/2026, audit du bot Support. Aucun appel Anthropic, aucune base : des réponses SIMULÉES, prises dans les
// vrais messages relevés par l'audit (14-28/10), passent par les règles dures. Chaque règle doit refuser sa phrase
// fautive ET laisser passer les bonnes réponses (la phrase de suivi, la réponse à une capture, la règle des 30 jours,
// le mot de passe dans l'app…), sinon on fabrique des cartes sans proposition.
import { readFileSync } from 'node:fs';
import { FOLLOW_UP_LINE, INCIDENT, INCIDENT_NOTE, INCIDENT_OTHER_NOTE, INCIDENT_PARAGRAPH, LOSSES_LINE, MYFXBOOK_URL, PAST_RESULTS_LINE, RESULTS_REPLY_NOTE, incidentReplyNote } from '../../lib/member/incident';
import { TRADER_PASSWORD_LINE, assessModelOutput, buildDraftSystem, fixOldDomain, hardRuleIssue, humanize, withPastDisclaimer } from '../../lib/member/replyDraft';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`ok  ${name}`);
    return;
  }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

const NOW = Date.parse('2026-10-28T12:00:00Z');
const refuses = (name: string, text: string, issue: string, before: string[] = []) => {
  const got = hardRuleIssue(text, { now: NOW, sentBefore: before });
  check(`refuse : ${name}`, got === issue, `attendu « ${issue} », obtenu « ${got} » pour : ${text}`);
};
const passes = (name: string, text: string, before: string[] = []) => {
  const got = hardRuleIssue(text, { now: NOW, sentBefore: before });
  check(`laisse passer : ${name}`, got === null, `refusé (${got}) : ${text}`);
};

// ── 1. délais et dédommagement ──────────────────────────────────────────────
refuses('« personally today » (#2456, 22/10)', 'Mathieu will get back to you personally today 🙏🏼', 'délai promis');
refuses('« contacting every affected member personally today » (#2740, 26/10)', 'Mathieu is contacting every affected member personally today.', 'délai promis');
refuses('« solutions in the next few days » (cartes 26-28/10)', "I contacted the broker and we should be able to find solutions in the next few days.", 'délai promis');
refuses('« in a few minutes »', "I'll check it in a few minutes bro", 'délai promis');
refuses('dédommagement', 'No worries, we will refund you.', 'promesse de dédommagement');
refuses('récupérer les fonds', "We're doing everything to help you recover the money.", 'promesse de dédommagement');
passes('FOLLOW_UP_LINE', FOLLOW_UP_LINE);
passes('« I can\'t promise a refund »', "I can't promise a refund, I'm sorry.");
passes('webinaire « this Wednesday »', 'The webinar is this Wednesday at 7pm, I will answer every question live there.');
passes('marché fermé le week-end', 'Gold is closed on Saturday and Sunday, trades start again on Monday.');

// ── 5. faits inventés ───────────────────────────────────────────────────────
refuses('« your identity is verified » (auto, 21/10, tg 977461880)', 'Perfect, your identity is verified, you can deposit now.', 'contenu d’image affirmé');
refuses('« your identity is approved » (20/10, tg 8850800869)', 'Great news, your identity is approved 🙏🏼', 'contenu d’image affirmé');
refuses('« he\'s looking at them right now » (#1812)', "Thanks, he's looking at them right now.", 'action affirmée');
refuses('« you actually gained £52 » (#1386)', 'If you check, you actually gained £52 over the week.', 'montant du client recalculé');
refuses('« failure in our system last night » (#106, 26/10)', 'There was a failure in our system last night, I am really sorry.', 'date de l’incident');
passes('réponse à une capture', "Thanks, I've received it, I'll check and get back to you.");
passes('« on 21-22 October »', 'The previous engine had an incident on 21-22 October, I am really sorry.');

// ── 3. mot de passe ─────────────────────────────────────────────────────────
refuses('« read-only for copying trades » (#3241, envoyé 21/10)', 'Algoria connects via your trader password (read-only for copying trades).', 'mot de passe en lecture seule');
refuses('« I\'ll need your MT login and trader password » (#507)', "I'll need your MT login and trader password too.", 'demande de mot de passe');
refuses('« send me your password »', 'Send me your password and I will connect it for you.', 'demande de mot de passe');
passes('TRADER_PASSWORD_LINE', TRADER_PASSWORD_LINE);
passes('connexion dans l\'app', 'Connect it in the app with your MT login, server and trader password.');
passes('« tell me when you\'ve entered your password »', "Tell me when you've entered your password in the app.");
passes('mot de passe investisseur en lecture seule', 'The investor password is the read-only one, Algoria needs the trader password.');

// ── 4. track record ─────────────────────────────────────────────────────────
refuses('« once it has a few weeks of real trades » (auto, 26/10, tg 6418653105)', "I'll share it once it has a few weeks of real trades.", 'track record promis plus tard');
refuses('« can\'t happen again »', 'This cannot happen again now.', 'ça ne se reproduira pas');
refuses('petit échantillon', 'Already 10 winning trades since Monday!', 'petit échantillon');
passes('LOSSES_LINE', `${LOSSES_LINE} ${MYFXBOOK_URL} ${PAST_RESULTS_LINE}`);
passes('règle des 30 jours', 'Keep the copy on for the first 30 days, that is the rule for the free access.');
{
  const t = withPastDisclaimer(`Here is the verified record: ${MYFXBOOK_URL}`);
  check('Myfxbook sans avertissement → ajouté', t.endsWith(PAST_RESULTS_LINE) && t.includes(MYFXBOOK_URL), t);
  const twice = withPastDisclaimer(`${MYFXBOOK_URL} Past results don't guarantee future results.`);
  check('avertissement déjà là → pas en double', twice.split(PAST_RESULTS_LINE).length === 2, twice);
  check('LOSSES_LINE survit à humanize (tiret simple)', humanize(LOSSES_LINE, true).includes('21-22 October'));
}

// ── 2. le paragraphe d'incident ─────────────────────────────────────────────
{
  const sent = "I'm really sorry for what happened, extra safeguards now run on Algoria AI. I contacted the broker about the incident and I'm waiting for their answer.";
  refuses('paragraphe d\'incident déjà envoyé (tg 7368510279, « 👋 » le 27/10)', 'Hey! Extra safeguards now run on Algoria AI and I contacted the broker.', 'paragraphe incident déjà envoyé', [sent]);
  refuses('phrase identique déjà envoyée', 'I contacted the broker about the incident and I am waiting for their answer!', 'paragraphe incident déjà envoyé', [sent]);
  refuses('phrase longue répétée telle quelle', 'Hey bro. The app shows every trade one by one in the History tab, wins and losses.', 'phrase déjà envoyée', ['The app shows every trade one by one in the History tab, wins and losses.']);
  passes('première fois', sent);
  passes('réponse aux prospects (2 minutes, −5 %) pas prise pour le paragraphe', 'New safeguards: a stop within 2 minutes.', [sent]);
  check('INCIDENT_PARAGRAPH reconnaît le texte réel', INCIDENT_PARAGRAPH.test(sent));
  check('note « autre sujet » : ne pas parler de l\'incident', /Do NOT mention the incident/.test(INCIDENT_OTHER_NOTE));
  check('note incident membre touché ≠ non touché', incidentReplyNote(true) !== incidentReplyNote(false) && incidentReplyNote(false).includes(LOSSES_LINE));
}

// ── 8. faits produit ────────────────────────────────────────────────────────
refuses('« gold and crypto » (auto, 27/10, tg 2074541052)', 'Algoria AI trades gold and crypto, 24/7.', 'actif non tradé (crypto)');
refuses('« trades Bitcoin on weekends »', 'On weekends the AI trades Bitcoin.', 'actif non tradé (crypto)');
passes('« gold only, no crypto »', 'It trades gold only, no crypto.');
passes('dépôt en crypto (moyen de paiement)', 'You can deposit with crypto from any wallet, check the deposit page of the broker.');
check('ancien domaine réécrit', fixOldDomain('Here: https://app.algoria.tech/member/login') === 'Here: https://app.getalgoria.com/member/login');

// ── de bout en bout : assessModelOutput ─────────────────────────────────────
{
  const built = buildDraftSystem({ biz: true, locale: 'en', knowledge: 'Elle trade uniquement l\'or.', memory: null, trackNow: null, webinar: null, status: null, now: NOW, historyMaintenance: true });
  const judge = (reply: string, userText: string, sentBefore?: string[]) => assessModelOutput(JSON.stringify({ intent: 'auto', reply }), {
    biz: true, locale: 'en', sys: built.system, userText, holdResults: true, knowledge: 'Elle trade uniquement l\'or.', knownPct: built.knownPct, sentBefore, now: NOW,
  });
  const promise = judge('Mathieu will get back to you personally today 🙏🏼', 'any news?');
  check('promesse de délai → pas de brouillon', promise.draft === null && promise.issue === 'délai promis', String(promise.issue));
  const proof = judge(`Here is the verified record of the new version since 26 October: ${MYFXBOOK_URL}`, 'do you have proof of results?');
  check('Myfxbook passe, avertissement ajouté', proof.draft != null && proof.draft.text.endsWith(PAST_RESULTS_LINE), String(proof.issue));
  const old = judge('Your access is here: https://app.algoria.tech/member', 'link?');
  check('ancien lien réécrit en sortie', old.draft?.text.includes('app.getalgoria.com/member') === true && !old.draft?.text.includes('algoria.tech'), String(old.issue));

  const sys = built.system;
  check('prompt business : règles dures présentes', /HARD RULES/.test(sys) && sys.includes(FOLLOW_UP_LINE) && sys.includes(TRADER_PASSWORD_LINE) && sys.includes(MYFXBOOK_URL));
  check('prompt business : or seul', /gold only|XAU\/USD only/i.test(sys) && !/gold and crypto|l'or et les cryptos/i.test(sys));
  const app = buildDraftSystem({ biz: false, locale: 'en', knowledge: null, memory: null, trackNow: null, webinar: null, status: null, now: NOW, historyMaintenance: true }).system;
  check('prompt du bot de l\'app : règles dures, plus « personally today »', /HARD RULES/.test(app) && !/personally today/i.test(app) && app.includes(TRADER_PASSWORD_LINE));
}

// ── les notes ne promettent plus rien ───────────────────────────────────────
{
  const notes = [INCIDENT_NOTE, incidentReplyNote(true), incidentReplyNote(false), INCIDENT_OTHER_NOTE, RESULTS_REPLY_NOTE];
  // « next few days » n'y reste que dans la liste des interdits (« Never a deadline (… in the next few days…) »)
  check('aucune note ne promet « solutions in the next few days », « personally today », « contacting every affected member »', notes.every((n) => !/solutions? in the next few days|personally today|contacting every affected member/i.test(n)));
  check('les notes d\'incident donnent la phrase de suivi', [INCIDENT_NOTE, incidentReplyNote(true), INCIDENT_OTHER_NOTE].every((n) => n.includes(FOLLOW_UP_LINE) || /come back to you personally as soon as/.test(n)));
  check('INCIDENT.start reste la nuit du 21-22/10', INCIDENT.start.startsWith('2026-10-2'));
  const src = readFileSync('lib/member/replyDraft.ts', 'utf8') + readFileSync('lib/member/supportAuto.ts', 'utf8');
  check('aucun paramètre temperature dans les appels Anthropic (#555)', !/\btemperature\s*:/.test(src));
  const academy = readFileSync('lib/member/academy.ts', 'utf8') + readFileSync('app/member/ai/page.tsx', 'utf8');
  check('académie et page IA : plus de « gold and crypto »', !/gold (?:and|&amp;|&) crypto|Crypto positions/i.test(academy));
  const writer = readFileSync('lib/channel/writer.ts', 'utf8');
  check('le CM ne reçoit pas le Myfxbook du knowledge', /myfxbook/i.test(writer) && /filter\(\(l\) => !\/myfxbook\/i/.test(writer));
  const mig = readFileSync('supabase/migrations/0038_support_kb_facts.sql', 'utf8');
  check('migration 0038 : sauvegarde, pas de DROP ni DELETE', mig.includes('sauvegarde avant 0038') && !/\b(?:drop|delete|truncate)\b/i.test(mig.replace(/--.*$/gm, '')));
}

console.log(failed ? `\n${failed} contrôle(s) en échec` : '\ntous les contrôles passent');
process.exit(failed ? 1 : 0);
