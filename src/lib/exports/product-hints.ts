/**
 * Indizi ricavati dalla descrizione estesa dei prodotti di BGP, per filtrare in Excel e assegnare
 * marchio e categoria in blocco: tipo di prodotto (le prime parole della descrizione, normalizzate)
 * e collezione («…, collezione NAIF 15, …»). Solo un aiuto per chi compila: l'import li ignora.
 * Modulo puro.
 */

export const OTHER_PRODUCT_TYPE = "Altro";

/** Regole in ordine: vince la prima che corrisponde all'inizio della descrizione (minuscola, senza «0 »/«STK »). */
const PRODUCT_TYPE_RULES: [RegExp, string][] = [
  [/^pavimento (?:in )?spc\b/, "Pavimento SPC"],
  [/^pavimento (?:in )?epc\b/, "Pavimento EPC"],
  [/^(?:pavimento vinilico|woven vinyl)\b/, "Pavimento vinilico"],
  [/^(?:pavimento )?melaminico\b/, "Pavimento melaminico"],
  [/^pavimento smart wood\b/, "Pavimento Smart Wood"],
  [/^pavimento sportivo\b/, "Pavimento sportivo"],
  [/^(?:pavimento in bamboo|plancia bamboo)\b/, "Pavimento in bamboo"],
  // da esterno prima del legno: «Quadrotte IPE' per esterno», «Ipé lapacho massello … fresato per clips»
  [/^(?:decking|(?:quadrott[ea]|piastrella) (?:wpc|ip[eé]|lapacho)|ip[eé](?![a-z])|lapacho|teak\b.*\bper esterno\b)/, "Decking"],
  [/^(?:pavimento|listone|listoncino|listell[oi]|plancia|prefinito|(?:super)?lamparquet|parquet|quadrott[ea]|spina|european oak|\d-layer|due strati|massello|industriale)\b/, "Pavimento in legno"],
  // essenza in testa: «Doussié massello…», «Teak 2 strati…», «Cabreuva incenso supportato…»
  [/^(?:rovere|doussi\S*|teak|iroko|acero|ciliegio|cabreuva|weng\S*|noce|kana|kempas|abete|olivo|ulivo|merbau|jatob\S*|afrormosia|castagno|frassino|larice)\b.*\b(?:massello|strati|supportat[oa]|prefinito|spina|listone|lamparquet|industriale)\b/, "Pavimento in legno"],
  [/^pezzo speciale\b/, "Pezzo speciale decking"],
  [/^(?:battiscopa|b\.scopa|bs pvc|basolino|coprimarmo)\b/, "Battiscopa"],
  [/^(?:kit )?soglia\b/, "Soglia"],
  [/^mazzett[ae]\b/, "Mazzetta"],
  [/^pannell[oi] (?:campione|collezione)\b/, "Pannello campione"],
  [/^(?:espositore|culla espositiva|mobile campionario|grucce|doghe \S+ per espositore|pannello a campo pieno per espositore)\b/, "Espositore"],
  [/^scatola campionatura\b/, "Scatola campionatura"],
  [/^(?:campione|campionature|folder)\b/, "Campionatura"],
  [/^(?:profilo|toro|paraspigolo|fascia laterale|terminale di partenza)\b/, "Profilo"],
  [/^angolare\b/, "Angolare"],
  [/^(?:boiserie|rivestimento|doghe (?:per|da) rivestimento|pannello di rivestimento)\b/, "Rivestimento"],
  [/^(?:(?:fusto |cartuccia )?(?:colla|collante|primer|prymer)|adesivo|ultrabond|eco prim|sigillante|stucco|ultraplan|triblock|unisil)\b/, "Colla e prodotto per posa"],
  [/^materassino\b/, "Materassino"],
  [/^(?:magatell[oi]|clips?|vite|viti|base|tappi|tassello|rivetto|piatto alluminio|piedini|dischi|alette|martinetti|guarnizione|inox starters?|anime di giunzione|bindella|accessori|ferma porte|salvapavimento)\b/, "Accessorio di posa"],
  [/^(?:wax care|olio|vernice|lios|latta|detergente|pro-drop|wpc spray|cleaner|smart cleaner|lamin clean|polish|brillo|flacone|idrobello|idronetto|linfoil|metal (?:lack|mat)|re-pair|kit di manutenzione|pulitore|sapone|velurex|decerante|diluente|straccio|disco pulitore|fondo bicomponente|ultracoat)\b/, "Manutenzione e finitura"],
  [/^(?:igrometro|matite|attrezzo)\b/, "Attrezzatura"],
];

/** Toglie i prefissi che non dicono il tipo: «0 Pavimento…» (varianti ITA), «STK Battiscopa…» (stock). */
function typeText(description: string): string {
  return description
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    // «0 Pavimento…», «0.15Pavimento…» (varianti), «STK …» (stock), «VEDI BSSV04! …», «NON ATTIVO …»
    .replace(/^(?:(?:0[\d.,-]*|stk|non attivo|fuori produzione|vedi (?:cod\. )?[^\s!,]+[!,]*(?: -)?)\s*)+/, "");
}

/** Tipo di prodotto dall'inizio della descrizione («Pavimento in legno», «Battiscopa», «Soglia»…); «Altro» se non riconosciuto. */
export function productTypeFromDescription(description: string | null | undefined): string {
  const text = typeText(description ?? "");
  if (!text) return OTHER_PRODUCT_TYPE;
  return PRODUCT_TYPE_RULES.find(([re]) => re.test(text))?.[1] ?? OTHER_PRODUCT_TYPE;
}

const COLLECTION_MAX = 40;

/**
 * Collezione indicata nella descrizione («…, collezione NAIF 15, scelta AB…» → «NAIF 15»), in maiuscolo;
 * null se la descrizione non la riporta. Si ferma alla virgola o alle parole che iniziano un altro dato.
 */
export function collectionFromDescription(description: string | null | undefined): string | null {
  const match = (description ?? "").match(/\bcollezione\s+([^,;]+)/i);
  if (!match) return null;
  let value = match[1]
    .split(/\s+(?:scelta|misura|finitura|spessore|formato|completo|colore|spazzolat[oa]|verniciat[oa])\b/i)[0]
    .replace(/\s+/g, " ")
    .replace(/[\s.:/\-–]+$/, "")
    .trim()
    .toUpperCase();
  if (value.length > COLLECTION_MAX) {
    const cut = value.lastIndexOf(" ", COLLECTION_MAX);
    value = value.slice(0, cut > 0 ? cut : COLLECTION_MAX).trim();
  }
  return value || null;
}
