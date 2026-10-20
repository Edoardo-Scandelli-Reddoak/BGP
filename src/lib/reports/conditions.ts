import "server-only";
import { and, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { sampleRequests, type RequestStatus } from "@/db/schema";
import { TIME_ZONE } from "@/lib/format";
import { addDays } from "./period";

/** Stati in cui una richiesta conta come spedita (e i suoi m² entrano nei report). */
export const SHIPPED_STATUSES: RequestStatus[] = ["SPEDITA", "COMPLETATA"];

/** Mezzanotte (fuso di Roma) del giorno ISO, come timestamptz. */
export function romeDayStart(iso: string): SQL {
  return sql`((${iso})::date)::timestamp at time zone ${TIME_ZONE}`;
}

/** Richiesta ricevuta tra `da` e `a` inclusi (giorni di calendario italiani). */
export function receivedBetween(da: string, a: string): SQL {
  return sql`(${sampleRequests.receivedAt} >= ${romeDayStart(da)} and ${sampleRequests.receivedAt} < ${romeDayStart(addDays(a, 1))})`;
}

/** Richiesta spedita (Spedita o Completata) con data di spedizione tra `da` e `a` inclusi. */
export function shippedBetween(da: string, a: string): SQL {
  return and(
    inArray(sampleRequests.status, SHIPPED_STATUSES),
    gte(sampleRequests.shipmentDate, da),
    lte(sampleRequests.shipmentDate, a),
  )!;
}
