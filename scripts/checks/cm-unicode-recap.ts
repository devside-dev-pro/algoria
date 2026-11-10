// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/cm-unicode-recap.ts
//
// 1) Le bonjour manquant des 8, 9 et 10/11/2026 : une coupe à 300 caractères au milieu de 🙏🏼 envoyait une moitié
//    d'emoji à Anthropic (400 « unexpected end of hex escape »). 2) Le lien « 👉 app.getalgoria.com » en double dans les
//    récaps depuis le 28/10. Aucun appel réseau, aucune base.
import { safeSlice, stripAppLines, wellFormed } from '../../lib/channel/text';
import { withAppLine } from '../../lib/channel/recap';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}
const lone = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

// ── le post 185 du 07/11 : 301 unités UTF-16, « Come say hi 🙏🏼 » à la fin ─────────────────────────────
{
  const post185 = `${'x'.repeat(301 - 'Come say hi 🙏🏼'.length)}Come say hi 🙏🏼`;
  check('le post de test fait 301 unités, comme le 185', post185.length === 301);
  check('slice(0, 300) laisse bien une moitié orpheline (le bug)', lone(post185.slice(0, 300)));
  check('JSON.stringify de l\'ancienne coupe contient \\ud83c', JSON.stringify(post185.slice(0, 300)).includes('\\ud83c'));
  const cut = safeSlice(post185, 300);
  check('safeSlice(300) : aucune moitié orpheline', !lone(cut));
  check('safeSlice(300) : 299 unités, 🙏 entier gardé', cut.length === 299 && cut.endsWith('🙏'));
  check('safeSlice : texte court inchangé', safeSlice('hello 👋', 300) === 'hello 👋');
  check('safeSlice : coupe sur une limite propre inchangée', safeSlice('ab👋cd', 4) === 'ab👋');
  check('safeSlice : coupe juste avant la moitié basse', safeSlice('ab👋cd', 3) === 'ab');
  for (let n = 0; n <= 20; n++) check(`safeSlice(${n}) sur une suite d'emojis à teint`, !lone(safeSlice('🙏🏼👋🏽🙌🏻💙🔵'.repeat(2), n)));
}
// ── wellFormed : filet avant l'envoi au modèle ───────────────────────────────────────────────────────
{
  check('wellFormed retire une moitié haute', wellFormed('hi \ud83c') === 'hi ');
  check('wellFormed retire une moitié basse', wellFormed('\udffc hi') === ' hi');
  check('wellFormed garde les emojis entiers', wellFormed('🙏🏼 ok 💙') === '🙏🏼 ok 💙');
  check('JSON propre après wellFormed', !/\\ud[89ab]/i.test(JSON.stringify(wellFormed('x\ud83c y \udffc z'))));
}
// ── le récap : une seule ligne 👉 app ───────────────────────────────────────────────────────────────
{
  const RISK = "Trading involves risk. Past results don't guarantee future results.";
  const count = (t: string) => (t.match(/app\.getalgoria\.com/g) ?? []).length;
  // le texte réel du 28/10 : le modèle écrit la ligne, rewriteRecap en ajoutait une seconde
  const model = 'Good evening everyone 💙\n\n✅ +$4.10 at 0.01 lot · +$41 at 0.10 lot\n\nAnd a big welcome to Member #2813 🚀\n\n👉 app.getalgoria.com';
  const out = withAppLine(model, RISK);
  check('récap 28/10 : un seul lien', count(out) === 1, out);
  check('récap : le lien juste avant la phrase de risque', out.endsWith(`👉 app.getalgoria.com\n\n${RISK}`));
  check('récap sans ligne du modèle : un lien quand même', count(withAppLine('Quiet day 🧘', null)) === 1);
  check('récap rouge (sans risque) : finit par le lien', withAppLine('x', null).endsWith('👉 app.getalgoria.com'));
  check('ancien domaine retiré aussi', !stripAppLines('a\n\n👉 app.algoria.tech').includes('algoria.tech'));
  check('variante « Not copying yet ? » retirée', count(withAppLine('a\n\n👉 Not copying yet ? app.getalgoria.com', RISK)) === 1);
  check('deux lignes du modèle → une', count(withAppLine('a\n\n👉 app.getalgoria.com\n\n👉 app.getalgoria.com', RISK)) === 1);
  check('pas de triple saut de ligne', !/\n{3,}/.test(withAppLine('a\n\n👉 app.getalgoria.com\n\nb', RISK)));
  check('une phrase qui cite l\'app sans 👉 reste', stripAppLines('Open the app.getalgoria.com page').includes('Open the app'));
}

if (failed) { console.error(`\n${failed} échec(s)`); process.exit(1); }
console.log('\nTout est bon.');
