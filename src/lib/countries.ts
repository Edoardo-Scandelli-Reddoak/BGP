/**
 * Paesi: nome canonico in italiano e riconoscimento delle varianti (sigle ISO 3166 a 2 e 3 lettere,
 * nomi in italiano, inglese, francese, tedesco, spagnolo e nella lingua locale, forme comuni come
 * «UK», «USA», «EAU», «RSM»). Il confronto ignora maiuscole, accenti, punteggiatura e spazi.
 * Interpreta solo valori che sono già un paese (colonna Paese dell'import, campi Paese dei moduli):
 * qui «CH» è la Svizzera e «SM» San Marino, non le sigle di provincia di un indirizzo.
 * Modulo puro: usato da import, anagrafiche, richieste, modulo pubblico e regole della bolla.
 */

export type Country = {
  /** Nome canonico in italiano: è il valore salvato. */
  name: string;
  iso2: string;
  iso3: string;
  aliases: readonly string[];
};

type CountryRow = readonly [name: string, iso2: string, iso3: string, aliases: readonly string[]];

const ROWS: readonly CountryRow[] = [
  // Italia e microstati
  ["Italia", "IT", "ITA", ["Italy", "Italie", "Italien", "Repubblica Italiana", "Italian Republic"]],
  ["San Marino", "SM", "SMR", ["Repubblica di San Marino", "RSM", "Rep. San Marino", "Saint-Marin", "Republic of San Marino"]],
  [
    "Città del Vaticano",
    "VA",
    "VAT",
    ["Vaticano", "Stato della Città del Vaticano", "Santa Sede", "Vatican", "Vatican City", "Holy See", "Cité du Vatican", "Vatikanstadt", "Vatikan", "Ciudad del Vaticano"],
  ],
  [
    "Principato di Monaco",
    "MC",
    "MCO",
    ["Monaco", "Principauté de Monaco", "Principality of Monaco", "Fürstentum Monaco", "Principado de Mónaco", "Mónaco", "Monte Carlo", "Montecarlo", "Monte-Carlo"],
  ],
  ["Andorra", "AD", "AND", ["Principato di Andorra", "Andorre", "Principat d'Andorra"]],
  ["Liechtenstein", "LI", "LIE", ["Principato del Liechtenstein", "Fürstentum Liechtenstein"]],
  // Unione europea
  ["Austria", "AT", "AUT", ["Österreich", "Oesterreich", "Autriche"]],
  ["Belgio", "BE", "BEL", ["Belgium", "Belgique", "België", "Belgie", "Belgien", "Bélgica"]],
  ["Bulgaria", "BG", "BGR", ["България", "Bulgarie", "Bulgarien"]],
  ["Cipro", "CY", "CYP", ["Cyprus", "Chypre", "Zypern", "Chipre", "Κύπρος", "Kypros"]],
  ["Croazia", "HR", "HRV", ["Croatia", "Hrvatska", "Republika Hrvatska", "Croatie", "Kroatien", "Croacia"]],
  ["Danimarca", "DK", "DNK", ["Denmark", "Danmark", "Danemark", "Dänemark", "Dinamarca"]],
  ["Estonia", "EE", "EST", ["Eesti", "Estonie", "Estland"]],
  ["Finlandia", "FI", "FIN", ["Finland", "Suomi", "Finlande", "Finnland"]],
  ["Francia", "FR", "FRA", ["France", "Frankreich", "République française", "Repubblica Francese"]],
  [
    "Germania",
    "DE",
    "DEU",
    ["Germany", "Deutschland", "Allemagne", "Alemania", "Bundesrepublik Deutschland", "Repubblica Federale di Germania", "BRD"],
  ],
  ["Grecia", "GR", "GRC", ["Greece", "Grèce", "Griechenland", "Ελλάδα", "Ελλάς", "Hellas", "Ellada"]],
  ["Irlanda", "IE", "IRL", ["Ireland", "Republic of Ireland", "Éire", "Irlande", "Irland"]],
  ["Lettonia", "LV", "LVA", ["Latvia", "Latvija", "Lettonie", "Lettland", "Letonia"]],
  ["Lituania", "LT", "LTU", ["Lithuania", "Lietuva", "Lituanie", "Litauen"]],
  ["Lussemburgo", "LU", "LUX", ["Luxembourg", "Luxemburg", "Lëtzebuerg", "Luxemburgo", "Granducato di Lussemburgo"]],
  ["Malta", "MT", "MLT", ["Malte"]],
  [
    "Paesi Bassi",
    "NL",
    "NLD",
    ["Olanda", "Netherlands", "The Netherlands", "Holland", "Nederland", "Pays-Bas", "Niederlande", "Holanda", "Países Bajos"],
  ],
  ["Polonia", "PL", "POL", ["Poland", "Polska", "Pologne", "Polen"]],
  ["Portogallo", "PT", "PRT", ["Portugal"]],
  [
    "Repubblica Ceca",
    "CZ",
    "CZE",
    ["Cechia", "Czech Republic", "Czechia", "Česko", "Česká republika", "République tchèque", "Tchéquie", "Tschechien", "Tschechische Republik", "República Checa", "Chequia"],
  ],
  ["Romania", "RO", "ROU", ["România", "Roumanie", "Rumänien", "Rumania", "Rumenia"]],
  ["Slovacchia", "SK", "SVK", ["Slovakia", "Slovensko", "Slovaquie", "Slowakei", "Eslovaquia"]],
  // «SLO»: sigla automobilistica, frequente negli indirizzi («SLO-6000 Koper»)
  ["Slovenia", "SI", "SVN", ["Slovenija", "Slovénie", "Slowenien", "Eslovenia", "SLO"]],
  ["Spagna", "ES", "ESP", ["Spain", "España", "Espagne", "Spanien", "Espanya"]],
  ["Svezia", "SE", "SWE", ["Sweden", "Sverige", "Suède", "Schweden", "Suecia"]],
  ["Ungheria", "HU", "HUN", ["Hungary", "Magyarország", "Hongrie", "Ungarn", "Hungría"]],
  // EFTA e Regno Unito
  ["Islanda", "IS", "ISL", ["Iceland", "Ísland", "Islande", "Island", "Islandia"]],
  ["Norvegia", "NO", "NOR", ["Norway", "Norge", "Noreg", "Norvège", "Norwegen", "Noruega"]],
  [
    "Svizzera",
    "CH",
    "CHE",
    ["Switzerland", "Schweiz", "Suisse", "Svizra", "Suiza", "Confederazione Svizzera", "Confoederatio Helvetica", "Helvetia"],
  ],
  [
    "Regno Unito",
    "GB",
    "GBR",
    [
      "UK",
      "United Kingdom",
      "Gran Bretagna",
      "Great Britain",
      "Inghilterra",
      "England",
      "Scozia",
      "Scotland",
      "Galles",
      "Wales",
      "Irlanda del Nord",
      "Northern Ireland",
      "Royaume-Uni",
      "Grande-Bretagne",
      "Angleterre",
      "Vereinigtes Königreich",
      "Großbritannien",
      "Reino Unido",
      "Gran Bretaña",
    ],
  ],
  // Balcani ed Europa orientale
  ["Albania", "AL", "ALB", ["Shqipëria", "Shqipëri", "Albanie", "Albanien"]],
  [
    "Bosnia ed Erzegovina",
    "BA",
    "BIH",
    ["Bosnia", "Bosnia-Erzegovina", "Bosnia e Erzegovina", "Bosnia and Herzegovina", "Bosnia Herzegovina", "Bosna i Hercegovina", "Босна и Херцеговина", "Bosnie-Herzégovine", "Bosnien und Herzegowina", "Bosnia y Herzegovina", "BiH"],
  ],
  ["Kosovo", "XK", "XKX", ["Kosova", "Косово"]],
  [
    "Macedonia del Nord",
    "MK",
    "MKD",
    ["Macedonia", "North Macedonia", "Severna Makedonija", "Северна Македонија", "Macédoine du Nord", "Nordmazedonien", "Macedonia del Norte", "FYROM"],
  ],
  ["Montenegro", "ME", "MNE", ["Crna Gora", "Црна Гора", "Monténégro"]],
  ["Serbia", "RS", "SRB", ["Srbija", "Србија", "Serbie", "Serbien"]],
  ["Moldavia", "MD", "MDA", ["Moldova", "Repubblica di Moldavia", "Republic of Moldova", "Moldawien"]],
  ["Ucraina", "UA", "UKR", ["Ukraine", "Ukraina", "Україна", "Ucrania"]],
  ["Bielorussia", "BY", "BLR", ["Belarus", "Беларусь", "Biélorussie", "Weißrussland", "Bielorrusia"]],
  ["Russia", "RU", "RUS", ["Russian Federation", "Federazione Russa", "Россия", "Rossiya", "Russie", "Russland", "Rusia"]],
  ["Turchia", "TR", "TUR", ["Turkey", "Türkiye", "Turquie", "Türkei", "Turquía"]],
  ["Georgia", "GE", "GEO", ["Sakartvelo", "Géorgie", "Georgien"]],
  ["Armenia", "AM", "ARM", ["Arménie", "Armenien", "Hayastan"]],
  ["Azerbaigian", "AZ", "AZE", ["Azerbaijan", "Azərbaycan", "Azerbaïdjan", "Aserbaidschan", "Azerbaiyán"]],
  ["Kazakistan", "KZ", "KAZ", ["Kazakhstan", "Qazaqstan", "Kasachstan", "Kazajistán"]],
  // Americhe
  [
    "Stati Uniti",
    "US",
    "USA",
    ["Stati Uniti d'America", "United States", "United States of America", "U.S.A.", "U.S.", "États-Unis", "Vereinigte Staaten", "Estados Unidos", "EEUU"],
  ],
  ["Canada", "CA", "CAN", ["Kanada", "Canadá"]],
  ["Messico", "MX", "MEX", ["Mexico", "México", "Mexique", "Mexiko"]],
  ["Brasile", "BR", "BRA", ["Brazil", "Brasil", "Brésil", "Brasilien"]],
  ["Argentina", "AR", "ARG", ["Argentine", "Argentinien"]],
  ["Cile", "CL", "CHL", ["Chile", "Chili"]],
  ["Colombia", "CO", "COL", ["Colombie", "Kolumbien"]],
  ["Perù", "PE", "PER", ["Peru", "Pérou"]],
  ["Belize", "BZ", "BLZ", ["Belice"]],
  // Asia e Oceania
  ["Australia", "AU", "AUS", ["Australie", "Australien"]],
  ["Nuova Zelanda", "NZ", "NZL", ["New Zealand", "Nouvelle-Zélande", "Neuseeland", "Nueva Zelanda", "Aotearoa"]],
  ["Cina", "CN", "CHN", ["China", "Chine", "Repubblica Popolare Cinese", "People's Republic of China", "PRC", "中国", "Zhongguo"]],
  ["Hong Kong", "HK", "HKG", ["Hong Kong SAR", "香港"]],
  ["Taiwan", "TW", "TWN", ["Taïwan", "台灣", "台湾"]],
  ["Giappone", "JP", "JPN", ["Japan", "Japon", "Japón", "日本", "Nippon", "Nihon"]],
  [
    "Corea del Sud",
    "KR",
    "KOR",
    ["Corea", "South Korea", "Korea", "Republic of Korea", "Repubblica di Corea", "Corée du Sud", "Südkorea", "Corea del Sur", "대한민국", "한국"],
  ],
  ["India", "IN", "IND", ["Inde", "Indien", "Bharat"]],
  ["Singapore", "SG", "SGP", ["Singapur", "Singapour"]],
  ["Thailandia", "TH", "THA", ["Tailandia", "Thailand", "Thaïlande"]],
  ["Vietnam", "VN", "VNM", ["Viet Nam", "Việt Nam"]],
  ["Malaysia", "MY", "MYS", ["Malesia", "Malaisie"]],
  ["Indonesia", "ID", "IDN", ["Indonésie", "Indonesien"]],
  ["Filippine", "PH", "PHL", ["Philippines", "Philippinen", "Filipinas"]],
  // Medio Oriente
  [
    "Emirati Arabi Uniti",
    "AE",
    "ARE",
    ["Emirati Arabi", "Emirati", "EAU", "E.A.U.", "UAE", "U.A.E.", "United Arab Emirates", "Émirats arabes unis", "Vereinigte Arabische Emirate", "Emiratos Árabes Unidos", "الإمارات"],
  ],
  ["Arabia Saudita", "SA", "SAU", ["Saudi Arabia", "KSA", "Arabie saoudite", "Saudi-Arabien", "السعودية"]],
  ["Qatar", "QA", "QAT", ["Katar", "قطر"]],
  ["Kuwait", "KW", "KWT", ["Koweït"]],
  ["Bahrein", "BH", "BHR", ["Bahrain", "Bahreïn"]],
  ["Oman", "OM", "OMN", ["Sultanato dell'Oman"]],
  ["Israele", "IL", "ISR", ["Israel", "Israël", "ישראל"]],
  ["Libano", "LB", "LBN", ["Lebanon", "Liban", "Libanon", "Líbano"]],
  ["Giordania", "JO", "JOR", ["Jordan", "Jordanie", "Jordanien", "Jordania"]],
  // Africa
  ["Egitto", "EG", "EGY", ["Egypt", "Égypte", "Ägypten", "Egipto", "مصر"]],
  ["Marocco", "MA", "MAR", ["Morocco", "Maroc", "Marokko", "Marruecos", "المغرب"]],
  ["Tunisia", "TN", "TUN", ["Tunisie", "Tunesien", "Túnez"]],
  ["Algeria", "DZ", "DZA", ["Algérie", "Algerien", "Argelia"]],
  ["Libia", "LY", "LBY", ["Libya", "Libye", "Libyen"]],
  ["Senegal", "SN", "SEN", ["Sénégal"]],
  ["Nigeria", "NG", "NGA", ["Nigéria"]],
  ["Kenya", "KE", "KEN", ["Kenia"]],
  ["Sudafrica", "ZA", "ZAF", ["South Africa", "Repubblica Sudafricana", "Afrique du Sud", "Südafrika", "Sudáfrica", "RSA"]],
];

