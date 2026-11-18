// Liste des 19 vocaux du mode guidé (SUPPORT_VOICE_RECORDER).
// `key` et `situation` servent à l'enregistrement. Le prompt montré au propriétaire n'affiche ni l'un ni l'autre :
// progression, titre, « Quand il part », et le texte anglais à lire.
import { FAQ_KIND, type FaqTopic } from '../member/faqVoice';

/** Où le code envoie déjà quelque chose de proche. `none` = ce vocal n'est branché nulle part. */
export type VoiceAutoSend = 'faq' | 'wait' | 'none';

export type VoiceScript = {
  /** 1..19, ordre d'enregistrement. */
  n: number;
  /** Clé interne. Jamais affichée dans le prompt. */
  key: string;
  title: string;
  /** Quand ce vocal part. Affiché au propriétaire, pas la clé technique. */
  when: string;
  /** Texte anglais à lire, tel que validé. */
  script: string;
  /** kind écrit dans support_assets. Jamais welcome_video : un vocal n'est pas une bulle. */
  kind: typeof FAQ_KIND | 'script_voice';
  /** situation écrite dans support_assets. Jamais affichée dans le prompt. */
  situation: string;
  /** true = la ligne fixe FAQ_LINES part avec le vocal (pas pour l'attente n°19). */
  fixedLine: boolean;
  /** Envoi automatique actuel. `none` = enregistré, pas encore envoyé tout seul. */
  autoSend: VoiceAutoSend;
  /**
   * Concept déjà dans le code (texte ou bulle), s'il y en a un.
   * Le vocal n'utilise PAS ce kind : le relier enverrait le mauvais média.
   */
  relatesTo?: string;
};

const faq = (
  n: number, key: FaqTopic, title: string, when: string, script: string,
): VoiceScript => ({
  n, key, title, when, script, kind: FAQ_KIND, situation: key, fixedLine: true, autoSend: 'faq',
});

const scriptVoice = (
  n: number, key: string, title: string, when: string, script: string, relatesTo?: string,
): VoiceScript => ({
  n, key, title, when, script, kind: 'script_voice', situation: key, fixedLine: false, autoSend: 'none', ...(relatesTo ? { relatesTo } : {}),
});

