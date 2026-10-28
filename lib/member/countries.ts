// LE PAYS DANS UN MESSAGE (16/10/2026, accueil du support : « Where are you from ? »). Server-only, sans dépendance.
// Reconnaît un drapeau (n'importe lequel : 🇬🇧 → GB) ou le nom, l'adjectif, une grande ville des pays qui nous écrivent
// vraiment (contacts depuis le 29/09 : UK, Afrique du Sud, Nouvelle-Zélande, Italie, Pays-Bas, Irlande, Belgique…).
// Prudence voulue : « SA », « NL », « US » seuls ne comptent pas (trop ambigus dans une phrase), ni les noms de langue
// (« I use English ») ; dans le doute, null. Frontières de LETTRES et pas \b : « 1uk, 2.yes » compte.
//
// LES FAUTES DE FRAPPE (28/10/2026). Ranz écrit « Hi mathew im from new zelandd » : aucune expression ne matche, pas de
// vocal NZ alors qu'il existe dans support_assets. Les expressions restent la règle (l'exact gagne toujours) ; en
// repli, `fuzzyCountry` accepte une faute bornée sur les noms de pays (et quelques grandes villes longues), seulement
// si un seul pays est possible. « nz » seul compte désormais (sans ambiguïté en réponse à « Where are you from ? ») ;
// « SA », « NL », « US » seuls toujours pas. Contrôle : npx tsx scripts/checks/country-typos.ts

const NAMES: Array<[string, RegExp]> = [
  ['GB', /(?<!\p{L})(uk|u\.k\.?|united kingdom|england|scotland|wales|britain|great britain|british|scottish|welsh|london|manchester|birmingham|glasgow)(?!\p{L})/iu],
  ['ZA', /(?<!\p{L})(south africa|south african|rsa|johannesburg|joburg|cape town|durban|pretoria)(?!\p{L})/iu],
  ['NZ', /(?<!\p{L})(new zealand|nz|kiwi|auckland|wellington|christchurch)(?!\p{L})/iu],
  ['AU', /(?<!\p{L})(australia|australian|aussie|sydney|melbourne|brisbane|perth|adelaide)(?!\p{L})/iu],
  ['IT', /(?<!\p{L})(italy|italia|italian|italiano|italiana|roma|rome|milano|milan|napoli|torino)(?!\p{L})/iu],
  ['NL', /(?<!\p{L})(netherlands|nederlands?|the netherlands|holland|dutch|amsterdam|rotterdam)(?!\p{L})/iu],
  ['BE', /(?<!\p{L})(belgium|belgique|belgi[eë]|belgian|brussels|bruxelles|antwerp)(?!\p{L})/iu],
  ['IE', /(?<!\p{L})(ireland|irish|dublin|cork)(?!\p{L})/iu],
  ['DE', /(?<!\p{L})(germany|deutschland|berlin|munich|m[uü]nchen|hamburg|frankfurt)(?!\p{L})/iu],
  ['AE', /(?<!\p{L})(uae|u\.a\.e\.?|emirates|dubai|abu dhabi|sharjah)(?!\p{L})/iu],
  ['NG', /(?<!\p{L})(nigeria|nigerian|lagos|abuja)(?!\p{L})/iu],
  ['IL', /(?<!\p{L})(israel|israeli|tel aviv)(?!\p{L})/iu],
  ['CH', /(?<!\p{L})(switzerland|swiss|suisse|schweiz|zurich|z[uü]rich|geneva|gen[eè]ve)(?!\p{L})/iu],
  ['MT', /(?<!\p{L})(malta|maltese)(?!\p{L})/iu],
  ['FR', /(?<!\p{L})(france|paris)(?!\p{L})/iu],
  ['ES', /(?<!\p{L})(spain|espa[nñ]a|madrid|barcelona)(?!\p{L})/iu],
  ['PT', /(?<!\p{L})(portugal|lisbon|lisboa|porto)(?!\p{L})/iu],
  ['AT', /(?<!\p{L})(austria|austrian|[oö]sterreich|vienna|wien)(?!\p{L})/iu],
  ['US', /(?<!\p{L})(usa|u\.s\.a\.?|united states|america|american)(?!\p{L})/iu],
  ['CA', /(?<!\p{L})(canada|canadian|toronto|vancouver|montreal)(?!\p{L})/iu],
  ['IN', /(?<!\p{L})(india|indian|mumbai|delhi|bangalore)(?!\p{L})/iu],
  ['MY', /(?<!\p{L})(malaysia|malaysian|kuala lumpur)(?!\p{L})/iu],
  ['KE', /(?<!\p{L})(kenya|kenyan|nairobi)(?!\p{L})/iu],
  ['GH', /(?<!\p{L})(ghana|ghanaian|accra)(?!\p{L})/iu],
  ['ZW', /(?<!\p{L})(zimbabwe|zimbabwean|harare)(?!\p{L})/iu],
  ['BW', /(?<!\p{L})(botswana|gaborone)(?!\p{L})/iu],
  ['NA', /(?<!\p{L})(namibia|windhoek)(?!\p{L})/iu],
  ['PL', /(?<!\p{L})(poland|polska|warsaw)(?!\p{L})/iu],
  ['SE', /(?<!\p{L})(sweden|stockholm)(?!\p{L})/iu],
  ['DK', /(?<!\p{L})(denmark|copenhagen)(?!\p{L})/iu],
  ['NO', /(?<!\p{L})(norway|oslo)(?!\p{L})/iu],
  ['CY', /(?<!\p{L})(cyprus|cypriot|limassol|nicosia)(?!\p{L})/iu],
  ['GR', /(?<!\p{L})(greece|athens)(?!\p{L})/iu],
  ['SG', /(?<!\p{L})(singapore)(?!\p{L})/iu],
  ['PH', /(?<!\p{L})(philippines|filipino|manila)(?!\p{L})/iu],
];

