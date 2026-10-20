import "server-only";
import { and, inArray, sql, type SQL } from "drizzle-orm";
import { sampleRequests } from "@/db/schema";
import { TIME_ZONE } from "@/lib/format";
import { SHIPPED_STATUSES } from "@/lib/status";
import { addDays } from "./period";

/**
 * Data di spedizione "effettiva" di una richiesta partita: la data di spedizione se inserita,
 * altrimenti la data di ritiro del corriere (obbligatoria per «Spedita»; nel blueprint la data
 * di spedizione è proprio "la data in cui il corriere ritira"). Vale solo per Spedita/Completata.
 */
export const effectiveShipmentDate = sql<string | null>`coalesce(${sampleRequests.shipmentDate}, ${sampleRequests.pickupDate})`;

/** Mezzanotte (fuso di Roma) del giorno ISO, come timestamptz. */
export function romeDayStart(iso: string): SQL {
  return sql`((${iso})::date)::timestamp at time zone ${TIME_ZONE}`;
}

/** Richiesta ricevuta tra `da` e `a` inclusi (giorni di calendario italiani). */
export function receivedBetween(da: string, a: string): SQL {
  return sql`(${sampleRequests.receivedAt} >= ${romeDayStart(da)} and ${sampleRequests.receivedAt} < ${romeDayStart(addDays(a, 1))})`;
}

/** Richiesta spedita (Spedita o Completata) con data di spedizione effettiva tra `da` e `a` inclusi. */
export function shippedBetween(da: string, a: string): SQL {
  return and(
    inArray(sampleRequests.status, SHIPPED_STATUSES),
    sql`${effectiveShipmentDate} between ${da}::date and ${a}::date`,
  )!;
}
