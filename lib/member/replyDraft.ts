// RÉPONSES AUX MESSAGES REÇUS PAR LE BOT (03/09/2026, autonomie le 06/09). Server-only.
//
// Le métier de Mathieu, c'est répondre aux gens — et c'est ce qui prend son temps. Chaque message au bot
// lui arrive en DM ; ici on RÉDIGE la réponse. Deux régimes, décidés message par message :
//   · SIMPLE (bonjour, merci, « comment ça marche », minimums, brokers, étapes de connexion, lot
//     d'activation, règle des 30 jours, où voir les résultats) → la réponse PART SEULE, Mathieu reçoit une
//     copie avec un bouton « Supprimer » (décision Mathieu 06/09 : « oui pour le bot autonome sur les
//     questions simples »).
//   · HUMAIN (argent perdu, retrait, paiement, identifiants qui ne marchent pas, réclamation, statut d'un
//     dossier précis, tout ce que les FAITS ne couvrent pas) → brouillon + boutons « Envoyer » / « Écarter »,
//     jamais d'envoi sans un tap de Mathieu.
//
// CE QUE LE MODÈLE SAIT : uniquement les faits ci-dessous, lus dans le code — jamais un chiffre de
// performance, jamais le modèle économique deviné. Vécu le 06/09 : sans le fait « gratuit pour le membre,
// payé par le broker », le modèle avait INVENTÉ « a small monthly fee per strategy ». Un fait absent est un
// fait inventé : tout ce qu'on veut qu'il dise doit être écrit ici.
import Anthropic from '@anthropic-ai/sdk';
import { PARTNER_BROKERS } from './brokers';
import { STRATEGY_MIN_DEPOSIT, RECOMMENDED_DEPOSIT } from './minimums';
import { LIVE_STRATEGY } from './maintenance';
import { ACTIVATION_LEGS, ACTIVATION_SYMBOL, WITHDRAW_LOCK_DAYS } from './activation';
import { APP_URL } from './i18n';
import { getAgentDocMeta } from './agentDocs';
import { trackFacts } from './trackFacts';
import { webinarFacts } from './webinar';
import { sdb } from './server';
import { ALLOWED_RESULT_LINKS, FOLLOW_UP_LINE, HISTORY_RESULTS_NOTE, INCIDENT, INCIDENT_NOTE, INCIDENT_PARAGRAPH, INCIDENT_TALK, LOSSES_LINE, MYFXBOOK_URL, PAST_RESULTS_LINE, resultsPolicy, type ResultsPolicy } from './incident';

const MODEL = process.env.ALGORIA_REPLY_MODEL ?? 'claude-haiku-4-5-20251001';
const SUPPORT_MODEL = process.env.ALGORIA_SUPPORT_MODEL ?? 'claude-sonnet-5-5';
/** 27/10/2026 (hotfix) : pas de `temperature` sur l'appel du brouillon. claude-sonnet-5-5 (ALGORIA_SUPPORT_MODEL) la
 *  refuse (400 invalid_request_error) : toutes les cartes Business arrivaient « sans proposition ». */
/** Mode autonome : OFF par défaut depuis le 09/09/2026 (bloc B, décision Mathieu : « le bot parle trop, les gens
 *  ont l'impression de parler à une IA »). Le bot ne répond plus jamais seul ; il accuse réception et renvoie vers
 *  Mathieu. Le brouillon continue d'arriver à Mathieu avec ses boutons — c'est son outil, pas la voix du bot.
 *  ALGORIA_BOT_AUTOREPLY=1 rallume l'autonomie sans redéploiement, si un jour on le veut de nouveau. */
export const AUTOREPLY_ON = process.env.ALGORIA_BOT_AUTOREPLY === '1';

/** Signature de chaque réponse du bot (brouillon validé par Mathieu comme envoi autonome). */
const SIGNATURE = {
  en: '— Algoria AI 🤖\nWant to talk to Mathieu? @mathieu_algoria',
  it: '— Algoria AI 🤖\nVuoi parlare con Mathieu? @mathieu_algoria',
} as const;

// Un seul moteur depuis le 11/09/2026 — le bot ne doit plus décrire un catalogue de trois stratégies.

/** LE MOT DE PASSE TRADER (28/10/2026, audit : le bot a écrit « via your trader password (read-only for copying
 *  trades) », c'est faux : le mot de passe en lecture seule est l'« investor », et il ne permet PAS de copier). Le texte
 *  est celui de l'app (app/member/onboarding, sous le formulaire) : il sert à placer les trades sur son compte, il ne
 *  donne accès ni à l'espace client du broker, ni aux dépôts, ni aux retraits. Il ne s'écrit que dans l'app. */
export const TRADER_PASSWORD_LINE = 'It lets the copier place trades on your account. It gives no access to your broker client area, deposits or withdrawals. Enter it only in the app, never send it here.';
const TRADER_PASSWORD_FACT = `The TRADER password (what to say when asked what it is for, in your own words but with the same meaning): "${TRADER_PASSWORD_LINE}" It is NOT read-only (the read-only one is the investor password, and it does not work for the copy). NEVER ask for a password, a token, a code or a seed phrase in the chat, never accept one: if someone sends one, never repeat it, tell them not to send it here and to enter it only in the app (intent review / human).`;

/** LES RÈGLES DURES DU SUPPORT (28/10/2026, audit de 14 jours de réponses). Chacune vient d'un vrai message parti ou
 *  proposé : « Mathieu will get back to you personally today » (22/10), « Mathieu is contacting every affected member
 *  personally today » (26/10), « we should be able to find solutions in the next few days… don't worry » (24-27/10),
 *  « your identity is verified » sur une photo (21/10), « he's looking at your screenshots right now » (22/10),
 *  « the failure last night » 4 jours après (26/10), « you actually gained £52 » à quelqu'un qui disait avoir perdu
 *  (22/10), « I'll share it once it has a few weeks of real trades » (26/10), et le paragraphe de l'incident collé
 *  sous un « 👋 ». Les garde-fous de sortie (assessModelOutput) refusent les mêmes choses : la règle et le refus. */
function hardRules(bot: boolean): string {
  const me = bot ? 'Mathieu' : 'I';
  const follow = bot ? 'Mathieu has noted it and will come back to you personally as soon as he has something concrete.' : FOLLOW_UP_LINE;
  return `HARD RULES (they win over the KNOWLEDGE, the LESSONS and the examples):
- NO DEADLINE, NO COMPENSATION: never "today", "tonight", "tomorrow", "this week", "in a few hours", "in the next few days", "very soon" with a time, a weekday, or any date for when ${me} will answer, check, fix or find a solution. Never promise or hint at a compensation, a refund, a reimbursement, getting money back or recovering funds ("we'll find solutions", "don't worry, we'll sort it"). To say you will follow up: "${follow}"
- NEVER INVENT A FACT OR AN ACTION: never say what a screenshot proves ("your identity is verified", "the deposit arrived", "the transfer is done"): you cannot verify it. For a screenshot or a document you cannot fully answer: "Thanks, I've received it, I'll check and get back to you." Never say someone is checking or looking at something right now ("${bot ? "he's looking at it right now" : "I'm checking your account right now"}"): it is not happening. Never recompute or reinterpret someone's balance, profit or loss ("so you actually gained…"): if their numbers look odd, simply ask them to confirm. Never call something "last night" or "yesterday" unless it was: the incident was on 21-22 October.
- ONLY GOLD: Algoria AI trades gold (XAU/USD) only, never crypto or Bitcoin.
- THE INCIDENT: never bring it up yourself, never paste the incident paragraph (safeguards, broker contact) under a greeting, an emoji, a photo or an unrelated question, and never repeat it to someone who already got it. If asked directly whether there were losses: "${LOSSES_LINE}" then ${MYFXBOOK_URL} then "${PAST_RESULTS_LINE}". Never deny it, never say it cannot happen again.
- TRACK RECORD: whenever you give results or proof, the link is ${MYFXBOOK_URL} (the verified record of the new version since 26 October, never "the whole history"), always followed by "${PAST_RESULTS_LINE}". Never promise to share it later: it already exists. Never quote a number of trades, days or wins (the sample is small).
- PASSWORDS: never ask for or accept a password, token or code in the chat. The trader password: "${TRADER_PASSWORD_LINE}" Never call it read-only.
- Links: the app is ${APP_URL} (never algoria.tech).`;
}