// ── LES FAUTES DE FRAPPE (28/10/2026) ────────────────────────────────────────────────────────────────────────────────
// Repli, seulement si aucune expression régulière ci-dessus n'a rien trouvé. On découpe le texte en mots de lettres.
// Un mot seul est comparé au nom collé (« englnd », « newzealand », « southafrica ») ; 2 ou 3 mots ne sont comparés
// qu'à un nom d'autant de mots, mot à mot (« new zelandd », « souht africa ») : sinon « hold and » ferait Holland et
// « no way » Norway. Seulement les noms de PAYS (pas les adjectifs ni les langues : « german » ne compte pas) et
// quelques grandes villes longues sans voisin anglais, avec une distance de Damerau-Levenshtein bornée par la longueur
// du nom : 0 sous 6 lettres (spain/spin, india/indie, malta/malt, wales/sales, paris/parts, perth/earth : trop près de
// l'anglais, donc exact seulement), 1 de 6 à 8 lettres (portugal/portal reste dehors), 2 à partir de 9.
// Les lettres doublées sont aussi écrasées des deux côtés (zelandd → zeland). La première lettre doit être la bonne
// (une faute en tête est rare, et ça coupe la plupart des faux positifs). On n'accepte que si UN SEUL pays est à la
// meilleure distance ; une fenêtre qui est exactement un autre pays du monde (Iceland ≠ Ireland, Algeria ≠ Nigeria)
// ou un mot anglais voisin connu (STOP) ne compte pas. Les villes courtes et l'Autriche restent exactes : Austria et
// Australia sont à une faute l'une de l'autre (« austrlia »), et c'est l'Australie qui nous écrit.
const FUZZY: Array<[string, string[]]> = [
  ['GB', ['england', 'scotland', 'united kingdom', 'britain', 'manchester', 'birmingham']],
  ['ZA', ['south africa', 'johannesburg']],
  ['NZ', ['new zealand', 'christchurch', 'wellington']],
  ['AU', ['australia', 'melbourne', 'brisbane', 'adelaide']],
  ['NL', ['netherlands', 'holland', 'amsterdam', 'rotterdam']],
  ['BE', ['belgium']],
  ['IE', ['ireland']],
  ['DE', ['germany', 'deutschland']],
  ['AE', ['emirates']],
  ['NG', ['nigeria']],
  ['IL', ['israel']],
  ['CH', ['switzerland']],
  ['FR', ['france']],
  ['PT', ['portugal']],
  ['US', ['united states', 'america']],
  ['CA', ['canada']],
  ['MY', ['malaysia']],
  ['ZW', ['zimbabwe']],
  ['BW', ['botswana']],
  ['NA', ['namibia']],
  ['PL', ['poland']],
  ['SE', ['sweden']],
  ['DK', ['denmark']],
  ['CY', ['cyprus']],
  ['GR', ['greece']],
  ['SG', ['singapore']],
  ['PH', ['philippines']],
];

// Les autres pays du monde, en exact seulement : ils bloquent une fenêtre qui serait à une faute d'un des nôtres.
const ELSEWHERE = new Set([
  'iceland', 'finland', 'algeria', 'niger', 'iran', 'iraq', 'oman', 'yemen', 'syria', 'libya', 'egypt', 'sudan',
  'chad', 'mali', 'peru', 'chile', 'cuba', 'haiti', 'japan', 'china', 'korea', 'nepal', 'laos', 'togo', 'benin',
  'gabon', 'congo', 'angola', 'zambia', 'malawi', 'uganda', 'rwanda', 'burundi', 'somalia', 'ethiopia', 'eritrea',
  'tanzania', 'mozambique', 'madagascar', 'mauritius', 'senegal', 'gambia', 'guinea', 'liberia', 'cameroon',
  'morocco', 'tunisia', 'jordan', 'lebanon', 'kuwait', 'qatar', 'bahrain', 'saudi arabia', 'turkey', 'russia',
  'ukraine', 'belarus', 'romania', 'bulgaria', 'serbia', 'croatia', 'slovenia', 'slovakia', 'hungary', 'czechia',
  'albania', 'kosovo', 'estonia', 'latvia', 'lithuania', 'georgia', 'armenia', 'monaco', 'andorra', 'luxembourg',
  'liechtenstein', 'pakistan', 'afghanistan', 'bangladesh', 'sri lanka', 'indonesia', 'thailand', 'vietnam',
  'cambodia', 'myanmar', 'mongolia', 'taiwan', 'brazil', 'argentina', 'uruguay', 'paraguay', 'bolivia', 'colombia',
  'venezuela', 'ecuador', 'mexico', 'panama', 'jamaica', 'bahamas', 'barbados', 'trinidad', 'nicaragua',
  'honduras', 'guatemala', 'el salvador', 'costa rica', 'new caledonia', 'papua new guinea', 'fiji', 'samoa',
  'tonga', 'greenland', 'scandinavia', 'europe', 'africa', 'asia', 'west africa', 'east africa', 'north africa',
  'south america', 'latin america', 'north america', 'central america', 'south korea', 'north korea',
  'new england', 'new jersey', 'new mexico', 'new york', 'new south wales', 'south sudan', 'austria', 'australasia',
]);

