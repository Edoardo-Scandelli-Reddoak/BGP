import "server-only";
import ExcelJS from "exceljs";
import type { Language } from "@/db/schema";
import { LANGUAGE_LABELS } from "@/lib/format";

/**
 * Anagrafiche in Excel nello stesso formato dell'import (src/lib/import/parse.ts): BGP scarica contatti
 * o prodotti, li completa in Excel e li reimporta da «Importa da file» senza toccare le intestazioni.
 */

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ContactExportRow = {
  name: string;
  email: string | null;
  defaultAddress: string | null;
  agentName: string | null;
  agentEmail: string | null;
  language: Language;
  country: string | null;
  phone: string | null;
};

export type ProductExportRow = {
  code: string;
  description: string;
  brand: string | null;
  category: string | null;
  pricePerM2: number | null;
  active: boolean;
};

type Column<K extends string> = { header: string; key: K; width: number };

/** Intestazioni del file Airtable di BGP (Lista_clienti_Airtable.xlsx), nello stesso ordine, + Country e Phone. */
export const CONTACT_EXPORT_COLUMNS: Column<keyof ContactExportRow>[] = [
  { header: "Name", key: "name", width: 44 },
  { header: "Email", key: "email", width: 40 },
  { header: "Default address", key: "defaultAddress", width: 60 },
  { header: "Agent name", key: "agentName", width: 34 },
  { header: "Agent email (cc)", key: "agentEmail", width: 32 },
  { header: "Language", key: "language", width: 12 },
  { header: "Country", key: "country", width: 16 },
  { header: "Phone", key: "phone", width: 18 },
];

/** Intestazioni del listino di BGP (Product list.xlsx) + le colonne facoltative dell'import. */
export const PRODUCT_EXPORT_COLUMNS: Column<keyof ProductExportRow>[] = [
  { header: "Codice_articolo", key: "code", width: 18 },
  { header: "Descrizione_articolo_estesa", key: "description", width: 80 },
  { header: "Marchio", key: "brand", width: 18 },
  { header: "Categoria", key: "category", width: 16 },
  { header: "Prezzo_m2", key: "pricePerM2", width: 12 },
  // Sì/No: reimportando il file i prodotti disattivati restano disattivati
  { header: "Attivo", key: "active", width: 8 },
];

/** Testo: Excel non converte codici («00123», «10150E1») e telefoni in numeri, anche nelle celle aggiunte a mano. */
const TEXT_FORMAT = "@";
const PRICE_FORMAT = "#,##0.00";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
/** Limite di Excel per l'elenco di un menu a tendina scritto nella regola («"a,b,c"»). */
const LIST_FORMULA_MAX = 255;

/**
 * Testo di una cella. Nel formato xlsx «_x001F_» indica un carattere di controllo ed exceljs scrive il testo
 * così com'è: una sequenza letterale (nel file Airtable di BGP ce ne sono, es. «manu_x001F__lazzari@…»)
 * va protetta come «_x005F_x001F_», altrimenti rileggendo il file diventa un carattere invisibile.
 * Si protegge ogni «_» che inizia una sequenza, anche quando chiude la precedente («_x0041_x0042_»).
 */
export function xlsxText(value: string | null | undefined): string | null {
  return value ? value.replace(/_(?=x[0-9a-fA-F]{4}_)/g, "_x005F_") : null;
}

/**
 * "a@x.it; b@y.it" → "a@x.it;b@y.it;", come scrive gli indirizzi il file Airtable di BGP
 * (l'import accetta entrambe le forme). Gli eventuali valori non validi restano nel file.
 */
export function bgpEmailList(value: string | null | undefined): string | null {
  const parts = (value ?? "").split(/[;,\s]+/).filter(Boolean);
  return parts.length ? parts.map((e) => `${e};`).join("") : null;
}

/** Intestazione in grassetto su fondo grigio, prima riga bloccata e filtri su tutte le colonne. */
export function styleHeaderRow(ws: ExcelJS.Worksheet, columnCount = ws.columnCount): void {
  const header = ws.getRow(1);
  for (let col = 1; col <= columnCount; col++) {
    const cell = header.getCell(col);
    cell.font = { ...cell.font, bold: true };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle" };
  }
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2", activeCell: "A2" }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } };
}

type WorksheetWithValidations = ExcelJS.Worksheet & {
  // presente in exceljs 4 ma non nelle sue dichiarazioni di tipo: accetta anche un intervallo («C2:C500»)
  dataValidations: { add(address: string, validation: ExcelJS.DataValidation): void };
};