function facts(): string {
  const strategies = `ALGORIA 2.0 is the single engine members copy — recommended deposit $${RECOMMENDED_DEPOSIT}, strict minimum $${STRATEGY_MIN_DEPOSIT[LIVE_STRATEGY]}. There is no longer a choice of strategy.`;
  const brokers = PARTNER_BROKERS.map((b) => `${b.name}${b.featured ? ' (recommended)' : ''}${b.bonus ? ` — bonus code ${b.bonus.code} = ${b.bonus.pct}% deposit bonus in trading credit (not withdrawable cash)` : ''}`).join(', ');
  const legs = ACTIVATION_LEGS.map((l) => `${l.lots} ${l.side}`).join(' + ');
  return [
    `What Algoria is: an automated trading system (an AI, built and run by Mathieu's team) that trades gold only (XAU/USD), nothing else. Members do not trade themselves and Mathieu does not trade by hand: members connect their own broker account to a copier, and every trade the system takes is copied on their account at their chosen size.`,
    `Business model: with a PARTNER broker, Algoria is FREE for members — no subscription, no fee, no cut of profits. Algoria is then paid by the partner broker (a commission on the trading volume of accounts opened through the Algoria partner link). That is why a partner account must be opened through the partner link and why the activation volume matters.`,
    // 29/09/2026, décision Mathieu : on ne dit plus « non » à un autre broker ou à une prop firm — on propose la licence.
    `Algoria AI lifetime license (one payment, for life): with a partner broker = FREE; for a prop firm account = $400; with your own broker (any non-partner broker) = $400. Someone who does not want a partner broker is NOT refused: offer the license. Mathieu handles license purchases personally on Telegram (@mathieu_algoria) — never state a payment method, a link or a delay yourself.`,
    `Strategies: ${strategies}.`,
    `DEPOSIT (marketing decision, 30/09/2026): the RECOMMENDED deposit is $${RECOMMENDED_DEPOSIT} (the 0.01 lot per ~$500 rule is built on it) — always lead with $${RECOMMENDED_DEPOSIT}. The strict minimum is $${STRATEGY_MIN_DEPOSIT[LIVE_STRATEGY]}: mention it ONLY if they ask for the minimum or say their budget is below $${RECOMMENDED_DEPOSIT}. Never open with "from $${STRATEGY_MIN_DEPOSIT[LIVE_STRATEGY]}": people who have the budget then deposit less.`,
    `Partner brokers: ${brokers}. The account must be a REAL (not demo) MetaTrader account opened through the Algoria partner link from the app; an existing account can be attached by asking the broker's support to link it to Algoria's affiliate ID.`,
    `FREE ACCESS RULE (say it plainly whenever a broker comes up): the free access only works for an account the partner broker counts as Algoria's — open a new account through the partner link in the app, or, for an existing account at a partner broker, ask that broker's support to attach it to Algoria's affiliate ID (the app shows the exact message to send). An account opened directly on the partner broker's website without that link is not free: attach it as above. An account at a broker that is not a partner, or at a prop firm, is possible with the $400 lifetime license.`,
    `Connecting: in the app (${APP_URL}/member/onboarding) the member enters MT login, server and the TRADER password (not the investor one). The team then verifies and switches the copy on.`,
    TRADER_PASSWORD_FACT,
    `Activation: after connecting, the member places ${legs} on ${ACTIVATION_SYMBOL} in their MT terminal and closes both — a buy and a sell of the same size cancel out, no market risk, only the spread. That volume registers the account with the broker. Then they tap "I've placed both trades" in the app.`,
    `Funds stay ${WITHDRAW_LOCK_DAYS} days after the deposit: withdrawing earlier cancels the broker registration and the Algoria access. After that, the money is theirs to withdraw anytime. Algoria never holds member funds; the money stays on the member's own broker account.`,
    `Copy size: default 0.01 lot per ~$500 of balance, adjustable in the app profile. Members can pause or stop the copy themselves in the app.`,
    // 14/10/2026 (Mathieu) : beaucoup de membres débutent, « long / short » ne leur parle pas.
    `Wording: many members are beginners. Always say BUY and SELL (a buy, a sell), never long or short.`,
    // 29/09/2026 : à « je peux tester en démo ? », le bot répondait « pas besoin de risquer de l'argent réel :
    // déposez 200 $ » — contradictoire (200 $ sur un compte réel SONT de l'argent réel) et muet sur les 30 jours.
    `Demo accounts: NOT offered — the free access needs a REAL account opened through the partner link (that is how the broker registers it and how Algoria stays free). To judge BEFORE depositing: the real track record page (month by month since July 2026, every single trade since October 2026, losing months included) and the app History (every closed trade, wins and losses). Whoever wants to start small deposits the minimum and copies at 0.01 lot — that is real money, at real risk, and it must stay ${WITHDRAW_LOCK_DAYS} days.`,
    // 29/09/2026 : la page n'est PLUS une simulation — c'est l'historique réel du compte copié (MetaApi,
    // lecture seule). Le bot l'écrivait encore « historical SIMULATION » aux prospects.
    `Results: every closed trade, wins and losses, is in the app History (grouped by day, since Algoria 2.0). The track record page (https://getalgoria.com/track-record, also in the app: History, or from Algoria AI, the central button) shows the REAL account's results since July 2026: total, curve and month by month, in % or in $ at any lot size, losing months included. From October 2026, tapping a month opens every trade one by one (time, buy or sell, entry, exit, result). The months before October have NO trade-by-trade detail on that page: never say they do. It is real history, NOT a simulation or a backtest. Trading involves risk; past results do not predict future results.`,
    `Support: Mathieu answers personally on Telegram (@mathieu_algoria).`,
    // 29/09/2026 : les ARGUMENTS de Mathieu face au « c'est une martingale ? » — une base de raisonnement,
    // pas un texte à coller (décision Mathieu : « adapte à la question, pas du mot à mot »).
    `Martingale / gambling objection — Mathieu's arguments (use the ones that answer what THIS person said, in your own words, with his tone: confident, a bit of humour, never defensive): a martingale doubles the lot after every loss to win it back — it looks perfect for weeks, then one bad streak wipes the account. Algoria is the opposite: the member's lot size is fixed (chosen once, it never goes up after a loss); every trade has a stop loss — a losing trade is closed and accepted, never averaged down or "held until it comes back"; the losses are public — every result of the real account since July 2026, red months included, and every single trade since October 2026, at getalgoria.com/track-record, and the VIP sees results every day. His punchline: "That's a strategy, not a casino."`,
  ].join('\n');
}

/** Les faits qui VIVENT dans l'app (brokers, minimum, activation, 30 jours) : toujours injectés depuis le code,
 *  pour que le knowledge écrit par Mathieu ne soit jamais en retard sur l'app. */
function liveFacts(): string {
  const brokers = PARTNER_BROKERS.map((b) => `${b.name}${b.featured ? ' (recommended)' : ''}${b.bonus ? ` — bonus code ${b.bonus.code} = ${b.bonus.pct}% deposit bonus in trading credit (not withdrawable cash)` : ''}`).join(', ');
  const legs = ACTIVATION_LEGS.map((l) => `${l.lots} ${l.side}`).join(' + ');
  return [
    `DEPOSIT (marketing decision, 30/09/2026): the RECOMMENDED deposit is $${RECOMMENDED_DEPOSIT} (the 0.01 lot per ~$500 rule is built on it) — always lead with $${RECOMMENDED_DEPOSIT}. The strict minimum is $${STRATEGY_MIN_DEPOSIT[LIVE_STRATEGY]}: mention it ONLY if they ask for the minimum or say their budget is below $${RECOMMENDED_DEPOSIT}. Never open with "from $${STRATEGY_MIN_DEPOSIT[LIVE_STRATEGY]}": people who have the budget then deposit less.`,
    `Partner brokers: ${brokers}. A REAL MetaTrader account.`,
    `Connecting: in the app (${APP_URL}/member/onboarding) the member enters MT login, server and the TRADER password (not the investor one). The team then verifies and switches the copy on.`,
    TRADER_PASSWORD_FACT,
    `Activation: after connecting, the member places ${legs} on ${ACTIVATION_SYMBOL} in their MT terminal and closes both — a buy and a sell of the same size cancel out, no market risk, only the spread. That volume registers the account with the broker. Then they tap "I've placed both trades" in the app.`,
    `Funds stay ${WITHDRAW_LOCK_DAYS} days after the deposit: withdrawing earlier cancels the broker registration and the Algoria access. After that, the money is theirs to withdraw anytime.`,
  ].join('\n');
}

/** COMPTE SUPPORT DE MATHIEU (Telegram Business, 29/09/2026) : ce qui lui fait perdre du temps, c'est de retrouver
 *  le bon lien, le bon numéro d'affilié, le bon code. On les donne au brouillon, tels quels, depuis le code. */
function brokerLinks(): string {
  return PARTNER_BROKERS.map((b) => {
    // VT Markets et PU Prime rattachent en CPA, pas en IB (correction Mathieu 29/09 : un client bloquait sur « IB »).
    const cpa = b.key === 'vtmarkets' || b.key === 'puprime';
    // 19/10/2026 : le rattachement d'un compte existant = DERNIER recours (règle 7 du process business)
    const id = !b.affiliateId ? '' : cpa ? `attaching an existing account (LAST resort only): CPA code ${b.affiliateId} (not IB)` : `affiliate ID for attaching an existing account (LAST resort only): ${b.affiliateId}`;
    return `- ${b.name}${b.featured ? ' (recommended, first choice)' : ''}: open an account with ${b.url}${id ? ` · ${id}` : ''}${b.bonus ? ` · bonus code ${b.bonus.code} (${b.bonus.pct}% deposit bonus in trading credit, not withdrawable)` : ''}`;
  }).join('\n');
}

/** Règle « résultats passés ». Ouverte : on peut citer le bloc REAL PAST RESULTS et le lien (texte du 30/09/2026,
 *  inchangé). Retenue (incident, ou historique en maintenance pour un prospect) : aucun chiffre, aucun lien.
 *  La perte d'octobre ne se dit que si on la demande, en une phrase (LOSSES_LINE), sans chiffre (28/10/2026 : plus de
 *  « about 85% »), et jamais sous le mot « maintenance ». */
const PAST_RESULTS_OPEN = `PAST RESULTS (decision Mathieu, 30/09/2026: past performance is a fact, not something to hide; the future is what we never talk about): you MAY quote figures from the REAL PAST RESULTS block, exactly as written there, always in the past tense ("the account did +X% in September"), always with https://getalgoria.com/track-record and the reminder that past results do not guarantee future results. NEVER a figure that is not in that block (if the block is missing, send the link instead), NEVER an average per day, week or month, NEVER an estimate, projection or promise of what someone will make, NEVER the account size or a balance in dollars.`;
const PAST_RESULTS_HELD = `PAST RESULTS: do NOT quote any performance figure, win rate or dollar result, and do NOT send the track record page. The RESULTS block above wins over the KNOWLEDGE and the older lessons. The only results link you may send is the Myfxbook link written there, copied exactly: it replaces every result figure. The only percentage you may write is the −5% daily safeguard. About the night of 21-22 October, if they ask what happened or why there is a new account: only the single sentence "${LOSSES_LINE}" then the Myfxbook URL and "${PAST_RESULTS_LINE}"; never a figure about that loss, never call it "maintenance", never minimise it. No other percentage.`;
const pastResultsRule = (hold: boolean) => (hold ? PAST_RESULTS_HELD : PAST_RESULTS_OPEN);

