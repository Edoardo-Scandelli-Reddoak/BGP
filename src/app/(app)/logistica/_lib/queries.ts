import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  carriers,
  contacts,
  emailLog,
  pieces,
  requestItems,
  sampleRequests,
  statusEvents,
  type RequestStatus,
} from "@/db/schema";

/** Esiste un DDT caricato per la richiesta (sottoquery correlata, senza leggere il file). */
const hasDdtSql = sql<boolean>`exists (select 1 from ${attachments} where ${attachments.requestId} = ${sampleRequests.id} and ${attachments.kind} = 'DDT')`;

/** Quando la richiesta è entrata (l'ultima volta) nello stato indicato. */
function enteredStatusAt(status: RequestStatus) {
  return sql<Date | null>`(select max(${statusEvents.createdAt}) from ${statusEvents} where ${statusEvents.requestId} = ${sampleRequests.id} and ${statusEvents.toStatus} = ${status})`.mapWith(
    statusEvents.createdAt,
  );
}

const LIST_LIMIT = 200;

/** Vista «Pronte per il ritiro»: dalla più vecchia. */
export async function listReadyForPickup() {
  return db
    .select({
      id: sampleRequests.id,
      receivedAt: sampleRequests.receivedAt,
      destinationAddress: sampleRequests.destinationAddress,
      packagesCount: sampleRequests.packagesCount,
      weightKg: sampleRequests.weightKg,
      deliveryFormRequired: sampleRequests.deliveryFormRequired,
      deliveryFormReady: sampleRequests.deliveryFormReady,
      ddtNumber: sampleRequests.ddtNumber,
      pickupDate: sampleRequests.pickupDate,
      contactName: contacts.name,
      contactCountry: contacts.country,
      carrierName: carriers.name,
      hasDdt: hasDdtSql,
      readySince: enteredStatusAt("PRONTA_RITIRO"),
    })
    .from(sampleRequests)
    .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
    .leftJoin(carriers, eq(carriers.id, sampleRequests.carrierId))
    .where(eq(sampleRequests.status, "PRONTA_RITIRO"))
    .orderBy(asc(sampleRequests.receivedAt), asc(sampleRequests.id))
    .limit(LIST_LIMIT);
}

export type ReadyForPickupRow = Awaited<ReturnType<typeof listReadyForPickup>>[number];

/** Vista «Bolle da preparare»: tutto ciò che serve per compilare il documento, in una sola query. */
export async function listDeliveryForms() {
  const rows = await db.query.sampleRequests.findMany({
    where: and(eq(sampleRequests.status, "PRONTA_RITIRO"), eq(sampleRequests.deliveryFormRequired, true)),
    orderBy: [asc(sampleRequests.receivedAt), asc(sampleRequests.id)],
    limit: 100,
    with: {
      contact: { with: { agent: { columns: { id: true, name: true, email: true } } } },
      carrier: { columns: { id: true, name: true } },
      items: {
        with: { product: { columns: { id: true, code: true, description: true } } },
        orderBy: [asc(requestItems.id)],
      },
      pieces: {
        with: { product: { columns: { id: true, code: true } } },
        orderBy: [asc(pieces.id)],
      },
      attachments: {
        columns: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
        orderBy: [desc(attachments.createdAt)],
      },
    },
  });
  return rows.map((r) => {
    const m2ByProduct = new Map<number, number>();
    for (const p of r.pieces) m2ByProduct.set(p.productId, (m2ByProduct.get(p.productId) ?? 0) + Number(p.areaM2 || 0));
    const ddtAttachment = r.attachments.find((a) => a.kind === "DDT") ?? null;
    return {
      ...r,
      m2ByProduct,
      totalM2: r.pieces.reduce((sum, p) => sum + Number(p.areaM2 || 0), 0),
      piecesCount: r.pieces.reduce((sum, p) => sum + p.quantity, 0),
      ddtAttachment,
      bollaReady: r.deliveryFormReady || Boolean(r.ddtNumber?.trim()) || ddtAttachment !== null,
    };
  });
}

export type DeliveryFormRow = Awaited<ReturnType<typeof listDeliveryForms>>[number];

/** Vista «Spedite: manca tracking», con l'esito dell'ultima conferma di spedizione tentata. */
export async function listShippedAwaitingTracking() {
  const rows = await db
    .select({
      id: sampleRequests.id,
      pickupDate: sampleRequests.pickupDate,
      trackingNumber: sampleRequests.trackingNumber,
      shipmentDate: sampleRequests.shipmentDate,
      deliveryFormRequired: sampleRequests.deliveryFormRequired,
      contactName: contacts.name,
      contactEmail: contacts.email,
      carrierName: carriers.name,
      shippedAt: enteredStatusAt("SPEDITA"),
    })
    .from(sampleRequests)
    .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
    .leftJoin(carriers, eq(carriers.id, sampleRequests.carrierId))
    .where(eq(sampleRequests.status, "SPEDITA"))
    .orderBy(asc(sampleRequests.pickupDate), asc(sampleRequests.id))
    .limit(LIST_LIMIT);

  const ids = rows.map((r) => r.id);
  const lastEmails = ids.length
    ? await db
        .selectDistinctOn([emailLog.requestId], {
          requestId: emailLog.requestId,
          status: emailLog.status,
          error: emailLog.error,
          createdAt: emailLog.createdAt,
        })
        .from(emailLog)
        .where(and(inArray(emailLog.requestId, ids), eq(emailLog.kind, "CONFERMA_SPEDIZIONE")))
        .orderBy(emailLog.requestId, desc(emailLog.createdAt), desc(emailLog.id))
    : [];
  const byRequest = new Map(lastEmails.map((e) => [e.requestId, e]));
  return rows.map((r) => ({ ...r, lastConfirmation: byRequest.get(r.id) ?? null }));
}

export type ShippedRow = Awaited<ReturnType<typeof listShippedAwaitingTracking>>[number];

/** Ultime richieste completate (eventualmente solo quelle senza costo di spedizione). */
export async function listRecentlyCompleted(options: { missingCostOnly: boolean; limit?: number }) {
  const where = options.missingCostOnly
    ? and(eq(sampleRequests.status, "COMPLETATA"), isNull(sampleRequests.shippingCost))
    : eq(sampleRequests.status, "COMPLETATA");
  return db
    .select({
      id: sampleRequests.id,
      updatedAt: sampleRequests.updatedAt,
      shipmentDate: sampleRequests.shipmentDate,
      trackingNumber: sampleRequests.trackingNumber,
      completedAt: sampleRequests.completedAt,
      notificationSentAt: sampleRequests.notificationSentAt,
      shippingCost: sampleRequests.shippingCost,
      ddtNumber: sampleRequests.ddtNumber,
      contactName: contacts.name,
      carrierName: carriers.name,
    })
    .from(sampleRequests)
    .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
    .leftJoin(carriers, eq(carriers.id, sampleRequests.carrierId))
    .where(where)
    .orderBy(sql`${sampleRequests.completedAt} desc nulls last`, desc(sampleRequests.id))
    .limit(options.limit ?? 30);
}

export type CompletedRow = Awaited<ReturnType<typeof listRecentlyCompleted>>[number];

/** Quante richieste completate non hanno ancora il costo di spedizione. */
export async function countCompletedWithoutCost(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(sampleRequests)
    .where(and(eq(sampleRequests.status, "COMPLETATA"), isNull(sampleRequests.shippingCost)));
  return row?.n ?? 0;
}
