// ✂️ COUPER UN TEXTE SANS CASSER UN EMOJI (10/11/2026).
//
// Les 8, 9 et 10/11, aucun bonjour n'est parti et tous les autres posts sont partis en texte de banque : les 4
// appels du rédacteur ont reçu un 400 d'Anthropic (« The request body is not valid JSON: unexpected end of hex
// escape »). Cause : le bonjour publié le 07/11 finissait par « Come say hi 🙏🏼 » au 300e caractère, et
// dayContext coupait chaque post récent avec `.slice(0, 300)`. 🙏🏼 = 🙏 + 🏼 (modificateur de teint), chacun sur deux
// unités UTF-16 : la coupe laissait la moitié haute de 🏼 (\ud83c) seule. JSON.stringify l'écrit « \ud83c » et l'API
// refuse le corps entier. Tant que ce post restait dans les 12 derniers publiés, plus aucun texte IA, et le bonjour
// (qui n'a pas de version de secours) sautait.
//
// `safeSlice` coupe au même endroit sans jamais séparer une paire ; `wellFormed` retire une moitié orpheline qui
// viendrait d'ailleurs (base, messages reçus) avant tout envoi au modèle.

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;

/** `s.slice(0, n)` sans couper une paire de substitution (un emoji n'est jamais coupé en deux). */
export function safeSlice(s: string, n: number): string {
  if (s.length <= n) return s;
  let end = Math.max(0, n);
  if (end > 0 && isHigh(s.charCodeAt(end - 1))) end--;
  return s.slice(0, end);
}

/** Retire les moitiés de paire orphelines (sinon le corps JSON envoyé à l'API est refusé). */
export const wellFormed = (s: string): string =>
  s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

// 🔗 LE LIEN EN DOUBLE DES RÉCAPS (28/10 → 09/11/2026) : « 👉 app.getalgoria.com » apparaissait deux fois. Le commit
// 603e6c9 (#531, 22/10, passage d'algoria.tech à getalgoria.com) a changé la consigne (« Last line exactly:
// 👉 app.getalgoria.com ») et la constante APP de recap.ts, mais pas l'expression qui retirait la ligne du modèle
// avant que le code remette la sienne : elle cherchait encore « app.algoria.tech ». Avant le 22/10, le « .tech »
// était en plus refusé par le garde-fou des liens ; après, la ligne du modèle passait, et rewriteRecap ajoutait APP
// derrière. Visible à partir du 28/10, premier récap réécrit après la coupure du master (aucun récap du 22 au 27/10).
// Désormais : toute ligne « 👉 … app.<domaine> », quel que soit le domaine, est retirée, où qu'elle soit.
const APP_LINE = /^\s*👉[^\n]*\bapp\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\n]*$/gimu;
/** Retire les lignes « 👉 app.… » du texte (le code remet la sienne, une seule fois). */
export const stripAppLines = (t: string): string => t.replace(APP_LINE, '').replace(/\n{3,}/g, '\n\n').trim();

