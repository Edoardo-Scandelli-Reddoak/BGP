import type { BollaRules } from "@/lib/config/bolla";
import { CRM_COLUMNS, type CrmColumn, type CrmExportConfig, type CrmGroupBy, type CrmRow } from "@/lib/config/crm-export";
import { parseDecimal } from "@/lib/format";
import { SAMPLE_FORMAT_LABELS } from "@/lib/sample-formats";

/**
 * Funzioni pure delle pagine Impostazioni → Costi, Bolla di consegna ed Export CRM
 * (usate sia dai form nel browser sia dalle server action).
 */

const BOLLA_PLACEHOLDERS = new Set(["{numero}", "{anno}"]);

/** Segnaposto tra graffe diversi da {numero} e {anno}, es. "C{num}/{anno}" → ["{num}"]. */
export function unknownBollaPlaceholders(format: string): string[] {
  return [...new Set(format.match(/\{[^{}]*\}/g) ?? [])].filter((p) => !BOLLA_PLACEHOLDERS.has(p));
}

/** Le regole in parole: «le spedizioni all'estero», «da 3 colli in su»… (vuoto = nessuna regola). */
export function bollaRulesSummary(rules: BollaRules): string[] {
  if (rules.always) return ["tutte le richieste"];
  const out: string[] = [];
  if (rules.abroad) out.push("le spedizioni all'estero");
  if (rules.formats.length) {
    out.push(`le richieste con ${rules.formats.map((f) => `«${SAMPLE_FORMAT_LABELS[f]}»`).join(" o ")}`);
  }
  if (rules.minPackages) {
    out.push(rules.minPackages === 1 ? "le richieste con almeno un collo" : `le richieste da ${rules.minPackages} colli in su`);
  }
  return out;
}

/** Importo scritto dall'utente ("12,50", "12.5", "") → numero; "" → 0; non valido → NaN. */
export function parseAmount(value: string): number {
  const n = parseDecimal(value);
  return n === null ? 0 : n;
}

/** Numero da mostrare in un campo di testo: 12.5 → "12,5", 0 → "0". */
export function amountText(value: number): string {
  return Number.isFinite(value) ? String(value).replace(".", ",") : "";
}

/** Colonne che identificano le righe per ciascun raggruppamento (almeno una per gruppo). */
export const CRM_KEY_COLUMNS: Record<CrmGroupBy, CrmColumn[][]> = {
  PRODOTTO: [["codice", "descrizione"]],
  PRODOTTO_CLIENTE: [["codice", "descrizione"], ["cliente"]],
  CLIENTE: [["cliente"]],
  AGENTE: [["agente"]],
};

/** Colonne identificative mancanti: con "Per cliente" senza «Cliente» le righe non si distinguono. */
export function missingCrmKeyColumns(groupBy: CrmGroupBy, columns: CrmColumn[]): CrmColumn[][] {
  return CRM_KEY_COLUMNS[groupBy].filter((alternatives) => !alternatives.some((c) => columns.includes(c)));
}

/** Valore di una cella come apparirà nel file (per l'anteprima). */
export function crmCellText(value: CrmRow[CrmColumn], column: CrmColumn, config: Pick<CrmExportConfig, "decimal" | "format">): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    const s = column === "m2" ? value.toFixed(2) : String(value);
    // in Excel il separatore dei decimali lo decide il computer di chi apre il file (in Italia: virgola)
    return config.format === "XLSX" || config.decimal === "," ? s.replace(".", ",") : s;
  }
  return value;
}

export const CRM_COLUMN_HINTS: Record<CrmColumn, string> = {
  mese: "Anno e mese esportati, es. 2026-09",
  codice: "Codice articolo",
  descrizione: "Descrizione del prodotto",
  marchio: "Dall'anagrafica prodotti, se indicato",
  categoria: "Dall'anagrafica prodotti, se indicata",
  cliente: "Ragione sociale del contatto",
  paese: "Paese del contatto",
  agente: "Agente del cliente («Direzionale» se non ne ha)",
  richieste: "Numero di richieste spedite",
  pezzi: "Numero di pezzi spediti",
  m2: "Metri quadri spediti",
};

export function crmColumnLabel(column: CrmColumn): string {
  return column === "m2" ? "m²" : CRM_COLUMNS[column];
}

/** Esito di un'esecuzione dell'export automatico (colonna «detail» di scheduled_runs) in una riga leggibile. */
export function summarizeCrmRun(detail: string | null): string {
  if (!detail) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return detail.length > 200 ? `${detail.slice(0, 200)}…` : detail;
  }
  const r = parsed as {
    rows?: number;
    email?: { status?: string; detail?: string };
    webhook?: { status?: string; detail?: string };
  };
  const EMAIL: Record<string, string> = {
    INVIATA: "inviata",
    SIMULATA: "simulata (modalità prova)",
    ERRORE: "errore",
    DISATTIVATO: "non prevista",
  };
  const WEBHOOK: Record<string, string> = { OK: "consegnato", ERRORE: "errore", DISATTIVATO: "non previsto" };
  const part = (label: string, map: Record<string, string>, x?: { status?: string; detail?: string }) => {
    if (!x?.status) return null;
    const text = map[x.status] ?? x.status.toLowerCase();
    return `${label}: ${text}${x.detail ? ` (${x.detail.slice(0, 120)})` : ""}`;
  };
  return [
    typeof r.rows === "number" ? `${r.rows} ${r.rows === 1 ? "riga" : "righe"}` : null,
    part("Email", EMAIL, r.email),
    part("Webhook", WEBHOOK, r.webhook),
  ]
    .filter(Boolean)
    .join(" · ");
}