/**
 * Menu a tendina con i valori proposti su un intervallo («C2:C500») che accetta anche valori diversi
 * (nessun messaggio di errore). I valori con virgole o virgolette non possono stare nell'elenco e vengono saltati.
 */
export function addSuggestionList(ws: ExcelJS.Worksheet, range: string, values: string[], prompt?: string): void {
  const list: string[] = [];
  let length = 2; // virgolette
  for (const v of values) {
    const value = v.trim();
    if (!value || /[,"]/.test(value) || list.includes(value)) continue;
    if (length + value.length + (list.length ? 1 : 0) > LIST_FORMULA_MAX) break;
    length += value.length + (list.length ? 1 : 0);
    list.push(value);
  }
  if (!list.length) return;
  (ws as WorksheetWithValidations).dataValidations.add(range, {
    type: "list",
    allowBlank: true,
    formulae: [`"${list.join(",")}"`],
    showErrorMessage: false,
    showInputMessage: Boolean(prompt),
    prompt: prompt?.slice(0, 255),
  });
}

/** Foglio di istruzioni: un titolo e un paragrafo per riga (una riga vuota tra le sezioni). */
export function addInstructionsSheet(wb: ExcelJS.Workbook, title: string, lines: string[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet("Istruzioni");
  ws.getColumn(1).width = 110;
  const head = ws.addRow([title]);
  head.font = { bold: true, size: 14 };
  ws.addRow([]);
  for (const line of lines) {
    const row = ws.addRow([line || null]);
    row.alignment = { wrapText: true, vertical: "top" };
    // i titoletti delle sezioni terminano con ":"
    if (line.endsWith(":")) row.font = { bold: true };
  }
  return ws;
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Campionature BGP";
  wb.created = new Date();
  return wb;
}

/** Clienti nel formato del file Airtable di BGP (lingua come la scrive BGP: Italiano, English, Français, Deutsch). */
export async function buildContactsWorkbook(rows: ContactExportRow[]): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = wb.addWorksheet("Contatti");
  ws.columns = CONTACT_EXPORT_COLUMNS.map((c) => ({ ...c, style: { numFmt: TEXT_FORMAT } }));
  for (const r of rows) {
    ws.addRow({
      name: xlsxText(r.name),
      email: xlsxText(bgpEmailList(r.email)),
      defaultAddress: xlsxText(r.defaultAddress),
      agentName: xlsxText(r.agentName),
      agentEmail: xlsxText(bgpEmailList(r.agentEmail)),
      language: LANGUAGE_LABELS[r.language],
      country: xlsxText(r.country),
      phone: xlsxText(r.phone),
    });
  }
  styleHeaderRow(ws, CONTACT_EXPORT_COLUMNS.length);
  return toBuffer(wb);
}

/** Prodotti nel formato del listino; Marchio e Categoria con un menu a tendina dei valori proposti. */
export async function buildProductsWorkbook(
  rows: ProductExportRow[],
  suggestions: { brands?: string[]; categories?: string[] } = {},
): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = wb.addWorksheet("Prodotti");
  ws.columns = PRODUCT_EXPORT_COLUMNS.map((c) => ({
    ...c,
    style: { numFmt: c.key === "pricePerM2" ? PRICE_FORMAT : TEXT_FORMAT },
  }));
  for (const r of rows) {
    ws.addRow({
      code: xlsxText(r.code),
      description: xlsxText(r.description),
      brand: xlsxText(r.brand),
      category: xlsxText(r.category),
      pricePerM2: r.pricePerM2 ?? null,
      active: r.active ? "Sì" : "No",
    });
  }
  styleHeaderRow(ws, PRODUCT_EXPORT_COLUMNS.length);
  if (rows.length) {
    const last = rows.length + 1;
    const prompt = "Scegli dall'elenco oppure scrivi un altro valore.";
    if (suggestions.brands) addSuggestionList(ws, `C2:C${last}`, suggestions.brands, prompt);
    if (suggestions.categories) addSuggestionList(ws, `D2:D${last}`, suggestions.categories, prompt);
  }
  return toBuffer(wb);
}

/** Risposta HTTP di download di un file Excel (mai in cache: contiene dati delle anagrafiche). */
export function xlsxResponse(fileName: string, data: Buffer): Response {
  const safeName = fileName.replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}
