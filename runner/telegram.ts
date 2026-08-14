// Canal VIP Telegram — Algoria y publie son activité et, une fois sa journée finie (dayDone),
// les setups qu'il voit mais ne prend plus → les VIP tradent en manuel s'ils le veulent.
// GATÉ : no-op tant que TELEGRAM_BOT_TOKEN + TELEGRAM_VIP_CHAT ne sont pas posés (Railway).
// TELEGRAM_VIP_CHAT = l'id du canal (ex. "-1001234567890") — le bot doit y être ADMIN.
import { ACTIVE_STRATEGY } from '../lib/engine/strategies';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const VIP = process.env.TELEGRAM_VIP_CHAT ?? '';

/** Le canal VIP est-il configuré ? (sinon tous les posts sont des no-op silencieux). */
export const vipReady = (): boolean => Boolean(TOKEN && VIP);

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
export async function sendDm(tgId: number, text: string, button?: { text: string; url: string }): Promise<boolean> {
  if (!TOKEN) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgId, text, disable_web_page_preview: true,
        ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
      }),
    });
    return res.ok;
  } catch {
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
