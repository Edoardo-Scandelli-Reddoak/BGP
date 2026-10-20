import type { Language } from "@/db/schema";
import { normalizeCountry, recognizeCountry } from "@/lib/countries";
import { formatEmailList, parseEmailList } from "@/lib/email/recipients";
import { parseDecimal } from "@/lib/format";
import { cleanLabel } from "@/lib/products/labels";

/**
 * Lettura e normalizzazione dei file di BGP:
 *  - contatti: export Airtable "Lista_clienti_Airtable.xlsx"
 *    colonne Name | Email | Default address | Agent name | Agent email (cc) | Language
 *    (+ facoltative Phone | Country: il paese è salvato col nome italiano se riconosciuto, vedi src/lib/countries.ts)
 *  - prodotti: "Product list.xlsx" — colonne Codice_articolo | Descrizione_articolo_estesa
 *    (+ facoltative Marchio | Categoria | Prezzo_m2)
 * Le intestazioni sono riconosciute anche con varianti (italiano/inglese, maiuscole, spazi).
 */

export type RawRow = Record<string, unknown>;

export type ParsedAgent = {
  key: string;
  name: string;
  email: string | null;
  /** Prima riga del file in cui compare l'agente (per i messaggi dell'import). */
  row: number;
};

export type ParsedCustomer = {
  key: string;
  /** Riga del file (1 = intestazioni). */
  row: number;
  name: string;
  email: string | null;
  defaultAddress: string | null;
  /** Paese della colonna Paese (nome italiano se riconosciuto, altrimenti com'è scritto) o ricavato dall'indirizzo. */
  country: string | null;
  /** true se il paese è ricavato dall'indirizzo (non dalla colonna Paese): non sovrascrive quello salvato. */
  countryDerived: boolean;
  /** null se la cella è vuota o la lingua non è riconosciuta (BGP: la lingua è obbligatoria). */
  language: Language | null;
  /** Valore originale della colonna lingua (per i messaggi). */
  languageRaw: string;
  phone: string | null;
  agentKey: string | null;
};

export type ParsedProduct = {
  code: string;
  description: string;
  /** Colonne facoltative: null se assenti o vuote (non cancellano il valore salvato). */
  brand: string | null;
  category: string | null;
  /** Prezzo al m² in euro: presente solo se la cella contiene un numero valido (altrimenti non si tocca). */
  pricePerM2?: number;
  /** Colonna Attivo (Sì/No): assente o vuota = undefined (il prodotto del file viene attivato). */
  active?: boolean;
};

export type ParseReport<T> = {
  rows: T[];
  skipped: { row: number; reason: string }[];
  /** Righe importate con un valore ignorato (es. prezzo non numerico). */
  warnings?: { row: number; reason: string }[];
};

const LANGUAGE_MAP: Record<string, Language> = {
  italiano: "it",
  italian: "it",
  it: "it",
  english: "en",
  inglese: "en",
  en: "en",
  français: "fr",
  francais: "fr",
  francese: "fr",
  french: "fr",
  fr: "fr",
  deutsch: "de",
  tedesco: "de",
  german: "de",
  de: "de",
};

export function normalizeLanguage(value: unknown): Language | null {
  if (typeof value !== "string") return null;
  return LANGUAGE_MAP[value.trim().toLowerCase()] ?? null;
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value !== null && "text" in value) return String((value as { text: unknown }).text ?? "").trim();
  return String(value).trim();
}

