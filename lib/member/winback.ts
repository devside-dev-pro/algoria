// RÉCUPÉRATION D'UN MEMBRE PARTI (win-back). Client-safe : aucune dépendance serveur, aucun secret.
//
// ── POURQUOI (25/08/2026, demande Mathieu) ─────────────────────────────────────────────────────────────
// Jusqu'ici, off-boarder quelqu'un c'était le perdre en silence : statut basculé, copieur débranché, et
// RIEN n'était dit à la personne. Elle découvrait son accès mort sans savoir pourquoi, et n'avait aucune
// porte de retour. Sur 15 off-boards, UN SEUL membre est revenu (#422, le 22/08) — et il est revenu parce
// qu'il a écrit lui-même, pas parce qu'on l'a rappelé. Il a rouvert un compte chez un AUTRE broker et
// redéposé $200 : la preuve que le retour est possible quand la porte existe.
//
// Le pari est explicite et il est de Mathieu : sur 10 personnes qui retirent, en récupérer 2 ou 3 est déjà
// un gain net. Ça suppose deux choses que le code doit garantir — que la personne SACHE pourquoi elle a
// perdu l'accès, et qu'elle ait un chemin de retour en un clic.
//
// ── LE TON, ET POURQUOI IL COMPTE ──────────────────────────────────────────────────────────────────────
// Le message part au moment le plus fragile de la relation. Il ne reproche RIEN — retirer son argent est
// un droit, pas une faute — il explique une mécanique (l'accès est adossé au capital resté en place) et il
// ouvre la porte. Un message qui culpabilise ferme la porte qu'il prétend ouvrir.

/** Statut d'un membre retiré de la circulation par nous. DISTINCT de 'paused'.
 *
 *  ⚠️ NE PAS RÉUTILISER 'paused', et ce n'est pas cosmétique : 'paused' est le statut d'un membre qui a
 *  choisi de mettre SA copie en pause, et c'est exactement le statut qui affiche « ▶ RESUME COPYING » dans
 *  son app (app/member/page.tsx). Un membre off-boardé en 'paused' voit donc un bouton qui le rebranche au
 *  copieur en un geste, sans redéposer quoi que ce soit. Un statut à part sort de tous les tests
 *  `['live','paused']` de l'app et de l'API — le verrou vient de là, pas d'une garde ajoutée à la main. */
export const OFFBOARDED = 'offboarded' as const;

export type OffboardReason = 'withdrawal' | 'inactive' | 'broker_detached' | 'other';

type Copy = { admin: string; en: string; it: string };

/** Motif → ce qu'on écrit au membre. Le motif conditionne le TEXTE, jamais l'effet technique : quelle que
 *  soit la raison, l'accès tombe et la porte de retour est la même. */
export const OFFBOARD_REASONS: Record<OffboardReason, Copy> = {
  withdrawal: {
    admin: 'capital retiré du compte',
    en:
      'Your Algoria access has been switched off because the capital was withdrawn from the trading account linked to it.\n\n' +
      'Nothing is lost on your side and nothing is held against you — your Algoria access is simply tied to a funded account, because that is what the AI trades on.\n\n' +
      'You can get your access back whenever you want: fund the same account again, or open one with another partner broker. Your member number, your history and your referral earnings are all still here, waiting.',
    it:
      'Il tuo accesso ad Algoria è stato disattivato perché il capitale è stato prelevato dal conto di trading collegato.\n\n' +
      'Non hai perso nulla e non ti viene rimproverato nulla — il tuo accesso ad Algoria è semplicemente legato a un conto finanziato, perché è su quello che opera l’IA.\n\n' +
      'Puoi riattivarlo quando vuoi: rifinanzia lo stesso conto, oppure aprine uno con un altro broker partner. Il tuo numero membro, il tuo storico e i tuoi guadagni da referral sono ancora qui.',
  },
  inactive: {
    admin: 'compte inactif / vide',
    en:
      'Your Algoria access has been switched off because the linked trading account is no longer funded and active.\n\n' +
      'No hard feelings and nothing to justify — access is tied to a funded account, because that is what the AI trades on.\n\n' +
      'You can turn it back on whenever you want: fund the same account again, or open one with another partner broker. Your member number, your history and your referral earnings are all still here.',
    it:
      'Il tuo accesso ad Algoria è stato disattivato perché il conto collegato non è più finanziato e attivo.\n\n' +
      'Nessun problema e nulla da giustificare — l’accesso è legato a un conto finanziato, perché è su quello che opera l’IA.\n\n' +
      'Puoi riattivarlo quando vuoi: rifinanzia lo stesso conto, oppure aprine uno con un altro broker partner. Il tuo numero membro, il tuo storico e i tuoi guadagni da referral sono ancora qui.',
  },
  broker_detached: {
    admin: 'compte non rattaché au broker partenaire',
    en:
      'Your Algoria access has been switched off because your trading account is not attached to Algoria on the broker side, so the AI cannot trade on it.\n\n' +
      'This one is fixable and it is not your fault — it usually happens when the account was opened outside our link.\n\n' +
      'The quickest route back is to open an account through the Algoria link with any of our partner brokers. Your member number, your history and your referral earnings are all still here.',
    it:
      'Il tuo accesso ad Algoria è stato disattivato perché il tuo conto non risulta collegato ad Algoria lato broker, quindi l’IA non può operare.\n\n' +
      'È risolvibile e non è colpa tua — succede quando il conto è stato aperto fuori dal nostro link.\n\n' +
      'La via più rapida è aprire un conto tramite il link Algoria con uno dei nostri broker partner. Il tuo numero membro, il tuo storico e i tuoi guadagni da referral sono ancora qui.',
  },
  other: {
    admin: 'autre motif',
    en:
      'Your Algoria access has been switched off because the trading account linked to it is no longer active.\n\n' +
      'You can get your access back whenever you want: fund an account again with any of our partner brokers. Your member number, your history and your referral earnings are all still here, waiting.',
    it:
      'Il tuo accesso ad Algoria è stato disattivato perché il conto di trading collegato non è più attivo.\n\n' +
      'Puoi riattivarlo quando vuoi: finanzia di nuovo un conto con uno dei nostri broker partner. Il tuo numero membro, il tuo storico e i tuoi guadagni da referral sono ancora qui.',
  },
};

