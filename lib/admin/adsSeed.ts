// ADS STUDIO · BIBLIOTHÈQUE DE DÉPART (01/10/2026) — importée une seule fois, d'un clic, depuis l'onglet.
// Source : le brief de Benjamin (« Algoria_Creatives_Mathieu.pdf », 6 pôles, 41 idées) et les 7 Ugly Ads écrites
// à partir de son pôle 4. Adapté à ce qu'est vraiment Algoria :
// - du COPY TRADING : l'IA trade l'or, le compte broker du membre copie automatiquement, rien à configurer ;
// - une « alerte » = la notification de gain avec la card style Binance (app + Telegram VIP), pas une alerte réglée ;
// - $ et pas € ; minimum 200 $, recommandé 500 $ (0.01 lot par 500 $) ; jamais de taille de compte (« 0.01 lot ») ;
// - jamais la règle des 30 jours (décision Mathieu : « c'est frustrant et ça peut leur faire peur ») ;
// - le passé oui, avec le rappel de risque ; aucune promesse sur l'avenir.
// Benjamin est l'expert ads : seuls les risques de refus / blocage Meta sont signalés (meta_flag).
import type { Need, Pole, Status } from './ads';

export interface SeedScript {
  key: string; pole: Pole; title: string; hook: string; body: string; prep?: string; needs: Need[];
  duration?: string; status: Status; source: string; notes?: string; meta_flag?: string; alt?: [string, string][];
}
export interface SeedHook { key: string; text: string; angle: string }

const RISK = 'Texte de fin à l\'écran : Trading involves risk. Past results don\'t guarantee future results.';
const BRIEF = 'Brief Benjamin';
const UGLY = 'Brief Benjamin · script prêt';
const PLAYED = 'Scène jouée : si un personnage parle de ses gains, afficher « Dramatization » à l\'écran et n\'utiliser qu\'une card de gain réelle (vrai trade du track record). Meta sanctionne les faux témoignages dans la pub financière.';