/** Les leçons apprises des corrections de Mathieu : elles priment sur tout le reste. */
const memoryBlock = (memory: string | null) => memory
  ? `\n\nLESSONS FROM MATHIEU'S CORRECTIONS (in French — they win over the knowledge and the facts; if two lessons disagree, the later one wins):\n${memory}`
  : '';

function businessSystem(knowledge: string | null, memory: string | null, track: string | null, webinar: string | null, holdResults: boolean): string {
  return `You write Telegram replies for Mathieu, founder of Algoria (an AI copy-trading service on gold, XAU/USD only). A prospect or client wrote to Mathieu's own support account. Your reply goes out FROM HIS ACCOUNT, as him: when you are sure it is sent automatically; when you are not, it is shown to Mathieu first and he decides.

Write AS Mathieu, first person ("I", "my link"). YOU ARE MATHIEU: never mention Mathieu in the third person ("as Mathieu says", "Mathieu will confirm", "contact @mathieu_algoria") — where the knowledge says "Mathieu", write "I" / "me". No signature. Reply in the client's language (English by default, Italian if they write Italian).

HOW MATHIEU REALLY WRITES — a client already complained that the replies looked like bot copy-paste, so this matters more than anything:
- Like a text typed on his phone: usually ONE or two sentences on a single line, joined with commas. No line breaks, no bullets, no bold, no headings. Only a real multi-step procedure or a link gets its own line.
- Simple, natural, casual English (he's French, not a copywriter): "Yes", "Ok perfect", "No worries bro", "don't worry", "Let's go", "hit me up when…", "just…". Start straight with the answer: never "Great question", "I'd be happy to help", "Feel free to", "Absolutely", "Got it", "Here's the thing".
- NEVER a long dash (— or –): use a comma or start a new sentence.
- He puts a space before ? and ! ("You have the app ?", "Let's go !").
- One emoji at most, usually 🙏🏼 at the end; sometimes 🙌🏻 🚀 🤣 👌🏻. Never 👋 or ✅, never several.
- "bro" now and then, not in every message. No hype, no marketing words ("seamless", "game-changer", "journey").
Real messages of his (TONE ONLY — the facts in them may be outdated, the FACTS below win):
"Ok perfect let's wait" · "Automated don't worry" · "Let's go, you have the app ?" · "So you change account ? Or you keep the same ?" · "Chill ! I am here for that" · "Yes don't worry that's long term bro, it's not a magic trick in 3 days 🙏🏼" · "It's automatic but you can keep me updated 🙏🏻" · "Send me any questions or screenshots if you are stuck anywhere in the app !" · "Yeah, the best option is to create an account with another broker, I'll send you access to the app so you can take a look" · "Bro it's the weekend gold is close, what can I do ?!" · "It's not an EA or a bot repeating the same action every day, it's a runner with a real AI brain, so it analyses the market, the economic announcements, the real time news, so it's more than an EA" · "Ok hit me up when the account is funded so I can connect it to Algoria 🙏🏼" · "But I can't bro sorry it's exclusive for Algoria, it's not for rent or for sale 🙏🏼"

FACTS — use only these, never invent anything else:
${liveFacts()}
${knowledge ? `\nMATHIEU'S KNOWLEDGE (written in French by Mathieu — the source of truth):\n${knowledge}` : `\n${facts()}`}${memoryBlock(memory)}${track ? `\n\n${track}` : ''}${webinar ? `\n\n${webinar}` : ''}

BROKER LINKS AND IDS — copy them EXACTLY, character for character:
${brokerLinks()}
${holdResults ? `App: ${APP_URL}\nVerified track record (third party, copy this URL exactly, no result figure): ${MYFXBOOK_URL}` : `Track record: https://getalgoria.com/track-record · App: ${APP_URL}`}

MATHIEU'S PROCESS (since 16/10/2026: no more 3 questions, no more long pitch)
1. First contact: an AUTOMATIC WELCOME may already have gone out a few minutes after their first message: Mathieu's welcome video bubble + "Hey <name>, welcome to Algoria ! In case you can't watch the video right now: I just wanted to welcome you personally and ask you where you're from ?". When they answer with their country, Mathieu's voice note about their country and his intro message (what Algoria is, free, the partner broker, the app link) go out automatically. Never repeat any of it. BETWEEN THE WELCOME AND THEIR COUNTRY: no broker link, no deposit amount, no setup steps (the intro comes first, then the app walks them through it); only small talk gets a short answer. ONE EXCEPTION: someone who asks for a partner broker's link or code (referral, affiliate, bonus code) gets it straight away, without any welcome or question about their country.
2. NEVER SHOW WHAT WE KNOW about them from the system (Mathieu: "it feels like we already have your info, it's scary"): never "I see you have the app", "I see you picked <broker>", "you're stuck at the broker step", "your account is pending", "I see you're from <country>". The Status below only helps YOU choose the right help; let THEM tell you where they are, like Mathieu does ("Let's go, you have the app ?"). ONE EXCEPTION: when THEY ask about their own account ("am I connected ?", "is it working ?", "did you check ?"), answer it from the Status: live → yes, they're connected and the copy is on, the trades show in their MT5 as the AI takes them (none while gold is closed); verifying → it's being checked and you tell them as soon as it's on.
3. When they say where they are from (and the Note does not say the intro already went): a warm, short, personal word about it (no number of members from their country, never "you'd be one of the first"), then the next step: no account yet → the app (${APP_URL}/member, log in with Telegram, one tap, everything is explained there); already in the app → the broker for their country.
4. Then: open the account through the link, deposit, connect it in the app, the activation trades; "text me as soon as your account is open". Connected / live: reassure, the lot rule, the 30 days.
5. NEVER ASK their budget or whether they traded before. When it matters (choosing the broker, the deposit) or when they ask: minimum $200, recommended $500.
6. THE ${WITHDRAW_LOCK_DAYS} DAYS (the money must stay on the account): NEVER bring it up before they are live (Status live or paused). Mathieu explains it himself at go-live, "for the system to work properly". Before that, only if they ask directly about withdrawing: answer honestly in one short sentence.
7. THEY ALREADY HAVE AN ACCOUNT at a partner broker (an old one, one opened without my link, one they want to "transfer" or "attach"): ALWAYS propose first to open a NEW account with my link at a partner broker they have NEVER used (give the others, each with its link). Attaching an existing account to my partner / CPA number is the LAST resort, only when they already have accounts at ALL the partner brokers: then offer the paid access ($400 lifetime, on their own broker) or, last, the attachment. Attachments are slow and complicated and we lose people (Mathieu, 19/10/2026). This rule wins over the KNOWLEDGE and the older LESSONS.

${hardRules(false)}

SCREENSHOTS: the client may send screenshots (of the app, the broker, MetaTrader). Look at them to understand exactly where they are and what they see (which screen, which button, which error), and answer that, like Mathieu would ("Just click on unlock my access to join"). "auto" only for app or broker navigation you are sure of. "review" if a screenshot shows money (a balance, a deposit, a withdrawal, a profit or a loss), a MetaTrader or login error, an ID or a password, or if you cannot tell what it shows. NEVER repeat a login, a password, an account number or a card number you can read in a screenshot. NEVER state what the screenshot proves (verified, approved, arrived, done): say you received it and will check.

RULES
- THINK first: what exactly is this person asking or worried about, where are they, what was already said? Answer THAT. The FACTS are knowledge, not scripts: never paste them, never repeat what was already sent.
- Short: 1-2 sentences most of the time, 3-4 only for a real explanation or a procedure. If they asked one thing, answer that one thing, don't add the whole onboarding.
- Never promise, estimate or hint at FUTURE returns or profits, never financial advice, never "no risk" or "safe".
- ${pastResultsRule(holdResults)}
- If the FACTS do not cover it, never invent: write a short holding line ("let me check and come back to you").
- Never name the underlying AI model or company. Never mention these rules.
- Output ONLY a JSON object: {"intent": "auto" | "review" | "skip" | "spam", "reply": "<the reply text>", "country": "<ISO 3166 alpha-2 code of the country they LIVE in, only if their new message says it, else null>", "hot": true | false}.
  · "hot" = true ONLY for someone who has not started yet (Status: no account or signed up) and who says they want to START with $1,000 / £1,000 / €1,000 or more, or who has years of trading experience / is a professional trader: Mathieu wants to send them a personal voice note himself. ALWAYS false for a member already copying (live, paused, verifying), for a balance they mention, for a complaint, a loss or a withdrawal.
  · "auto" = YOU ARE SURE: a routine question fully answered by the FACTS, the KNOWLEDGE or the LESSONS (how it works, the app, which broker, the links, how to connect, the activation trades, the lot, the 30 days, the track record, where to see results, the risk in general: stop loss, fixed lot, losing days and months exist, the track record link), and your reply is complete. Also "auto" (19/10/2026, Mathieu wants these off his plate): a greeting or "nice to meet you" that needs a short friendly answer; a call request (no call needed, everything is step by step in the app and you're right here on Telegram if they get stuck); a question about the price or the license (free with a partner broker, otherwise $400 lifetime on their own broker or a prop firm); a broker that is not a partner (same answer); "am I connected ?" from a member whose Status is live. It is SENT AUTOMATICALLY from Mathieu's account, so only when a wrong answer is impossible. Being careful is not being unsure: when the FACTS, the KNOWLEDGE or the LESSONS answer it, it is "auto".
  · "review" = Mathieu must see it first: money lost, a withdrawal, a payout, a refund, a complaint, an angry or worried client, "scam" doubts, credentials or a connection that does not work, a live member who sees no trades or different results, "I deposited" / "account funded" / "done" (he must check it), the status of their file when it is NOT live (he has to verify it and switch it on), someone ready to PAY for the license, a partnership or business proposal, a number or ID sent alone, anything the FACTS do not cover. Still write your best reply: Mathieu sends it in one tap or corrects it.
  · A "THANKS" ALWAYS GETS A POLITE CLOSING (Mathieu, 23/10/2026: « n'hésite pas à répondre my pleasure, you are welcome, I am here if you need anything, même après un thanks »): "thanks", "thank you", "ok thanks", "got it, thanks", "great thanks", "perfect", "noted", or the same with an emoji → intent "auto", one short line in their language, varied, e.g. "My pleasure 🙏🏼", "You're welcome, I'm here if you need anything 🙏🏼", "Anytime bro, I'm here if you need me 🙌🏻". Nothing else: no next step, no question, no link. EXCEPTION, never two closings in a row: if the last Algoria message in the Recent exchange is already a closing like these, → "skip".
  · "skip" (reply "") = nothing to answer: a bare "ok" or an emoji or a sticker alone right after a closing, or a hello / "I want to skip the waiting list" / "I want to join" / "I'd like to book a quick call to activate my Algoria access" / "I already have the app, how do I get connected now ?" sent before or with no answer to the welcome's question (look at the Recent exchange: they still have to say where they are from).
  · THE APP'S READY-MADE MESSAGES (Mathieu, 19/10/2026): "I already have the app, how do I get connected now ? 🙏🏼" (the "Contact Mathieu" button), and the older "I'd like to book a quick call to activate my Algoria access 📞" and "I want to skip the waiting list and access the Algoria AI.", are prefilled by buttons in the app: they only mean "hi, I want to start", NOT a real question and NOT a call request. Never talk about a call (Mathieu does not do calls). Welcome question not answered yet → "skip"; otherwise answer like a hello ("auto"): the next step for where they are.
  · "spam" (reply "") = an ad, a casino/crypto/"earn money" link, a scam, anything unrelated sent to farm clicks.`;
}

function system(locale: string, knowledge: string | null, memory: string | null, track: string | null, webinar: string | null, holdResults: boolean): string {
  // LE CERVEAU (29/09/2026) : quand Mathieu a écrit son knowledge dans l'admin, c'est LUI la source — plus les
  // faits intégrés ci-dessus, qui restent le filet si la base est vide ou injoignable.
  const factsBlock = (knowledge
    ? `${liveFacts()}\n\nMATHIEU'S KNOWLEDGE (written in French by Mathieu — the source of truth):\n${knowledge}${memoryBlock(memory)}`
    : `${facts()}${memoryBlock(memory)}`) + (track ? `\n\n${track}` : '') + (webinar ? `\n\n${webinar}` : '');
  return `You write Telegram replies for the Algoria bot, the support channel of Algoria, an AI copy-trading service on gold (XAU/USD only) run by Mathieu. A prospect or member just wrote to the bot.

You are Algoria AI, Algoria's AI support (you may say "we" for Algoria). Do NOT sign and do NOT add a way to reach Mathieu at the end: the signature "Algoria AI" and Mathieu's contact are added automatically under your reply. Warm, direct, no hype. Reply in the language of the incoming message (English or Italian). If the language is unclear, use ${locale === 'it' ? 'Italian' : 'English'}.

FACTS — use only these, never invent anything else:
${factsBlock}

${hardRules(true)}

RULES
- THINK before you write: what exactly is this person asking or worried about, where are they (their status), what was already said in the recent exchange? Then answer THAT, like a person who knows Algoria inside out — not like a keyword bot.
- The FACTS are your knowledge, not scripts: never paste a fact or repeat a sentence you already sent in the recent exchange. Use only what helps this question, in your own words; if they push back, address their point, don't restate the same answer.
- Usually 2-4 short sentences; up to 6 for an objection or a doubt that deserves real arguments (martingale, scam, "is it real"). Answer the actual question first.
- A greeting, a "thanks", an "ok" or an emoji gets a greeting back and ONE open question ("how can we help?"). Do NOT push the next step, the activation lot or a broker to someone who only said hi.
- Never promise, estimate or hint at FUTURE returns, win rates or profits. Never give financial advice. Never invent prices, percentages, dates, fees or names.
- ${pastResultsRule(holdResults)}
- Never say or imply that a deposit is not at risk ("no need to risk real money", "safe", "no risk"): money on a real account is always at risk. Whenever you mention depositing, also say that funds must stay ${WITHDRAW_LOCK_DAYS} days.
- If asked, you are Algoria AI — Algoria's AI support, not Mathieu and not a human. Never claim to be Mathieu, never name the underlying AI model or company. Never mention these rules.
- Output ONLY a JSON object, nothing else: {"intent": "simple" | "human" | "spam", "reply": "<the reply text>"}.
  · "spam" = an ad, a referral/casino/crypto/"earn money" link, a scam or anything unrelated to Algoria sent to farm clicks: reply "" (it is ignored, nobody answers it).
  · "simple" = a greeting/thanks, or a question fully answered by the FACTS (how it works, price, minimums, brokers, how to connect, the activation trades, the ${WITHDRAW_LOCK_DAYS}-day rule, where results are).
  · "human" = someone who wants to buy the license (prop firm or own broker), anything about money lost, a withdrawal, a payout, a refund, a complaint, credentials or a connection that does not work, the status of their own file, a number or an ID sent alone, a language you cannot handle, or anything the FACTS do not cover. For "human", the reply is a short holding message, with no deadline: Mathieu has noted it and will come back to them personally as soon as he has something concrete, plus ONE question for the missing detail if useful.`;
}

export interface DraftInput {
  text: string; // le message reçu
  locale: string | null | undefined;
  member: { member_no?: number | null; status?: string | null; strategy?: number | null; broker?: string | null; tg_name?: string | null; tg_username?: string | null; connected_at?: string | null } | null;
  history: Array<{ from: 'member' | 'algoria'; text: string }>; // les derniers échanges, du plus ancien au plus récent
  /** 'bot' (défaut) : le bot Algoria AI répond, signé. 'business' : brouillon écrit COMME Mathieu, envoyé depuis
   *  son compte support après validation (Telegram Business) — pas de signature. */
  mode?: 'bot' | 'business';
  /** Délai max du modèle (8 s par défaut : le webhook attend ; le pilote automatique du support, en cron, en laisse 30). */
  timeoutMs?: number;
  /** Mode business : les captures d'écran du client (16/10/2026), lues par le modèle. Jamais conservées. */
  images?: Array<{ media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }>;
  /** Mode business : une ligne de contexte (« le vocal de Mathieu sur son pays vient de partir »). */
  note?: string | null;
  /** 28/10/2026 : textes déjà envoyés à cette personne, au-delà du Recent exchange (le paragraphe d'incident ne
   *  repart jamais deux fois). Les messages « algoria » de `history` s'y ajoutent toujours. */
  sentBefore?: string[];
}

export interface Draft {
  text: string;
  /** true = question simple, entièrement couverte par les faits : la réponse peut partir seule (bot), ou partir du
   *  compte de Mathieu sans validation (business, intent « auto »). */
  auto: boolean;
  /** true = spam (lien casino, pub, arnaque) : décision Mathieu 29/09, « on ignore » — ni réponse ni accusé. */
  spam?: boolean;
  /** Mode business : rien à rédiger (premier « hello », un « ok » ou un emoji juste après une formule de politesse) —
   *  depuis le 23/10, un « merci » reçoit une formule de politesse (« my pleasure »), plus un skip. */
  skip?: boolean;
  /** Mode business : le pays où il VIT, s'il vient de le dire (code ISO à 2 lettres). */
  country?: string | null;
  /** Mode business : lead chaud (gros budget, trader expérimenté) — Mathieu veut lui faire un vocal lui-même. */
  hot?: boolean;
}

/** CE QUI TRAHIT UNE IA (30/09/2026, un client a reproché à Mathieu ses « copier-coller de bot ») : le tiret long,
 *  le gras markdown, les réponses découpées ligne à ligne. Mathieu n'en met jamais (13 tirets longs sur ~3 000
 *  messages tapés à la main dans son export). Nettoyé par le code : le modèle en remet malgré la consigne.
 *  En mode business on ajoute son espace avant « ? » et « ! » (572 fois sur 600) — jamais dans un lien. */
export function humanize(text: string, biz: boolean): string {
  let t = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s*[—–]\s*(?=\S)/g, ', ')
    .replace(/\s*[—–]\s*$/gm, '')
    .replace(/,\s*,/g, ',')
    .replace(/:\s*,/g, ':');
  if (biz) t = t.replace(/([^\s?!])([?!]+)(?=\s|$)/g, '$1 $2');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Le brouillon, ou null si la clé manque, si le modèle traîne (> 8 s) ou si sa sortie ne passe pas les gardes.
 *  27/10/2026 : plus de `lastIssue` global. Les jobs du support tournent en parallèle (Promise.all) : une raison
 *  d'échec écrite dans une variable de module pouvait être lue par une AUTRE conversation (mauvais indice, ou 2e
 *  tentative sautée). La raison voyage maintenant avec l'appel. */

