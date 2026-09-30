// ACADEMY — le contenu pédagogique de l'app (30/09/2026). Remplace les deux vidéos du fondateur (Welcome +
// « Meet ALGORIA 2.0 »), devenues fausses : elles présentaient encore 3 stratégies.
//
// Tout vient de la knowledge (lib/member/knowledge.seed.md) : des FAITS, jamais un chiffre de performance ni
// une promesse. Même contenu que les cartes publiées sur le canal (How it works, FAQ, Myth vs Fact, Glossary,
// RaiseFX, Quiz), réécrit pour un écran de téléphone : du texte natif, pas des images 1600×900 illisibles en
// 390 px de large.
//
// Le code ALGORIA100 N'APPARAÎT PAS ici : c'est une arme de closing servie aux hésitants (voir brokers.ts),
// et l'Academy est publique. Mathieu décide s'il le rend public.
//
// Mise en forme : `**gras**` dans les textes, rien d'autre.

export interface Fact { ok: boolean; t: string; s?: string }
export interface Lesson {
  id: string;
  kicker: string;
  title: string;
  body: string;
  facts?: Fact[];
  /** Encadré « AT ALGORIA » : la règle concrète chez nous. */
  note?: string;
  link?: { href: string; label: string };
}
export interface AcademyModule { key: string; label: string; icon: string; blurb: string; lessons: Lesson[] }
export interface QuizQuestion { q: string; options: string[]; answer: number; why: string }

const TRACK = { href: 'https://algoria.tech/track-record', label: 'algoria.tech/track-record' };