// Mots anglais (ou de nos clients) à une faute d'un nom ci-dessus et qui ne sont PAS un pays (audit du 28/10 sur un
// dictionnaire anglais, mots seuls et paires de mots courants).
const STOP = new Set([
  'german', 'germane', 'cypress', 'fiance', 'fiancee', 'franca', 'franco', 'frances', 'francs', 'sweeten', 'swidden',
  'sweven', 'philippians', 'philippics', 'philistines', 'emigrates', 'emigate', 'emigates', 'manifester',
]);

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const squeeze = (s: string) => s.replace(/(\p{L})\1+/gu, '$1');
const limitFor = (len: number) => (len < 6 ? 0 : len < 9 ? 1 : 2);

/** Damerau-Levenshtein (variante « transpositions adjacentes »), arrêt dès que `max` est dépassé. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const TARGETS = FUZZY.flatMap(([code, names]) => names.map((n) => {
  const parts = n.split(' ');
  const flat = parts.join('');
  return { code, parts, flat, sq: squeeze(flat), max: limitFor(flat.length) };
}));
const ELSEWHERE_FLAT = new Set([...ELSEWHERE].map((n) => n.replace(/ /g, '')));

/** Distance mot à mot d'une fenêtre de plusieurs mots contre un nom d'autant de mots (« souht africa »). Chaque mot a
 *  sa propre borne (0 sous 4 lettres, 1 jusqu'à 8, 2 au-delà) : « now zealand », « sound africa », « united sales »
 *  ne passent pas. */
function wordwise(win: string[], parts: string[]): number {
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const max = parts[i].length < 4 ? 0 : parts[i].length < 9 ? 1 : 2;
    const d = Math.min(editDistance(win[i], parts[i], max), editDistance(squeeze(win[i]), squeeze(parts[i]), max));
    if (d > max) return Infinity;
    total += d;
  }
  return total;
}

/** Le pays malgré une faute de frappe (« new zelandd » → 'NZ'), seulement s'il n'y en a qu'un possible. Sinon null. */
export function fuzzyCountry(text: string): string | null {
  const words = fold(text).match(/\p{L}+/gu) ?? [];
  let best = Infinity;
  const codes = new Set<string>();
  const offer = (code: string, d: number) => {
    if (d > best) return;
    if (d < best) { best = d; codes.clear(); }
    codes.add(code);
  };
  for (let i = 0; i < words.length; i++) {
    const one = words[i];
    // un seul mot, contre le nom collé (« englnd », « newzealand », « southafrica »)
    if (one.length >= 6 && !STOP.has(one) && !ELSEWHERE_FLAT.has(one)) {
      const sq = squeeze(one);
      for (const t of TARGETS) {
        if (t.max === 0 || one[0] !== t.flat[0]) continue;
        const d = Math.min(editDistance(one, t.flat, t.max), editDistance(sq, t.sq, t.max));
        if (d <= t.max) offer(t.code, d);
      }
    }
    // deux ou trois mots, seulement contre un nom d'autant de mots (« new zelandd », « south afrika »)
    for (let k = 2; k <= 3 && i + k <= words.length; k++) {
      const win = words.slice(i, i + k);
      const flat = win.join('');
      if (ELSEWHERE_FLAT.has(flat)) continue;
      for (const t of TARGETS) {
        if (t.parts.length !== k || win[0][0] !== t.flat[0]) continue;
        const d = wordwise(win, t.parts);
        if (d <= t.max) offer(t.code, d);
      }
    }
  }
  return codes.size === 1 ? [...codes][0] : null;
}

/** Le premier drapeau du texte (🇬🇧 → 'GB'), sinon le premier pays nommé. null si rien de sûr. */
export function detectCountry(text: string): string | null {
  const flag = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/u.exec(text);
  if (flag) return String.fromCharCode(flag[1].codePointAt(0)! - 0x1f1e6 + 65, flag[2].codePointAt(0)! - 0x1f1e6 + 65);
  let best: { code: string; at: number } | null = null;
  for (const [code, re] of NAMES) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { code, at: m.index };
  }
  return best?.code ?? fuzzyCountry(text);
}