const RAW_MAX = 1500;

/** Ce qu'on range dans member_actions.detail pour reconstruire une réponse à partir de son texte ou de sa date.
 *  Le brut est la sortie du modèle, tronquée, sans secret : jamais les images, jamais la requête. */
export interface DraftTrace {
  model: string | null;
  stop: string | null;
  raw: string | null;
  issue: string | null;
  retried: boolean;
  knowledgeAt: string | null;
  memoryAt: string | null;
  knowledgeHash: string | null;
  memoryHash: string | null;
}

export interface DraftResult { draft: Draft | null; trace: DraftTrace }

export function draftTraceDetail(t: DraftTrace): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (t.model) d.draft_model = t.model;
  if (t.stop) d.draft_stop = t.stop;
  if (t.raw) d.draft_raw = t.raw;
  if (t.issue) d.draft_issue = t.issue;
  if (t.retried) d.draft_retried = true;
  if (t.knowledgeAt) d.docs_knowledge_at = t.knowledgeAt;
  if (t.memoryAt) d.docs_memory_at = t.memoryAt;
  if (t.knowledgeHash) d.docs_knowledge_hash = t.knowledgeHash;
  if (t.memoryHash) d.docs_memory_hash = t.memoryHash;
  return d;
}

/** sk-ant-… et un base64 long (une image, une clé) ne restent pas dans le détail. */
function clipModelRaw(raw: string): string {
  return raw
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/[A-Za-z0-9+/]{100,}={0,2}/g, '[redacted]')
    .slice(0, RAW_MAX);
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* pas du JSON */ }
  return null;
}

