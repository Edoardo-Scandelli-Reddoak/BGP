import { formatDate, requestCode } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/status";
import { csvDecimal, toCsv } from "./csv";
import { SOURCE_LABELS } from "./history-filters";
import type { HistoryRow } from "./history";
import type { M2ProductRow } from "./m2";

/** CSV del report m² mensile per il CRM: Codice;Descrizione;Marchio;Richieste;Pezzi;m2 */
export function m2ReportCsv(rows: M2ProductRow[]): string {
  return toCsv(
    ["Codice", "Descrizione", "Marchio", "Richieste", "Pezzi", "m2"],
    rows.map((r) => [r.code, r.description, r.brand ?? "", r.requests, r.pieces, csvDecimal(r.m2, 2)]),
  );
}

export function m2ReportFileName(month: string): string {
  return `m2-campioni-${month}.csv`;
}

/** CSV dello storico completo, con gli stessi filtri della pagina. */
export function historyCsv(rows: HistoryRow[]): string {
  return toCsv(
    [
      "Codice",
      "Ricevuta",
      "Stato",
      "Origine",
      "Contatto",
      "Agente",
      "Paese",
      "Prodotti",
      "Colli",
      "Peso kg",
      "m2",
      "Corriere",
      "Data ritiro",
      "Tracking",
      "Spedita il",
      "Costo spedizione EUR",
    ],
    rows.map((r) => [
      requestCode(r.id),
      formatDate(r.receivedAt),
      STATUS_LABELS[r.status],
      SOURCE_LABELS[r.source],
      r.contactName,
      r.agentName ?? "",
      r.country ?? "",
      r.productCodes ?? "",
      r.packagesCount,
      csvDecimal(r.weightKg, 2),
      csvDecimal(r.m2, 2),
      r.carrierName ?? "",
      formatDate(r.pickupDate),
      r.trackingNumber ?? "",
      formatDate(r.shipmentDate),
      csvDecimal(r.shippingCost, 2),
    ]),
  );
}