/** Toglie "()" finali, virgole doppie e spazi superflui dall'indirizzo. */
export function cleanAddress(value: unknown): string | null {
  const s = str(value)
    .replace(/\s*\(\s*\)\s*$/, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || null;
}

const ITALIAN_STREET = /^(VIA|VIALE|V\.LE|PIAZZA|P\.ZZA|PIAZZALE|CORSO|C\.SO|LOCALITA'?|LOC\.|STRADA|CONTRADA|C\.DA|LARGO|VICOLO|VICO|FRAZIONE|FRAZ\.|BORGO|SALITA|LUNGOMARE)\b/i;

/** Sigle delle province italiane (attuali e soppresse ancora in uso negli indirizzi). */
const ITALIAN_PROVINCES = new Set(
  (
    "AG AL AN AO AP AQ AR AT AV BA BG BI BL BN BO BR BS BT BZ CA CB CE CH CI CL CN CO CR CS CT CZ " +
    "EN FC FE FG FI FM FO FR GE GO GR IM IS KR LC LE LI LO LT LU MB MC ME MI MN MO MS MT NA NO NU " +
    "OG OR OT PA PC PD PE PG PI PN PO PR PS PT PU PV PZ RA RC RE RG RI RM RN RO SA SI SO SP SR SS " +
    "SU SV TA TE TN TO TP TR TS TV UD VA VB VC VE VI VR VS VT VV"
  ).split(" "),
);

/** CAP italiano (5 cifre) prima della località. */
const ITALIAN_CAP = /(?:^|[\s,])\d{5}\s+\S/;
/** CAP svizzero (4 cifre) prima della località. */
const SWISS_POSTCODE = /(?:^|[\s,])\d{4}\s+\S/;
/** Sigle usate nel file per la Svizzera: CH (o il cantone, es. TI, ZH) con CAP a 4 cifre. */
const SWISS_CODES = new Set(["CH", "TI", "ZH"]);

/**
 * Paese ricavato dall'indirizzo del file Airtable di BGP:
 *  - "…, 24023 CLUSONE (BG)": sigla di provincia italiana + CAP a 5 cifre → Italia
 *    (senza CAP a 5 cifre la sigla è di un paese estero: (CH) Chieti o Svizzera, (SI) Siena o Slovenia…);
 *  - (HR) → Croazia, (SM) → San Marino, (CH)/(TI)/(ZH) con CAP a 4 cifre → Svizzera;
 *  - (EE) "Escursionisti Esteri" e le altre sigle → non indicato (da completare in anagrafica);
 *  - provincia vuota "()": Italia solo con toponimo italiano, CAP a 5 cifre e lingua italiana
 *    (o non indicata), perché "Via …" si trova anche in Svizzera e Croazia.
 */
export function countryFromAddress(address: unknown, language: Language | null = null): string | null {
  const raw = str(address);
  const emptyProvince = /\(\s*\)\s*$/.test(raw);
  const s = raw.replace(/\s*\(\s*\)\s*$/, "");
  const code = s.match(/\(([A-Z]{2})\)\s*$/)?.[1];
  if (code) {
    if (ITALIAN_PROVINCES.has(code) && ITALIAN_CAP.test(s)) return "Italia";
    if (code === "HR") return "Croazia";
    if (code === "SM") return "San Marino";
    if (SWISS_CODES.has(code) && SWISS_POSTCODE.test(s)) return "Svizzera";
    return null;
  }
  if (emptyProvince && ITALIAN_STREET.test(s) && ITALIAN_CAP.test(s) && (language === null || language === "it")) {
    return "Italia";
  }
  return null;
}

const ACTIVE_VALUES: Record<string, boolean> = {
  si: true, s: true, yes: true, y: true, true: true, vero: true, "1": true, x: true, attivo: true,
  no: false, n: false, false: false, falso: false, "0": false, disattivo: false, disattivato: false,
};

/** Colonna Attivo: Sì/No (anche Yes/No, 1/0, Vero/Falso). null = cella vuota; NaN = valore non riconosciuto. */
export function parseActive(value: unknown): boolean | null | number {
  if (typeof value === "boolean") return value;
  const s = str(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (!s) return null;
  return ACTIVE_VALUES[s] ?? NaN;
}

/** Prezzo massimo accettato (come gli importi in Impostazioni → Costi). */
const MAX_PRICE = 100_000;

/**
 * Prezzo in euro da una cella: numero oppure testo all'italiana ("45,50", "1.234,50 €", "€ 12").
 * null = cella vuota; NaN = valore non valido (testo, negativo o troppo alto).
 */
export function parsePrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= MAX_PRICE ? Math.round(value * 100) / 100 : NaN;
  }
  const s = str(value).replace(/€|\beuro?\b/gi, "").trim();
  if (!s) return null;
  if (!/^[\d\s.,]+$/.test(s)) return NaN;
  const n = parseDecimal(s);
  if (n === null || Number.isNaN(n) || n < 0 || n > MAX_PRICE) return NaN;
  return Math.round(n * 100) / 100;
}

export function normalizeEmails(value: unknown): string | null {
  const list = parseEmailList(str(value));
  return list.length ? formatEmailList(list) : null;
}

function normalizeKey(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim())
    .join("|");
}

