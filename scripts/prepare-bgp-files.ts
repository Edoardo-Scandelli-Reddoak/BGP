/**
 * File da mandare a BGP per completare le anagrafiche (solo letture sul database):
 *  - Lista_clienti_Airtable_con_Paese.xlsx: il file contatti originale (stesse righe, ordine e colonne)
 *    con la colonna Country dopo Language, compilata col paese in anagrafica (o ricavato dall'indirizzo);
 *    in giallo le celle Country da completare, in arancione le righe dei contatti «da verificare»;
 *  - Product_list_con_Marchio_e_Categoria.xlsx: il listino originale con le colonne Marchio e Categoria
 *    (menu a tendina con i valori del blueprint, accetta anche altri valori) e due colonne di aiuto che
 *    l'import ignora: «Tipo (dalla descrizione)» e «Collezione», per filtrare e compilare in blocco.
 * Ogni file ha un foglio «Istruzioni». Alla fine i file vengono riletti con il lettore e il parser
 * dell'import per controllare righe, intestazioni e valori.
 *
 *   npm run bgp:files -- [--contatti ../Lista_clienti_Airtable.xlsx] [--prodotti "../Product list.xlsx"] [--out ../per-BGP]
 */
import "dotenv/config";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { BRAND_SUGGESTIONS, CATEGORY_SUGGESTIONS, mergeSuggestions } from "@/components/anagrafiche/constants";
import { db } from "@/db";
import { contacts, products } from "@/db/schema";
import { recognizeCountry } from "@/lib/countries";
import { collectionFromDescription, productTypeFromDescription } from "@/lib/exports/product-hints";
import { addInstructionsSheet, addSuggestionList, styleHeaderRow, xlsxText } from "@/lib/exports/registry-xlsx";
import {
  cleanAddress,
  countryFromAddress,
  customerKey,
  IMPORT_COLUMNS,
  normalizeLanguage,
  parseContactRows,
  parseProductRows,
} from "@/lib/import/parse";
import { readTabularFile } from "@/lib/import/read-file";

const CONTACTS_OUT = "Lista_clienti_Airtable_con_Paese.xlsx";
const PRODUCTS_OUT = "Product_list_con_Marchio_e_Categoria.xlsx";
const TYPE_HEADER = "Tipo (dalla descrizione)";
const COLLECTION_HEADER = "Collezione";

const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const TO_FILL = solid("FFFFF3B0"); // giallo chiaro: Country da compilare
const TO_REVIEW = solid("FFFFD8A8"); // arancione chiaro: contatto «da verificare»
const HELPER = solid("FFF1F5F9"); // grigio: colonne di aiuto, ignorate dall'import

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Larghezze per le colonne del file contatti che nell'originale non ne hanno (chiave: intestazione normalizzata). */
const CONTACT_WIDTHS: Record<string, number> = { name: 44, email: 40, agentname: 34, agentemailcc: 32, language: 12 };

/** Colonna (1 = A) con una delle intestazioni accettate dall'import, come `pick` in parse.ts. */
function findColumn(ws: ExcelJS.Worksheet, names: string[]): number | null {
  const wanted = names.map(headerKey);
  let found: number | null = null;
  ws.getRow(1).eachCell((cell, col) => {
    if (found === null && wanted.includes(headerKey(cell.text))) found = col;
  });
  return found;
}

function requireColumn(ws: ExcelJS.Worksheet, names: string[], file: string): number {
  const col = findColumn(ws, names);
  if (!col) throw new Error(`${file}: colonna «${names[0]}» non trovata`);
  return col;
}

/** Protegge le sequenze «_x001F_» letterali dei file originali, che exceljs riscriverebbe come caratteri di controllo. */
function protectLiteralEscapes(ws: ExcelJS.Worksheet): number {
  let changed = 0;
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      if (typeof cell.value !== "string") return;
      const value = xlsxText(cell.value);
      if (value !== cell.value) {
        cell.value = value;
        changed++;
      }
    }),
  );
  return changed;
}

function count<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/* ------------------------------------------------------------------ */
/* Contatti                                                            */
/* ------------------------------------------------------------------ */

