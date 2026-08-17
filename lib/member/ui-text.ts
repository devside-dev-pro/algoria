// TEXTES DE L'APP MEMBRE (phase 3 — app italienne). Client-safe : aucun secret, juste des chaînes.
//
// Pas de librairie i18n : deux langues, un dictionnaire plat, et un repli anglais AUTOMATIQUE. Une clé
// oubliée en italien affiche l'anglais — jamais un trou ni une clé technique à l'écran. C'est ce qui
// permet de traduire écran par écran sans jamais casser l'app.
//
// Périmètre volontairement limité au TUNNEL DE CONVERSION (porte d'entrée, mur du dépôt, wizard) :
// c'est là que se joue le dépôt. Les écrans de confort (historique, réglages) restent en anglais tant
// qu'ils ne coûtent pas un client.
import type { Locale } from './i18n';

type Dict = Record<string, { en: string; it: string }>;

export const UI: Dict = {
  // ===== connexion / accès =====
  'login.title': { en: 'ALGORIA', it: 'ALGORIA' },
  'login.sub': {
    en: 'Your member dashboard — copying status, risk control and the live AI feed. Sign in with the Telegram account that joined the channel.',
    it: 'La tua dashboard membro — stato della copia, controllo del rischio e il feed live dell\'IA. Accedi con l\'account Telegram con cui sei entrato nel canale.',
  },
  'login.cta': { en: '✈️ LOG IN WITH TELEGRAM', it: '✈️ ACCEDI CON TELEGRAM' },
  'login.waiting': { en: '● waiting for Telegram…', it: '● in attesa di Telegram…' },
  'login.tapStart': {
    en: 'Telegram should have opened — tap START in the bot chat and you\'ll be signed in here automatically.',
    it: 'Telegram dovrebbe essersi aperto — premi START nella chat del bot e l\'accesso qui avverrà da solo.',
  },
  'login.fallback': { en: '✈️ Nothing opened? Open Telegram here', it: '✈️ Non si è aperto nulla? Apri Telegram qui' },
  'login.restart': { en: 'Start over', it: 'Ricomincia' },
  'login.expired': { en: 'Link expired — try again.', it: 'Link scaduto — riprova.' },
  'login.error': { en: 'Something went wrong — try again.', it: 'Qualcosa è andato storto — riprova.' },
  'login.footer': { en: 'ACCESS IS GRANTED LIVE ON STREAM · MEMBERS ONLY', it: 'ACCESSO CONCESSO IN DIRETTA · SOLO MEMBRI' },
  // CODE À 6 CHIFFRES — la porte de l'app installée sur l'écran d'accueil, dont le stockage est séparé de
  // celui du navigateur (ni le polling ni le bouton du bot n'y posent de session). Toujours visible :
  // c'est justement quand l'app se recharge en revenant de Telegram qu'on en a besoin.
  'login.codeToggle': { en: 'Have a 6-digit code?', it: 'Hai un codice a 6 cifre?' },
  'login.codeHelp': {
    en: 'Send /code to the bot on Telegram, then type the six digits here. This is the way in for the app you added to your Home Screen.',
    it: 'Invia /code al bot su Telegram, poi inserisci qui le sei cifre. È la via d\'accesso per l\'app che hai aggiunto alla schermata Home.',
  },
  'login.codeCta': { en: 'SIGN IN', it: 'ACCEDI' },
  'login.codeBusy': { en: 'checking…', it: 'verifica…' },

  'denied.title': { en: 'Access unavailable', it: 'Accesso non disponibile' },
  'denied.body': {
    en: 'This account can\'t access Algoria Members right now. If you think that\'s a mistake, message us and we\'ll sort it out.',
    it: 'Questo account al momento non può accedere ad Algoria Members. Se pensi sia un errore, scrivici e lo risolviamo.',
  },
  'denied.cta': { en: '✈️ JOIN THE WAITLIST', it: '✈️ ENTRA IN LISTA D\'ATTESA' },
  'denied.signin': { en: 'already accepted? sign in again', it: 'già accettato? accedi di nuovo' },

  'fail.title': { en: 'We couldn\'t load your account', it: 'Non siamo riusciti a caricare il tuo account' },
  'fail.body': {
    en: 'Usually a expired session or a network hiccup. Try again — if it keeps happening, sign in again.',
    it: 'Di solito è una sessione scaduta o un problema di rete. Riprova — se continua, accedi di nuovo.',
  },
  'fail.retry': { en: '↻ Try again', it: '↻ Riprova' },
  'fail.signin': { en: 'Sign in again', it: 'Accedi di nuovo' },
  'fail.support': { en: '💬 Still stuck? Message us — we answer fast', it: '💬 Ancora bloccato? Scrivici — rispondiamo subito' },

  // ===== wizard : mur du dépôt (l'écran où 84 % se figent) =====
  'ob.proof.title': { en: 'You\'re joining a system that\'s already working', it: 'Stai entrando in un sistema che funziona già' },
  'ob.proof.week': { en: 'this week', it: 'questa settimana' },
  'ob.proof.wins': { en: 'wins', it: 'operazioni vinte' },
  'ob.proof.best': { en: 'best trade', it: 'migliore operazione' },
  'ob.proof.control': { en: 'You keep full control', it: 'Mantieni il pieno controllo' },
  'ob.proof.controlEnd': { en: 'of your funds', it: 'dei tuoi fondi' },
  'ob.proof.withdraw': { en: 'Withdraw anytime', it: 'Preleva quando vuoi' },
  'ob.proof.risk': { en: 'Risk capped', it: 'Rischio limitato' },
  'ob.proof.riskEnd': { en: 'every single day', it: 'ogni singolo giorno' },
  'ob.proof.video': { en: '▶ New here? Watch the 2-min founder intro', it: '▶ Nuovo qui? Guarda la presentazione di 2 minuti' },

  'ob.budget.q': { en: 'How much are you planning to start with?', it: 'Con quanto pensi di iniziare?' },
  'ob.budget.help': { en: 'We\'ll point you to the broker that fits your budget best.', it: 'Ti indichiamo il broker più adatto al tuo budget.' },
  'ob.broker.title': { en: 'Open your broker account', it: 'Apri il tuo conto broker' },
  'ob.broker.recommended': { en: 'RECOMMENDED', it: 'CONSIGLIATO' },
  'ob.broker.others': { en: 'Other partner brokers', it: 'Altri broker partner' },
  'ob.broker.done': { en: 'I\'ve opened my account', it: 'Ho aperto il mio conto' },

  'ob.mt5.title': { en: 'Connect your trading account', it: 'Collega il tuo conto di trading' },
  'ob.mt5.login': { en: 'Account number (login)', it: 'Numero di conto (login)' },
  'ob.mt5.server': { en: 'Server', it: 'Server' },
  'ob.mt5.password': { en: 'Password', it: 'Password' },
  'ob.mt5.name': { en: 'Full name on the broker account', it: 'Nome completo sul conto broker' },
  'ob.mt5.deposit': { en: 'Deposit amount ($)', it: 'Importo del deposito ($)' },
  'ob.mt5.secure': { en: 'Encrypted and never shared. Used only to connect you to the copier.', it: 'Crittografati e mai condivisi. Servono solo a collegarti al copiatore.' },
  'ob.mt5.submit': { en: 'Connect my account', it: 'Collega il mio conto' },

  'ob.strategy.title': { en: 'Pick your strategy', it: 'Scegli la tua strategia' },
  'ob.strategy.submit': { en: 'Finish', it: 'Concludi' },
  'ob.back': { en: 'Back', it: 'Indietro' },
  'ob.rejected': { en: 'Your last request was declined', it: 'La tua ultima richiesta è stata rifiutata' },


  // ===== wizard : étape 1 (broker) — l'écran qui décide du dépôt =====
  'ob.step1': { en: '1 · Open your broker account', it: '1 · Apri il tuo conto broker' },
  'ob.budget.label': { en: 'HOW MUCH DO YOU PLAN TO START WITH?', it: 'CON QUANTO PENSI DI INIZIARE?' },
  'ob.budget.best': { en: '★ BEST MATCH FOR YOUR BUDGET', it: '★ IL MIGLIORE PER IL TUO BUDGET' },
  'ob.broker.recoNote': { en: 'is our recommended partner for your starting budget — fully supported, same hands-free copy.', it: 'è il partner consigliato per il tuo budget iniziale — pienamente supportato, stessa copia automatica.' },
  'ob.broker.genericNote': { en: 'Open your account with one of our partner brokers.', it: 'Apri il tuo conto con uno dei nostri broker partner.' },
  'ob.broker.createCta': { en: '▲ CREATE MY', it: '▲ APRI IL MIO CONTO' },
  'ob.broker.createCtaEnd': { en: 'ACCOUNT', it: '' },
  'ob.min.title': { en: 'Minimum deposit: from $200', it: 'Deposito minimo: da 200 $' },
  'ob.min.body': { en: '— it depends on the strategy you\'ll pick at the last step. Fund for the one you want:', it: '— dipende dalla strategia che sceglierai all\'ultimo passaggio. Deposita per quella che vuoi:' },
  'ob.min.warn': { en: 'Below the minimum, position sizing doesn\'t work — trades simply won\'t run.', it: 'Sotto il minimo il dimensionamento delle posizioni non funziona — le operazioni non partono.' },


  // ===== wizard : étapes 2 (connexion MT) et 3 (stratégie) =====
  'ob.other': { en: 'I\'d rather use another broker', it: 'Preferisco usare un altro broker' },
  'ob.othersLabel': { en: 'OTHER PARTNER BROKERS — SAME MINIMUMS', it: 'ALTRI BROKER PARTNER — STESSI MINIMI' },
  'ob.selected': { en: '✓ selected', it: '✓ scelto' },
  'ob.openAccount': { en: 'open account ↗', it: 'apri conto ↗' },
  'ob.ready': { en: 'MY ACCOUNT IS READY →', it: 'IL MIO CONTO È PRONTO →' },
  'ob.step2': { en: '2 · Connect your MetaTrader account', it: '2 · Collega il tuo conto MetaTrader' },
  'ob.step2.sub': { en: 'Pick your broker & platform, then enter the account it gave you.', it: 'Scegli broker e piattaforma, poi inserisci il conto che ti hanno dato.' },
  'ob.step2.enc': { en: 'Encrypted end-to-end', it: 'Crittografati end-to-end' },
  'ob.step2.encEnd': { en: ', never shown again.', it: ', mai più mostrati.' },
  'ob.yourAccount': { en: 'YOUR ACCOUNT', it: 'IL TUO CONTO' },
  'ob.broker': { en: 'Broker', it: 'Broker' },
  'ob.platform': { en: 'Platform', it: 'Piattaforma' },
  'ob.choose': { en: '— choose —', it: '— scegli —' },
  'ob.chooseServer': { en: '— choose your server —', it: '— scegli il tuo server —' },
  'ob.serverNotListed': { en: 'My server isn\'t listed…', it: 'Il mio server non è in elenco…' },
  'ob.serverType': { en: 'type it EXACTLY as MetaTrader shows it', it: 'scrivilo ESATTAMENTE come appare in MetaTrader' },
  'ob.serverHint': { en: 'Must match your broker\'s server exactly — copy it from MetaTrader (caps & spaces count).', it: 'Deve corrispondere esattamente al server del broker — copialo da MetaTrader (maiuscole e spazi contano).' },
  'ob.serverBack': { en: '← Pick from the list instead', it: '← Scegli invece dall\'elenco' },
  // ⚠️ TEXTE RÉÉCRIT (14/08/2026) — il DISAIT « the one you log in with », ce qui se lit « celui avec
  // lequel je me connecte chez le broker ». C'est exactement la confusion qui produit le premier motif de
  // refus : 20 demandes sur 42 refusées pour identifiants invalides, presque toujours le mot de passe de
  // l'espace client saisi à la place de celui du compte MetaTrader. On ne dit plus « celui avec lequel tu
  // te connectes » — on dit d'OÙ il vient, et ce qu'il n'est pas.
  'ob.pwdHint': { en: 'The password of your TRADING account — the one the broker emailed you when the account was created, the one you type into MetaTrader. NOT the password of the broker\'s website. Not the read-only "investor" one either, or the copy can\'t trade.', it: 'La password del tuo conto DI TRADING — quella che il broker ti ha inviato via email alla creazione del conto, quella che digiti in MetaTrader. NON la password del sito del broker. E nemmeno quella "investor" di sola lettura, altrimenti la copia non può operare.' },
  'ob.pwdLost': { en: 'Lost it? Reset it from your broker\'s client area, on the trading account itself — look for "Change password" / "Trading password" (not the website login).', it: 'Persa? Reimpostala dall\'area clienti del broker, sul conto di trading stesso — cerca "Cambia password" / "Password di trading" (non quella del sito).' },
  'ob.loginHint': { en: 'The account NUMBER shown in MetaTrader — usually 6 to 10 digits. Not your email.', it: 'Il NUMERO di conto mostrato in MetaTrader — di solito 6-10 cifre. Non la tua email.' },
  'ob.loginWarn': { en: 'That looks like your broker website login. Algoria needs the MetaTrader account number — the digits shown at the top of MetaTrader, also in the broker\'s email.', it: 'Sembra il login del sito del broker. Algoria ha bisogno del numero di conto MetaTrader — le cifre mostrate in alto in MetaTrader, presenti anche nell\'email del broker.' },
  // le bouton d'envoi attend une vraie connexion MetaTrader (~30 s) — « encrypting » mentait sur la durée
  'ob.checking': { en: 'CHECKING YOUR ACCOUNT…', it: 'VERIFICA DEL TUO CONTO…' },
  'ob.verif': { en: 'FOR VERIFICATION', it: 'PER LA VERIFICA' },
  'ob.fullName': { en: 'Full name on your broker account', it: 'Nome completo sul tuo conto broker' },
  'ob.amount': { en: 'Amount deposited ($ — min 200)', it: 'Importo depositato ($ — min 200)' },
  'ob.verifHint': { en: 'Accurate name & deposit = faster approval — the team checks them with the broker before switching the copy on.', it: 'Nome e deposito esatti = approvazione più rapida — il team li verifica con il broker prima di attivare la copia.' },
  'ob.encrypting': { en: 'ENCRYPTING…', it: 'CRITTOGRAFIA…' },
  'ob.connectCta': { en: 'CONNECT MY ACCOUNT →', it: 'COLLEGA IL MIO CONTO →' },
  'ob.noBroker': { en: 'Don\'t have a broker account yet? Open one →', it: 'Non hai ancora un conto broker? Aprine uno →' },
  'ob.step3': { en: '3 · Choose your strategy', it: '3 · Scegli la tua strategia' },
  'ob.step3.sub': { en: 'Every strategy copies at the same fixed size — your risk lever is the strategy itself. You can switch anytime from your Profile.', it: 'Tutte le strategie copiano con la stessa size fissa — la tua leva di rischio è la strategia stessa. Puoi cambiarla quando vuoi dal Profilo.' },
  'ob.saving': { en: 'SAVING…', it: 'SALVATAGGIO…' },
  'ob.startCta': { en: '⚡ START COPYING ALGORIA', it: '⚡ INIZIA A COPIARE ALGORIA' },
  'ob.backMt5': { en: '← Back to MT5 details', it: '← Torna ai dati MT5' },

  // ===== paywall / statut (vus par tous les prospects) =====
  'lock.cta': { en: 'UNLOCK MY ACCESS', it: 'SBLOCCA IL MIO ACCESSO' },
  'lock.membersOnly': { en: 'MEMBERS ONLY', it: 'SOLO MEMBRI' },
  'status.onboarding': { en: 'SETTING UP', it: 'IN CONFIGURAZIONE' },
  'status.pending_copier': { en: 'CONNECTING', it: 'COLLEGAMENTO' },
  'status.live': { en: 'LIVE', it: 'ATTIVO' },
  'status.paused': { en: 'PAUSED', it: 'IN PAUSA' },
  'support.ask': { en: 'A question? Message us', it: 'Una domanda? Scrivici' },
  // ===== COMPTE PRÉEXISTANT — LA DÉMARCHE QUE SEUL LE TITULAIRE PEUT FAIRE (17/08/2026) ==============
  // Avant, cet écran disait « écris à Mathieu d'abord ». C'était le mauvais destinataire : Mathieu ne
  // peut que CONSTATER que le compte n'apparaît pas chez le partenaire, il ne peut pas le rattacher.
  // Seul le titulaire peut le demander au support de son broker. Le renvoyer vers Mathieu ajoutait donc
  // un aller-retour de plusieurs jours avant même que la vraie démarche commence.
  'ob.exist.title': { en: 'An account opened before Algoria has to be attached first.', it: 'Un conto aperto prima di Algoria va prima collegato.' },
  'ob.exist.body': {
    en: 'Your broker only links an account to us when it was created through our link. Yours wasn’t, so it doesn’t show up on our side and we can’t switch the copying on — even if you already funded it.',
    it: 'Il tuo broker collega un conto a noi solo se è stato aperto dal nostro link. Il tuo non lo è stato, quindi non compare dalla nostra parte e non possiamo attivare la copia — anche se lo hai già finanziato.',
  },
  'ob.exist.good': {
    en: 'Good news: your broker can attach it. Only you can ask them — send them the message below, it takes two minutes.',
    it: 'La buona notizia: il tuo broker può collegarlo. Solo tu puoi chiederlo — invia loro il messaggio qui sotto, sono due minuti.',
  },
  'ob.exist.which': { en: 'Which broker is this account with?', it: 'Con quale broker è questo conto?' },
  'ob.exist.acc': { en: 'Your account number at that broker', it: 'Il numero del tuo conto presso quel broker' },
  'ob.exist.accPh': { en: 'e.g. 29011666', it: 'es. 29011666' },
  'ob.exist.send': { en: 'Send this to your broker’s support (live chat or email):', it: 'Invia questo al supporto del tuo broker (chat o email):' },
  'ob.exist.copy': { en: '📋 COPY THE MESSAGE', it: '📋 COPIA IL MESSAGGIO' },
  'ob.exist.copied': { en: '✓ COPIED — now paste it to your broker', it: '✓ COPIATO — ora incollalo al tuo broker' },
  'ob.exist.after': {
    en: 'They usually confirm within a few days. Once they do, come back here and connect your account — nothing else to redo.',
    it: 'Di solito confermano in pochi giorni. Quando lo fanno, torna qui e collega il tuo conto — niente altro da rifare.',
  },
  'ob.exist.notPartner': {
    en: 'That broker isn’t one of our partners, so there’s nothing to attach. Message Mathieu — residents of some countries pay for access directly and keep their own broker.',
    it: 'Quel broker non è tra i nostri partner, quindi non c’è nulla da collegare. Scrivi a Mathieu — i residenti di alcuni paesi pagano l’accesso direttamente e tengono il proprio broker.',
  },
  'ob.exist.newInstead': { en: '← or open a new account with a partner broker (instant)', it: '← oppure apri un nuovo conto con un broker partner (immediato)' },
  'ob.exist.ask': { en: '💬 Ask Mathieu if you’re stuck', it: '💬 Chiedi a Mathieu se sei bloccato' },
  'ob.exist.cont': { en: '✓ I’ve sent it — continue my setup', it: '✓ L’ho inviato — continua la configurazione' },
  'ob.exist.contHint': {
    en: 'You can finish here now. We’ll hold your account until your broker confirms the link — you won’t have to do this twice.',
    it: 'Puoi finire qui adesso. Terremo il tuo conto in attesa finché il broker conferma il collegamento — non dovrai rifarlo.',
  },
  'ob.exist.ackAttach': { en: 'I asked my broker to attach this account to Algoria', it: 'Ho chiesto al mio broker di collegare questo conto ad Algoria' },
  'ob.exist.pending': {
    en: 'Waiting on your broker to confirm the link. Nothing else to do — we’ll switch the copying on as soon as they do.',
    it: 'In attesa che il tuo broker confermi il collegamento. Nient’altro da fare — attiveremo la copia appena lo fanno.',
  },
};