export const ACADEMY: AcademyModule[] = [
  {
    key: 'basics', label: 'How it works', icon: '⚙️', blurb: 'The 6 things to know before you start.',
    lessons: [
      {
        id: 'lot', kicker: 'Risk control', title: 'Your lot never grows after a loss.',
        body: 'A martingale doubles its size after every loss to win it back. **Algoria does the opposite:** you choose your copy size once, and it stays the same, win or lose.',
        facts: [{ ok: false, t: 'Martingale', s: 'doubles after losses' }, { ok: true, t: 'Algoria', s: 'fixed lot, always' }],
      },
      {
        id: 'sl', kicker: 'Every single trade', title: 'A stop loss on every trade.',
        body: 'When a trade goes wrong, the loss is **cut and accepted.** Never averaged down, never “held until it comes back”. The AI manages it all, news included.',
      },
      {
        id: 'quiet', kicker: 'Quality over quantity', title: 'No trade today ? That’s the plan.',
        body: 'Algoria never over-trades. It only enters when a **clean setup** shows up. Quiet days are normal, and they are part of the strategy.',
        facts: [{ ok: true, t: 'Clean setup', s: 'trade' }, { ok: false, t: 'No setup', s: 'no trade' }],
      },
      {
        id: 'copy', kicker: 'The copy, step by step', title: 'Your money stays yours.',
        body: 'Algoria trades. The copier sends each trade to **your own MT5 account**, automatically, at the size you chose. Your funds never leave your broker account, in your name.',
        facts: [{ ok: true, t: 'Algoria AI', s: 'takes the trade' }, { ok: true, t: 'Copier', s: 'copies it automatically' }, { ok: true, t: 'Your MT5 account', s: 'your size · your broker · your name' }],
      },
      {
        id: 'password', kicker: 'Account safety', title: 'What your password can’t do.',
        body: 'The **trader password** only connects your account to the copier so trades can be copied. Deposits and withdrawals stay 100% in your hands.',
        facts: [{ ok: true, t: 'Copy the trades' }, { ok: false, t: 'Withdraw your money' }, { ok: false, t: 'Deposit or move funds' }, { ok: false, t: 'Open your client area' }],
      },
      {
        id: 'thirty', kicker: 'The one rule', title: 'Keep your deposit 30 days.',
        body: 'Those 30 days register your account with the partner broker, and that is what keeps **your Algoria access free.** After 30 days, the money is yours to withdraw whenever you want.',
        note: 'A withdrawal before day 30 disconnects the account from Algoria.',
      },
    ],
  },
  {
    key: 'faq', label: 'FAQ', icon: '💬', blurb: 'The questions everyone asks us.',
    lessons: [
      {
        id: 'demo', kicker: 'You asked', title: 'Can I try a demo first ?',
        body: 'The free access works on a **real account**, that’s how the broker registers it. A demo is possible with the $400 lifetime license. Want to judge first ? The track record shows every real trade.',
        facts: [{ ok: false, t: 'Free access', s: 'needs a real account' }, { ok: true, t: 'Lifetime license ($400)', s: 'demo possible' }],
        link: TRACK,
      },
      {
        id: 'broker', kicker: 'You asked', title: 'Which broker should I pick ?',
        body: '**RaiseFX first:** your account runs with the same spreads as the account Algoria trades. Already have an account there ? Pick another partner: VT Markets, PU Prime, TradingSphere or Xlence.',
        note: 'The broker’s deposit bonus is trading credit, not withdrawable cash.',
      },
      {
        id: 'withdraw', kicker: 'You asked', title: 'When can I withdraw ?',
        body: 'Keep your deposit **30 days**, that’s what keeps your access free. After that, withdraw whenever you want, with the same method you used to deposit.',
        facts: [{ ok: true, t: 'Withdraw whenever you want', s: 'after day 30' }, { ok: true, t: 'Same method as your deposit' }, { ok: false, t: 'Broker bonus', s: 'trading credit, not cash' }],
      },
      {
        id: 'deposit', kicker: 'You asked', title: 'How much should I deposit ?',
        body: 'We recommend **$500:** the 0.01 lot rule is built on it, so the AI trades your account at its normal size. The minimum is $200, in any currency.',
        facts: [{ ok: true, t: '$500 recommended', s: 'copies at 0.01 lot' }, { ok: true, t: '$200 minimum', s: 'any currency · your account · your name' }],
      },
      {
        id: 'link', kicker: 'You asked', title: 'Why use your link ?',
        body: 'That’s how Algoria stays free. The partner broker pays us, **never a cut of your profits.** An account opened without the link isn’t linked to Algoria, so it isn’t free.',
        facts: [{ ok: true, t: 'You pay $0', s: 'no fee · no subscription · no profit cut' }],
      },
      {
        id: 'existing', kicker: 'You asked', title: 'Already have an account ?',
        body: 'You can’t open a second one at the same broker, KYC blocks it. **Two easy ways in:**',
        facts: [{ ok: false, t: '2nd account, same broker', s: 'KYC blocks it' }, { ok: true, t: 'Option A: attach your account', s: 'ask their support · the app gives you the exact message' }, { ok: true, t: 'Option B: open at another partner', s: 'through the link in the app' }],
      },
    ],
  },
  {
    key: 'myths', label: 'Myth vs Fact', icon: '🧐', blurb: 'What people think, and what is true.',
    lessons: [
      {
        id: 'hand', kicker: 'Myth vs Fact', title: 'Who’s really trading ?',
        body: 'Algoria is **100% driven by AI**, on gold and crypto. Mathieu built it, he never places a trade by hand. Every trade you get is the AI’s decision.',
        facts: [{ ok: false, t: 'Someone trades by hand behind the screen' }, { ok: true, t: '100% AI. Zero manual trades.' }],
      },
      {
        id: 'wins', kicker: 'Myth vs Fact', title: 'Only the wins ?',
        body: 'The track record is the **real copied account**, trade by trade since July 2026, red months included. No simulation, no backtest.',
        facts: [{ ok: false, t: 'They only show the winning trades' }, { ok: true, t: 'Every real trade, red months included' }],
        link: TRACK,
      },
      {
        id: 'biglot', kicker: 'Myth vs Fact', title: 'Bigger lot, faster money ?',
        body: 'The rule is **0.01 lot per ~$500** of balance. A bigger lot doesn’t make the strategy better, it just makes every loss bigger too.',
        facts: [{ ok: false, t: 'Bigger lot, faster money' }, { ok: true, t: '0.01 lot per ~$500. Bigger lot = bigger risk.' }],
      },
      {
        id: 'manual', kicker: 'Myth vs Fact', title: 'Do I copy the trades ?',
        body: 'No. You connect your own **MetaTrader 5** account once, then every Algoria trade is copied automatically at your size. You can pause or stop the copy yourself in the app.',
        facts: [{ ok: false, t: 'I have to copy the trades myself' }, { ok: true, t: 'Copied automatically on your own MT5' }],
      },
      {
        id: 'nodeposit', kicker: 'Myth vs Fact', title: 'Free means no deposit ?',
        body: 'The access is free, the broker pays Algoria. But the AI can’t trade a $0 account: **your deposit stays your money**, on your own account.',
        facts: [{ ok: false, t: 'Free access means no deposit needed' }, { ok: true, t: 'Access is free. The deposit is yours.' }],
      },
      {
        id: 'days', kicker: 'Myth vs Fact', title: 'A trade open for days ?',
        body: 'Crypto positions aren’t intraday, one can stay open a few days. **Every one still has its stop loss**, the AI manages it the whole time.',
        facts: [{ ok: false, t: 'A trade open for days means it’s stuck' }, { ok: true, t: 'Crypto isn’t intraday. Stop loss always on.' }],
      },
    ],
  },
  {
    key: 'glossary', label: 'Glossary', icon: '📚', blurb: 'The trading words, in plain English.',
    lessons: [
      {
        id: 'g-lot', kicker: 'Lot · the size of a trade', title: 'Lot',
        body: 'The bigger the lot, the more each price move is worth, **up and down.** 1.00 is a standard lot, 0.01 is a micro lot, 100 times smaller.',
        note: '0.01 lot per ~$500 of balance, set once in your profile.',
      },
      {
        id: 'g-sl', kicker: 'Stop loss · the automatic exit', title: 'Stop loss',
        body: 'A price level fixed in advance where a losing trade **closes by itself.** The loss is cut and accepted, it can’t keep growing.',
        note: 'Every single trade has one. We never hold and hope.',
      },
      {
        id: 'g-lev', kicker: 'Leverage · 1:500', title: 'Leverage',
        body: 'The broker lets you open a position **bigger than the margin** it blocks. What you win or lose per move still depends on your lot size, not the leverage.',
        note: 'MT5 standard account, 1:500 leverage.',
      },
      {
        id: 'g-spread', kicker: 'Spread · the buy / sell gap', title: 'Spread',
        body: 'At any moment there’s a buy price and a slightly lower sell price. **The gap is the spread**, the broker’s cost on every trade.',
        note: 'RaiseFX: same spreads as the account Algoria trades.',
      },
      {
        id: 'g-dd', kicker: 'Drawdown · the dip', title: 'Drawdown',
        body: 'How far an account drops from its **last peak** before making a new high. Every real strategy has some, the question is how it’s managed.',
        note: 'Nothing hidden: red months are on the track record.',
        link: TRACK,
      },
      {
        id: 'g-kyc', kicker: 'Know Your Customer', title: 'KYC',
        body: 'The identity check every regulated broker does before you can trade: **your ID**, sometimes a proof of address. One person, one identity.',
        note: 'That’s why a 2nd account at the same broker is blocked.',
      },
    ],
  },
  {
    key: 'raisefx', label: 'RaiseFX', icon: '⭐', blurb: 'Our first-choice broker, step by step.',
    lessons: [
      {
        id: 'r-why', kicker: 'Broker spotlight', title: 'Meet RaiseFX',
        body: '**Algoria’s own broker.** Your account runs with the exact same spreads as the account the AI trades live. That’s why it’s the first one we recommend.',
        facts: [{ ok: true, t: 'Exact same spreads', s: 'as the account you watch live' }, { ok: true, t: 'MT5 · standard · 1:500', s: 'server RaiseGlobal-Live' }],
      },
      {
        id: 'r-steps', kicker: 'Broker spotlight', title: 'Open it in 4 steps',
        body: 'Everything starts from the app. The one step people miss: RaiseFX only enables trading once your **KYC level 2** is validated.',
        facts: [{ ok: true, t: '1. Open with the link', s: 'in the Algoria app' }, { ok: true, t: '2. MT5 standard account', s: 'leverage 1:500' }, { ok: true, t: '3. Validate KYC level 2', s: 'trading unlocks right after' }, { ok: true, t: '4. Deposit and connect', s: '$500 recommended' }],
      },
    ],
  },
];

