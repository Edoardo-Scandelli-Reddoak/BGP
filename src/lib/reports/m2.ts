import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contacts, pieces, products, sampleRequests, type RequestStatus } from "@/db/schema";
import { shippedBetween } from "./conditions";
import { monthEnd, monthStart } from "./period";

export type M2ProductRow = {
  productId: number;
  code: string;
  description: string;
  brand: string | null;
  /** Richieste distinte che contengono pezzi di questo prodotto. */
  requests: number;
  pieces: number;
  m2: number;
};

export type M2Shipment = {
  id: number;
  status: RequestStatus;
  shipmentDate: string | null;
  contactName: string;
  country: string | null;
  pieces: number;
  m2: number;
};

export type MonthlyM2Report = {
  month: string;
  rows: M2ProductRow[];
  shipments: M2Shipment[];
  totals: { requests: number; pieces: number; m2: number; products: number };
  /** Spedizioni del mese senza misure registrate (non contribuiscono ai m²). */
  shipmentsWithoutPieces: number;
};

/**
 * Report m² del mese per il CRM. Regola: i m² contano nel mese della data di spedizione
 * della richiesta (stato Spedita o Completata); i m² vengono dai pezzi misurati dal magazzino.
 */
export async function getMonthlyM2Report(month: string): Promise<MonthlyM2Report> {
  const inMonth = shippedBetween(monthStart(month), monthEnd(month));
  const m2Sum = sql<number>`coalesce(sum(${pieces.areaM2}), 0)::float8`.mapWith(Number);
  const qtySum = sql<number>`coalesce(sum(${pieces.quantity}), 0)::int`.mapWith(Number);

  const [rows, shipments] = await Promise.all([
    db
      .select({
        productId: products.id,
        code: products.code,
        description: products.description,
        brand: products.brand,
        requests: sql<number>`count(distinct ${pieces.requestId})::int`.mapWith(Number),
        pieces: qtySum,
        m2: m2Sum,
      })
      .from(pieces)
      .innerJoin(sampleRequests, eq(sampleRequests.id, pieces.requestId))
      .innerJoin(products, eq(products.id, pieces.productId))
      .where(inMonth)
      .groupBy(products.id)
      .orderBy(sql`sum(${pieces.areaM2}) desc`, asc(products.code)),
    db
      .select({
        id: sampleRequests.id,
        status: sampleRequests.status,
        shipmentDate: sampleRequests.shipmentDate,
        contactName: contacts.name,
        country: contacts.country,
        pieces: qtySum,
        m2: m2Sum,
      })
      .from(sampleRequests)
      .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
      .leftJoin(pieces, eq(pieces.requestId, sampleRequests.id))
      .where(inMonth)
      .groupBy(sampleRequests.id, contacts.id)
      .orderBy(asc(sampleRequests.shipmentDate), asc(sampleRequests.id)),
  ]);

  const withPieces = shipments.filter((s) => s.pieces > 0).length;
  return {
    month,
    rows,
    shipments,
    totals: {
      requests: withPieces,
      pieces: rows.reduce((s, r) => s + r.pieces, 0),
      m2: rows.reduce((s, r) => s + r.m2, 0),
      products: rows.length,
    },
    shipmentsWithoutPieces: shipments.length - withPieces,
  };
}
