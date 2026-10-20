import type { Language } from "@/db/schema";
import { formatEmailList, parseEmailList } from "@/lib/email/recipients";

/**
 * Lettura e normalizzazione dei file di BGP:
 *  - contatti: export Airtable "Lista_clienti_Airtable.xlsx"
 *    colonne Name | Email | Default address | Agent name | Agent email (cc) | Language
 *  - prodotti: "Product list.xlsx" — colonne Codice_articolo | Descrizione_articolo_estesa
 * Le intestazioni sono riconosciute anche con varianti (italiano/inglese, maiuscole, spazi).
 */

export type RawRow = Record<string, unknown>;

export type ParsedAgent = { key: string; name: string; email: string | null };

export type ParsedCustomer = {
  key: string;
  name: string;
  email: string | null;
  defaultAddress: string | null;
  country: string | null;
  language: Language;
  phone: string | null;
  agentKey: string | null;
};

export type ParsedProduct = { code: string; description: string };

export type ParseReport<T> = { rows: T[]; skipped: { row: number; reason: string }[] };

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

/** Gli indirizzi italiani del file finiscono con la sigla di provincia "(BG)": in quel caso il paese è Italia. */
export function countryFromAddress(address: unknown): string | null {
  return /\([A-Z]{2}\)\s*$/.test(str(address)) ? "Italia" : null;
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

const COLS = {
  name: ["Name", "Nome", "Ragione sociale", "Cliente"],
  email: ["Email", "E-mail", "Emails"],
  address: ["Default address", "Indirizzo", "Indirizzo predefinito", "Address"],
  agentName: ["Agent name", "Agente", "Nome agente"],
  agentEmail: ["Agent email (cc)", "Agent email", "Email agente"],
  language: ["Language", "Lingua"],
  phone: ["Phone", "Telefono", "Tel"],
  country: ["Country", "Paese", "Nazione"],
  code: ["Codice_articolo", "Codice articolo", "Codice", "SKU", "SKU code", "Code"],
  description: ["Descrizione_articolo_estesa", "Descrizione articolo estesa", "Descrizione", "Description", "Product name"],
};

export function parseContactRows(rows: RawRow[]): {
  agents: ParsedAgent[];
  customers: ParseReport<ParsedCustomer>;
} {
  const agents = new Map<string, ParsedAgent>();
  const customers: ParsedCustomer[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const rowNum = i + 2; // riga 1 = intestazioni
    const name = str(pick(row, COLS.name)).replace(/\s{2,}/g, " ");
    if (!name) {
      if (Object.values(row).some((v) => str(v))) skipped.push({ row: rowNum, reason: "Nome mancante" });
      return;
    }
    const agentName = str(pick(row, COLS.agentName)).replace(/\s{2,}/g, " ");
    const agentEmail = normalizeEmails(pick(row, COLS.agentEmail));
    let aKey: string | null = null;
    if (agentName || agentEmail) {
      aKey = agentKey(agentName || agentEmail || "", agentEmail);
      if (!agents.has(aKey)) agents.set(aKey, { key: aKey, name: agentName || agentEmail || "Agente", email: agentEmail });
    }
    const address = cleanAddress(pick(row, COLS.address));
    const key = customerKey(name, address);
    if (seen.has(key)) {
      skipped.push({ row: rowNum, reason: `Duplicato di un contatto già presente nel file (${name})` });
      return;
    }
    seen.add(key);
    const explicitCountry = str(pick(row, COLS.country));
    customers.push({
      key,
      name,
      email: normalizeEmails(pick(row, COLS.email)),
      defaultAddress: address,
      country: explicitCountry || countryFromAddress(address),
      language: normalizeLanguage(pick(row, COLS.language)) ?? "it",
      phone: str(pick(row, COLS.phone)) || null,
      agentKey: aKey,
    });
  });

  return { agents: [...agents.values()], customers: { rows: customers, skipped } };
}

export function parseProductRows(rows: RawRow[]): ParseReport<ParsedProduct> {
  const out = new Map<string, ParsedProduct>();
  const skipped: { row: number; reason: string }[] = [];
  rows.forEach((row, i) => {
    const code = str(pick(row, COLS.code));
    const description = str(pick(row, COLS.description)).replace(/\s{2,}/g, " ");
    if (!code) {
      if (description) skipped.push({ row: i + 2, reason: "Codice articolo mancante" });
      return;
    }
    const k = code.toUpperCase();
    if (out.has(k)) skipped.push({ row: i + 2, reason: `Codice duplicato ${code}` });
    out.set(k, { code, description });
  });
  return { rows: [...out.values()], skipped };
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