export const COUNTRIES: readonly Country[] = ROWS.map(([name, iso2, iso3, aliases]) => ({ name, iso2, iso3, aliases }));

export const ITALY = "Italia";

/** Paesi più frequenti per BGP, in testa ai suggerimenti (gli altri seguono in ordine alfabetico). */
const FREQUENT = [
  ITALY,
  "Svizzera",
  "Francia",
  "Germania",
  "Austria",
  "Slovenia",
  "Croazia",
  "San Marino",
  "Principato di Monaco",
  "Spagna",
  "Belgio",
  "Paesi Bassi",
  "Regno Unito",
];

/** Nomi canonici per i suggerimenti dei campi Paese: prima i più frequenti, poi in ordine alfabetico. */
export const COUNTRY_NAMES: readonly string[] = [
  ...FREQUENT,
  ...COUNTRIES.map((c) => c.name)
    .filter((n) => !FREQUENT.includes(n))
    .sort((a, b) => a.localeCompare(b, "it")),
];

/** Lettere che la scomposizione Unicode non separa dall'accento (ß, ø, æ, œ, ł, đ, ı). */
const SPECIAL_LETTERS: Record<string, string> = { ß: "ss", ø: "o", æ: "ae", œ: "oe", ł: "l", đ: "d", ı: "i" };

