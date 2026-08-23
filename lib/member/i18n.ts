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
// ⚠️ RÉÉCRIT (14/08/2026). L'ancien texte PROMETTAIT une réponse ici même — « Mathieu will get back to
// you personally » — et ne proposait son compte qu'en option secondaire, « pour une réponse plus rapide ».
// Les gens lisaient la promesse et attendaient. Or ce bot n'est pas une messagerie : il gère les
// connexions et les alertes, ses messages arrivent dans une boîte que Mathieu ne relève pas en continu.
// Une question posée ici pouvait donc rester sans réponse pendant des jours, ce qui est bien pire que de
// dire franchement où écrire.
// On ne promet plus rien ici, on ROUTE : le bouton vaut mieux qu'un pseudo à recopier, et le texte dit
// explicitement que ce bot ne répond pas aux questions.
export const INBOX_ACK: Record<Locale, string> = {
  en: "Thanks for writing 👋 One thing though — this bot doesn't answer questions. It only handles logins and trade alerts, so a message here can sit unread for a while.\n\nMathieu replies himself, from his own account. Tap below and ask him there — that's where you'll get an answer.",
  it: "Grazie per il messaggio 👋 Una cosa però — questo bot non risponde alle domande. Gestisce solo accessi e notifiche, quindi un messaggio qui può restare non letto per un po'.\n\nMathieu risponde di persona, dal suo account. Tocca qui sotto e scrivigli lì — è lì che otterrai una risposta.",
};
/** Le bouton qui accompagne l'accusé de réception — un tap, pas un pseudo à recopier à la main. */
export const INBOX_ACK_BTN: Record<Locale, string> = {
  en: '💬 Ask Mathieu directly',
  it: '💬 Scrivi direttamente a Mathieu',
};
/** Compte HUMAIN du support — la seule adresse où une question obtient vraiment une réponse. */
export const SUPPORT_TG_URL = 'https://t.me/mathieu_algoria';

// ═══ BOUTONS D'ACTION DES MESSAGES DU BOT (24/08/2026) ═══════════════════════════════════════════════
// Né d'un test de Mathieu sur un de ses propres comptes : le script de relance partait en TEXTE NU.
// Ni lien vers l'app, ni pseudo, ni canal — la personne lisait « are you still interested ? » sans avoir
// le moindre moyen de dire oui. La relance automatique du runner portait pourtant déjà un bouton depuis
// le 14/08 ; c'est l'envoi manuel depuis la file (bouton 🤖 BOT) et l'envoi groupé qui n'en avaient pas.
//
// LIEN D'INVITATION AU CANAL, et c'est le point le plus important : on relance en majorité des gens qui
// ont QUITTÉ le canal. Leur écrire « si tu as perdu le canal, dis-le-moi » ajoutait un aller-retour à
// une personne déjà tiède. Le lien est un lien d'invitation traqué (fourni par Mathieu le 24/08) : il
// est révocable côté Telegram, donc s'il cesse de fonctionner c'est ICI qu'on le remplace, à un seul
// endroit. Ce n'est pas un secret — un lien d'invitation est fait pour être diffusé.
export const CHANNEL_INVITE_URL = 'https://t.me/+n3THAxOYSok2ZjY8';
/** Racine de l'espace membre — les relances visent l'onboarding, les annonces l'accueil. */
export const APP_URL = 'https://app.algoria.tech';

const CTA_APP: Record<Locale, string> = { en: '🚀 Open the app', it: "🚀 Apri l'app" };
const CTA_CHANNEL: Record<Locale, string> = { en: '📡 Join the channel', it: '📡 Entra nel canale' };
const CTA_ASK: Record<Locale, string> = { en: '💬 Ask Mathieu', it: '💬 Scrivi a Mathieu' };

/**
 * Clavier d'action à joindre à un message du bot (`reply_markup`).
 *
 * Trois portes, jamais une de moins : REPRENDRE (l'app), REVENIR (le canal, pour ceux qui l'ont quitté)
 * et PARLER (Mathieu). Un message de relance sans elles est un cul-de-sac — la personne ne peut pas
 * répondre au bot, qui ne lit rien, et n'a aucun lien sous la main.
 *
 * L'app est seule sur la première rangée : c'est l'action qu'on veut voir cliquée, les deux autres sont
 * des secours. `appPath` cible la page utile ('/member/onboarding' pour une relance, '/member' pour une
 * annonce à quelqu'un de déjà actif) — l'app redirige de toute façon si le membre n'est pas au bon stade.
 */
export function ctaKeyboard(locale: Locale = 'en', appPath = '/member'): { inline_keyboard: Array<Array<{ text: string; url: string }>> } {
  const path = appPath.startsWith('/') ? appPath : `/${appPath}`;
  return {
    inline_keyboard: [
      [{ text: CTA_APP[locale], url: `${APP_URL}${path}` }],
      [{ text: CTA_CHANNEL[locale], url: CHANNEL_INVITE_URL }, { text: CTA_ASK[locale], url: SUPPORT_TG_URL }],
    ],
  };
}

/** Confirmation de connexion (deep-link /start lg_…). Le message porte un BOUTON (SIGNED_IN_BTN) : « reviens
 *  sur l'app » ne suffisait pas quand la personne arrive du navigateur intégré de Telegram — l'onglet qui
 *  attendait la confirmation a disparu, il n'y a plus rien où revenir. Le bouton la reconnecte en un tap. */
export const SIGNED_IN: Record<Locale, string> = {
  en: '✅ Signed in — tap below to open your Algoria app.',
  it: '✅ Accesso effettuato — tocca qui sotto per aprire la tua app Algoria.',
};
export const SIGNED_IN_BTN: Record<Locale, string> = {
  en: '🚀 Open Algoria',
  it: '🚀 Apri Algoria',
};

/** CODE À 6 CHIFFRES — la porte pour l'app installée sur l'écran d'accueil, dont le stockage est séparé de
 *  celui du navigateur : le bouton ci-dessus y connecte Safari, jamais l'app. Ces six chiffres se recopient
 *  LÀ où la session est voulue. %s = le code. Envoyé en complément du bouton, et sur commande /code. */
export const LOGIN_CODE_MSG: Record<Locale, string> = {
  en: '🔑 Your Algoria login code:\n\n<code>%s</code>\n\nType it into the app — works anywhere, including the app you added to your Home Screen. Valid 10 minutes, once.',
  it: '🔑 Il tuo codice di accesso Algoria:\n\n<code>%s</code>\n\nInseriscilo nell’app — funziona ovunque, anche nell’app che hai aggiunto alla schermata Home. Valido 10 minuti, una sola volta.',
};
/** Ligne ajoutée SOUS le bouton après un START : le code est déjà là, sans avoir à demander quoi que ce soit. */
export const SIGNED_IN_CODE_HINT: Record<Locale, string> = {
  en: '\n\nAdded Algoria to your Home Screen? The button above won’t reach it — type this code in the app instead: <code>%s</code>',
  it: '\n\nHai aggiunto Algoria alla schermata Home? Il pulsante qui sopra non la raggiunge — inserisci invece questo codice nell’app: <code>%s</code>',
};
