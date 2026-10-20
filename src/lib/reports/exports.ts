import { formatDate, requestCode } from "@/lib/format";
import { sampleFormatText } from "@/lib/sample-formats";
import { STATUS_LABELS } from "@/lib/status";
import { csvDecimal, csvText, toCsv } from "./csv";
import { SOURCE_LABELS } from "./history-filters";
import type { HistoryProductItem, HistoryRow } from "./history";

/** Separatore tra i prodotti di una richiesta (le descrizioni dei formati possono contenere virgole). */
export const HISTORY_ITEMS_SEPARATOR = " | ";

/** Un prodotto della richiesta: "10150E1 — Mezze doghe", "PAN01 — Pannello (2 colori)"; il codice da solo se il formato non è indicato. */
export function historyProductText(item: HistoryProductItem): string {
  const format = sampleFormatText(item.format, item.note);
  return format ? `${item.code} — ${format}` : item.code;
}

/** "10150E1 — Mezze doghe | MAZZ01 — Mazzetta | PAN01" */
export function historyProductsText(items: HistoryProductItem[]): string {
  return items.map(historyProductText).join(HISTORY_ITEMS_SEPARATOR);
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
      "Destinatario",
      "Alla c.a.",
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
      r.recipientName ?? "",
      r.attentionOf ?? "",
      r.agentName ?? "",
      r.country ?? "",
      csvText(historyProductsText(r.productItems)),
      r.packagesCount,
      csvDecimal(r.weightKg, 2),
      csvDecimal(r.m2, 2),
      r.carrierName ?? "",
      formatDate(r.pickupDate),
      r.trackingNumber ?? "",
      formatDate(r.shippedOn),
      csvDecimal(r.shippingCost, 2),
    ]),
  );
}
