import "server-only";
import { asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { pieces, requestItems, sampleRequests, type RequestStatus } from "@/db/schema";

/**
 * Dati della coda magazzino: una query relazionale (richiesta + contatto + prodotti richiesti)
 * e un'aggregazione dei pezzi misurati per tutte le richieste mostrate.
 */

export type WarehouseCard = {
  id: number;
  status: RequestStatus;
  receivedAt: Date;
  /** Momento in cui è stata segnata pronta (solo per «Pronta per il ritiro»). */
  readyAt: Date | null;
  contactName: string;
  contactCompany: string | null;
  destinationAddress: string;
  notes: string | null;
  deliveryFormRequired: boolean;
  packagesCount: number | null;
  weightKg: number | null;
  items: { id: number; quantity: number; code: string; description: string }[];
  /** Righe di misura, pezzi (somma quantità) e m² registrati. */
  pieceRows: number;
  piecesCount: number;
  totalM2: number;
};

const READY_AT_SQL = (id: unknown) =>
  // Alias esplicito: nelle query relazionali Drizzle riscrive i riferimenti alle colonne con l'alias esterno.
  sql`(select extract(epoch from max(se.created_at)) * 1000 from status_events se where se.request_id = ${id} and se.to_status = 'PRONTA_RITIRO')`;

async function loadCards(status: "IN_PREPARAZIONE" | "PRONTA_RITIRO", limit?: number): Promise<WarehouseCard[]> {
  const rows = await db.query.sampleRequests.findMany({
    where: eq(sampleRequests.status, status),
    columns: {
      id: true,
      status: true,
      receivedAt: true,
      destinationAddress: true,
      notes: true,
      deliveryFormRequired: true,
      packagesCount: true,
      weightKg: true,
    },
    with: {
      contact: { columns: { name: true, company: true } },
      items: {
        columns: { id: true, quantity: true },
        with: { product: { columns: { code: true, description: true } } },
        orderBy: [asc(requestItems.id)],
      },
    },
    extras: (t) => ({
      readyAtMs: sql<number | string | null>`${READY_AT_SQL(t.id)}`.as("ready_at_ms"),
    }),
    // Coda: dalla più vecchia. Pronte: dalla più recente (momento del passaggio di stato).
    orderBy: (t, { asc: up, desc: down }) =>
      status === "IN_PREPARAZIONE" ? [up(t.receivedAt), up(t.id)] : [down(READY_AT_SQL(t.id)), down(t.id)],
    limit,
  });
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const aggregates = await db
    .select({
      requestId: pieces.requestId,
      rows: count(),
      pieces: sql<number>`coalesce(sum(${pieces.quantity}), 0)`.mapWith(Number),
      m2: sql<number>`coalesce(sum(${pieces.areaM2}), 0)`.mapWith(Number),
    })
    .from(pieces)
    .where(inArray(pieces.requestId, ids))
    .groupBy(pieces.requestId);
  const byRequest = new Map(aggregates.map((a) => [a.requestId, a]));

  return rows.map((r) => {
    const agg = byRequest.get(r.id);
    const readyMs = r.readyAtMs === null ? null : Number(r.readyAtMs);
    return {
      id: r.id,
      status: r.status,
      receivedAt: r.receivedAt,
      readyAt: readyMs !== null && Number.isFinite(readyMs) ? new Date(readyMs) : null,
      contactName: r.contact?.name ?? "—",
      contactCompany: r.contact?.company ?? null,
      destinationAddress: r.destinationAddress,
      notes: r.notes,
      deliveryFormRequired: r.deliveryFormRequired,
      packagesCount: r.packagesCount,
      weightKg: r.weightKg,
      items: r.items.map((i) => ({
        id: i.id,
        quantity: i.quantity,
        code: i.product.code,
        description: i.product.description,
      })),
      pieceRows: agg?.rows ?? 0,
      piecesCount: agg?.pieces ?? 0,
      totalM2: agg?.m2 ?? 0,
    };
  });
}

/** Richieste «In preparazione», dalla più vecchia. */
export function getWarehouseQueue(): Promise<WarehouseCard[]> {
  return loadCards("IN_PREPARAZIONE");
}

/** Ultime richieste «Pronta per il ritiro» (per eventuali correzioni del magazzino). */
export function getRecentlyReady(limit = 20): Promise<WarehouseCard[]> {
  return loadCards("PRONTA_RITIRO", limit);
}

/** Totale delle richieste «Pronta per il ritiro» (l'elenco ne mostra al massimo 20). */
export async function countReady(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(sampleRequests).where(eq(sampleRequests.status, "PRONTA_RITIRO"));
  return row?.n ?? 0;
}