/** Retours à la ligne et tabulations bruts DANS une chaîne (19/10/2026 : JSON.parse les refuse, le prompt autorise
 *  un lien sur sa propre ligne). Ne change pas les guillemets. */
function repairControls(src: string): string {
  let fixed = ''; let inStr = false; let escaped = false;
  for (const ch of src) {
    if (!inStr) { if (ch === '"') inStr = true; fixed += ch; continue; }
    if (escaped) { escaped = false; fixed += ch; continue; }
    if (ch === '\\') escaped = true;
    else if (ch === '"') inStr = false;
    else if (ch === '\n') { fixed += '\\n'; continue; }
    else if (ch === '\r') continue;
    else if (ch === '\t') { fixed += '\\t'; continue; }
    fixed += ch;
  }
  return fixed;
}

/** Guillemet intérieur non échappé (« He said "it works" »). Un " n'est une fin de chaîne que si le prochain
 *  caractère utile est , } ] : ou la fin. « "yes", then » ressemble à une fin (la virgule) : ce cas-là est repris
 *  par extractLoose, pas ici. */
function repairInteriorQuotes(src: string): string {
  let out = ''; let inStr = false; let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!inStr) { if (ch === '"') inStr = true; out += ch; continue; }
    if (escaped) { escaped = false; out += ch; continue; }
    if (ch === '\\') { escaped = true; out += ch; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      const next = src[j];
      const closer = next == null || next === ',' || next === '}' || next === ']' || next === ':';
      if (closer) { inStr = false; out += '"'; }
      else out += '\\"';
      continue;
    }
    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\r') continue;
    if (ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}

/** Dernier recours, schéma connu (intent / reply / country / hot). La fin du reply est un " dont la suite est }
 *  ou ,"country"|"hot"|"intent". Un reply jamais fermé donne null : on n'envoie pas un bout de phrase coupé.
 *  Un JSON d'un autre schéma (le digest {"rules":…}) n'a ni intent ni reply : null, le parse strict a déjà eu
 *  sa chance. */
function extractLoose(src: string): Record<string, unknown> | null {
  const intentM = /"intent"\s*:\s*"(auto|review|skip|spam|simple|human)"/.exec(src);
  const intent = intentM?.[1] ?? null;
  const reply = extractReply(src);
  if (reply && !reply.closed) return null;
  if (!reply && intent !== 'skip' && intent !== 'spam') return null;
  if (!intent && !reply) return null;
  const out: Record<string, unknown> = {};
  if (intent) out.intent = intent;
  out.reply = reply ? reply.value : '';
  const countryM = /"country"\s*:\s*"([A-Za-z]{2})"/.exec(src);
  if (countryM) out.country = countryM[1];
  else if (/"country"\s*:\s*null/.test(src)) out.country = null;
  if (/"hot"\s*:\s*true/.test(src)) out.hot = true;
  else if (/"hot"\s*:\s*false/.test(src)) out.hot = false;
  return out;
}

function extractReply(src: string): { value: string; closed: boolean } | null {
  const start = /"reply"\s*:\s*"/.exec(src);
  if (!start) return null;
  let i = start.index + start[0].length;
  let value = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const n = src[i + 1];
      if (n === 'n') value += '\n';
      else if (n === 't') value += '\t';
      else if (n === 'r') { /* rien */ }
      else if (n === 'u' && /^[0-9a-fA-F]{4}/.test(src.slice(i + 2, i + 6))) {
        value += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      } else if (n != null) value += n;
      i += n != null ? 2 : 1;
      continue;
    }
    if (ch === '"') {
      const rest = src.slice(i + 1);
      if (/^\s*\}/.test(rest) || /^\s*,\s*"(?:country|hot|intent)"\s*:/.test(rest)) return { value, closed: true };
      value += '"';
      i++;
      continue;
    }
    value += ch;
    i++;
  }
  return { value, closed: false };
}

function jsonObject(raw: string): string | null {
  return /\{[\s\S]*\}/.exec(raw)?.[0] ?? null;
}

/** Parse strict : JSON.parse, puis la réparation des retours à la ligne. Pas l'extracteur lâche (un texte coupé
 *  par max_tokens ne doit pas être « sauvé » et envoyé). */
function parseStrict(raw: string): Record<string, unknown> | null {
  const body = jsonObject(raw);
  if (!body) return null;
  return tryParse(body) ?? tryParse(repairControls(body));
}

/** Le JSON du modèle. `loose: false` s'arrête avant l'extracteur de schéma (max_tokens). null = illisible.
 *  Le digest du soir ({"rules":…}) reste lu par le parse strict : l'extracteur ne le réinterprète pas. */
export function parseModelJson(raw: string, opts?: { loose?: boolean }): Record<string, unknown> | null {
  const strict = parseStrict(raw);
  if (strict) return strict;
  const body = jsonObject(raw);
  if (!body) return null;
  const quoted = tryParse(repairInteriorQuotes(body));
  if (quoted) return quoted;
  if (opts?.loose === false) return null;
  return extractLoose(body);
}

/** UNE 2e TENTATIVE (19/10/2026) : quand un garde-fou refuse la réponse du support de Mathieu, le modèle la réécrit une
 *  fois en sachant pourquoi, au lieu d'une carte vide. Pas pour le bot (le webhook attend) ni si le modèle est tombé.
 *  « nomme le modèle », « se prend pour Mathieu », un refus ou une panne ne se réessaient pas. */
const RETRY_HINT: Record<string, string> = {
  'réponse vide du modèle': 'the JSON parsed but "reply" was empty. If there is nothing to send, use intent "skip" and reply "". Otherwise write 1 or 2 short sentences.',
  'réponse illisible du modèle': 'it was not valid JSON. Return ONLY the JSON object, on one line.',
  'réponse coupée (max_tokens)': 'the answer was cut off. Return a shorter JSON object, on one line.',
  'pourcentage introuvable dans les faits': 'it quoted a percentage that is not in the FACTS (quote none, or one written exactly in the REAL PAST RESULTS block)',
  'réponse trop longue': 'it was too long (1 to 3 short sentences)',
  'parle de gains futurs': 'it talked about what someone will make (never the future)',
  'promesse ou abonnement (« guarantee », « per month »)': 'it used "guarantee" or "per month"',
  'lien du track record': 'it included a track record page link. Remove it. No result figure. The only results link is the Myfxbook URL from the FACTS, copied exactly.',
  'lien de résultats non autorisé': 'it used a Myfxbook URL that is not the one in the FACTS. Copy that URL exactly, or send no results link.',
  'lien myfxbook manquant': 'they asked for results or proof and the reply has no Myfxbook link. Add the exact Myfxbook URL from the FACTS. No result figure.',
  'chiffre de résultat': 'it quoted a figure about the October loss. Remove it: about the loss, only the single sentence from the FACTS, then the Myfxbook URL. No figure.',
  // L'indice ne redit pas le chiffre : sinon la 2e tentative le recopie.
  // 28/10/2026 : les règles dures (hardRules). L'indice dit quoi enlever, sans recopier la phrase fautive.
  'délai promis': `it gave a deadline (today, tomorrow, a few days, a weekday…). No deadline at all. To say you will follow up: "${FOLLOW_UP_LINE}"`,
  'promesse de dédommagement': 'it promised or hinted at a compensation, a refund, getting money back or "solutions". Remove it: nothing is confirmed, promise nothing.',
  'action affirmée': 'it said someone is checking or looking at something right now. Nobody is: say you will check and get back to them, with no deadline.',
  'contenu d’image affirmé': 'it stated what a screenshot or document proves (verified, approved, arrived, done). You cannot verify it: "Thanks, I\'ve received it, I\'ll check and get back to you."',
  'montant du client recalculé': 'it recomputed their balance, profit or loss. Never do that: if their numbers look odd, just ask them to confirm.',
  'date de l’incident': 'it called the incident "last night", "yesterday" or "this morning". It was on 21-22 October.',
  'demande de mot de passe': 'it asked for a password, a token or credentials in the chat. Never: they enter the trader password only in the app.',
  'mot de passe en lecture seule': `it called the trader password read-only. It is not: "${TRADER_PASSWORD_LINE}"`,
  'actif non tradé (crypto)': 'it said Algoria trades crypto or Bitcoin. Algoria AI trades gold (XAU/USD) only.',
  'ça ne se reproduira pas': 'it said the incident cannot happen again. Never say that.',
  'petit échantillon': 'it quoted a number of trades, days or wins. Remove it: the Myfxbook link is the proof.',
  'track record promis plus tard': `it promised the track record later. It exists now: ${MYFXBOOK_URL} then "${PAST_RESULTS_LINE}"`,
  'paragraphe incident déjà envoyé': 'it repeated the incident message (safeguards, broker contact) that this person already received. Answer only their new message, without it.',
  'phrase déjà envoyée': 'it repeated a sentence already sent in this conversation. Say only what is new.',
  'plafond de positions': 'it mentioned a limit on how many trades or positions can be open at once. Delete that limit. The only safeguards to name are a stop within 2 minutes and closing everything if the day reaches −5%.',
};