export const SEED_SCRIPTS: SeedScript[] = [
  // ===== PÔLE 1 · MICRO-TROTTOIRS =====
  {
    key: 'street-1', pole: 'street', title: 'Questions à choix, puis Algoria', status: 'idea', source: BRIEF, needs: ['street', 'videographer'], duration: '30 à 45 s',
    hook: '"1 Bitcoin or 10,000 dollars ? You have 2 seconds."',
    body: `Mathieu pose 4 à 5 questions rapides à une personne, de plus en plus proches du revenu passif. La dernière réponse amène Algoria.

Exemple d'enchaînement :
1. "1 Bitcoin or 10,000 dollars ?"
2. "Work one more hour a day, or never think about money again ?"
3. "Learn trading for 2 years, or let an AI do it ?"
4. "Watch charts all day, or check your phone twice ?"
5. "Last one: would you let an AI trade gold for you ?"

Sur la dernière réponse : "That's what Algoria is. An AI trades gold, and your own broker account copies it, automatically."

Fin
"Every trade is public. Link below 🙏🏼"
${RISK}`,
  },
  {
    key: 'street-2', pole: 'street', title: 'Rencontre spontanée dans la rue', status: 'idea', source: BRIEF, needs: ['street', 'videographer'], duration: '30 à 45 s',
    hook: '"Quick question: is any of your money working for you right now ?"',
    body: `Mathieu arrête 1 ou 2 passants, leur parle d'investissement passif, rebondit sur leurs réponses, puis amène Algoria naturellement.

Les 3 points à placer, simplement :
1. "An AI trades gold. Your account copies every trade, automatically."
2. "Your money stays on your own broker account, in your name."
3. "Every trade is public, wins and losses."

Fin
"Go check the track record yourself. Link below 🙏🏼"
${RISK}`,
  },
  {
    key: 'street-3', pole: 'street', title: 'Débutants perdus face au trading', status: 'idea', source: BRIEF, needs: ['street', 'videographer'], duration: '30 à 45 s',
    hook: '"If you had to start trading today, where would you even begin ?"',
    body: `Mathieu interroge des personnes qui ne connaissent rien au trading. Leurs réponses montrent qu'elles ne savent pas par où commencer (c'est le cœur de la vidéo, garder les hésitations).

Puis Mathieu sort son téléphone, page live de l'app :
"With Algoria you don't need to know where to begin. There's nothing to set up: the AI trades, your account copies it. And if you want to learn the basics, there's an Academy inside the app."

Fin
"Link below 🙏🏼"
${RISK}`,
  },
  {
    key: 'street-4', pole: 'street', title: 'Combien vaut ton temps ?', status: 'idea', source: BRIEF, needs: ['street', 'videographer'], duration: '30 à 45 s',
    hook: '"How much is one hour of your time worth ?"',
    body: `Mathieu demande aux passants ce qu'ils font dans la vie et combien vaut une heure de leur temps. Quand l'un explique qu'il est salarié, Mathieu fait le lien : aujourd'hui, il échange son temps contre de l'argent.

Mathieu : "What if part of your money worked without taking your time ? That's the idea behind Algoria: an AI trades gold, your account copies it, and you don't spend your days on charts."

Fin
"See every trade it has taken. Link below 🙏🏼"
${RISK}`,
    meta_flag: 'Ne pas présenter Algoria comme un remplacement de salaire ni promettre un revenu (« earn X without working ») : Meta refuse ces pubs dans la catégorie services financiers.',
  },
  {
    key: 'street-5', pole: 'street', title: 'Que ferais-tu avec 200 $ ?', status: 'idea', source: BRIEF, needs: ['street', 'videographer'], duration: '30 à 45 s',
    hook: '"What would you do with 200 dollars ?"',
    body: `Mathieu demande aux passants ce qu'ils feraient avec 200 $. Leurs réponses ouvrent la discussion sur l'investissement.

Mathieu : "You don't need thousands to start. With Algoria the minimum is 200 dollars. 500 is better: the guideline is 0.01 lot per 500 dollars."

Les points qui rassurent un débutant (confirmés) :
- "Your money stays on your own broker account, in your name. We never touch it."
- "You withdraw from your broker, the same way you deposited."
- "It works with our partner brokers: RaiseFX, VT Markets, PU Prime, TradingSphere and Xlence."

Fin
"Start small, watch every trade, decide for yourself. Link below 🙏🏼"
Texte : Trading involves risk. Only invest what you can afford to lose.`,
    notes: 'Ne pas parler de la règle des 30 jours (décision Mathieu).',
  },
  {
    key: 'street-6', pole: 'street', title: 'Tu laisserais une IA trader pour toi ?', status: 'idea', source: BRIEF, needs: ['street', 'videographer'], duration: '45 à 60 s',
    hook: '"Would you let an AI trade for you ?"',
    body: `La personne est d'abord sceptique et pose ses questions. Mathieu répond en montrant l'app :
- "Where's my money ?" → "On your own broker account. The password you give us only lets the AI copy trades. It can't withdraw."
- "Does it lose ?" → il montre le track record public, avec un jour rouge.
- "How do I start ?" → il fait les premières étapes avec elle, en direct : l'écran broker de l'app, le tunnel d'inscription.

Fin
"Want to see every trade it has taken ? Link below 🙏🏼"
${RISK}`,
    notes: 'Ne jamais filmer de vrais identifiants (login, mot de passe, serveur).',
  },

  // ===== PÔLE 2 · SCÈNES JOUÉES =====
  {
    key: 'scene-1', pole: 'scene', title: 'Le seau d\'eau', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '30 à 40 s',
    hook: 'Plan large : une personne assise sur un escabeau commence à parler, on voit l\'autre arriver derrière avec un seau d\'eau. "OK, so Algoria is an AI that trades gold…" · Texte : Wait for it.',
    body: `Le montage coupe juste avant l'impact. La personne assise déroule sa présentation, le spectateur attend la chute.

Présentation (3 points) :
1. "An AI trades gold for you."
2. "Your own broker account copies every trade, automatically, at 0.01 lot."
3. "And every single trade is public, wins and losses."

Fin : retour au geste du début, elle reçoit le seau.
"…link below 🙏🏼" (dit trempée)
${RISK}`,
    prep: 'Un lieu qui peut être mouillé, serviettes, vêtements de rechange. Tourner plusieurs prises de la chute et garder de la marge au montage pour choisir le moment exact du début, de la coupure et de l\'impact.',
  },
  {
    key: 'scene-2', pole: 'scene', title: 'La discussion à la maison', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '30 à 45 s',
    hook: '"Wait, since when are you into trading ?"',
    body: `Deux personnes (couple ou amis selon le casting) rentrent à la maison. La conversation part sur le trading. L'une explique qu'elle ne fait rien elle-même et montre Algoria sur son téléphone : la page live, puis une notification de gain avec la card.

"I don't trade. The AI does, and my account copies it. I just get the notification."
L'autre : "And where's your money ?" · "On my own broker account. In my name."

Fin
"Link below 🙏🏼"
${RISK}`,
    meta_flag: PLAYED,
  },
  {
    key: 'scene-3', pole: 'scene', title: 'Confisque-moi ces écrans', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '30 s',
    hook: '"Give me that. And that. And that one too."',
    body: `Une personne est absorbée par ses graphiques sur plusieurs appareils. L'autre arrive et lui confisque ses écrans un par un.

Puis elle lui présente Algoria : "You don't need to watch all of this. An AI trades gold, and your account copies it, automatically."

Fin : elle lui rend un seul téléphone, avec l'app Algoria ouverte. "That's all you need. Link below 🙏🏼"
${RISK}`,
    notes: 'Tout repose sur le contraste : l\'obsession des graphiques contre la simplicité de l\'app.',
  },
  {
    key: 'scene-4', pole: 'scene', title: 'Le dîner interrompu', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '25 à 35 s',
    hook: 'Le téléphone vibre sur la table. "Sorry… it\'s my AI."',
    body: `Adaptation Algoria : pas d'alerte configurée. C'est la notification de gain d'Algoria (la card style Binance) qui arrive pendant le repas : un trade de l'IA vient de se fermer, copié sur son compte.

Elle montre la card : "The AI just closed a trade on gold. My account copied it. I was eating."
L'autre : "You didn't do anything ?" · "Nothing. That's the point."

Fin
"Link below 🙏🏼"
${RISK}`,
    meta_flag: 'Card de gain réelle uniquement (vrai trade), et « with 0.01 lot », jamais de taille de compte. Sinon mention « Dramatization ». Meta sanctionne les résultats inventés.',
  },
  {
    key: 'scene-5', pole: 'scene', title: 'Les messages vocaux', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '30 à 40 s',
    hook: 'Vocal 1 : "I lost money again today… I honestly don\'t know what I\'m doing anymore."',
    body: `Deux lieux différents, uniquement des messages vocaux. Le montage alterne les lieux et les vocaux.

Vocal 2 : "Stop trading on your own. Look at Algoria: an AI trades gold and your account copies it. You don't make any decision. And you can see every trade it has taken, losses included."
Vocal 3 : "Wait, where does my money go ?" · Vocal 4 : "Nowhere. It stays on your own broker account."

Fin
"Link below 🙏🏼"
${RISK}`,
    notes: 'Adaptation : le brief parle d\'une IA qui aide à « préparer ses décisions ». Chez Algoria il n\'y a aucune décision à prendre, le compte copie.',
  },
  {
    key: 'scene-6', pole: 'scene', title: 'La fausse réunion', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '25 à 35 s',
    hook: '"Are you still in a meeting ?" · "No… I\'m watching my AI trade."',
    body: `Elle le croit au travail, très concentré devant son ordinateur. Il lui montre la page live d'Algoria : le trade en cours de l'IA, le même que sur son compte.

"I don't analyse anything. The AI trades gold, my account copies it. I just like watching it."

Fin : il ferme l'ordinateur et part avec elle. "Link below 🙏🏼"
${RISK}`,
  },

  // ===== PÔLE 3 · JEU D'ACTEUR AVEC MATHIEU =====
  {
    key: 'acting-1', pole: 'acting', title: '« C\'est Mathieu d\'Algoria ! »', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '30 s',
    hook: '"Wait… are you Mathieu from Algoria ?"',
    body: `Deux personnes croisent Mathieu et le reconnaissent grâce aux pubs. Mathieu confirme, échange quelques mots et explique simplement :
"An AI trades gold, your own broker account copies it, and every trade is public."
L'une : "So I don't have to do anything ?" · "You connect your account once. That's it."

Fin, Mathieu face caméra
"You can message me directly. Link below 🙏🏼"
${RISK}`,
    notes: 'Doit avoir l\'air spontané, mais reste une scène jouée.',
  },
  {
    key: 'acting-2', pole: 'acting', title: 'La mini-conférence Algoria', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '30 s une fois monté',
    hook: '"Here\'s how Algoria works, explained to two people who have never traded."',
    body: `Mathieu anime une courte présentation devant les 2 acteurs (écran ou tableau) :
1. "An AI trades gold."
2. "You open an account with a partner broker, in your name."
3. "You connect it in the app, and every trade is copied automatically."
Puis il les accompagne dans les premières étapes de l'app. Le montage condense présentation, questions et prise en main.

Fin
"Link below 🙏🏼"
${RISK}`,
    notes: 'Ne filmer aucun identifiant réel.',
  },
  {
    key: 'acting-3', pole: 'acting', title: '« Encore une pub de trading ? »', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '40 à 50 s',
    hook: '"Oh great… another trading ad."',
    body: `Deux personnes tombent sur une pub de Mathieu et réagissent avec scepticisme. Mathieu arrive : "Fair. Let me show you."
- Il montre le track record public : "Every trade since the start. Including this red day."
- "Your money never comes to us. It stays on your own broker account."
Les deux personnes, rassurées par la démonstration, décident de regarder avec lui.

Fin
"Don't trust me. Check it yourself. Link below 🙏🏼"
${RISK}`,
    meta_flag: 'Leur réaction est jouée : ne pas la présenter comme un avis client réel (mention « Dramatization » si besoin).',
  },
  {
    key: 'acting-4', pole: 'acting', title: 'Le suivi avec Mathieu', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '40 à 50 s',
    hook: '"So, how\'s your first week with Algoria ?"',
    body: `Mathieu retrouve les deux personnages pour faire le point. Contenu laissé à Mathieu, fidèle au vrai accompagnement, par exemple :
- où voir chaque trade dans l'app ;
- comment mettre la copie en pause en un tap ;
- comment retirer chez son broker.

Fin, Mathieu face caméra
"Got a question ? Message me directly. Link below 🙏🏼"
${RISK}`,
    meta_flag: PLAYED,
  },
  {
    key: 'acting-5', pole: 'acting', title: 'Les clones : débutant contre expert', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '30 à 40 s',
    hook: 'Débutant (gauche) : "I keep losing money and I don\'t know why." · Expert (droite) : "Because you trade on emotions."',
    body: `Mathieu au centre. À gauche, le débutant (t-shirt couleur A) ; à droite, l'expert (t-shirt couleur B), joués par le même acteur et réunis au montage.

Débutant : "So what do I do ?"
Mathieu (au milieu) : "You let an AI do it. It trades gold, no emotions, no fatigue, and your account copies every trade."
Expert : "And you can check every trade it has taken."

Fin
"Link below 🙏🏼"
${RISK}`,
    prep: 'Trépied, cadrage fixe, même lumière. Deux t-shirts de couleurs différentes par acteur. Tourner 2 versions (acteur 1 dupliqué, puis acteur 2).',
  },
  {
    key: 'acting-6', pole: 'acting', title: '« Tu as 30 secondes »', status: 'idea', source: BRIEF, needs: ['actors', 'videographer'], duration: '30 s pile',
    hook: '"You\'ve got 30 seconds to explain Algoria. Go."',
    body: `Chrono à l'écran. Mathieu : "An AI trades gold. Your own broker account copies it, automatically. Every trade is public."
Les acteurs : "Prove it."
Il montre la page live, le track record, une card de gain réelle.
Acteur : "Where's the money ?" · "On your broker account. In your name."
Conclure avant zéro.

Fin
"Link below 🙏🏼"
${RISK}`,
  },

  // ===== PÔLE 4 · UGLY ADS (scripts prêts à tourner) =====
  {
    key: 'ugly-1', pole: 'ugly', title: 'This is my real trading account', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '30 à 40 s',
    prep: 'Ton téléphone pour filmer, un 2e téléphone avec MetaTrader ouvert sur un compte qui copie à 0.01 lot, et l\'app Algoria ouverte sur la page live.',
    hook: '"This is my real trading account, and I haven\'t placed a single trade myself." · Texte : I don\'t place the trades. The AI does.',
    body: `1. (Selfie) "Algoria is an AI that trades gold. My account just copies it, automatically."
2. (Tu filmes le 2e téléphone, MetaTrader) "Here's my broker account. My money, my name. These trades opened on their own, at 0.01 lot."
3. (Tu filmes l'app Algoria, la page live) "And here's the AI's trade, the same one, at the same time."
4. (Selfie) "I don't analyse charts. I don't click buy or sell. I just check it here."

Fin
"Every trade is public on the track record. Tap below and see for yourself 🙏🏼"
Texte : Every trade public. Link below. + ${RISK}`,
    alt: [
      ['I haven\'t clicked buy or sell in weeks. Let me show you why.', 'curiosity'],
      ['This trade opened while I was filming this video.', 'proof'],
      ['Same trade, two screens. One is the AI, one is my account.', 'proof'],
    ],
  },
  {
    key: 'ugly-2', pole: 'ugly', title: 'One notification. One trade. One hour.', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '30 s une fois monté',
    prep: 'Un jour où le marché est actif. Tu filmes en vrai sur environ une heure, chaque plan affiche l\'heure (horloge visible ou ajoutée au montage).',
    hook: '(La vraie card de gain apparaît) "There it is." · Texte : 10:42 · the AI just closed a trade',
    body: `Plans courts, l'heure à l'écran :
1. 09:51 · (app, page live) "The AI just opened a trade on gold. I'm not doing anything."
2. 10:05 · (toi dehors, café ou marche) "Still open. I'm out, living my life."
3. 10:30 · (app) "Still running. My account copies it automatically, at 0.01 lot."
4. 10:42 · (la notification et la card de gain dans le Telegram VIP) "Closed. Profit notification, right here."

Fin
"That's one real trade. Not every trade wins, and they're all on the public track record. Link below 🙏🏼"
${RISK}`,
    notes: 'Si le trade se termine en perte, tu postes quand même la vidéo, ou tu la gardes pour l\'ad « Someone said this is a scam ». C\'est ce qui rend crédible.',
    alt: [
      ['My phone just buzzed. Here\'s what happened in the last hour.', 'curiosity'],
      ['I filmed one trade from start to finish. No cuts on the times.', 'proof'],
      ['This is what an Algoria notification looks like.', 'curiosity'],
    ],
  },
  {
    key: 'ugly-3a', pole: 'ugly', title: 'You asked me · Where is my money ?', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '20 à 30 s',
    prep: 'La question s\'affiche comme une boîte à questions Instagram. Tourne les 5 questions à la suite, même cadre, même lumière : 5 ads en une session.',
    hook: 'Question à l\'écran : "Where is my money actually ?"',
    body: `"On your own broker account. In your name. Algoria never touches it. The password you give us only lets the AI copy trades. It can't withdraw, it can't deposit. Nothing."
(Montre l'écran de connexion de l'app, le champ « trader password », sans vrai mot de passe.)

Fin
"Got a question ? Ask me in the channel. Link below 🙏🏼"`,
  },
  {
    key: 'ugly-3b', pole: 'ugly', title: 'You asked me · Do I need to know trading ?', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '20 à 30 s',
    prep: 'Même session que les 4 autres questions.',
    hook: 'Question à l\'écran : "Do I need to know anything about trading ?"',
    body: `"No. The AI trades, your account copies it. There's nothing to set up, no strategy to pick. You can learn the basics in the Academy inside the app if you want to."
(Montre l'Academy.)

Fin
"Got a question ? Ask me in the channel. Link below 🙏🏼"`,
  },
  {
    key: 'ugly-3c', pole: 'ugly', title: 'You asked me · How much do I need ?', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '20 à 30 s',
    prep: 'Même session que les 4 autres questions.',
    hook: 'Question à l\'écran : "How much do I need to start ?"',
    body: `"The minimum is 200 dollars. I recommend 500, because the guideline is 0.01 lot for every 500 dollars. Start small, watch it work, then decide."

Fin
"Got a question ? Ask me in the channel. Link below 🙏🏼"
Texte : Trading involves risk. Only invest what you can afford to lose.`,
  },
  {
    key: 'ugly-3d', pole: 'ugly', title: 'You asked me · Can I withdraw ?', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '20 à 30 s',
    prep: 'Même session que les 4 autres questions.',
    hook: 'Question à l\'écran : "Can I withdraw whenever I want ?"',
    body: `"It's your own broker account, so yes, it's your money. You withdraw from your broker, the same way you deposited. Nothing is locked with us."

Fin
"Got a question ? Ask me in the channel. Link below 🙏🏼"`,
    notes: 'Pas de règle des 30 jours dans les ads (décision Mathieu).',
  },
  {
    key: 'ugly-3e', pole: 'ugly', title: 'You asked me · Does it lose sometimes ?', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '20 à 30 s',
    prep: 'Même session que les 4 autres questions. La page track record ouverte, avec un jour rouge visible.',
    hook: 'Question à l\'écran : "Does it lose sometimes ?"',
    body: `"Of course. Every trader loses trades, the AI too. That's why every single trade is public on the track record, wins and losses. Go check it."
(Montre la page track record, avec un jour rouge visible.)

Fin
"Got a question ? Ask me in the channel. Link below 🙏🏼"`,
  },
  {
    key: 'ugly-4', pole: 'ugly', title: 'A day with Algoria', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '30 à 40 s',
    prep: '6 à 8 plans courts filmés pendant une vraie journée, chacun avec l\'heure.',
    hook: '(Réveil, téléphone à la main) "First thing I check every morning." · Texte : A normal day. Algoria runs in the background.',
    body: `Plans de 3 à 5 s :
1. 08:00 · café, ouverture de l'app : "Let's see what the AI did overnight."
2. 10:00 · travail, sport ou marche : "I'm not watching charts. It trades on its own."
3. 13:00 · notification de gain pendant le déjeuner : "There's one."
4. 16:00 · rendez-vous ou dehors : "My account just copies, at 0.01 lot."
5. 21:00 · canapé, page track record : "And everything it did today is public, right here."

Fin
"That's the whole point: I got my time back. Link below 🙏🏼"
${RISK}`,
    meta_flag: 'Éviter les plans « luxe » (voiture, billets) : trading + train de vie = pub souvent refusée par Meta. L\'angle, c\'est le temps récupéré, pas l\'argent.',
    alt: [
      ['How much time I spend on trading in a day. Spoiler: 2 minutes.', 'time'],
      ['I trade gold every day and I never open a chart.', 'time'],
      ['POV: the AI trades while you live your life.', 'pov'],
    ],
  },
  {
    key: 'ugly-5', pole: 'ugly', title: 'Someone said this is a scam', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '30 à 40 s',
    prep: 'Un vrai commentaire sceptique (support, Instagram, Telegram), nom et photo floutés. Ton ordinateur ouvert sur le track record public.',
    hook: '(Tu lis le commentaire) "\'Another trading scam.\' Fair. Let me show you."',
    body: `1. "First: your money never comes to us. It stays on your own broker account, in your name."
2. (Ordinateur, track record) "Second: every trade the AI has taken since July is public. Every single one. Including the losing days."
3. (Tu montres un jour rouge) "Here's a red day. We don't hide them."
4. "Third: you don't send us a cent to trade. You fund your own account, with your own broker."

Fin
"Don't trust me. Check it yourself. Link below 🙏🏼"
${RISK}`,
    alt: [
      ['\'If it worked, why would you share it ?\' Good question.', 'skeptic'],
      ['Here\'s every trade our AI has ever taken. Losses included.', 'proof'],
      ['I\'ll show you the losing days first.', 'proof'],
    ],
  },
  {
    key: 'ugly-6', pole: 'ugly', title: 'Only got $200 ?', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '30 à 40 s',
    prep: 'L\'app ouverte sur le tunnel d\'inscription (écran broker, puis écran connexion), sans vrai identifiant.',
    hook: '"Only got 200 dollars ? You can still start." · Texte : Start from $200',
    body: `1. "You don't need thousands. The minimum is 200 dollars. If you can, 500 is better: the guideline is 0.01 lot per 500 dollars."
2. (Écran broker de l'app) "Step one: open an account with one of our partner brokers, in your name."
3. "Step two: fund it. Your money stays there, in your own account."
4. (Écran connexion) "Step three: connect it in the app. Then the AI's trades are copied automatically."

Fin
"Start small, watch every trade, decide for yourself. Link below 🙏🏼"
Texte : Trading involves risk. Only invest what you can afford to lose. + rappel standard.`,
    alt: [
      ['You don\'t need 10,000 dollars to start trading.', 'money'],
      ['What 200 dollars and an AI can do. Here are the 3 steps.', 'money'],
      ['The smallest account you can start with on Algoria.', 'money'],
    ],
  },
  {
    key: 'ugly-7', pole: 'ugly', title: 'I\'m closing my laptop', status: 'to_shoot', source: UGLY, needs: ['solo'], duration: '25 à 35 s',
    prep: 'Ton ordinateur ouvert sur des graphiques, puis ton téléphone avec l\'app.',
    hook: '(Tu fermes l\'ordinateur d\'un coup sec) "I used to stare at this all day. Not anymore." · Texte : I closed the charts.',
    body: `1. "There's nothing to set up. The AI trades gold on its own, and my account copies every trade."
2. (Tu prends le téléphone, page live de l'app) "If I want to see what's happening, it's all here."
3. (Notification ou card de gain si tu en as une réelle, sinon la liste des trades du jour) "And when a trade closes, I get the notification."
4. (Tu te lèves et tu pars) "The rest of the day is mine."

Fin
"Want to see every trade it's taken ? Link below 🙏🏼"
${RISK}`,
    alt: [
      ['This is the last time I open a trading chart.', 'time'],
      ['Trading used to take my whole day.', 'time'],
      ['What if you never had to watch a chart again ?', 'question'],
    ],
  },

  // ===== PÔLE 5 · B-ROLL + VOIX OFF =====
  {
    key: 'broll-1', pole: 'broll', title: 'Ce que personne ne voit derrière un trade', status: 'idea', source: BRIEF, needs: ['solo', 'videographer'], duration: '30 à 40 s',
    hook: 'Face caméra (3 s) : "Clicking buy or sell is the smallest part of a trade."',
    body: `Voix off (micro-cravate), sous-titres sur toute la vidéo :
"Before every trade, someone has to watch the market. Analyse it. Wait for the right moment. Check again. Most people do all of that themselves, for hours. With Algoria, the AI does that part, and your account copies the trade when it happens. You just see the notification."

Inserts : Mathieu devant ses graphiques, prenant des notes, puis consultant l'app Algoria.

Fin
"Every trade is public. Link below 🙏🏼"
${RISK}`,
    notes: 'Adaptation : chez Algoria ce n\'est pas la méthode de Mathieu qui est montrée, c\'est le travail que l\'IA fait à la place du membre.',
  },
  {
    key: 'broll-2', pole: 'broll', title: 'J\'ai arrêté de regarder les graphiques toute la journée', status: 'idea', source: BRIEF, needs: ['solo', 'videographer'], duration: '30 s',
    hook: 'Face caméra (3 s) : "How many hours did you spend on charts this week ?"',
    body: `Voix off :
"That's the part I wanted to get rid of. Now the AI watches gold, takes the trades, and my account copies them. I check the app a couple of times a day, and the rest of my time is mine."

Inserts : l'ordinateur, le téléphone, puis Mathieu qui s'éloigne du bureau, marche, sort.

Fin
"Link below 🙏🏼"
${RISK}`,
    notes: 'Angle : le temps récupéré, sans promesse de résultat.',
  },
  {
    key: 'broll-3', pole: 'broll', title: 'Une notification, et ensuite ?', status: 'idea', source: BRIEF, needs: ['solo', 'videographer'], duration: '25 à 30 s',
    hook: 'Face caméra (3 s), le téléphone vibre : "My phone just buzzed. So what do I do now ?"',
    body: `Voix off :
"Nothing. That notification means the AI just closed a trade, and my account already copied it. No button to press, no order to place. If I want the details, it's all in the app. And every trade, wins and losses, is on the public track record."

Inserts : la card de gain, la page live, le track record.

Fin
"Link below 🙏🏼"
${RISK}`,
    notes: 'Adaptation de « Une alerte, et ensuite ? » : chez Algoria il n\'y a rien à faire après la notification. Card réelle uniquement.',
  },
  {
    key: 'broll-4', pole: 'broll', title: 'La partie de l\'IA qu\'on ne filme jamais', status: 'idea', source: BRIEF, needs: ['solo', 'videographer'], duration: '30 à 40 s',
    hook: 'Face caméra (3 s) : "This is the part of Algoria nobody films."',
    body: `Voix off :
"Every week I read what members tell me, and we improve the app. A clearer screen here, a faster setup there. The AI trades, but there's a team behind it, every day."

Inserts : Mathieu au bureau, en réunion, devant ses écrans, pendant le tournage.

Fin
"Link below 🙏🏼"`,
  },
  {
    key: 'broll-5', pole: 'broll', title: 'On a filmé tout ça à Pau', status: 'idea', source: BRIEF, needs: ['solo', 'videographer'], duration: '30 à 40 s',
    hook: 'Face caméra (3 s) : "Behind every ad you\'ve seen, here\'s what really happens."',
    body: `Voix off :
"This is the day we filmed in Pau. The setup, the team, the demo. And in between takes, the AI kept trading, and my account kept copying."

Inserts : arrivée sur le lieu, préparation d'une démo, échanges avec l'équipe, l'app ouverte entre deux prises.

Fin
"Link below 🙏🏼"`,
    notes: 'Faisable dès le jour du tournage : prévoir beaucoup de plans courts et variés.',
  },
  {
    key: 'broll-6', pole: 'broll', title: 'Si je découvrais le trading aujourd\'hui', status: 'idea', source: BRIEF, needs: ['solo', 'videographer'], duration: '30 à 40 s',
    hook: 'Face caméra (3 s) : "If I was starting trading today, here\'s what I\'d want to know first."',
    body: `Voix off :
"Where is my money ? Can I see every trade, including the losses ? How much do I really need to start ? With Algoria, your money stays on your own broker account, every trade is public, and you can start from 200 dollars."

Inserts : Mathieu qui marche, explique un graphique, ouvre l'app, montre le track record.

Fin
"Link below 🙏🏼"
${RISK}`,
    notes: 'Ton débutant, aucune promesse de gain.',
  },

  // ===== PÔLE 6 · AUTRES PISTES =====
  {
    key: 'other-1', pole: 'other', title: 'UGC à distance', status: 'idea', source: BRIEF, needs: ['creators'],
    hook: 'Au choix du créateur, dans la banque de hooks.',
    body: 'Faire tourner des créateurs anglophones chez eux, pour d\'autres visages, voix et accents. Leur envoyer une fiche Ugly Ad comme base.',
    meta_flag: 'Un créateur qui n\'est pas membre ne doit pas présenter des gains comme les siens. Contenu payé : activer le tag « Paid partnership » sur Meta.',
  },
  {
    key: 'other-2', pole: 'other', title: 'Tutoriels pour débutants', status: 'idea', source: BRIEF, needs: ['solo'],
    hook: '"How to connect your MT5 account to Algoria, in 40 seconds."',
    body: `Filmer l'écran (app Algoria, MT5 ou le compte broker) avec la petite caméra de Mathieu dans un coin, une étape précise par vidéo.

Idées : trouver son serveur MT5 · créer son mot de passe trader · connecter son compte · lire la page live · mettre en pause.`,
    notes: 'Bonus : ces tutos servent aussi au support (les erreurs d\'identifiants MT5 font perdre beaucoup de temps).',
  },
  {
    key: 'other-3', pole: 'other', title: 'Réactions à des vidéos', status: 'idea', source: BRIEF, needs: ['solo'],
    hook: 'Un trader à l\'écran : "AI trading is a scam." · Mathieu : "Let me show you what ours actually does."',
    body: 'Un court passage d\'un trader qui critique l\'IA ou soulève une objection, puis Mathieu réagit et montre son point de vue à l\'écran (track record, page live).',
    meta_flag: 'Extrait d\'une vidéo d\'un autre créateur : réclamation de droits d\'auteur possible et pub retirée. Garder un extrait très court, ou recréer l\'objection en texte à l\'écran.',
  },
  {
    key: 'other-4', pole: 'other', title: 'Conférence du 17 octobre', status: 'idea', source: BRIEF, needs: ['event', 'videographer'],
    hook: 'Une citation courte de Mathieu sur scène.',
    body: 'Filmer un ou deux passages en anglais, des citations courtes, le public et des plans de scène réutilisables en ads.',
  },
  {
    key: 'other-5', pole: 'other', title: 'Studio avec hooks visuels', status: 'idea', source: BRIEF, needs: ['videographer'],
    hook: 'Animation courte : un taureau de marché se fait écraser, puis coupe nette vers Mathieu au studio.',
    body: 'Continuer les vidéos studio déjà produites, en testant des ouvertures visuelles marquantes avant l\'arrivée de Mathieu à l\'écran. Le taureau n\'est qu\'un exemple.',
  },
  {
    key: 'other-6', pole: 'other', title: 'Lifestyle à Dubaï', status: 'idea', source: BRIEF, needs: ['solo'],
    hook: 'À définir sur place.',
    body: 'Lors d\'un prochain séjour, filmer le quotidien de Mathieu à Dubaï pour de nouveaux décors, relié à une vraie démo d\'Algoria.',
    meta_flag: 'Risque Meta élevé : luxe + trading = promesse implicite de richesse, souvent refusé. Montrer le quotidien, pas l\'argent (pas de voitures, de billets, de montres), et toujours une vraie démo.',
  },
  {
    key: 'other-7', pole: 'other', title: 'Réponses aux commentaires en vidéo', status: 'idea', source: BRIEF, needs: ['solo'],
    hook: 'Le commentaire à l\'écran, flouté.',
    body: 'Prendre une question ou une objection du public, l\'afficher en hook, et répondre avec une preuve visuelle ou une démo. Même format que l\'Ugly Ad « Someone said this is a scam » : à décliner en série.',
    notes: 'Toujours flouter le nom et la photo de la personne.',
  },
  {
    key: 'other-8', pole: 'other', title: 'Démos d\'une seule fonction', status: 'idea', source: BRIEF, needs: ['solo'],
    hook: '"One feature of Algoria, in 15 seconds."',
    body: `Une vidéo = une fonction, filmée sur le téléphone, avec un bénéfice concret en quelques secondes.

Idées : la page live · la card de gain · le track record public · la pause en un tap · l'Academy · le parrainage.`,
  },
  {
    key: 'other-9', pole: 'other', title: 'Comparaison de méthodes', status: 'idea', source: BRIEF, needs: ['solo'],
    hook: '"Trading gold by hand vs letting an AI do it. Same day."',
    body: 'Côte à côte : une journée de trading manuel (graphiques, analyse, stress, temps passé) et la même journée avec Algoria (la page live, une notification). On compare le temps et l\'effort, sans promettre de résultat.',
    notes: 'Adaptation : le brief compare deux analyses ; chez Algoria le membre n\'analyse rien, on compare donc le temps passé.',
  },
  {
    key: 'other-10', pole: 'other', title: 'Extraits Q&A en public', status: 'idea', source: BRIEF, needs: ['event', 'videographer'],
    hook: 'La question du public, telle quelle.',
    body: 'Lors d\'une conférence ou d\'un événement, isoler les échanges les plus clairs et les monter en formats courts, en anglais.',
  },
];

