// TEXTES BOT PAR MARCHÉ (01/08 — ouverture de l'Italie, second canal Telegram).
// Server-only et volontairement minimaliste : pas de librairie i18n, juste un dictionnaire par langue.
// Les messages du BOT vivent ici ; l'interface de l'app aura sa propre couche (phase 3).
//
// D'où vient la langue d'une personne ? De son CANAL D'ADHÉSION (chat_id), pas de sa langue Telegram :
// un Italien peut très bien avoir Telegram en anglais, et quelqu'un qui rejoint le canal italien veut
// être servi en italien. TELEGRAM_CHANNEL_IT (env) porte l'id du canal italien — tant qu'il n'est pas
// posé, tout reste en anglais et rien ne change pour l'existant.

export type Locale = 'en' | 'it';
export const LOCALES: Locale[] = ['en', 'it'];
export const LOCALE_LABEL: Record<Locale, string> = { en: '🇬🇧 EN', it: '🇮🇹 IT' };

/** Langue d'une demande d'adhésion, d'après le canal qui l'a reçue. Inconnu → anglais. */
export function localeForChat(chatId: number | string | null | undefined): Locale {
  const it = (process.env.TELEGRAM_CHANNEL_IT ?? '').trim();
  return it && String(chatId ?? '') === it ? 'it' : 'en';
}

/** Normalise une valeur venue de la base / d'un formulaire. */
export const asLocale = (v: unknown): Locale => (v === 'it' ? 'it' : 'en');

/** DM envoyé au moment de la demande d'adhésion — la SEULE fenêtre où Telegram autorise le bot à
 *  écrire à un inconnu, donc le message le plus rentable du funnel. */
export const JOIN_DM: Record<Locale, string> = {
  en: [
    '🎉 <b>Thanks for requesting access to Algoria!</b>',
    '',
    'You\'ll be let into the channel in <b>just a few minutes</b> — watch for the notification.',
    '',
    'While you wait, get a head start 👇',
    '',
    '🎬 <b>Watch the intro</b> — what Algoria is and how it works, in a few minutes:',
    'app.algoria.tech/academy',
    '',
    '📲 <b>Create your free account</b> — pick your strategy and get your access ready:',
    'app.algoria.tech/member',
    '',
    '💬 <b>A question?</b> Message Mathieu directly: @mathieu_algoria',
    '',
    'Algoria is <b>completely free</b>: the AI trades gold in <i>your own</i> broker account — your money never leaves it, and you stay in control.',
    '',
    'See you inside 🥇',
  ].join('\n'),
  it: [
    '🎉 <b>Grazie per aver richiesto l\'accesso ad Algoria!</b>',
    '',
    'Entrerai nel canale <b>tra pochi minuti</b> — tieni d\'occhio la notifica.',
    '',
    'Nel frattempo, parti in vantaggio 👇',
    '',
    '🎬 <b>Guarda la presentazione</b> — cos\'è Algoria e come funziona, in pochi minuti:',
    'app.algoria.tech/academy',
    '',
    '📲 <b>Crea il tuo account gratuito</b> — scegli la strategia e prepara il tuo accesso:',
    'app.algoria.tech/member',
    '',
    '💬 <b>Hai una domanda?</b> Scrivi direttamente a Mathieu: @mathieu_algoria',
    '',
    'Algoria è <b>completamente gratuito</b>: l\'IA fa trading sull\'oro nel <i>tuo</i> conto broker — i tuoi soldi non escono mai da lì, e il controllo resta tuo.',
    '',
    'Ci vediamo dentro 🥇',
  ].join('\n'),
};

/** Accusé de réception d'un DM entrant (boîte de réception du bot). */
export const INBOX_ACK: Record<Locale, string> = {
  en: "Got your message 🙌 A real human reads these — Mathieu will get back to you personally.\n\nFor a faster answer, message him directly: @mathieu_algoria\nYour app: app.algoria.tech/member",
  it: "Messaggio ricevuto 🙌 Qui legge una persona vera — Mathieu ti risponderà di persona.\n\nPer una risposta più rapida, scrivigli direttamente: @mathieu_algoria\nLa tua app: app.algoria.tech/member",
};

/** Confirmation de connexion (deep-link /start lg_…). */
export const SIGNED_IN: Record<Locale, string> = {
  en: '✅ Signed in — head back to the Algoria app.',
  it: '✅ Accesso effettuato — torna sull\'app Algoria.',
};
