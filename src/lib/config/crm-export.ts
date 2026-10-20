import { z } from "zod";

/**
 * Export dei m² verso il CRM, configurabile da BGP (Impostazioni → Export CRM):
 * raggruppamento, colonne e ordine, formato del file, invio automatico mensile e webhook.
 * Modulo puro: tipi, valori predefiniti, validazione e scrittura del CSV.
 */

export type CrmGroupBy = "PRODOTTO" | "PRODOTTO_CLIENTE" | "CLIENTE" | "AGENTE";

export const CRM_GROUP_BY_LABELS: Record<CrmGroupBy, string> = {
  PRODOTTO: "Per prodotto",
  PRODOTTO_CLIENTE: "Per prodotto e cliente",
  CLIENTE: "Per cliente",
  AGENTE: "Per agente",
};

export const CRM_COLUMNS = {
  mese: "Mese",
  codice: "Codice",
  descrizione: "Descrizione",
  marchio: "Marchio",
  categoria: "Categoria",
  cliente: "Cliente",
  paese: "Paese",
  agente: "Agente",
  richieste: "Richieste",
  pezzi: "Pezzi",
  m2: "m2",
} as const;

export type CrmColumn = keyof typeof CRM_COLUMNS;

/** Colonne disponibili per ciascun raggruppamento (le misure ci sono sempre). */
export const CRM_COLUMNS_BY_GROUP: Record<CrmGroupBy, CrmColumn[]> = {
  PRODOTTO: ["mese", "codice", "descrizione", "marchio", "categoria", "richieste", "pezzi", "m2"],
  PRODOTTO_CLIENTE: [
    "mese", "codice", "descrizione", "marchio", "categoria", "cliente", "paese", "agente", "richieste", "pezzi", "m2",
  ],
  CLIENTE: ["mese", "cliente", "paese", "agente", "richieste", "pezzi", "m2"],
  AGENTE: ["mese", "agente", "richieste", "pezzi", "m2"],
};

export type CrmExportConfig = {
  groupBy: CrmGroupBy;
  /** Colonne nell'ordine del file. */
  columns: CrmColumn[];
  separator: ";" | "," | "\t";
  decimal: "," | ".";
  header: boolean;
  format: "CSV" | "XLSX";
  /** Nome del file senza estensione; {mese} = AAAA-MM. */
  fileName: string;
  /** Invio automatico del mese precedente, il giorno indicato. */
  autoSend: { enabled: boolean; recipients: string[]; day: number };
  /** Collegamento automatico: POST JSON firmato (HMAC SHA-256) a un indirizzo del CRM. */
  webhook: { enabled: boolean; url: string; secret: string };
};

export const DEFAULT_CRM_EXPORT_CONFIG: CrmExportConfig = {
  // Stesso file di oggi: Codice;Descrizione;Marchio;Richieste;Pezzi;m2 per prodotto.
  groupBy: "PRODOTTO",
  columns: ["codice", "descrizione", "marchio", "richieste", "pezzi", "m2"],
  separator: ";",
  decimal: ",",
  header: true,
  format: "CSV",
  fileName: "m2-campioni-{mese}",
  autoSend: { enabled: false, recipients: [], day: 1 },
  webhook: { enabled: false, url: "", secret: "" },
};

export const crmExportConfigSchema = z
  .object({
    groupBy: z.enum(["PRODOTTO", "PRODOTTO_CLIENTE", "CLIENTE", "AGENTE"]),
    columns: z
      .array(z.enum(Object.keys(CRM_COLUMNS) as [CrmColumn, ...CrmColumn[]]))
      .min(1, "Scegli almeno una colonna"),
    separator: z.enum([";", ",", "\t"]),
    decimal: z.enum([",", "."]),
    header: z.boolean(),
    format: z.enum(["CSV", "XLSX"]),
    fileName: z
      .string()
      .trim()
      .min(1, "Indica il nome del file")
      .max(80, "Massimo 80 caratteri")
      .regex(/^[\w{}\-. ]+$/, "Usa solo lettere, numeri, spazi, - _ . e {mese}"),
    autoSend: z.object({
      enabled: z.boolean(),
      recipients: z.array(z.string().email("Email non valida")).max(10, "Massimo 10 destinatari"),
      day: z.coerce
        .number()
        .int("Giorno non valido")
        .min(1, "Giorno tra 1 e 28")
        .max(28, "Giorno tra 1 e 28 (vale per tutti i mesi)"),
    }),
    webhook: z.object({
      enabled: z.boolean(),
      url: z.string().trim().max(500, "Indirizzo troppo lungo"),
      secret: z.string().max(200, "Segreto troppo lungo"),
    }),
  })
  .superRefine((c, ctx) => {
    const allowed = CRM_COLUMNS_BY_GROUP[c.groupBy];
    const bad = c.columns.filter((col) => !allowed.includes(col));
    if (bad.length) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: `Colonne non disponibili con questo raggruppamento: ${bad.map((b) => CRM_COLUMNS[b]).join(", ")}`,
      });
    }
    if (c.format === "CSV" && c.separator === "," && c.decimal === ",") {
      ctx.addIssue({ code: "custom", path: ["decimal"], message: "Con il separatore «,» usa il punto per i decimali" });
    }
    if (c.autoSend.enabled && c.autoSend.recipients.length === 0) {
      ctx.addIssue({ code: "custom", path: ["autoSend", "recipients"], message: "Indica almeno un destinatario" });
    }
    if (c.webhook.enabled && !/^https:\/\/\S+$/.test(c.webhook.url)) {
      ctx.addIssue({ code: "custom", path: ["webhook", "url"], message: "Indica un indirizzo https://" });
    }
  });

/** Una riga dell'export: valori per colonna (testo o numero). */
export type CrmRow = Partial<Record<CrmColumn, string | number | null>>;

/** Colonne che contengono codici: da proteggere dalle conversioni automatiche di Excel. */
const TEXT_COLUMNS: CrmColumn[] = ["codice", "mese"];
const EXCEL_COERCED = /^(?:[+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?%?|\d+[/:.-]\d+(?:[/:.-]\d+)?)$/i;
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number | null | undefined, column: CrmColumn, config: CrmExportConfig): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const s = column === "m2" ? value.toFixed(2) : String(value);
    return config.decimal === "," ? s.replace(".", ",") : s;
  }
  let s = value;
  if (TEXT_COLUMNS.includes(column) && EXCEL_COERCED.test(s)) return `"=""${s}"""`;
  if (FORMULA_START.test(s)) s = `'${s}`;
  const needsQuotes = s.includes(config.separator) || /["\r\n]/.test(s);
  return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV secondo la configurazione (BOM UTF-8 e righe CRLF, per Excel). */
export function crmCsv(rows: CrmRow[], config: CrmExportConfig): string {
  const lines: string[] = [];
  if (config.header) lines.push(config.columns.map((c) => cell(CRM_COLUMNS[c], c === "codice" ? "descrizione" : c, config)).join(config.separator));
  for (const row of rows) lines.push(config.columns.map((c) => cell(row[c], c, config)).join(config.separator));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Nome del file con estensione, es. "m2-campioni-2026-10.csv". */
export function crmFileName(config: CrmExportConfig, month: string): string {
  const base = config.fileName.replaceAll("{mese}", month).trim() || `m2-campioni-${month}`;
  return `${base}.${config.format === "XLSX" ? "xlsx" : "csv"}`;
}