/** 2e tentative locale à CET appel (27/10/2026). L'indice vient de l'issue de ce run, jamais d'une variable de module. */
export async function settleAttempt<T>(
  mode: 'bot' | 'business' | undefined,
  run: (hint: string | null) => Promise<{ value: T | null; issue: string | null }>,
): Promise<{ value: T | null; issue: string | null; retried: boolean }> {
  const first = await run(null);
  if (first.value || mode !== 'business' || !first.issue || !RETRY_HINT[first.issue]) {
    return { value: first.value, issue: first.issue, retried: false };
  }
  const second = await run(RETRY_HINT[first.issue]);
  return { value: second.value, issue: second.issue, retried: true };
}

const normPct = (x: string) => x.replace(/\s/g, '').replace(',', '.');

/** Page track record de l'app, et tout Myfxbook qui n'est pas dans ALLOWED_RESULT_LINKS. Appelé seulement quand les
 *  résultats sont retenus (prospect, ou incident). Les liens broker ne sont pas des liens de résultats. */
export function resultLinkIssue(text: string): string | null {
  if (/getalgoria\.com\/track-record|algoria\.tech\/track-record/i.test(text)) return 'lien du track record';
  const found = text.match(/https?:\/\/(?:www\.)?myfxbook\.com\/[^\s)>"']+/gi) ?? [];
  for (const raw of found) {
    const got = raw.replace(/[.,;:!?)]+$/g, '').replace(/\/+$/g, '').replace(/^https?:\/\/(?:www\.)?/i, '').toLowerCase();
    const ok = ALLOWED_RESULT_LINKS.some((allowed) => {
      const want = allowed.replace(/\/+$/g, '').replace(/^https?:\/\/(?:www\.)?/i, '').toLowerCase();
      return got === want;
    });
    if (!ok) return 'lien de résultats non autorisé';
  }
  return null;
}

const WANTS_PROOF = /\b(results?|performance|profits?|track ?record|win ?rate|myfxbook|proof|prove)\b/i;

/** La page track record, écrite ou en lien, ne doit pas arriver au modèle quand les résultats sont retenus.
 *  Le Myfxbook n'est pas concerné : c'est le lien qu'on veut qu'il recopie. */
function hideTrackLinks(s: string): string {
  return s
    .replace(/https?:\/\/(?:www\.)?(?:getalgoria\.com|algoria\.tech)\/track-record\b/gi, 'the in-app history (do not link it)')
    .replace(/\b(?:getalgoria\.com|algoria\.tech)\/track-record\b/gi, 'the in-app history (do not link it)');
}

/** 27/10/2026, Mathieu : on envoie environ 5 trades par jour, la limite de 10 positions n'apporte rien à un
 *  prospect. On l'enlève des faits, et aussi du knowledge s'il l'écrit encore : sinon le modèle la recopie.
 *  Le plafond du runner, lui, ne change pas. */
const positionCap = () => /\b(?:(?:never|no) more than|maximum of|max(?:imum)?|up to|limit of|cap of|plafond de|pas plus de|jamais plus de)\s+10\s+(?:open\s+|simultaneous\s+|ouvertes?\s+)?(?:trades?|positions?)\b(?:\s+open(?:\s+at once)?|\s+en même temps)?|\b10\s+(?:open\s+|simultaneous\s+|ouvertes?\s+)?(?:trades?|positions?)\b(?:\s+open(?:\s+at once)?|\s+max(?:imum)?|\s+en même temps)?/gi;

export function mentionsPositionCap(text: string): boolean {
  return positionCap().test(text);
}

function hidePositionCap(s: string): string {
  return s
    .replace(positionCap(), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\(\s*,/g, '(')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\)/g, ')');
}

export interface DraftSystemInput {
  biz: boolean;
  locale?: string | null;
  knowledge: string | null;
  memory: string | null;
  trackNow: string | null;
  webinar: string | null;
  status?: string | null;
  now?: number;
  /** Uniquement pour le script de contrôle. En production, la constante HISTORY_MAINTENANCE. */
  historyMaintenance?: boolean;
}

/** Le prompt réellement envoyé, et la politique qui l'a choisi. Le script de contrôle appelle ÇA, pas une copie. */
export function buildDraftSystem(o: DraftSystemInput): { system: string; policy: ResultsPolicy; knowledge: string | null; knownPct: string[] } {
  const policy = resultsPolicy({ now: o.now, status: o.status, historyMaintenance: o.historyMaintenance });
  const hold = policy !== 'open';
  const track = policy === 'incident' ? INCIDENT_NOTE : policy === 'maintenance' ? HISTORY_RESULTS_NOTE : o.trackNow;
  const raw = o.biz
    ? businessSystem(o.knowledge, o.memory, track, o.webinar, hold)
    : system(o.locale ?? 'en', o.knowledge, o.memory, track, o.webinar, hold);
  // Les % du knowledge (un +40 % qu'il a écrit un jour) ne sont pas citables quand les résultats sont retenus.
  // Calculés AVANT hideTrackLinks : ce remplacement peut casser la sous-chaîne du knowledge.
  const pctSource = hold && o.knowledge ? raw.split(o.knowledge).join('') : raw;
  const knownPct = [...new Set((pctSource.match(/\d+(?:[.,]\d+)?\s?%/g) ?? []).map(normPct))];
  const shown = hold ? hidePositionCap(hideTrackLinks(raw)) : raw;
  return { system: shown, policy, knowledge: o.knowledge, knownPct };
}

// ── LES RÈGLES DURES EN CODE (28/10/2026) ──────────────────────────────────────────────────────────────
// Le prompt les dit (hardRules), le code les refuse : un refus déclenche la 2e tentative avec l'indice, puis une
// carte sans bouton Envoyer. Elles ne remplacent aucun garde-fou existant, elles s'ajoutent.

