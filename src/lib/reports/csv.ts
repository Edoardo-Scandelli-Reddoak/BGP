/**
 * CSV per Excel in italiano: BOM UTF-8 (accenti corretti), separatore ";", virgola decimale,
 * righe terminate da CRLF. Modulo puro (nessuna dipendenza) per poterlo testare da solo.
 */

export const CSV_SEPARATOR = ";";
const BOM = "﻿";
const NEEDS_QUOTES = /[;"\r\n]/;
/** Celle che Excel interpreterebbe come formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d+(?:[.,]\d+)?$/;

/** Cella già pronta per il CSV (virgolette incluse): la produce solo `csvText`. */
export type CsvRawCell = { readonly csvRaw: string };

export type CsvValue = string | number | null | undefined | CsvRawCell;

/** Testo che Excel convertirebbe da solo in numero o data: 10150E1 → 1,02E+05, 0123 → 123, 3/4 → 03-apr. */
const EXCEL_COERCED = /^(?:[+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?%?|\d+[/:.-]\d+(?:[/:.-]\d+)?)$/i;

/**
 * Testo da tenere com'è anche aprendo il file con Excel (codici articolo come 10150E1 o 0123):
 * se Excel lo convertirebbe, la cella diventa ="10150E1", che Excel mostra come testo.
 * Il contenuto protetto è fatto solo di cifre e separatori, quindi non può essere una formula pericolosa.
 */
export function csvText(value: string | null | undefined): CsvValue {
  if (value === null || value === undefined) return "";
  if (!EXCEL_COERCED.test(value)) return value;
  return { csvRaw: `"=""${value}"""` };
}

/** Numero con virgola decimale e cifre fisse, senza separatore delle migliaia: 1234.5 → "1234,50". */
export function csvDecimal(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toFixed(decimals).replace(".", ",");
}

/**
 * Una cella: i numeri interi restano tali, gli altri usano la virgola decimale;
 * il testo che contiene ";", virgolette o a capo va tra virgolette (con le virgolette raddoppiate).
 * Il testo che inizia con = + - @ (e non è un numero) viene preceduto da un apostrofo.
 */
export function csvEscape(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value.csvRaw;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
  }
  let s = value;
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvEscape).join(CSV_SEPARATOR);
}

/** Documento completo: BOM + intestazione + righe, CRLF finale incluso. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return BOM + [csvRow(header), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

/** Risposta HTTP di download per un route handler. */
export function csvResponse(fileName: string, csv: string): Response {
  const safeName = fileName.replace(/[^\w.-]/g, "_");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}
