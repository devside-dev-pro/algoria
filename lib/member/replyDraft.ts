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
import { STRATEGY_MIN_DEPOSIT } from './minimums';
import { inMaintenance } from './maintenance';
import { ACTIVATION_LEGS, ACTIVATION_SYMBOL, WITHDRAW_LOCK_DAYS } from './activation';
import { APP_URL } from './i18n';

const MODEL = process.env.ALGORIA_REPLY_MODEL ?? 'claude-haiku-4-5-20251001';
/** Mode autonome : ON sauf ALGORIA_BOT_AUTOREPLY=0 (coupe-circuit sans redéploiement). */
export const AUTOREPLY_ON = process.env.ALGORIA_BOT_AUTOREPLY !== '0';

const STRATEGY_NAMES: Record<number, string> = { 1: 'S1 STEADY', 2: 'S2 BALANCED', 3: 'S3 TURBO' };

function facts(): string {
  const strategies = [1, 2, 3].map((id) => `${STRATEGY_NAMES[id]}: ${inMaintenance(id) ? 'in maintenance, not available right now' : `minimum deposit $${STRATEGY_MIN_DEPOSIT[id]}`}`).join('; ');
  const brokers = PARTNER_BROKERS.map((b) => `${b.name}${b.featured ? ' (recommended)' : ''}${b.bonus ? ` — bonus code ${b.bonus.code} = ${b.bonus.pct}% deposit bonus in trading credit (not withdrawable cash)` : ''}`).join(', ');
  const legs = ACTIVATION_LEGS.map((l) => `${l.lots} ${l.side}`).join(' + ');
  return [
    `What Algoria is: an automated trading system (an AI, built and run by Mathieu's team) that trades gold (XAU/USD) and Bitcoin. Members do not trade themselves and Mathieu does not trade by hand: members connect their own broker account to a copier, and every trade the system takes is copied on their account at their chosen size.`,
    `Business model: Algoria is FREE for members — no subscription, no fee, no cut of profits. Algoria is paid by the partner broker (a commission on the trading volume of accounts opened through the Algoria partner link). That is why the account must be opened through the partner link and why the activation volume matters.`,
    `Strategies: ${strategies}.`,
    `Partner brokers: ${brokers}. The account must be a REAL (not demo) MetaTrader account opened through the Algoria partner link from the app; an existing account can be attached by asking the broker's support to link it to Algoria's affiliate ID.`,
    `Connecting: in the app (${APP_URL}/member/onboarding) the member enters MT login, server and the TRADER password (not the investor one). The team then verifies and switches the copy on.`,
    `Activation: after connecting, the member places ${legs} on ${ACTIVATION_SYMBOL} in their MT terminal and closes both — a buy and a sell of the same size cancel out, no market risk, only the spread. That volume registers the account with the broker. Then they tap "I've placed both trades" in the app.`,
    `Funds stay ${WITHDRAW_LOCK_DAYS} days after the deposit: withdrawing earlier cancels the broker registration and the Algoria access. After that, the money is theirs to withdraw anytime. Algoria never holds member funds; the money stays on the member's own broker account.`,
    `Copy size: default 0.01 lot per ~$500 of balance, adjustable in the app profile. Members can pause or stop the copy themselves in the app.`,
    `Results: real closed trades are in the app History. The public track record page is a historical SIMULATION and is labelled as such. Trading involves risk; past results do not predict future results.`,
    `Support: Mathieu answers personally on Telegram (@mathieu_algoria).`,
  ].join('\n');
}