export const isOffboardReason = (v: unknown): v is OffboardReason =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(OFFBOARD_REASONS, v);

/** Le message envoyé au membre. `name` en tête : ce message annonce une mauvaise nouvelle, il ne doit pas
 *  ressembler à un envoi de masse. Repli sur l'anglais pour toute langue non traduite — jamais de vide. */
export function winbackMessage(reason: OffboardReason, name: string | null, locale: string | null | undefined): string {
  const copy = OFFBOARD_REASONS[reason] ?? OFFBOARD_REASONS.other;
  const body = locale === 'it' ? copy.it : copy.en;
  const hi = locale === 'it' ? `Ciao${name ? ` ${name}` : ''},` : `Hi${name ? ` ${name}` : ''},`;
  return `${hi}\n\n${body}`;
}

// ── RELANCE DES DÉPOSANTS PARTIS (01/10/2026) ──────────────────────────────────────────────────────────
// Le message ci-dessus part AU MOMENT du départ. Ceux-ci partent APRÈS, depuis le panneau WIN-BACK de
// l'admin : Mathieu relit, ajuste, clique. Trois cas, tirés de l'historique réel des 10 premiers :
//   · returned     — off-boardé (capital retiré) puis revenu de lui-même dans l'app : le plus chaud ;
//   · disconnected — a coupé la copie lui-même, récemment (souvent un jour rouge) ;
//   · old          — parti à l'époque des 3 stratégies (avant septembre) : beaucoup a changé depuis.
// Style de Mathieu : pas de tiret long, une espace avant ? et !, 🙏🏼 à la fin. Résultats PASSÉS seulement.
export type WinbackGroup = 'returned' | 'disconnected' | 'old';

export function winbackFollowup(group: WinbackGroup, o: { name: string | null; broker: string | null; exitDate: string; exitMonth: string; redDayLine?: string | null; monthLine?: string | null; notPartner?: boolean }): string {
  const hi = `Hi${o.name ? ` ${o.name}` : ''},`;
  let text: string;
  if (group === 'returned') {
    text = `${hi} I saw you opened the Algoria app again 🙂 Welcome back ! If you want to restart the copy, it's simple: fund your ${o.broker ?? 'broker'} account again, then tap Connect in the app and I activate you myself. Any question before you restart ? I'm here 🙏🏼`;
  } else if (group === 'disconnected') {
    const facts = [o.redDayLine, o.monthLine].filter(Boolean).join(' ');
    text = `${hi} I saw you disconnected the copy on ${o.exitDate}.${facts ? ` ${facts}` : ''} Your account is still yours, nothing changed on your side. If you want to reconnect, it's one tap in the app. Can I help with anything ? 🙏🏼`;
  } else {
    text = `${hi} it's Mathieu from Algoria. A lot has changed since ${o.exitMonth}: one single strategy now (no more choosing between 3), Algoria AI in the app, and every trade public on the track record. If you'd like to give it another go, reconnect from the app and I'll activate you myself. And if something went wrong for you, tell me, I want to know 🙏🏼`;
  }
  if (o.notPartner) text += `\n\nOne thing: your account must be opened through the Algoria link so the broker attaches it to us. I can send you the link.`;
  return text;
}
