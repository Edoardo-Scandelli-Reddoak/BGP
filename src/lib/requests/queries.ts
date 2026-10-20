import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  emailLog,
  pieces,
  requestItems,
  sampleRequests,
  statusEvents,
} from "@/db/schema";

/**
 * Carica una richiesta con tutto ciò che serve alle pagine di dettaglio, alle email e alla bolla:
 * contatto (+ agente), corriere, prodotti richiesti, pezzi misurati, storico stati, allegati
 * (solo metadati, senza il contenuto del file) ed email inviate.
 */
export async function getRequestDetail(id: number) {
  const request = await db.query.sampleRequests.findFirst({
    where: eq(sampleRequests.id, id),
    with: {
      contact: { with: { agent: true } },
      carrier: true,
      createdBy: { columns: { id: true, name: true, role: true } },
      items: { with: { product: true }, orderBy: [asc(requestItems.id)] },
      pieces: {
        with: { product: true, createdBy: { columns: { id: true, name: true } } },
        orderBy: [asc(pieces.id)],
      },
      events: {
        with: { user: { columns: { id: true, name: true, role: true } } },
        orderBy: [asc(statusEvents.createdAt), asc(statusEvents.id)],
      },
      attachments: {
        columns: {
          id: true,
          kind: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          uploadedById: true,
        },
        orderBy: [desc(attachments.createdAt)],
      },
      emails: { orderBy: [desc(emailLog.createdAt)] },
    },
  });
  if (!request) return null;

  const totalM2 = request.pieces.reduce((sum, p) => sum + Number(p.areaM2 || 0), 0);
  const piecesCount = request.pieces.reduce((sum, p) => sum + p.quantity, 0);
  /** m² per prodotto (per bolla, email e riepiloghi). */
  const m2ByProduct = new Map<number, number>();
  for (const p of request.pieces) {
    m2ByProduct.set(p.productId, (m2ByProduct.get(p.productId) ?? 0) + Number(p.areaM2 || 0));
  }
  const ddtAttachment = request.attachments.find((a) => a.kind === "DDT") ?? null;

  return {
    ...request,
    totalM2: Math.round(totalM2 * 10000) / 10000,
    piecesCount,
    m2ByProduct,
    ddtAttachment,
  };
}

export type RequestDetail = NonNullable<Awaited<ReturnType<typeof getRequestDetail>>>;

/** Contenuto di un allegato (per download e per l'invio in email). */
export async function getAttachmentFile(attachmentId: number) {
  const rows = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  return rows[0] ?? null;
}
