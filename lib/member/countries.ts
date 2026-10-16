// LE PAYS DANS UN MESSAGE (16/10/2026, accueil du support : « Where are you from ? »). Server-only, sans dépendance.
// Reconnaît un drapeau (n'importe lequel : 🇬🇧 → GB) ou le nom, l'adjectif, une grande ville des pays qui nous écrivent
// vraiment (contacts depuis le 29/09 : UK, Afrique du Sud, Nouvelle-Zélande, Italie, Pays-Bas, Irlande, Belgique…).
// Prudence voulue : « SA », « NL », « US » seuls ne comptent pas (trop ambigus dans une phrase), ni les noms de langue
// (« I use English ») ; dans le doute, null. Frontières de LETTRES et pas \b : « 1uk, 2.yes » compte.

const NAMES: Array<[string, RegExp]> = [
  ['GB', /(?<!\p{L})(uk|u\.k\.?|united kingdom|england|scotland|wales|britain|great britain|british|scottish|welsh|london|manchester|birmingham|glasgow)(?!\p{L})/iu],
  ['ZA', /(?<!\p{L})(south africa|south african|rsa|johannesburg|joburg|cape town|durban|pretoria)(?!\p{L})/iu],
  ['NZ', /(?<!\p{L})(new zealand|kiwi|auckland|wellington|christchurch)(?!\p{L})/iu],
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

/** Le premier drapeau du texte (🇬🇧 → 'GB'), sinon le premier pays nommé. null si rien de sûr. */
export function detectCountry(text: string): string | null {
  const flag = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/u.exec(text);
  if (flag) return String.fromCharCode(flag[1].codePointAt(0)! - 0x1f1e6 + 65, flag[2].codePointAt(0)! - 0x1f1e6 + 65);
  let best: { code: string; at: number } | null = null;
  for (const [code, re] of NAMES) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { code, at: m.index };
  }
  return best?.code ?? null;
}