/** Chiave di un agente: prima email se presente, altrimenti il nome. */
export function agentKey(name: string, email: string | null): string {
  const first = parseEmailList(email)[0];
  return first ? `email:${first.toLowerCase()}` : `name:${normalizeKey(name)}`;
}

/** Chiave di un cliente per gli import ripetuti: nome + indirizzo normalizzati. */
export function customerKey(name: string, address: string | null): string {
  return normalizeKey(name, address);
}

/** Trova il valore di una colonna accettando più intestazioni possibili. */
function pick(row: RawRow, names: string[]): unknown {
  const wanted = names.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const [k, v] of Object.entries(row)) {
    const nk = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (wanted.includes(nk)) return v;
  }
  return undefined;
}

export const IMPORT_COLUMNS = {
  name: ["Name", "Nome", "Ragione sociale", "Cliente"],
  email: ["Email", "E-mail", "Emails"],
  address: ["Default address", "Indirizzo", "Indirizzo predefinito", "Address"],
  agentName: ["Agent name", "Agente", "Nome agente"],
  agentEmail: ["Agent email (cc)", "Agent email", "Email agente"],
  language: ["Language", "Lingua"],
  phone: ["Phone", "Telefono", "Tel"],
  // «Country / Paese»: come la colonna è chiamata nella pagina di import e nel riepilogo
  country: ["Country", "Paese", "Nazione", "Country / Paese"],
  code: ["Codice_articolo", "Codice articolo", "Codice", "SKU", "SKU code", "Code"],
  description: ["Descrizione_articolo_estesa", "Descrizione articolo estesa", "Descrizione", "Description", "Product name"],
  brand: ["Marchio", "Brand"],
  category: ["Categoria", "Category"],
  // le intestazioni si confrontano senza spazi né simboli: «Prezzo m²» diventa «prezzom»
  active: ["Attivo", "Active"],
  pricePerM2: ["Prezzo_m2", "Prezzo al m2", "Prezzo m²", "Prezzo m2", "Prezzo al m²", "Prezzo/m2", "Prezzo al mq", "Prezzo mq", "Prezzo/mq", "Prezzo_mq", "Price per m2", "Price m2"],
};

