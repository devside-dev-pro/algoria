// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/country-typos.ts
//
// Le pays malgré les fautes de frappe (28/10/2026, Ranz : « Hi mathew im from new zelandd » → aucun vocal NZ). Aucun
// appel réseau, aucune base : c'est le vrai `detectCountry` de lib/member/countries.ts.
import { detectCountry, fuzzyCountry } from '../../lib/member/countries';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`ok  ${name}`);
    return;
  }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}
function expect(text: string, want: string | null): void {
  const got = detectCountry(text);
  check(`« ${text} » → ${want ?? 'null'}`, got === want, `obtenu ${got ?? 'null'}`);
}

// ── le cas réel ──────────────────────────────────────────────────────────────
expect('Hi mathew im from new zelandd', 'NZ');

// ── fautes de frappe reconnues ───────────────────────────────────────────────
for (const [t, cc] of [
  ['new zelandd', 'NZ'], ['new zeland', 'NZ'], ['newzealand', 'NZ'], ['new zealnd', 'NZ'], ['New Zeeland', 'NZ'],
  ['nz', 'NZ'], ['NZ', 'NZ'], ['from NZ!', 'NZ'], ['im in nz bro', 'NZ'],
  ['austrlia', 'AU'], ['australie', 'AU'], ['Austrailia', 'AU'],
  ['south afrika', 'ZA'], ['southafrica', 'ZA'], ['souht africa', 'ZA'], ['im from south afica', 'ZA'],
  ['englnd', 'GB'], ['untied kingdom', 'GB'], ['unitedkingdom', 'GB'], ['scotlnd', 'GB'], ['britian', 'GB'],
  ['irland', 'IE'], ['germnay', 'DE'], ['the netherland', 'NL'], ['holand', 'NL'], ['belguim', 'BE'],
  ['isreal', 'IL'], ['nigeriaa', 'NG'], ['switzerlnd', 'CH'], ['portugall', 'PT'], ['phillipines', 'PH'],
  ['johanesburg', 'ZA'], ['manchster', 'GB'], ['I live in Melborne', 'AU'],
] as const) expect(t, cc);

// ── l'exact gagne toujours ───────────────────────────────────────────────────
expect('germnay but now london', 'GB');
expect('austria', 'AT');
expect('austrlia or austria', 'AT');
expect('spain', 'ES');
expect('india', 'IN');
expect('indian', 'IN');
expect('italian', 'IT');
expect('kiwi', 'NZ');
expect('perth', 'AU');
expect('cork', 'IE');
expect('🇳🇿', 'NZ');
expect('1uk', 'GB');
expect('Wales', 'GB');
expect('Rome', 'IT');
expect('oslo', 'NO');
expect('Paris', 'FR');
expect('dubai', 'AE');

// ── rien : phrases ordinaires et voisins anglais ──────────────────────────────
for (const t of [
  'I use English', 'im fine thanks', 'how do I connect my broker app', 'yes', 'hello', "I'm from here", 'ok',
  'SA', 'NL', 'US', 'i speak german', 'sales', 'home', 'parts', 'earth', 'spin', 'span', 'stain', 'indie', 'malt',
  'no way', 'is real', 'hold and', 'pool land', 'case town', 'united sales', 'sound africa', 'now zealand',
  'wedding to', 'de mark', 'get many', 'can add', 'great brain', 'my fiance', 'cypress', 'sweeten',
  'what is the minimum deposit', 'can you send me the link please', 'thank you so much brother',
  'I am interested in the gold trading', 'how much do I need to start', 'is this legit', 'where are you from',
  'i went to the island last summer', 'my portal password', 'scotch and soda',
  'iceland', 'algeria',
]) expect(t, null);

// ── ambiguïté : deux pays à la même distance → null ──────────────────────────
check('englnd + germnay → null', fuzzyCountry('englnd or germnay') === null);

if (failed) {
  console.error(`\n${failed} contrôle(s) en échec`);
  process.exit(1);
}
console.log('\ntous les contrôles passent');