async function prepareContacts(source: string, target: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(source);
  const ws = wb.worksheets[0];
  const file = path.basename(source);
  const nameCol = requireColumn(ws, IMPORT_COLUMNS.name, file);
  const addressCol = requireColumn(ws, IMPORT_COLUMNS.address, file);
  const languageCol = requireColumn(ws, IMPORT_COLUMNS.language, file);
  if (findColumn(ws, IMPORT_COLUMNS.country)) throw new Error(`${file}: c'è già una colonna Country/Paese`);

  // Clienti in anagrafica, riconosciuti con la stessa chiave dell'import (nome + indirizzo).
  const customers = await db
    .select({
      name: contacts.name,
      defaultAddress: contacts.defaultAddress,
      country: contacts.country,
      needsReview: contacts.needsReview,
    })
    .from(contacts)
    .where(eq(contacts.type, "CLIENTE"));
  const byKey = new Map<string, { country: string | null; needsReview: boolean }>();
  for (const c of customers) {
    const key = customerKey(c.name, c.defaultAddress);
    const cur = byKey.get(key);
    byKey.set(key, { country: cur?.country || c.country, needsReview: Boolean(cur?.needsReview) || c.needsReview });
  }

  const countryCol = languageCol + 1;
  ws.spliceColumns(countryCol, 0, []);
  const lastCol = ws.columnCount;
  const header = ws.getRow(1).getCell(countryCol);
  header.value = "Country";
  header.font = ws.getRow(1).getCell(languageCol).font;
  ws.getColumn(countryCol).width = 16;
  // colonne senza larghezza nel file originale (in Excel nomi ed email restano tagliati): larghezze leggibili
  ws.getRow(1).eachCell((cell, col) => {
    const column = ws.getColumn(col);
    if (!column.width) column.width = CONTACT_WIDTHS[headerKey(cell.text)] ?? 16;
  });

  const stats = { rows: 0, fromDb: 0, fromAddress: 0, empty: 0, review: 0, reviewEmpty: 0, notInDb: 0 };
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    stats.rows++;
    const name = row.getCell(nameCol).text.trim().replace(/\s{2,}/g, " ");
    const address = row.getCell(addressCol).text;
    const match = name ? byKey.get(customerKey(name, cleanAddress(address))) : undefined;
    if (!match) stats.notInDb++;
    const country = match?.country || countryFromAddress(address, normalizeLanguage(row.getCell(languageCol).text));
    const cell = row.getCell(countryCol);
    cell.value = country || null;
    cell.numFmt = "@";
    if (match?.needsReview) {
      stats.review++;
      for (let c = 1; c <= lastCol; c++) row.getCell(c).fill = TO_REVIEW;
    }
    if (!country) {
      stats.empty++;
      if (match?.needsReview) stats.reviewEmpty++;
      cell.fill = TO_FILL;
    } else if (match?.country) stats.fromDb++;
    else stats.fromAddress++;
  }
  styleHeaderRow(ws, lastCol);

  addInstructionsSheet(wb, "Lista clienti: colonna Country da completare", [
    "Cosa compilare:",
    "La colonna Country (paese del cliente), subito dopo Language. Le celle già compilate vengono dall'anagrafica dell'app o dall'indirizzo: controllale e correggile se serve.",
    "",
    "Valori accettati:",
    "Il nome del paese in italiano, in inglese o nella lingua del paese (Italia / Italy, Svizzera / Switzerland / Schweiz, Croazia / Croatia / Hrvatska, Francia / France…) oppure la sigla ISO di 2 o 3 lettere (IT, CH, HR, FR…). L'app salva il nome in italiano; un valore che non riconosce viene salvato com'è e segnalato nel riepilogo dell'import.",
    "",
    "Colori:",
    "Giallo: paese non indicato, da compilare.",
    "Arancione (tutta la riga): contatto segnato «da verificare» nell'app (per esempio lingua mancante o paese da controllare): verifica anche gli altri dati della riga. Dopo l'import la segnalazione si toglie dalla scheda del contatto con «Segna come verificato».",
    "",
    "Da non modificare:",
    "Name e Default address: servono a riconoscere il cliente già presente; se cambiano, l'import crea un nuovo contatto. Non rinominare le intestazioni e lascia i dati nel primo foglio.",
    "",
    "Come reimportare:",
    "Nell'app: Anagrafiche → Contatti → Importa da file, riquadro Contatti: carica questo file così com'è (.xlsx). Viene letto solo il primo foglio, queste istruzioni sono ignorate. Le celle Country vuote non cancellano nulla.",
  ]);

  protectLiteralEscapes(ws);
  await wb.xlsx.writeFile(target);
  return stats;
}

/* ------------------------------------------------------------------ */
/* Prodotti                                                            */
/* ------------------------------------------------------------------ */