/** Chiave di confronto: senza maiuscole, accenti, punteggiatura e spazi («U.S.A.» = «usa»). */
export function countryKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ßøæœłđı]/g, (ch) => SPECIAL_LETTERS[ch])
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const INDEX: ReadonlyMap<string, string> = (() => {
  const index = new Map<string, string>();
  for (const c of COUNTRIES) {
    for (const v of [c.name, c.iso2, c.iso3, ...c.aliases]) index.set(countryKey(v), c.name);
  }
  return index;
})();

/** Spazi normalizzati (anche a capo e tabulazioni); vuoto → stringa vuota. */
function clean(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Nome canonico in italiano del paese indicato, oppure null se il valore non è un paese noto.
 * Tollera un'indicazione tra parentesi («Svizzera (TI)», «Italia (BG)»).
 */
export function recognizeCountry(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!value) return null;
  const found = INDEX.get(countryKey(value));
  if (found) return found;
  const withoutParens = value.replace(/\([^)]*\)/g, " ");
  return withoutParens !== value ? (INDEX.get(countryKey(withoutParens)) ?? null) : null;
}

/**
 * Valore da salvare nei campi Paese: il nome canonico se il paese è riconosciuto, altrimenti il testo
 * com'è stato scritto (solo spazi normalizzati); vuoto → null. Un valore senza lettere né cifre
 * («-», «?», «/») vale come vuoto: «-» è anche il filtro «Paese non indicato» dei contatti.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!countryKey(value)) return null;
  return recognizeCountry(value) ?? value;
}

/** Il valore indica l'Italia (in qualsiasi forma riconosciuta: «IT», «Italy», «ITALIA»…). */
export function isItaly(raw: string | null | undefined): boolean {
  return recognizeCountry(raw) === ITALY;
}

