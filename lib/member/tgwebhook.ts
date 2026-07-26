// Secret du webhook Telegram — DÉRIVÉ du bot token (sha256) : aucun nouvel env à poser. Le même calcul
// sert à l'activation (admin → setWebhook) et à la vérification (route webhook) — server-only.
import { createHash } from 'node:crypto';

export const tgWebhookSecret = (): string | null => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token ? createHash('sha256').update(token).digest('hex').slice(0, 40) : null;
};
