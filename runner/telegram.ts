// Canal VIP Telegram — Algoria y publie son activité et, une fois sa journée finie (dayDone),
// les setups qu'il voit mais ne prend plus → les VIP tradent en manuel s'ils le veulent.
// GATÉ : no-op tant que TELEGRAM_BOT_TOKEN + TELEGRAM_VIP_CHAT ne sont pas posés (Railway).
// TELEGRAM_VIP_CHAT = l'id du canal (ex. "-1001234567890") — le bot doit y être ADMIN.
import { ACTIVE_STRATEGY } from '../lib/engine/strategies';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const VIP = process.env.TELEGRAM_VIP_CHAT ?? '';

/** Le canal VIP est-il configuré ? (sinon tous les posts sont des no-op silencieux). */
export const vipReady = (): boolean => Boolean(TOKEN && VIP);

/** Id du canal VIP, tel que posé dans TELEGRAM_VIP_CHAT ('' si non configuré).
 *  Exporté pour que l'auto-approbation des adhésions puisse EXCLURE ce canal : le VIP se valide à la
 *  main (décision Mathieu du 24/08 — voir autoApproveJoins dans runner/index.ts). */
export const VIP_CHAT: string = VIP;

/** Étiquette de LA stratégie de ce runner — chaque message VIP dit QUI parle (les 3 runners postent). */
export const VIP_TAG: string = { 1: '🌱 S1 STEADY', 2: '⚖️ S2 BALANCED', 3: '🚀 S3 TURBO' }[ACTIVE_STRATEGY.id] ?? `S${ACTIVE_STRATEGY.id}`;

/** Montant formaté propre : $1,632 (séparateur de milliers) — signe géré par l'appelant. */
export const usd = (n: number): string => '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
/** Filet de séparation léger pour aérer les cartes VIP. */
export const VIP_RULE = '━━━━━━━━━━━━━';

/**
 * APPROUVE une demande d'adhésion au canal (31/07 — Mathieu les acceptait par lots à la main).
 * Renvoie { ok } si Telegram a accepté, sinon { ok:false, error } :
 *  · error non vide = refus STRUCTUREL (déjà membre, demande expirée/annulée) → ne pas retenter ;
 *  · error null + ok false = pépin réseau → l'appelant laisse la demande en file pour le tick suivant.
 */
export async function approveJoinRequest(chatId: number, userId: number): Promise<{ ok: boolean; error: string | null }> {
  if (!TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN missing' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/approveChatJoinRequest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return d.ok ? { ok: true, error: null } : { ok: false, error: d.description ?? `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: null }; // réseau : on retentera
  }
}

/** DM direct du bot à UN utilisateur (relance onboarding…). Ne marche que si la personne a déjà ouvert le
 *  chat du bot (login natif /start → oui). Renvoie true si envoyé — 403 = chat jamais ouvert, on l'accepte. */
/** @param button bouton optionnel sous le message (libellé + URL) — un tap vaut mieux qu'un pseudo à
 *  recopier, et les relances automatiques doivent TOUJOURS offrir une porte vers l'humain : ce bot ne
 *  répond pas aux questions, une réponse à un de ses DM peut rester longtemps sans réaction. */
// Motif du DERNIER refus d'envoi, lu juste après l'appel. Volontairement un module-level simple plutôt
// qu'un changement de signature : `sendDm` a plusieurs appelants qui n'ont que faire de l'erreur, et leur
// imposer un type de retour composite pour un seul cas d'usage serait payer partout pour un besoin local.
// Corollaire à respecter : le lire IMMÉDIATEMENT après l'appel, jamais plus tard.
let lastDmError: string | null = null;
export const lastDmFailure = (): string | null => lastDmError;

export async function sendDm(
  tgId: number,
  text: string,
  // Un bouton simple, OU un clavier complet (plusieurs rangées — voir ctaKeyboard dans lib/member/i18n.ts).
  // La forme « un bouton » reste acceptée pour ne pas casser les appels existants.
  button?: { text: string; url: string } | { inline_keyboard: Array<Array<{ text: string; url: string }>> },
): Promise<boolean> {
  if (!TOKEN) return false;
  const markup = button && ('inline_keyboard' in button ? button : { inline_keyboard: [[button]] });
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgId, text, disable_web_page_preview: true,
        ...(markup ? { reply_markup: markup } : {}),
      }),
    });
    // LE MOTIF DU REFUS EST RETENU, pas seulement le fait qu'il y en a eu un. `lastDmError` permet à
    // l'appelant de distinguer « a bloqué le bot » (définitif — on cesse de le relancer) d'un raté réseau
    // (on retente demain). Sans cette distinction, la relance auto retentait éternellement les mêmes
    // blocages, et l'admin marquait ces gens comme « touchés » alors qu'ils n'avaient rien reçu.
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { description?: string };
      lastDmError = err.description ?? `HTTP ${res.status}`;
    } else lastDmError = null;
    return res.ok;
  } catch (e) {
    lastDmError = (e as { message?: string })?.message ?? 'network error';
    return false;
  }
}

/** Poste une PHOTO dans le canal VIP (carte de gain générée par l'app — /api/card/win). Telegram va
 *  chercher l'URL lui-même. Renvoie true si posté — l'appelant retombe sur postVip (texte) en cas d'échec,
 *  un TP ne doit JAMAIS être perdu parce que le rendu d'image a raté. */
export async function postVipPhoto(photoUrl: string, caption: string): Promise<boolean> {
  if (!TOKEN || !VIP) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: VIP, photo: photoUrl, caption, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error('[algoria] postVipPhoto HTTP', res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error('[algoria] postVipPhoto failed:', (e as { message?: string })?.message ?? e);
    return false;
  }
}

/** Poste dans le canal VIP en HTML (gras/italique/mono → cartes soignées). No-op si non configuré. Ne throw JAMAIS.
 *  Les messages sont composés en interne (aucune entrée utilisateur) → pas d'échappement nécessaire côté appelant. */
export async function postVip(text: string): Promise<void> {
  if (!TOKEN || !VIP) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: VIP, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) console.error('[algoria] postVip HTTP', res.status, (await res.text()).slice(0, 200));
  } catch (e) {
    console.error('[algoria] postVip failed:', (e as { message?: string })?.message ?? e);
  }
}