/** Hooks isolés (non rattachés à une fiche) : la réserve quand il en manque. */
export const SEED_HOOKS: SeedHook[] = [
  { key: 'hook-1', text: 'I\'m going to show you our worst day first.', angle: 'proof' },
  { key: 'hook-2', text: 'Every trade our AI has taken is public. Here\'s the link.', angle: 'proof' },
  { key: 'hook-3', text: 'I check my trading account twice a day. That\'s it.', angle: 'time' },
  { key: 'hook-4', text: 'What I do while the AI trades: literally anything else.', angle: 'time' },
  { key: 'hook-5', text: 'You don\'t need to understand charts for this.', angle: 'beginner' },
  { key: 'hook-6', text: '3 things to check before you trust any trading app.', angle: 'beginner' },
  { key: 'hook-7', text: 'If you think this is too good to be true, good. Check the losses.', angle: 'skeptic' },
  { key: 'hook-8', text: 'Where is your money ? Not with us. Here\'s why that matters.', angle: 'skeptic' },
  { key: 'hook-9', text: 'Start with 200 dollars, not 20,000.', angle: 'money' },
  { key: 'hook-10', text: 'I let an AI trade gold on my account. Here\'s what it looks like.', angle: 'curiosity' },
  { key: 'hook-11', text: 'This notification is the only thing I see from my trading all day.', angle: 'curiosity' },
  { key: 'hook-12', text: 'POV: your phone buzzes at dinner and it\'s a closed trade.', angle: 'pov' },
  { key: 'hook-13', text: 'POV: you closed your charts for good.', angle: 'pov' },
  { key: 'hook-14', text: 'Would you let an AI trade for you ? Be honest.', angle: 'question' },
  { key: 'hook-15', text: 'What\'s the first thing you\'d ask before trusting a trading AI ?', angle: 'question' },
];