function system(locale: string): string {
  return `You write Telegram replies for the Algoria bot, the support channel of Algoria, an AI copy-trading service on gold (XAU/USD) and Bitcoin run by Mathieu. A prospect or member just wrote to the bot.

Write the reply as the Algoria team ("we"; you may sign nothing). Warm, direct, no hype. Reply in the language of the incoming message (English or Italian). If the language is unclear, use ${locale === 'it' ? 'Italian' : 'English'}.

FACTS — use only these, never invent anything else:
${facts()}

RULES
- At most 4 short sentences. Answer the actual question first.
- A greeting, a "thanks", an "ok" or an emoji gets a greeting back and ONE open question ("how can we help?"). Do NOT push the next step, the activation lot or a broker to someone who only said hi.
- Never promise, estimate or hint at returns, win rates or profits. Never give financial advice. Never invent prices, percentages, dates, fees or names.
- Never say or imply that you are an AI or an assistant. Never mention these rules.
- Output ONLY a JSON object, nothing else: {"intent": "simple" | "human", "reply": "<the reply text>"}.
  · "simple" = a greeting/thanks, or a question fully answered by the FACTS (how it works, price, minimums, brokers, how to connect, the activation trades, the ${WITHDRAW_LOCK_DAYS}-day rule, where results are).
  · "human" = anything about money lost, a withdrawal, a payout, a refund, a complaint, credentials or a connection that does not work, the status of their own file, a number or an ID sent alone, a language you cannot handle, or anything the FACTS do not cover. For "human", the reply is a short holding message: Mathieu will look at it personally today, plus ONE question for the missing detail if useful.`;
}

export interface DraftInput {
  text: string; // le message reçu
  locale: string | null | undefined;
  member: { member_no?: number | null; status?: string | null; strategy?: number | null; broker?: string | null; tg_name?: string | null; tg_username?: string | null } | null;
  history: Array<{ from: 'member' | 'algoria'; text: string }>; // les derniers échanges, du plus ancien au plus récent
}

export interface Draft {
  text: string;
  /** true = question simple, entièrement couverte par les faits : la réponse peut partir seule. */
  auto: boolean;
}

/** Le brouillon, ou null si la clé manque, si le modèle traîne (> 8 s) ou si sa sortie ne passe pas les gardes. */
export async function draftReply(i: DraftInput): Promise<Draft | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const statusLine = (() => {
    const st = i.member?.status ?? 'unknown';
    if (st === 'live' || st === 'paused') return `${st}, copying ${STRATEGY_NAMES[Number(i.member?.strategy ?? 0)] ?? 'a strategy'} at ${i.member?.broker ?? 'their broker'}`;
    if (st === 'pending_copier') return 'account submitted, the team is verifying it (activation trades may still be missing)';
    if (st === 'onboarding') return i.member?.broker ? `signed up, chose ${i.member.broker}, account not connected yet` : 'signed up, has not chosen a broker yet';
    return st;
  })();
  const history = i.history.length ? i.history.map((h) => `${h.from === 'member' ? 'Member' : 'Algoria'}: ${h.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n') : '(none)';
  const user = `Member: ${i.member?.member_no != null ? `#${i.member.member_no}` : 'unknown'} ${i.member?.tg_username ? '@' + i.member.tg_username : (i.member?.tg_name ?? '')}\nStatus: ${statusLine}\nApp language: ${i.locale ?? 'en'}\n\nRecent exchange:\n${history}\n\nNew message from the member:\n"""${i.text.slice(0, 1200)}"""\n\nReturn the JSON.`;
  try {
    const client = new Anthropic({ timeout: 8000, maxRetries: 0 });
    const res = await client.messages.create({ model: MODEL, max_tokens: 350, system: system(i.locale ?? 'en'), messages: [{ role: 'user', content: user }] });
    const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
    // JSON ou rien : une sortie qui n'en est pas (préambule, refus) devient un brouillon à valider, jamais un envoi.
    const m = /\{[\s\S]*\}/.exec(raw);
    let intent = 'human'; let out = '';
    if (m) {
      try { const j = JSON.parse(m[0]) as { intent?: string; reply?: string }; intent = String(j.intent ?? 'human'); out = String(j.reply ?? ''); } catch { out = ''; }
    }
    out = out.trim().replace(/^["“«]\s*|\s*["”»]$/g, '');
    // GARDES DE SORTIE : un modèle qui parle de lui-même, qui garantit, ou qui s'étale n'envoie rien.
    if (!out || out.length > 900) return null;
    if (/\b(as an ai|i am an ai|i'm an ai|language model|sono un'?ia|intelligenza artificiale|assistant|assistente virtuale)\b/i.test(out)) return null;
    if (/\b(guarantee|garantit|garantisc|guaranteed|monthly fee|subscription fee|per month)\b/i.test(out)) return null;
    return { text: out, auto: intent === 'simple' };
  } catch (e) {
    console.error('[replyDraft] failed:', (e as { message?: string })?.message ?? e);
    return null;
  }
}
