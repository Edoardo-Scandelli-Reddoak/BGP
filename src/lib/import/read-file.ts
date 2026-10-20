import ExcelJS from "exceljs";
import { parseCsv, type RawRow } from "./parse";

/** Legge il primo foglio di un file .xlsx oppure un .csv e restituisce le righe come oggetti. */
export async function readTabularFile(fileName: string, data: ArrayBuffer | Buffer): Promise<RawRow[]> {
  const lower = fileName.toLowerCase();
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return parseCsv(buffer.toString("utf8"));
  }
  if (!lower.endsWith(".xlsx")) throw new Error("Formato non supportato: usa .xlsx o .csv");
  const wb = new ExcelJS.Workbook();
  // exceljs vuole un ArrayBuffer/Buffer "classico"
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    header[col - 1] = String(cell.text ?? "").trim();
  });
  const rows: RawRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: RawRow = {};
    header.forEach((h, i) => {
      if (!h) return;
      const cell = row.getCell(i + 1);
      obj[h] = cell.text ?? "";
    });
    rows.push(obj);
  });
  return rows;
}