/** Paese estero: indicato e diverso dall'Italia (un valore non riconosciuto conta come estero). */
export function isForeignCountry(raw: string | null | undefined): boolean {
  return normalizeCountry(raw) !== null && !isItaly(raw);
}

/**
 * Paese da aggiungere all'indirizzo di consegna (che ha via, CAP e città; il paese è in un campo a
 * parte): solo se estero e non già scritto in una riga o dopo una virgola dell'indirizzo, in qualunque
 * forma riconosciuta («Svizzera», «CH», «Switzerland»). null se non serve.
 */
export function countryForAddress(address: string | null | undefined, country: string | null | undefined): string | null {
  if (!isForeignCountry(country)) return null;
  const name = normalizeCountry(country)!;
  const key = countryKey(name);
  const known = recognizeCountry(country);
  const inAddress = (address ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .some((s) => s && (countryKey(s) === key || (known !== null && recognizeCountry(s) === known)));
  return inAddress ? null : name;
}

/** Indirizzo di consegna su una riga, con il paese se estero: «Via Nassa 5, 6900 Lugano, Svizzera». */
export function oneLineAddress(address: string | null | undefined, country: string | null | undefined): string {
  const line = (address ?? "").replace(/\s*\n\s*/g, ", ").trim();
  const foreign = countryForAddress(address, country);
  if (!foreign) return line;
  return line ? `${line}, ${foreign}` : foreign;
}