async function prepareProducts(source: string, target: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(source);
  const ws = wb.worksheets[0];
  const file = path.basename(source);
  const codeCol = requireColumn(ws, IMPORT_COLUMNS.code, file);
  const descriptionCol = requireColumn(ws, IMPORT_COLUMNS.description, file);
  if (findColumn(ws, IMPORT_COLUMNS.brand) || findColumn(ws, IMPORT_COLUMNS.category)) {
    throw new Error(`${file}: ci sono già le colonne Marchio/Categoria`);
  }

  const saved = await db.select({ code: products.code, brand: products.brand, category: products.category }).from(products);
  const byCode = new Map(saved.map((p) => [p.code.toUpperCase(), p]));
  const brands = mergeSuggestions(BRAND_SUGGESTIONS, saved.map((p) => p.brand));
  const categories = mergeSuggestions(CATEGORY_SUGGESTIONS, saved.map((p) => p.category));

  const first = ws.columnCount + 1;
  const cols = { brand: first, category: first + 1, type: first + 2, collection: first + 3 };
  const headerRow = ws.getRow(1);
  const headerFont = headerRow.getCell(descriptionCol).font;
  const headers: [number, string, number][] = [
    [cols.brand, "Marchio", 18],
    [cols.category, "Categoria", 16],
    [cols.type, TYPE_HEADER, 24],
    [cols.collection, COLLECTION_HEADER, 24],
  ];
  for (const [col, title, width] of headers) {
    headerRow.getCell(col).value = title;
    headerRow.getCell(col).font = headerFont;
    ws.getColumn(col).width = width;
  }
  // descrizioni lunghe: colonna più larga del file originale
  ws.getColumn(descriptionCol).width = Math.max(ws.getColumn(descriptionCol).width ?? 0, 70);

  const stats = { rows: 0, brand: 0, category: 0, withCollection: 0, types: new Map<string, number>() };
  let lastRow = 1;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    stats.rows++;
    lastRow = r;
    const description = row.getCell(descriptionCol).text;
    const font = row.getCell(descriptionCol).font;
    const current = byCode.get(row.getCell(codeCol).text.trim().toUpperCase());
    const type = productTypeFromDescription(description);
    const collection = collectionFromDescription(description);
    count(stats.types, type);
    if (current?.brand) stats.brand++;
    if (current?.category) stats.category++;
    if (collection) stats.withCollection++;
    const values: [number, string | null][] = [
      [cols.brand, current?.brand || null],
      [cols.category, current?.category || null],
      [cols.type, type],
      [cols.collection, collection],
    ];
    for (const [col, value] of values) {
      const cell = row.getCell(col);
      cell.value = value;
      cell.numFmt = "@";
      cell.font = font;
      if (col === cols.type || col === cols.collection) {
        cell.fill = HELPER;
        cell.font = { ...font, italic: true, color: { argb: "FF475569" } };
      }
    }
  }
  styleHeaderRow(ws, cols.collection);
  for (const col of [cols.type, cols.collection]) {
    headerRow.getCell(col).font = { ...headerFont, bold: true, italic: true, color: { argb: "FF475569" } };
  }
  if (lastRow > 1) {
    const prompt = "Scegli dall'elenco oppure scrivi un altro valore.";
    const letter = (col: number) => ws.getColumn(col).letter;
    addSuggestionList(ws, `${letter(cols.brand)}2:${letter(cols.brand)}${lastRow}`, brands, prompt);
    addSuggestionList(ws, `${letter(cols.category)}2:${letter(cols.category)}${lastRow}`, categories, prompt);
  }

  addInstructionsSheet(wb, "Listino prodotti: Marchio e Categoria da completare", [
    "Cosa compilare:",
    `Le colonne Marchio e Categoria di ogni prodotto. Ogni cella ha un menu a tendina con i valori proposti (Marchio: ${BRAND_SUGGESTIONS.join(", ")}; Categoria: ${CATEGORY_SUGGESTIONS.join(", ")}); si può anche scrivere un valore diverso.`,
    "",
    "Per fare prima:",
    `Usa i filtri sulle colonne «${TYPE_HEADER}» e «${COLLECTION_HEADER}» (o il filtro «Contiene…» sulla descrizione), scrivi il valore nella prima cella visibile, seleziona le celle filtrate sotto e premi Ctrl+D (su Mac ⌘+D) per copiarlo in tutte.`,
    "",
    "Colonne di aiuto (in grigio):",
    `«${TYPE_HEADER}» e «${COLLECTION_HEADER}» sono ricavate in automatico dalla descrizione, solo per filtrare: l'import le ignora, non serve correggerle né cancellarle.`,
    "",
    "Da non modificare:",
    "Codice_articolo: serve a riconoscere il prodotto. Non rinominare le intestazioni e lascia i dati nel primo foglio. Le celle Marchio e Categoria lasciate vuote non cancellano nulla.",
    "",
    "Come reimportare:",
    "Nell'app: Anagrafiche → Prodotti → Importa da file, riquadro Prodotti: carica questo file così com'è (.xlsx). Viene letto solo il primo foglio, queste istruzioni sono ignorate.",
  ]);

  protectLiteralEscapes(ws);
  await wb.xlsx.writeFile(target);
  return stats;
}

/* ------------------------------------------------------------------ */
/* Verifica con il lettore e il parser dell'import                     */
/* ------------------------------------------------------------------ */