/** Message que le MEMBRE envoie au support de son broker pour faire rattacher un compte préexistant.
 *  Écrit à la première personne, court, et il contient les deux seules choses que le support demande :
 *  le numéro de compte et l'identifiant d'affilié à rattacher. Volontairement en anglais quelle que soit
 *  la langue de l'app : les supports brokers répondent en anglais, et un message en italien ferait
 *  repartir un aller-retour de traduction. */
export function brokerAttachMessage(brokerName: string, affiliateId: string, accountNo: string): string {
  return [
    `Hello,`,
    ``,
    `I already have a live account with ${brokerName} (account number: ${accountNo || '________'}).`,
    ``,
    `I would like this account to be attached to your partner/IB with the affiliate ID ${affiliateId} (Algoria).`,
    `Could you please link my account to that partner ID?`,
    ``,
    `Thank you.`,
  ].join('\n');
}

/** Traduit une clé. Clé inconnue → la clé elle-même (visible en dev, jamais vide en prod). */
export function tr(locale: Locale, key: string): string {
  const e = UI[key];
  if (!e) return key;
  return (locale === 'it' ? e.it : e.en) || e.en;
}

/** Langue à utiliser AVANT de connaître le membre : choix mémorisé, sinon langue du navigateur. */
export function guessLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = localStorage.getItem('alg_locale');
    if (saved === 'it' || saved === 'en') return saved;
  } catch { /* localStorage indispo (mode privé) → on devine */ }
  return (navigator.language ?? '').toLowerCase().startsWith('it') ? 'it' : 'en';
}

/** Mémorise la langue pour les écrans hors session (login, accès refusé) et les prochaines visites. */
export function rememberLocale(locale: Locale): void {
  try { localStorage.setItem('alg_locale', locale); } catch { /* sans persistance, on retombera sur le navigateur */ }
}
