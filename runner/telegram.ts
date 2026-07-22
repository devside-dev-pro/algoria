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

/** DM direct du bot à UN utilisateur (relance onboarding…). Ne marche que si la personne a déjà ouvert le
 *  chat du bot (login natif /start → oui). Renvoie true si envoyé — 403 = chat jamais ouvert, on l'accepte. */
export async function sendDm(tgId: number, text: string): Promise<boolean> {
  if (!TOKEN) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: tgId, text, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Poste un message texte dans le canal VIP. No-op si non configuré. Ne throw JAMAIS (best-effort). */
export async function postVip(text: string): Promise<void> {
  if (!TOKEN || !VIP) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: VIP, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error('[algoria] postVip HTTP', res.status, (await res.text()).slice(0, 200));
  } catch (e) {
    console.error('[algoria] postVip failed:', (e as { message?: string })?.message ?? e);
  }
}