export function parseContactRows(rows: RawRow[]): {
  agents: ParsedAgent[];
  customers: ParseReport<ParsedCustomer> & { warnings: { row: number; reason: string }[] };
} {
  const agents = new Map<string, ParsedAgent>();
  const customers: ParsedCustomer[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const warnings: { row: number; reason: string }[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const rowNum = i + 2; // riga 1 = intestazioni
    const name = str(pick(row, IMPORT_COLUMNS.name)).replace(/\s{2,}/g, " ");
    if (!name) {
      if (Object.values(row).some((v) => str(v))) skipped.push({ row: rowNum, reason: "Nome mancante" });
      return;
    }
    const agentName = str(pick(row, IMPORT_COLUMNS.agentName)).replace(/\s{2,}/g, " ");
    const agentEmail = normalizeEmails(pick(row, IMPORT_COLUMNS.agentEmail));
    let aKey: string | null = null;
    if (agentName || agentEmail) {
      aKey = agentKey(agentName || agentEmail || "", agentEmail);
      if (!agents.has(aKey)) {
        agents.set(aKey, { key: aKey, name: agentName || agentEmail || "Agente", email: agentEmail, row: rowNum });
      }
    }
    const address = cleanAddress(pick(row, IMPORT_COLUMNS.address));
    const key = customerKey(name, address);
    if (seen.has(key)) {
      skipped.push({ row: rowNum, reason: `Duplicato di un contatto già presente nel file (${name})` });
      return;
    }
    seen.add(key);
    // Colonna Paese: nome italiano se il paese è riconosciuto («FR», «France», «Hrvatska»…),
    // altrimenti il valore com'è scritto, con un avviso nel riepilogo.
    const countryCell = str(pick(row, IMPORT_COLUMNS.country)).replace(/\s+/g, " ");
    const explicitCountry = normalizeCountry(countryCell);
    if (explicitCountry && !recognizeCountry(countryCell)) {
      warnings.push({ row: rowNum, reason: `${name}: paese «${countryCell}» non riconosciuto, salvato com'è — controlla` });
    }
    const languageRaw = str(pick(row, IMPORT_COLUMNS.language));
    const language = normalizeLanguage(languageRaw);
    const derivedCountry = countryFromAddress(pick(row, IMPORT_COLUMNS.address), language);
    // Paese della colonna in contrasto con l'indirizzo (es. sigla di provincia «BG» letta come Bulgaria):
    // vale la colonna, ma si segnala.
    if (explicitCountry && derivedCountry && recognizeCountry(countryCell) && explicitCountry !== derivedCountry) {
      warnings.push({
        row: rowNum,
        reason: `${name}: paese «${str(countryCell)}» (${explicitCountry}) diverso da quello dell'indirizzo (${derivedCountry}) — controlla`,
      });
    }
    customers.push({
      key,
      row: rowNum,
      name,
      email: normalizeEmails(pick(row, IMPORT_COLUMNS.email)),
      defaultAddress: address,
      country: explicitCountry || derivedCountry,
      countryDerived: !explicitCountry,
      language,
      languageRaw,
      phone: str(pick(row, IMPORT_COLUMNS.phone)) || null,
      agentKey: aKey,
    });
  });

  return { agents: [...agents.values()], customers: { rows: customers, skipped, warnings } };
}

export function parseProductRows(rows: RawRow[]): ParseReport<ParsedProduct> {
  const out = new Map<string, ParsedProduct>();
  const skipped: { row: number; reason: string }[] = [];
  const warnings: { row: number; reason: string }[] = [];
  rows.forEach((row, i) => {
    const code = str(pick(row, IMPORT_COLUMNS.code));
    const description = str(pick(row, IMPORT_COLUMNS.description)).replace(/\s{2,}/g, " ");
    if (!code) {
      if (description) skipped.push({ row: i + 2, reason: "Codice articolo mancante" });
      return;
    }
    const k = code.toUpperCase();
    if (out.has(k)) {
      skipped.push({ row: i + 2, reason: `Codice duplicato ${code}` });
      return;
    }
    // Spazi normalizzati; l'allineamento ai valori già in anagrafica («gaia parquet» → «Gaia Parquet») è nell'import.
    const brand = cleanLabel(str(pick(row, IMPORT_COLUMNS.brand)));
    const category = cleanLabel(str(pick(row, IMPORT_COLUMNS.category)));
    const product: ParsedProduct = { code, description, brand, category };
    // Prezzo al m²: solo se la cella è un numero valido; un valore non valido viene ignorato e segnalato.
    const priceCell = pick(row, IMPORT_COLUMNS.pricePerM2);
    const price = parsePrice(priceCell);
    if (price !== null && !Number.isNaN(price)) product.pricePerM2 = price;
    else if (Number.isNaN(price)) {
      warnings.push({ row: i + 2, reason: `${code}: prezzo al m² «${str(priceCell)}» non valido, non importato` });
    }
    const activeCell = pick(row, IMPORT_COLUMNS.active);
    const active = parseActive(activeCell);
    if (typeof active === "boolean") product.active = active;
    else if (Number.isNaN(active)) {
      warnings.push({ row: i + 2, reason: `${code}: Attivo «${str(activeCell)}» non riconosciuto (usa Sì o No), prodotto attivato` });
    }
    out.set(k, product);
  });
  return { rows: [...out.values()], skipped, warnings };
}

/** CSV con separatore ";" o "," (rilevato dalla prima riga) e campi tra virgolette. */
export function parseCsv(text: string): RawRow[] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header, ...body] = records.filter((r) => r.some((v) => v.trim()));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}
