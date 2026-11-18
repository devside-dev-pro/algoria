// MONTANT SIGNÉ DU CANAL. Une seule fonction : le VIP (vipFill), le rédacteur (writer) et le récap
// en avaient chacun une copie, et cm.ts une quatrième, jamais appelée.
//
// +$14.80 sous 100 $, +$148 au-delà (les centimes n'aident plus à lire). Le signe moins est U+2212
// MINUS SIGN, pas le trait d'union.
//
// Telegram coupe selon UAX #14. « + », « − » et « $ » sont tous des préfixes numériques (classe PR),
// et aucune règle n'interdit la coupure entre deux PR. Le 18/11/2026, le post 266 stockait « +$74.40 »
// collé et l'affichait quand même « + » en fin de ligne, puis « $74.40 ». U+2060 WORD JOINER a une
// chasse nulle et interdit la coupure de chaque côté (LB11) : le signe et le dollar restent ensemble,
// sans espace visible.
//
// On met le caractère lui-même, pas l'entité &#8288;. Le récap échappe « & » avant l'envoi (recap.ts) :
// l'entité s'afficherait en toutes lettres. En parse_mode HTML (publish.ts), seuls « < », « > » et « & »
// sont spéciaux : U+2060 traverse le parseur comme le reste du texte.

const WJ = '\u2060';
const MINUS = '\u2212';
/** « +$ » / « −$ » / « -$ » en tête, avec ou sans word joiner (montants déjà formatés sans). */
const SIGNED_PREFIX = new RegExp(`^[+${MINUS}-]?${WJ}?\\$`);

/** Signe et $ insécables. +$14.80 sous 100 $, +$148 au-delà. */
export const usd = (v: number): string => {
  const n = Math.abs(v);
  const digits = n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2);
  return `${v >= 0 ? '+' : MINUS}${WJ}$${digits}`;
};

/** Le nombre seul (« 74.40 », « 148 ») pour un placeholder [X] écrit sans signe dans le modèle. */
export const stripUsdSign = (formatted: string): string => formatted.replace(SIGNED_PREFIX, '');