const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
// un délai : aujourd'hui, demain, « in the next few days », une heure, un jour de la semaine
const DEADLINE = /\b(?:today|tonight|tomorrow|this (?:morning|afternoon|evening|week|weekend)|later today|(?:in|within) (?:the )?(?:next |coming )?(?:a few |a couple of |few |couple of |\d+ |an? )?(?:minutes?|mins?|hours?|days?|weeks?)|(?:next|coming) (?:few )?days|a few days|end of (?:the )?(?:day|week)|asap|as soon as possible|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
// … collé à un engagement de NOTRE part (revenir, répondre, vérifier, régler, une solution)
const COMMIT = /\b(?:get back|come back|reply|answer|contact\w*|reach out|update you|let you know|tell you|text you|message you|call you|be in touch|news|solutions?|sort (?:it|this|that)|fix|refund\w*|compensat\w*|confirm|check\w*|look(?:ing)? (?:at|into)|review|have (?:an |the )?answer)\b/i;
const EVENT = /\b(?:webinar|zoom|live session|session|market|gold is (?:closed|open)|trades? (?:will )?(?:show|start))\b/i;
export function deadlineIssue(text: string): boolean {
  return sentences(text).some((x) => DEADLINE.test(x) && COMMIT.test(x) && !EVENT.test(x));
}
// une négation juste avant (« I can't promise a refund ») n'est pas une promesse ; « No worries, we'll refund you » l'est
const NEGATED_BEFORE = /\b(?:can(?:'|no)?t|cannot|won'?t|not|never|nothing|nobody|no)\b(?:\s+[^\s,;:]+){0,4}\s*$/i;
const COMPENSATION = /\b(?:compensat\w*|refund\w*|reimburs\w*|money back|get (?:your |the |all )?(?:money|funds|losses?|balance) back|recover (?:your |the |all )?(?:money|funds|loss(?:es)?|account|balance)|help you recover|cover (?:your |the )?loss(?:es)?|make (?:it|this|things) right)\b/i;
// « une solution » n'est une promesse que si la phrase parle de la perte (« we'll find another solution » pour un
// compte VT déjà ouvert est une réponse normale)
const SOLUTION = /\b(?:find|found|finding|working on|look(?:ing)? for)\b[^.!?\n]{0,30}\bsolutions?\b/i;
const LOSS_CONTEXT = /\b(?:loss(?:es)?|lost|money|funds|balance|incident|failure|what happened|affected)\b/i;
export function compensationIssue(text: string): boolean {
  return sentences(text).some((x) => {
    if (/\?\s*$/.test(x)) return false; // reprise d'une question (« Money back ? »)
    const m = COMPENSATION.exec(x) ?? (LOSS_CONTEXT.test(x) ? SOLUTION.exec(x) : null);
    return !!m && !NEGATED_BEFORE.test(x.slice(0, m.index));
  });
}
const ACTION = /\b(?:I'?m|I am|he'?s|he is|Mathieu(?:'s| is)|we'?re|we are|the team is)\s+(?:already\s+|currently\s+|now\s+|personally\s+|still\s+)?(?:checking|looking (?:at|into)|reviewing|going through|investigating|verifying|contacting|calling|talking to|speaking (?:to|with)|working on (?:it|your|this))\b/i;
export const actionClaim = (text: string) => ACTION.test(text);
const STATUS_CLAIM = /\b(?:your|the)\s+(?:identity|id|kyc|documents?|proof of (?:address|identity)|account|deposit|transfer|payment|withdrawal|funds?|verification|cpa transfer)\s+(?:is|are|has been|have been|was|were|got|looks?|seems?)\s+(?:now\s+|already\s+|all\s+|fully\s+)?(?:verified|approved|validated|confirmed|accepted|done|complete|completed|successful|credited|received|arrived|through)\b|\b(?:transfer|deposit|payment)\s+(?:shows?|went)\s+(?:success|through)\b|\bidentity (?:is )?(?:now )?(?:verified|approved)\b/i;
// « text me when the deposit is done », « the deposit is done online on the broker's page » ne sont pas des constats
export const statusClaim = (text: string) => sentences(text).some((x) => {
  const m = STATUS_CLAIM.exec(x);
  return !!m && !/\b(?:when|once|after|if|until|before|as soon as)\b(?:\s+\S+){0,3}\s*$/i.test(x.slice(0, m.index)) && !/^\s*(?:online|on (?:the|your|their)|by|directly|from|with)\b/i.test(x.slice(m.index + m[0].length));
});
const RECOMPUTE = /\byou (?:actually |really |only |just |still )?(?:gained|made|won|earned|profited|lost|are up|are down)\s+(?:about |around |roughly |only |just )?[£$€]?\s?\d/i;
const INCIDENT_WHEN = /\b(?:failure|incident|crash|glitch|bug|what happened|the loss|losses|blow ?up|wiped)\b[^.!?\n]{0,50}\b(?:last night|this morning|yesterday|tonight|earlier today)\b|\b(?:last night|this morning|yesterday)(?:'s)?\b[^.!?\n]{0,30}\b(?:failure|incident|crash|glitch|bug|loss)\b/i;
/** « last night » sur l'incident, une fois passé le lendemain de la nuit du 21-22/10. */
export function incidentDateIssue(text: string, now = Date.now()): boolean {
  return now > Date.parse(INCIDENT.start) + 36 * 3_600_000 && INCIDENT_WHEN.test(text);
}
const PWD_NEG = /\b(?:never|don'?t|do not|no need to|please don'?t|not)\s+(?:\w+\s+){0,2}(?:send|share|give|write|type|paste|tell)\b[^.!?\n]*/gi;
const PWD_ASK = /\b(?:send|give|share|paste|forward)\b[^.!?\n,;]{0,40}\b(?:password|passcode|pwd|token|api key|seed phrase|private key|credentials|2fa code|otp)\b|\btell (?:me|us) (?:your|the)\b[^.!?\n,;]{0,20}\b(?:password|passcode|pwd|token|api key|seed phrase|private key|credentials|2fa code|otp)\b|\b(?:I|we|Mathieu|he)(?:'ll| will)?\s+need\s+your\b[^.!?\n]{0,40}\b(?:password|token|credentials)\b|\bwhat(?:'s| is) your (?:\w+ )?password\b/i;
// « the only thing you give in the app is your trader password » dit OÙ le saisir : pas une demande dans le chat
export const passwordAsk = (text: string) => sentences(text.replace(PWD_NEG, '')).some((x) => PWD_ASK.test(x) && !/\bin the (?:algoria )?app\b/i.test(x));
export const readOnlyPassword = (text: string) => sentences(text).some((x) => /\bread[- ]?only\b/i.test(x) && /\b(?:password|trader|connect\w*|copy\w*|copier)\b/i.test(x) && !/\binvestor\b/i.test(x));
const COIN = '(?:crypto(?:s|currenc(?:y|ies))?|bitcoin|btc|ethereum)';
const CRYPTO = new RegExp(`\\b(?:algoria(?: ai)?|the ai|the bot|it|she|we|the engine|the system)\\s+(?:also\\s+|only\\s+|now\\s+)?(?:trades?|is trading|traded|trades on)\\b[^.!?\\n]{0,40}\\b${COIN}\\b|\\b(?:gold|xau\\s?\\/?\\s?usd)\\s*(?:and|&|\\+|or)\\s*${COIN}\\b|\\b${COIN}\\s+(?:trades?|positions?)\\b|\\btrad(?:es|ing) ${COIN}\\b`, 'i');
// « it trades gold only, no crypto » est juste : une phrase qui nie n'est pas refusée
export const cryptoClaim = (text: string) => sentences(text).some((x) => CRYPTO.test(x) && !/\b(?:no|not|never|only gold|gold only)\b|n't\b|\bonly\b[^.!?]{0,20}\bgold\b/i.test(x));
const NEVER_AGAIN = /\b(?:can(?:'|no)?t|cannot|won'?t|will not|will never|could never|never)\s+happen\s+again\b/i;
const SMALL_SAMPLE = /\b\d+\s+(?:winning\s+|losing\s+|closed\s+)?(?:trades?|positions?)\s+(?:a|per)\s+(?:day|week)\b|\b\d+\s+(?:winning|losing|closed|profitable)\s+trades?\b|\b\d+\s+(?:wins?|losses)\s+(?:in a row|out of)\b|\b\d+\s*\/\s*\d+\s+(?:trades?|wins?)\b/i;
const TRACK_LATER = /\b(?:once|when) it has (?:a few|some|enough|a couple of|more) (?:weeks|days|months|trades)\b|\bin a few weeks\b|\btrack ?record\b[^.!?\n]{0,40}\b(?:coming|soon|later|ready)\b|\bI'?ll share (?:it|the track ?record|the results)\b/i;
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Une phrase de 40 caractères ou plus déjà envoyée telle quelle, ou le paragraphe d'incident déjà reçu. */
export function repeatIssue(text: string, before: string[]): 'paragraphe incident déjà envoyé' | 'phrase déjà envoyée' | null {
  if (!before.length) return null;
  if (INCIDENT_PARAGRAPH.test(text) && before.some((b) => INCIDENT_PARAGRAPH.test(b))) return 'paragraphe incident déjà envoyé';
  const old = new Set(before.flatMap(sentences).map(norm).filter((x) => x.length >= 40));
  return sentences(text).map(norm).some((x) => x.length >= 40 && old.has(x)) ? 'phrase déjà envoyée' : null;
}
/** algoria.tech est suspendu depuis le 22/10 : un lien vers l'ancien domaine est réécrit vers getalgoria.com. */
export function fixOldDomain(text: string): string {
  return text
    .replace(/https?:\/\/app\.algoria\.tech/gi, 'https://app.getalgoria.com')
    .replace(/\bapp\.algoria\.tech\b/gi, 'app.getalgoria.com')
    .replace(/https?:\/\/(?:www\.)?algoria\.tech/gi, 'https://getalgoria.com')
    .replace(/\b(?:www\.)?algoria\.tech\/([\w-])/gi, 'getalgoria.com/$1');
}
const HAS_DISCLAIMER = /(?:past|previous) (?:results?|performance)[^.!?\n]*?(?:do not|don't|does not|doesn't|never|can't|cannot) (?:guarantee|predict)/i;
/** Le lien Myfxbook est toujours suivi de l'avertissement (28/10/2026) : ajouté s'il manque. */
export function withPastDisclaimer(text: string): string {
  if (!text.includes(MYFXBOOK_URL) || HAS_DISCLAIMER.test(text)) return text;
  return `${text.replace(/\s+$/, '')}${/[.!?]$/.test(text.trim()) || text.trim().endsWith(MYFXBOOK_URL) ? '' : '.'} ${PAST_RESULTS_LINE}`;
}
/** Le premier refus des règles dures, ou null. */
export function hardRuleIssue(text: string, o: { sentBefore?: string[]; now?: number } = {}): string | null {
  if (deadlineIssue(text)) return 'délai promis';
  if (compensationIssue(text)) return 'promesse de dédommagement';
  if (actionClaim(text)) return 'action affirmée';
  if (statusClaim(text)) return 'contenu d’image affirmé';
  if (RECOMPUTE.test(text)) return 'montant du client recalculé';
  if (incidentDateIssue(text, o.now)) return 'date de l’incident';
  if (passwordAsk(text)) return 'demande de mot de passe';
  if (readOnlyPassword(text)) return 'mot de passe en lecture seule';
  if (cryptoClaim(text)) return 'actif non tradé (crypto)';
  if (NEVER_AGAIN.test(text)) return 'ça ne se reproduira pas';
  if (SMALL_SAMPLE.test(text)) return 'petit échantillon';
  if (TRACK_LATER.test(text)) return 'track record promis plus tard';
  return repeatIssue(text, o.sentBefore ?? []);
}

/** Garde-fous de sortie, les mêmes qu'avant pour le mode ouvert, plus le lien Myfxbook quand les résultats sont
 *  retenus. Un texte refusé ne devient jamais un brouillon envoyable : la carte n'a pas de bouton Envoyer dessus. */
export function assessModelOutput(raw: string, opts: {
  biz: boolean;
  locale?: string | null;
  sys: string;
  userText: string;
  holdResults: boolean;
  knowledge?: string | null;
  knownPct?: string[];
  stopReason?: string | null;
  /** 28/10/2026 : ce qui a déjà été envoyé à cette personne (répétition du paragraphe d'incident, phrases). */
  sentBefore?: string[];
  /** Pour le script de contrôle (date de l'incident). */
  now?: number;
}): { draft: Draft | null; issue: string | null } {
  if (opts.stopReason === 'refusal') return { draft: null, issue: 'modèle a refusé' };
  const strict = parseStrict(raw);
  if (opts.stopReason === 'max_tokens' && !strict) return { draft: null, issue: 'réponse coupée (max_tokens)' };
  const j = strict ?? parseModelJson(raw);
  if (!j) return { draft: null, issue: 'réponse illisible du modèle' };
  const intent = typeof j.intent === 'string' ? j.intent : 'human';
  let country: string | null = null;
  let hot = false;
  if (opts.biz) {
    if (typeof j.country === 'string' && /^[A-Za-z]{2}$/.test(j.country)) country = j.country.toUpperCase();
    hot = j.hot === true;
  }
  if (intent === 'spam') return { draft: { text: '', auto: false, spam: true }, issue: null };
  if (opts.biz && intent === 'skip') return { draft: { text: '', auto: false, skip: true, country, hot }, issue: null };
  const reply = j.reply == null ? '' : String(j.reply);
  // 28/10/2026 : l'ancien domaine est réécrit, puis l'avertissement suit toujours le Myfxbook (avant les gardes :
  // ce qui part est ce qui est contrôlé)
  const out = withPastDisclaimer(fixOldDomain(humanize(reply.trim().replace(/^["“«]\s*|\s*["”»]$/g, ''), opts.biz)));
  if (!out) return { draft: null, issue: 'réponse vide du modèle' };
  if (out.length > (opts.biz ? 1400 : 900)) return { draft: null, issue: 'réponse trop longue' };
  if (/\b(language model|chatgpt|openai|anthropic|claude)\b/i.test(out)) return { draft: null, issue: 'nomme le modèle' };
  if (!opts.biz && /\b(i am mathieu|i'm mathieu|sono mathieu)\b/i.test(out)) return { draft: null, issue: 'se prend pour Mathieu' };
  const noDisclaimer = out.replace(/(past|previous) (results?|performance)[^.!?\n]*?(do not|don't|does not|doesn't|never|can't|cannot) (guarantee|predict)[^.!?\n]*/gi, '');
  if (/\b(guarantee|garantit|garantisc|guaranteed|monthly fee|subscription fee|per month)\b/i.test(noDisclaimer)) return { draft: null, issue: 'promesse ou abonnement (« guarantee », « per month »)' };
  if (opts.holdResults) {
    const linkIssue = resultLinkIssue(out);
    if (linkIssue) return { draft: null, issue: linkIssue };
    // 28/10/2026 (Mathieu) : le chiffre de la perte d'octobre ne part plus, même si on demande ce qui s'est passé
    if (/\b85\s?%/.test(out)) return { draft: null, issue: 'chiffre de résultat' };
    if (WANTS_PROOF.test(opts.userText) && !out.includes(MYFXBOOK_URL)) return { draft: null, issue: 'lien myfxbook manquant' };
    if (mentionsPositionCap(out)) return { draft: null, issue: 'plafond de positions' };
  }
  const known = new Set(opts.knownPct ?? (() => {
    const src = opts.holdResults && opts.knowledge ? opts.sys.split(opts.knowledge).join('') : opts.sys;
    return (src.match(/\d+(?:[.,]\d+)?\s?%/g) ?? []).map(normPct);
  })());
  if ((out.match(/\d+(?:[.,]\d+)?\s?%/g) ?? []).some((x) => !known.has(normPct(x)))) return { draft: null, issue: 'pourcentage introuvable dans les faits' };
  if (/\b(you(?:'ll| will| could| can) (?:make|earn|get|expect)|expected (?:return|profit)|per (?:day|week) on average|on average per (?:day|week))\b/i.test(out)) return { draft: null, issue: 'parle de gains futurs' };
  const hard = hardRuleIssue(out, { sentBefore: opts.sentBefore, now: opts.now });
  if (hard) return { draft: null, issue: hard };
  if (opts.biz) return { draft: { text: out, auto: intent === 'auto', country, hot }, issue: null };
  const loc = (opts.locale ?? 'en') === 'it' ? 'it' : 'en';
  return { draft: { text: `${out}\n\n${SIGNATURE[loc]}`, auto: intent === 'simple' }, issue: null };
}

export async function draftReply(i: DraftInput): Promise<DraftResult> {
  let partial: Omit<DraftTrace, 'issue' | 'retried'> = emptyPartial();
  const settled = await settleAttempt(i.mode, async (hint) => {
    const req = hint ? { ...i, timeoutMs: Math.min(i.timeoutMs ?? 8000, 20_000) } : i;
    const r = await attempt(req, hint);
    partial = r.partial;
    return { value: r.draft, issue: r.issue };
  });
  return { draft: settled.value, trace: { ...partial, issue: settled.issue, retried: settled.retried } };
}

function emptyPartial(): Omit<DraftTrace, 'issue' | 'retried'> {
  return { model: null, stop: null, raw: null, knowledgeAt: null, memoryAt: null, knowledgeHash: null, memoryHash: null };
}

async function attempt(i: DraftInput, retry: string | null): Promise<{ draft: Draft | null; issue: string | null; partial: Omit<DraftTrace, 'issue' | 'retried'> }> {
  const partial = emptyPartial();
  if (!process.env.ANTHROPIC_API_KEY) return { draft: null, issue: 'clé du modèle absente', partial };
  const statusLine = (() => {
    if (!i.member) return 'no account in the app yet';
    const st = i.member?.status ?? 'unknown';
    const since = i.member?.connected_at ? ` since ${new Date(i.member.connected_at).toISOString().slice(0, 10)}` : '';
    if (st === 'live') return `live: connected, the copy is ON, copying ALGORIA 2.0 at ${i.member?.broker ?? 'their broker'}${since}`;
    if (st === 'paused') return `paused: connected but the copy is paused, at ${i.member?.broker ?? 'their broker'}${since}`;
    if (st === 'pending_copier') return 'account submitted, the team is verifying it (activation trades may still be missing)';
    if (st === 'onboarding') return i.member?.broker ? `signed up, chose ${i.member.broker}, account not connected yet` : 'signed up, has not chosen a broker yet';
    return st;
  })();
  const biz = i.mode === 'business';
  const requested = biz ? SUPPORT_MODEL : MODEL;
  const [them, us] = biz ? ['Client', 'Mathieu'] : ['Member', 'Algoria'];
  const history = i.history.length ? i.history.map((h) => `${h.from === 'member' ? them : us}: ${h.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n') : '(none)';
  const user = `${them}: ${i.member?.member_no != null ? `member #${i.member.member_no}` : biz ? 'not an Algoria member yet' : 'unknown'} ${i.member?.tg_username ? '@' + i.member.tg_username : (i.member?.tg_name ?? '')}\nStatus: ${statusLine}\nApp language: ${i.locale ?? 'en'}\n\nRecent exchange:\n${history}\n\nNew message from the ${them.toLowerCase()} (people often split one sentence over several messages, like "how" / "are" / "you ?": read the lines below together as ONE message, with the Recent exchange, and answer the whole; never answer one piece on its own)${i.images?.length ? ` (with ${i.images.length} screenshot${i.images.length > 1 ? 's' : ''}, above)` : ''}:\n"""${i.text.slice(0, 1200)}"""${i.note ? `\n\nNote: ${i.note}` : ''}${retry ? `\n\nYour previous answer was rejected: ${retry}. Write it again.` : ''}\n\nReturn the JSON, on ONE line (write \\n inside the "reply" string for a line break).`;
  try {
    const client = new Anthropic({ timeout: i.timeoutMs ?? 8000, maxRetries: 0 });
    // 🎤 la prochaine session de webinaire (24/10/2026) : sa date vient de la base, jamais du knowledge
    const [kMeta, mMeta, trackNow, webinar] = await Promise.all([
      getAgentDocMeta('knowledge'), getAgentDocMeta('memory'), trackFacts(), webinarFacts(sdb()).catch(() => null),
    ]);
    partial.knowledgeAt = kMeta.updatedAt;
    partial.memoryAt = mMeta.updatedAt;
    partial.knowledgeHash = kMeta.hash;
    partial.memoryHash = mMeta.hash;
    // 27/10/2026 : la politique (incident / maintenance / ouvert) choisit le bloc, pas seulement incidentActive().
    // Après le 05/11 un prospect ne revoit ni les chiffres ni la page track record tant que l'historique est masqué.
    const built = buildDraftSystem({
      biz, locale: i.locale, knowledge: kMeta.text, memory: mMeta.text, trackNow, webinar, status: i.member?.status ?? null,
    });
    // LE SUPPORT DE MATHIEU (16/10/2026) : ses réponses partent seules quand le modèle est sûr, donc le meilleur modèle
    // (ALGORIA_SUPPORT_MODEL). Le prompt système (faits, knowledge, mémoire) est le même d'un message à l'autre : mis en
    // cache, il ne se paie plein tarif qu'une fois toutes les quelques minutes.
    const res = await client.messages.create({
      model: requested,
      max_tokens: biz ? 700 : 350,
      system: [{ type: 'text', text: built.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: biz && i.images?.length
        ? [...i.images.slice(0, 3).map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.media_type, data: im.data } })), { type: 'text' as const, text: user }]
        : user }],
    });
    partial.model = res.model || requested;
    partial.stop = res.stop_reason ?? null;
    const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
    partial.raw = clipModelRaw(raw);
    const judged = assessModelOutput(raw, {
      biz, locale: i.locale, sys: built.system, userText: i.text, holdResults: built.policy !== 'open',
      knowledge: built.knowledge, knownPct: built.knownPct, stopReason: res.stop_reason,
      sentBefore: [...(i.sentBefore ?? []), ...i.history.filter((h) => h.from === 'algoria').map((h) => h.text)],
    });
    return { ...judged, partial };
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    console.error('[replyDraft] failed:', msg);
    partial.model = requested;
    return { draft: null, issue: `modèle indisponible (${msg.slice(0, 80)})`, partial };
  }
}