export const VOICE_SCRIPTS: readonly VoiceScript[] = [
  faq(1, 'faq_how_it_works', 'How it works',
    'Après un premier « how does it work / what is Algoria / how do I start », ou en complément de l\'accueil.',
    'Hey, quick one — Algoria is an AI that trades gold for you on MetaTrader 5. You open your own account with a partner broker through the link in the app, fund it, connect it once, and every trade the AI takes is copied on your account at the size you choose. Your money stays on your own account the whole time — we never hold it. Trading involves risk, you can lose money, so only use what you can afford. When you\'re ready, open app.getalgoria.com, log in with Telegram, and start the partner broker step. If you get stuck, just text me here.'),
  faq(2, 'faq_broker', 'Broker / partner account',
    'Quand on demande quel broker, pourquoi un compte partenaire, ou « I thought it was free » (volet partenaire ; le détail 400 $ est aussi au n°4).',
    'So, for free access, you open your trading account with one of our partner brokers, through the link inside the app. The broker covers your Algoria access, that\'s why it has to be a partner account. I usually recommend RaiseFX, and with the code ALGORIA100 RaiseFX gives you a plus one hundred percent deposit bonus. That\'s trading credit under the broker\'s conditions, not cash and not profit. If RaiseFX doesn\'t work for you, there are other partners in the app. And please, no passwords here.'),
  faq(3, 'faq_deposit', 'Deposit (minimum / how)',
    'Questions sur le minimum, comment déposer, combien démarrer. Pas si le virement est refusé ou si le client dit « j\'ai déjà déposé » sans preuve claire — ces cas restent en relecture.',
    'Good question. The Algoria access itself is free with a partner broker — you don\'t pay me for the AI. What you deposit is your own trading money, on your own broker account. I recommend around five hundred dollars to start; the absolute minimum is two hundred. That\'s real money at risk — trading gold can lose as well as win, so only deposit what you\'re comfortable with. Once the account is funded, you connect it in the app at app.getalgoria.com, and the AI can start copying trades for you. If you get stuck on the deposit page, text me.'),
  faq(4, 'faq_cost_free', 'Cost / is it free / $400',
    '« Is it free? », prix, 400 $, abonnement, prop firm / own broker payant.',
    'Yeah so — if you open with one of our partner brokers through the app link, Algoria access is completely free. The broker covers it, not you. If you want to use your own broker outside the partners, or a prop firm, then it\'s a one-time four hundred dollar lifetime access, paid in the app. No monthly subscription either way. And just to be clear: free access doesn\'t mean risk-free trading — your deposit on the broker can still go up or down. If you\'re going the free path, open the app and use the partner link there.'),
  faq(5, 'faq_connect', 'Connect MT5 in the app',
    'Comment connecter MT5 dans l\'app, déjà dans l\'app, login / serveur / mot de passe trader.',
    'Alright, once your broker account is open and funded, open the Algoria app, go through onboarding, and enter your MT5 login, the server, and the trader password there — only in the app, never send that stuff to me in chat. That trader password lets trades be placed on your account, so treat it like any sensitive login. Don\'t use the investor password, that\'s read-only and it won\'t work. When it\'s linked you\'ll see the status in the app. If something fails, send me a screenshot of the error — no passwords — and I\'ll help you fix it.'),
  faq(6, 'faq_results_myfxbook', 'Results / Myfxbook',
    'Preuves, résultats, Myfxbook, performance. Pas si la question porte sur l\'incident d\'octobre, une perte personnelle ou un remboursement — relecture.',
    'For proof, don\'t take screenshots from random people — use the verified track record on Myfxbook. I\'ll drop the official link right after this voice. That\'s the live record of the current engine, followed by a third party. You\'ll see winning days and losing days, nothing hidden. Important: past results do not guarantee future results, and you can lose money trading. Have a look calmly on Myfxbook, then we continue with your setup when you\'re ready.'),
  faq(7, 'faq_gold_only', 'Gold only',
    '« What do you trade? », or, XAUUSD, Bitcoin, crypto bot, indices.',
    'Quick clarification — Algoria only trades gold, XAUUSD. Not Bitcoin, not other cryptos, not indices. You might fund your broker with a card, a bank transfer or even a crypto transfer, that\'s just a deposit method — the strategy itself is gold only. If someone told you it trades crypto, that\'s outdated. I just want that to be clear so there\'s no confusion. Gold only now. When you\'re ready, keep going in the app at app.getalgoria.com, and text me here if anything is unclear.'),
  faq(8, 'faq_withdraw_30d', 'Withdrawal & 30-day rule',
    'Retrait, cash out, règle des 30 jours. Sujet argent : le vocal peut être préparé, l\'envoi auto 05-09h reste en relecture.',
    'Your money is on your own broker account, so withdrawals go through the broker, the same way you deposited. I never touch your funds. One Algoria rule: please don\'t withdraw during the first thirty days, or it breaks the connection to the AI. The money isn\'t locked — it\'s still yours — but withdrawing early cuts the access. After thirty days you can withdraw whenever you want from the broker side. And yeah, results aren\'t guaranteed; only withdraw what you actually have available after the broker\'s own rules.'),
  faq(9, 'faq_risk_lots', 'Risk & lot size',
    'Taille de lot, risque, 0.01 / 500 $. Pas si la question est une plainte sur une perte ou l\'incident.',
    'On risk: you choose the lot size in the app. As a simple rule we use about zero point zero one lot per roughly five hundred dollars on the account. The lot stays fixed, it doesn\'t jump up after a loss. You can go lower if you want to be safer. There\'s also a daily safety rule: if the day reaches minus five percent, everything closes. That limits a bad day, it doesn\'t remove the risk. Trading can still lose money, including streaks of losing days, so keep your size sensible. If you\'re unsure, start small — you can change it anytime in your profile in the app.'),
  faq(10, 'faq_kyc_raisefx', 'KYC at the broker',
    'KYC / vérification chez le broker, documents, compte en attente de validation. Pas si le KYC a été refusé par le broker.',
    'If the broker is still verifying you, that\'s normal — especially on RaiseFX, they need KYC done before trading is fully on, including their level 2 if they ask for it. Upload clear documents in the broker\'s own app or site, wait until they approve you, then fund, then connect in the Algoria app. I can\'t complete the broker verification for you from here. Once you\'re approved, just text me "verified" and I\'ll point you to the next step in the app.'),
  scriptVoice(11, 'accueil_generique', 'Accueil générique (pays sans vocal)',
    'Accueil d\'un prospect dont le pays n\'a pas de vocal country_voice (hors GB, ZA, NZ, AU, IE, DE, AE). Après le premier contact, à la place du vocal pays manquant.',
    'Hey, welcome — I\'m Mathieu. Algoria is an AI that trades gold for you on your own MetaTrader 5 account. You open a partner broker account through the link in the app, fund it, connect it once, and the trades get copied at the size you choose. Your money stays on your account, we never hold it. Trading involves risk, so only use what you can afford. Open app.getalgoria.com, log in with Telegram — one tap, no password — and everything is explained step by step there. Text me here if you get stuck.',
    'welcome_video'),
  scriptVoice(12, 'relance_avant_broker', 'Relance avant broker (24 h)',
    'Relance ~24 h après l\'ouverture du wizard (écran 0) si le broker n\'est pas encore confirmé. Une seule action : reprendre le lien partenaire dans l\'app.',
    'Hey, just checking in. I saw you started the setup in the app, and the next step is opening your trading account with a partner broker, through the link inside the app. RaiseFX is the one I usually recommend, and if that one doesn\'t work for you, the other partners are in there too. That\'s what makes the Algoria access free — it has to be opened through that link. When you\'re ready, go back into the app and tap the broker step. If something\'s blocking you, just tell me and I\'ll help.',
    'followup:0'),
  scriptVoice(13, 'relance_already_have_account', 'Relance « already have an account »',
    'Après un « I already have an account » / compte existant / changement d\'IB, si le prospect n\'a pas avancé.',
    'Hey, I got that you already have a broker account. For free access, the account has to be with a partner, and opened or attached through our link. Changing the IB on an existing account is often slow, and sometimes the broker charges for it — so I usually wouldn\'t pay for that. The cleanest path is often a new account with a partner you don\'t already have — RaiseFX if you can, or VT Markets, PU Prime, TradingSphere or Xlence. Open the app and use the partner link there, or text me which broker you already have.'),
  scriptVoice(14, 'relance_apres_origine', 'Relance après choix d\'origine → connecter MT5',
    'Après le choix d\'origine (new / existing), pour faire passer à la connexion MT5 dans l\'app, avec l\'activation et le bouton d\'aide.',
    'Hey, your broker account is on the right path — next step is connecting it in the app. Open app.getalgoria.com, enter your MT5 login, the server, and the trader password — only in the app, never send that password here. After that there\'s a one-time activation: a zero point five lot buy and a zero point five lot sell on USDJPY, then close both, and tap "I\'ve placed both trades". If you\'re not comfortable doing that yourself, tap "Let Algoria do it for me" — that asks our team to help you place it, it doesn\'t place the trades automatically. Text me if you get stuck.',
    'followup:1'),
  scriptVoice(15, 'pre_depot_rassurance', 'Pré-dépôt rassurance (dont incident 21–22/10)',
    'Avant un premier dépôt, pour rassurer (argent chez le client, 30 jours, Myfxbook) et mentionner honnêtement l\'incident 21–22/10, sans aucun chiffre de résultat. Sujet sensible : pas d\'envoi auto 05-09h.',
    'Hey, before you deposit I want to be straight with you. Your money stays on your own broker account — I never hold it — and you withdraw the same way you deposited. Just wait thirty days before the first withdrawal, or it cuts the Algoria access. For the track record, use the verified Myfxbook page, I\'ll send the link after this. And yes, the previous engine had an incident on the twenty-first and twenty-second of October. The engine has been fully rebuilt since, and that Myfxbook record is the one to look at. I won\'t promise you any results. Only deposit what you can afford, when you\'re ready.'),
  scriptVoice(16, 'refus_no_deposit', 'Refus no_deposit',
    'Juste après un refus de connexion `no_deposit`. Action : financer, puis toucher « CONNECT MY ACCOUNT → » dans l\'app (formulaire prérempli, motif affiché dans le bandeau). Si le client conteste le refus ou un virement a échoué : relecture.',
    'Hey, I couldn\'t approve the connection yet because there\'s no deposit on that account. That\'s all it is, and you\'ll see the reason in the app too. The minimum is two hundred dollars, and I recommend around five hundred to start. It\'s your money, on your own broker account. When the funds are there, open the app, everything is already filled in, and just tap Connect my account again. Text me if the deposit isn\'t showing, or if you get stuck on the payment page.',
    'reject:no_deposit'),
  scriptVoice(17, 'refus_not_partner', 'Refus not_partner',
    'Juste après un refus `not_partner`. Action : nouveau compte via le lien, ou rattachement au partner ID, puis « CONNECT MY ACCOUNT → ».',
    'Hey, I had to decline this one because the account wasn\'t opened through the Algoria partner link, so the broker doesn\'t count it as ours. For free access, you either open a new account with a partner through the link in the app, or you ask your current partner broker to attach this account to our partner ID. Changing the IB can be slow, and sometimes it\'s not free, so a fresh account with a partner you don\'t already have is often cleaner. RaiseFX is the one I recommend. When that\'s done, open the app, fix just that, and tap Connect my account again.',
    'reject:not_partner'),
  scriptVoice(18, 'refus_wrong_credentials', 'Refus wrong_credentials',
    'Juste après un refus `wrong_credentials`. Action : corriger numéro de compte / mot de passe trader dans l\'app, puis « CONNECT MY ACCOUNT → ».',
    'Hey, I couldn\'t log in with the details that were entered, so the connection didn\'t go through. Please check the MetaTrader account number — the digits at the top of MT5 — and the trader password, not your broker website login, and not the investor password, that\'s read-only. Enter those only in the app, never send the password here. Then fix just those in the app, and tap Connect my account again. If it fails again, send me a screenshot of the error, with no passwords, and I\'ll help you from there.',
    'reject:wrong_credentials'),
];

export const scriptByKey = (key: string): VoiceScript | undefined => VOICE_SCRIPTS.find((s) => s.key === key);

/** Échappement HTML Telegram (&, <, >). */
export const escapeTgHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const TELEGRAM_TEXT_LIMIT = 4096;

/** Prompt d'une étape, HTML Telegram. Pas de clé technique. */
export function scriptPrompt(s: VoiceScript, n: number, total: number): string {
  const head = `<b>${n}/${total} — ${escapeTgHtml(s.title)}</b>`;
  const when = `Quand il part :\n${escapeTgHtml(s.when.trim())}`;
  const body = `<pre>${escapeTgHtml(s.script.trim())}</pre>`;
  return [head, when, body].join('\n\n');
}

/** Message final envoyé au propriétaire. La note est échappée ; le prompt est déjà du HTML. Tient dans 4096. */
export function formatRecorderMessage(note: string, promptHtml: string | null): string {
  const parts = [note.trim() ? escapeTgHtml(note.trim()) : '', promptHtml ?? ''].filter(Boolean);
  const text = parts.join('\n\n');
  return text.length <= TELEGRAM_TEXT_LIMIT ? text : text.slice(0, TELEGRAM_TEXT_LIMIT);
}