export const QUIZ: QuizQuestion[] = [
  { q: 'What happens to your lot size after a losing trade ?', options: ['It doubles to win it back', 'It stays exactly the same', 'It drops to zero', 'The AI picks a random size'], answer: 1, why: 'Fixed lot, always. Doubling after a loss is a martingale, Algoria does the opposite.' },
  { q: 'Where is your money while Algoria trades ?', options: ['On Algoria’s account', 'On your own broker account', 'In a shared pool', 'In a crypto wallet'], answer: 1, why: 'It never leaves your broker account, in your name. Algoria never holds your funds.' },
  { q: 'The trader password you give the copier lets it…', options: ['Withdraw your funds', 'Copy trades only', 'Change your deposit method', 'Open your client area'], answer: 1, why: 'Copy trades, that’s it. No withdrawals, no deposits, no access to your client area.' },
  { q: 'Recommended lot for every ~$500 of balance ?', options: ['0.01', '0.10', '0.50', '1.00'], answer: 0, why: '0.01 lot per ~$500, set in your profile. A bigger lot doesn’t mean faster money, it means bigger risk.' },
  { q: 'How long do you keep your deposit in to keep your access free ?', options: ['7 days', '14 days', '30 days', '1 year'], answer: 2, why: '30 days. After that, withdraw whenever you want with the same method you deposited with.' },
  { q: 'Can you withdraw the broker’s deposit bonus ?', options: ['Yes, anytime', 'Yes, after 30 days', 'No, it’s trading credit', 'Only in crypto'], answer: 2, why: 'The bonus is trading credit: it helps you trade but it can’t be withdrawn. Your own deposit can.' },
  { q: 'How does Algoria get paid ?', options: ['A % of your profits', 'A monthly subscription', 'The partner broker pays us', 'A fee you pay at signup'], answer: 2, why: 'The partner broker pays Algoria when you open with our link. You pay $0, we never take a cut of your profits.' },
  { q: 'No trade today. What does it mean ?', options: ['The AI is broken', 'No clean setup, so no trade', 'You have to restart the app', 'Your lot is too small'], answer: 1, why: 'Algoria never over-trades. It only enters on clean setups, quality over quantity.' },
  { q: 'Which account do you need to connect ?', options: ['MT4, any leverage', 'MT5 standard, 1:500 leverage', 'A demo account', 'Any crypto exchange'], answer: 1, why: 'MetaTrader 5, standard account, 1:500 leverage. Free access needs a real account.' },
  { q: 'Every single Algoria trade has…', options: ['A stop loss', 'No limit at all', 'A doubling rule', 'A manual exit by Mathieu'], answer: 0, why: 'A stop loss on every trade. When it’s wrong, it’s cut and we move on.' },
];