async function readRows(file: string) {
  return readTabularFile(file, await readFile(file));
}

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`Verifica non superata: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function verifyContacts(source: string, target: string) {
  const [orig, out] = await Promise.all([readRows(source), readRows(target)]);
  check(out.length === orig.length, `stesse righe dell'originale (${out.length})`);
  check(Object.keys(out[0] ?? {}).includes("Country"), "intestazione Country presente e letta dall'import");
  const a = parseContactRows(orig);
  const b = parseContactRows(out);
  check(
    b.customers.rows.length === a.customers.rows.length && b.customers.skipped.length === a.customers.skipped.length,
    `stessi clienti riconosciuti (${b.customers.rows.length}, ${b.customers.skipped.length} scartati come nell'originale)`,
  );
  check(
    b.customers.rows.every((c, i) => {
      const o = a.customers.rows[i];
      return c.key === o.key && c.email === o.email && c.language === o.language && c.agentKey === o.agentKey;
    }),
    "stessi nomi, indirizzi, email, agenti e lingue dell'originale",
  );
  const explicit = out.map((r) => String(r.Country ?? "").trim()).filter(Boolean);
  const unknown = explicit.filter((v) => !recognizeCountry(v));
  check(unknown.length === 0, `${explicit.length} valori di Country riconosciuti come paese`);
  // `row` è la riga del file (1 = intestazioni): il file non ha righe vuote
  check(
    b.customers.rows.every((c) => c.countryDerived === !String(out[c.row - 2]?.Country ?? "").trim()),
    "Country letto dall'import come colonna del paese",
  );
}

async function verifyProducts(source: string, target: string) {
  const [orig, out] = await Promise.all([readRows(source), readRows(target)]);
  check(out.length === orig.length, `stesse righe dell'originale (${out.length})`);
  const headers = Object.keys(out[0] ?? {});
  check(["Marchio", "Categoria", TYPE_HEADER, COLLECTION_HEADER].every((h) => headers.includes(h)), "nuove intestazioni presenti");
  const a = parseProductRows(orig);
  const b = parseProductRows(out);
  check(b.rows.length === a.rows.length && b.skipped.length === a.skipped.length, `stessi prodotti riconosciuti (${b.rows.length})`);
  check(
    b.rows.every((p, i) => p.code === a.rows[i].code && p.description === a.rows[i].description),
    "stessi codici e descrizioni dell'originale",
  );
  const allowed = new Set(["code", "description", "brand", "category", "pricePerM2"]);
  check(
    b.rows.every((p) => Object.keys(p).every((k) => allowed.has(k))) && !b.rows.some((p) => p.pricePerM2 !== undefined),
    "colonne di aiuto ignorate dall'import",
  );
  const filled = (header: string) => new Set(out.filter((r) => String(r[header] ?? "").trim()).map((r) => String(r[header])));
  const brands = filled("Marchio");
  const categories = filled("Categoria");
  check(
    b.rows.every((p) => (!p.brand || brands.has(p.brand)) && (!p.category || categories.has(p.category))),
    `Marchio e Categoria letti solo dalle loro colonne (${b.rows.filter((p) => p.brand).length} marchi, ${b.rows.filter((p) => p.category).length} categorie)`,
  );
}

async function main() {
  const contactsSource = path.resolve(arg("contatti") ?? "../Lista_clienti_Airtable.xlsx");
  const productsSource = path.resolve(arg("prodotti") ?? "../Product list.xlsx");
  const outDir = path.resolve(arg("out") ?? "../per-BGP");
  await mkdir(outDir, { recursive: true });
  const contactsTarget = path.join(outDir, CONTACTS_OUT);
  const productsTarget = path.join(outDir, PRODUCTS_OUT);

  const c = await prepareContacts(contactsSource, contactsTarget);
  console.log(`\n${contactsTarget}`);
  console.log(
    `  ${c.rows} righe: Country compilato ${c.fromDb + c.fromAddress} (${c.fromDb} dall'anagrafica, ${c.fromAddress} dall'indirizzo), ` +
      `da completare ${c.empty}; righe «da verificare» ${c.review} (${c.reviewEmpty} anche senza paese); non trovate in anagrafica ${c.notInDb}`,
  );
  await verifyContacts(contactsSource, contactsTarget);

  const p = await prepareProducts(productsSource, productsTarget);
  console.log(`\n${productsTarget}`);
  console.log(
    `  ${p.rows} righe: marchio già indicato ${p.brand}, categoria già indicata ${p.category}, con collezione ${p.withCollection}`,
  );
  console.log("  Tipo (dalla descrizione):");
  for (const [type, n] of [...p.types].sort((x, y) => y[1] - x[1])) console.log(`    ${String(n).padStart(5)}  ${type}`);
  await verifyProducts(productsSource, productsTarget);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
