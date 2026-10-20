import "server-only";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attachments,
  carriers,
  contacts,
  pieces,
  products,
  requestItems,
  sampleRequests,
  statusEvents,
  type RequestStatus,
} from "@/db/schema";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import type { SessionUser } from "@/lib/auth/session";
import { sendRequestNotification, type NotificationResult } from "@/lib/email/notifications";
import { parseEmailList } from "@/lib/email/recipients";
import { TIME_ZONE, todayIso } from "@/lib/format";
import { can } from "@/lib/roles";
import { SAMPLE_FORMATS, sampleFormatMissing } from "@/lib/sample-formats";
import { nextStatus, previousStatus, STATUS_LABELS } from "@/lib/status";
import { dbId } from "@/lib/validation";
import { mergeItems, normalizeMultiline, optionalText } from "./input";
import {
  bollaSatisfied,
  EDITABLE_IN,
  shouldSendShipmentConfirmation,
  transitionPermission,
  transitionProblems,
  type TransitionOptions,
  type WorkflowSnapshot,
} from "./workflow";

/**
 * Servizio di dominio delle richieste campioni.
 * Tutte le modifiche passano da qui: permessi, stato ammesso, validazione, storico, email automatiche.
 * Le server action delle pagine si limitano a leggere il form e chiamare queste funzioni.
 */

type Actor = SessionUser;
type Result<T = undefined> = ActionResult<T>;

const DENIED = "Non hai i permessi per questa operazione.";
const NOT_FOUND = "Richiesta non trovata.";

/* ------------------------------------------------------------------ */
/* Schemi di input (riusabili dalle server action)                     */
/* ------------------------------------------------------------------ */

/**
 * Id obbligatorio (contatto, prodotto): se manca o non è un numero il messaggio è quello indicato;
 * il controllo dei limiti di Postgres resta quello comune di `dbId`.
 */
const requiredId = (message: string) =>
  z
    .unknown()
    .refine((v) => {
      const n = typeof v === "string" ? (v.trim() === "" ? NaN : Number(v)) : Number(v);
      return Number.isInteger(n) && n > 0;
    }, message)
    .pipe(dbId);

/** Data 'YYYY-MM-DD'; un <input type="date"> vuoto invia "" e diventa null. */
const isoDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida")
    .nullish()
    .transform((v) => (v ? v : null)),
);

export const requestItemInput = z
  .object({
    productId: requiredId("Prodotto non valido"),
    quantity: z.coerce.number().int("Quantità non valida").min(1, "Quantità minima 1").max(9999, "Quantità troppo alta"),
    /** Formato del campione: si può salvare una bozza senza, ma serve per inviarla al magazzino. */
    sampleFormat: z.preprocess(
      (v) => (v === "" ? null : v),
      z.enum(SAMPLE_FORMATS, { error: "Formato non valido" }).nullish(),
    ),
    formatNote: optionalText(200),
    notes: optionalText(500),
  })
  .refine((i) => i.sampleFormat !== "ALTRO" || Boolean(i.formatNote), {
    path: ["formatNote"],
    message: "Descrivi il formato richiesto",
  });

export const requestInfoInput = z.object({
  contactId: requiredId("Seleziona il contatto"),
  /** Ragione sociale della ditta o cognome e nome del destinatario. */
  recipientName: z.string().trim().min(1, "Indica il destinatario").max(200, "Massimo 200 caratteri"),
  /** Persona a cui è destinata la spedizione, se il destinatario è una ditta. */
  attentionOf: optionalText(200),
  destinationAddress: z
    .string()
    .trim()
    .min(1, "Indica l'indirizzo di consegna")
    .max(2000)
    .transform(normalizeMultiline),
  /** Preavviso telefonico prima della consegna: null = non ancora indicato. */
  phoneNotice: z.boolean().nullish().transform((v) => v ?? null),
  phoneNoticeNumber: optionalText(50),
  notes: optionalText(5000),
  deliveryFormRequired: z.boolean(),
  /** Data di ricezione (se la richiesta è arrivata per telefono/email in un giorno precedente). */
  receivedAt: isoDate.refine((v) => !v || v <= todayIso(), "La data di ricezione non può essere nel futuro"),
  items: z
    .array(requestItemInput)
    .min(1, "Aggiungi almeno un prodotto")
    .max(100, "Troppi prodotti in una sola richiesta"),
}).superRefine((v, ctx) => {
  if (v.phoneNotice === true && !v.phoneNoticeNumber) {
    ctx.addIssue({ code: "custom", path: ["phoneNoticeNumber"], message: "Indica il numero per il preavviso" });
  }
});
export type RequestInfoInput = z.input<typeof requestInfoInput>;

export const warehouseInput = z.object({
  packagesCount: z.coerce.number().int("Numero colli non valido").min(0).max(999).nullish(),
  weightKg: z.coerce.number().min(0, "Peso non valido").max(99999, "Peso troppo alto").nullish(),
  warehouseNotes: optionalText(2000),
});
export type WarehouseInput = z.input<typeof warehouseInput>;

export const pieceInput = z.object({
  productId: requiredId("Seleziona il prodotto"),
  lengthCm: z.coerce.number().gt(0, "La lunghezza deve essere maggiore di 0").max(10000, "Lunghezza troppo alta"),
  widthCm: z.coerce.number().gt(0, "La larghezza deve essere maggiore di 0").max(10000, "Larghezza troppo alta"),
  quantity: z.coerce.number().int().min(1, "Quantità minima 1").max(999).default(1),
  conditionNote: optionalText(500),
});
export type PieceInput = z.input<typeof pieceInput>;

export const logisticsInput = z.object({
  carrierId: dbId.nullish(),
  pickupDate: isoDate,
  trackingNumber: optionalText(100),
  shipmentDate: isoDate,
  ddtNumber: optionalText(50),
  deliveryFormReady: z.boolean().optional(),
  shippingCost: z.coerce.number().min(0, "Costo non valido").max(100000).nullish(),
  logisticsNotes: optionalText(2000),
});
export type LogisticsInput = z.input<typeof logisticsInput>;

export const DDT_MAX_BYTES = 10 * 1024 * 1024;
export const DDT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];

/* ------------------------------------------------------------------ */
/* Helpers interni                                                     */
/* ------------------------------------------------------------------ */

async function loadSnapshot(id: number) {
  const req = await db.query.sampleRequests.findFirst({
    where: eq(sampleRequests.id, id),
    with: { contact: { columns: { id: true, email: true } } },
  });
  if (!req) return null;
  const [itemRows, [pieceAgg], [ddt]] = await Promise.all([
    db
      .select({ sampleFormat: requestItems.sampleFormat, formatNote: requestItems.formatNote })
      .from(requestItems)
      .where(eq(requestItems.requestId, id)),
    db.select({ n: count() }).from(pieces).where(eq(pieces.requestId, id)),
    db
      .select({ n: count() })
      .from(attachments)
      .where(and(eq(attachments.requestId, id), eq(attachments.kind, "DDT"))),
  ]);
  const snapshot: WorkflowSnapshot = {
    status: req.status,
    contactId: req.contactId,
    contactHasEmail: parseEmailList(req.contact?.email).length > 0,
    recipientName: req.recipientName,
    destinationAddress: req.destinationAddress,
    phoneNotice: req.phoneNotice,
    phoneNoticeNumber: req.phoneNoticeNumber,
    itemsCount: itemRows.length,
    itemsMissingFormat: itemRows.filter((i) => sampleFormatMissing(i.sampleFormat, i.formatNote)).length,
    packagesCount: req.packagesCount,
    weightKg: req.weightKg,
    piecesCount: pieceAgg.n,
    deliveryFormRequired: req.deliveryFormRequired,
    deliveryFormReady: req.deliveryFormReady,
    carrierId: req.carrierId,
    pickupDate: req.pickupDate,
    ddtNumber: req.ddtNumber,
    hasDdtAttachment: ddt.n > 0,
    trackingNumber: req.trackingNumber,
    shipmentDate: req.shipmentDate,
    notificationSentAt: req.notificationSentAt,
  };
  return { request: req, snapshot };
}

/** Snapshot del flusso per i pannelli UI (cosa manca per avanzare). */
export async function getWorkflowSnapshot(id: number): Promise<WorkflowSnapshot | null> {
  return (await loadSnapshot(id))?.snapshot ?? null;
}

function statusError(status: RequestStatus, action: string): Result<never> {
  return fail(`Non puoi ${action}: la richiesta è nello stato «${STATUS_LABELS[status]}».`);
}

async function validateContact(contactId: number): Promise<string | null> {
  const [c] = await db
    .select({ id: contacts.id, active: contacts.active })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!c) return "Contatto non trovato.";
  if (!c.active) return "Il contatto selezionato è disattivato.";
  return null;
}

async function validateProducts(productIds: number[], allowInactiveIds: number[] = []): Promise<string | null> {
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return null;
  const rows = await db
    .select({ id: products.id, code: products.code, active: products.active })
    .from(products)
    .where(inArray(products.id, unique));
  if (rows.length !== unique.length) return "Uno o più prodotti non esistono più.";
  const inactive = rows.filter((r) => !r.active && !allowInactiveIds.includes(r.id));
  if (inactive.length) return `Prodotti non attivi: ${inactive.map((r) => r.code).join(", ")}.`;
  return null;
}

async function hasDdtAttachment(id: number): Promise<boolean> {
  const [ddt] = await db
    .select({ n: count() })
    .from(attachments)
    .where(and(eq(attachments.requestId, id), eq(attachments.kind, "DDT")));
  return ddt.n > 0;
}

function receivedAtFrom(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  // Stessa giornata: teniamo l'ora attuale; giorno precedente: mezzogiorno (ora di Roma) di quel giorno.
  return iso === todayIso() ? new Date() : romeNoon(iso);
}

/** Mezzogiorno del giorno indicato nel fuso Europe/Rome, indipendente dal fuso del server. */
function romeNoon(iso: string): Date {
  const utcNoon = new Date(`${iso}T12:00:00Z`);
  const romeHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hour12: false }).format(utcNoon),
  );
  return new Date(utcNoon.getTime() - (romeHour - 12) * 3600_000);
}

function notificationMessage(n: NotificationResult | null, okText: string): string | undefined {
  if (!n) return undefined;
  if (n.status === "INVIATA") return `${okText} (${n.to.join(", ")}).`;
  if (n.status === "SIMULATA") return `${okText} — modalità prova: email registrata ma non inviata.`;
  return `Attenzione: email non inviata — ${n.error}. Controlla il registro email.`;
}

/* ------------------------------------------------------------------ */
/* Back office: creazione e modifica                                   */
/* ------------------------------------------------------------------ */

export async function createRequest(
  actor: Actor,
  rawInput: RequestInfoInput,
  options: { sendToWarehouse?: boolean } = {},
): Promise<Result<{ id: number }>> {
  if (!can(actor.role, "requests.manage")) return fail(DENIED);
  const parsed = requestInfoInput.safeParse(rawInput);
  if (!parsed.success) return fail("Controlla i campi evidenziati.", zodFieldErrors(parsed.error.issues));
  const input = parsed.data;

  const contactErr = await validateContact(input.contactId);
  if (contactErr) return fail(contactErr, { contactId: contactErr });
  const items = mergeItems(input.items);
  const productErr = await validateProducts(items.map((i) => i.productId));
  if (productErr) return fail(productErr, { items: productErr });

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(sampleRequests)
      .values({
        contactId: input.contactId,
        recipientName: input.recipientName,
        attentionOf: input.attentionOf,
        destinationAddress: input.destinationAddress,
        phoneNotice: input.phoneNotice,
        phoneNoticeNumber: input.phoneNotice === false ? null : input.phoneNoticeNumber,
        notes: input.notes,
        deliveryFormRequired: input.deliveryFormRequired,
        receivedAt: receivedAtFrom(input.receivedAt),
        source: "INTERNO",
        createdById: actor.id,
      })
      .returning({ id: sampleRequests.id });
    await tx.insert(requestItems).values(items.map((i) => ({ ...i, requestId: row.id })));
    await tx.insert(statusEvents).values({ requestId: row.id, fromStatus: null, toStatus: "NUOVA", userId: actor.id });
    return row.id;
  });

  if (options.sendToWarehouse) {
    const res = await advanceStatus(actor, id, "IN_PREPARAZIONE");
    if (!res.ok) {
      return { ok: true, data: { id }, message: `Richiesta salvata, ma non inviata al magazzino: ${res.error}` };
    }
    return { ok: true, data: { id }, message: res.message ?? "Richiesta creata e inviata al magazzino." };
  }
  return { ok: true, data: { id }, message: "Richiesta salvata." };
}

export async function updateRequestInfo(actor: Actor, id: number, rawInput: RequestInfoInput): Promise<Result> {
  if (!can(actor.role, "requests.manage")) return fail(DENIED);
  const parsed = requestInfoInput.safeParse(rawInput);
  if (!parsed.success) return fail("Controlla i campi evidenziati.", zodFieldErrors(parsed.error.issues));
  const input = parsed.data;

  const current = await db.query.sampleRequests.findFirst({
    where: eq(sampleRequests.id, id),
    with: { items: true, pieces: { columns: { productId: true } } },
  });
  if (!current) return fail(NOT_FOUND);
  if (!EDITABLE_IN.info.includes(current.status)) return statusError(current.status, "modificare i dati");

  const contactErr = await validateContact(input.contactId);
  if (contactErr && input.contactId !== current.contactId) return fail(contactErr, { contactId: contactErr });

  const items = mergeItems(input.items);
  const itemKey = (i: { productId: number; sampleFormat?: string | null; formatNote?: string | null }) =>
    [i.productId, i.sampleFormat ?? "", i.formatNote?.trim() || ""].join("|");
  const before = new Map(current.items.map((i) => [itemKey(i), i]));
  const itemsChanged =
    items.length !== current.items.length ||
    items.some((i) => {
      const b = before.get(itemKey(i));
      return !b || b.quantity !== i.quantity || (b.notes?.trim() || null) !== (i.notes ?? null);
    });

  if (itemsChanged) {
    if (!EDITABLE_IN.items.includes(current.status)) {
      return statusError(current.status, "modificare i prodotti richiesti");
    }
    const productErr = await validateProducts(
      items.map((i) => i.productId),
      current.items.map((i) => i.productId),
    );
    if (productErr) return fail(productErr, { items: productErr });
    const keep = new Set(items.map((i) => i.productId));
    const measured = [...new Set(current.pieces.map((p) => p.productId))].filter((pid) => !keep.has(pid));
    if (measured.length) {
      return fail("Non puoi togliere un prodotto che ha già pezzi misurati: elimina prima i pezzi dal magazzino.");
    }
  }

  const saved = await db.transaction(async (tx) => {
    const rows = await tx
      .update(sampleRequests)
      .set({
        contactId: input.contactId,
        recipientName: input.recipientName,
        attentionOf: input.attentionOf,
        destinationAddress: input.destinationAddress,
        phoneNotice: input.phoneNotice,
        phoneNoticeNumber: input.phoneNotice === false ? null : input.phoneNoticeNumber,
        notes: input.notes,
        deliveryFormRequired: input.deliveryFormRequired,
        ...(input.receivedAt ? { receivedAt: receivedAtFrom(input.receivedAt) } : {}),
      })
      .where(and(eq(sampleRequests.id, id), eq(sampleRequests.status, current.status)))
      .returning({ id: sampleRequests.id });
    if (rows.length === 0) return false;
    if (itemsChanged) {
      await tx.delete(requestItems).where(eq(requestItems.requestId, id));
      await tx.insert(requestItems).values(items.map((i) => ({ ...i, requestId: id })));
    }
    return true;
  });
  if (!saved) return fail("La richiesta è stata modificata da un altro utente: ricarica la pagina.");

  // Automazione 3 ("bolla richiesta" E "Pronta per il ritiro"): scatta anche quando la bolla viene
  // richiesta su una richiesta già pronta, se la logistica non l'ha ancora preparata.
  if (current.status === "PRONTA_RITIRO" && !current.deliveryFormRequired && input.deliveryFormRequired) {
    const bollaReady = bollaSatisfied({
      deliveryFormRequired: true,
      deliveryFormReady: current.deliveryFormReady,
      ddtNumber: current.ddtNumber,
      hasDdtAttachment: await hasDdtAttachment(id),
    });
    if (!bollaReady) {
      const n = await sendRequestNotification("AVVISO_BOLLA", id, actor.id);
      return {
        ok: true,
        message: `Dati della richiesta aggiornati. ${notificationMessage(n, "Avviso bolla inviato alla logistica") ?? ""}`.trim(),
      };
    }
  }
  return { ok: true, message: "Dati della richiesta aggiornati." };
}

/** Eliminazione consentita solo per le richieste ancora «Nuova richiesta» (es. doppioni, spam dal modulo). */
export async function deleteRequest(actor: Actor, id: number): Promise<Result> {
  if (!can(actor.role, "requests.manage")) return fail(DENIED);
  const deleted = await db
    .delete(sampleRequests)
    .where(and(eq(sampleRequests.id, id), eq(sampleRequests.status, "NUOVA")))
    .returning({ id: sampleRequests.id });
  if (deleted.length === 0) return fail("Si possono eliminare solo le richieste nello stato «Nuova richiesta».");
  return { ok: true, message: "Richiesta eliminata." };
}

/* ------------------------------------------------------------------ */
/* Magazzino                                                           */
/* ------------------------------------------------------------------ */

async function requireWarehouseEditable(actor: Actor, id: number): Promise<Result | null> {
  if (!can(actor.role, "warehouse.work")) return fail(DENIED);
  const [row] = await db
    .select({ status: sampleRequests.status })
    .from(sampleRequests)
    .where(eq(sampleRequests.id, id))
    .limit(1);
  if (!row) return fail(NOT_FOUND);
  if (!EDITABLE_IN.warehouse.includes(row.status)) return statusError(row.status, "modificare i dati di magazzino");
  return null;
}

export async function updateWarehouseData(actor: Actor, id: number, rawInput: WarehouseInput): Promise<Result> {
  const denied = await requireWarehouseEditable(actor, id);
  if (denied) return denied;
  const parsed = warehouseInput.safeParse(rawInput);
  if (!parsed.success) return fail("Controlla i campi evidenziati.", zodFieldErrors(parsed.error.issues));
  const [current] = await db
    .select({ status: sampleRequests.status })
    .from(sampleRequests)
    .where(eq(sampleRequests.id, id))
    .limit(1);
  if (current.status !== "IN_PREPARAZIONE") {
    // La richiesta è già pronta per il ritiro: non si possono svuotare i dati che l'hanno resa tale.
    const fieldErrors: Record<string, string> = {};
    if (!parsed.data.packagesCount) fieldErrors.packagesCount = "Obbligatorio dopo «Pronta per il ritiro»";
    if (!parsed.data.weightKg) fieldErrors.weightKg = "Obbligatorio dopo «Pronta per il ritiro»";
    if (Object.keys(fieldErrors).length) return fail("Colli e peso sono obbligatori per una richiesta pronta per il ritiro.", fieldErrors);
  }
  await db
    .update(sampleRequests)
    .set({
      packagesCount: parsed.data.packagesCount ?? null,
      weightKg: parsed.data.weightKg ?? null,
      warehouseNotes: parsed.data.warehouseNotes,
    })
    .where(eq(sampleRequests.id, id));
  return { ok: true, message: "Dati di magazzino salvati." };
}

async function validatePieceProduct(requestId: number, productId: number): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(requestItems)
    .where(and(eq(requestItems.requestId, requestId), eq(requestItems.productId, productId)));
  return row.n > 0 ? null : "Il prodotto del pezzo deve essere uno dei prodotti richiesti.";
}

export async function addPiece(actor: Actor, requestId: number, rawInput: PieceInput): Promise<Result<{ id: number }>> {
  const denied = await requireWarehouseEditable(actor, requestId);
  if (denied) return denied as Result<never>;
  const parsed = pieceInput.safeParse(rawInput);
  if (!parsed.success) return fail("Controlla le misure.", zodFieldErrors(parsed.error.issues));
  const productErr = await validatePieceProduct(requestId, parsed.data.productId);
  if (productErr) return fail(productErr, { productId: productErr });
  const [row] = await db
    .insert(pieces)
    .values({ ...parsed.data, requestId, createdById: actor.id })
    .returning({ id: pieces.id });
  return { ok: true, data: { id: row.id }, message: "Pezzo aggiunto." };
}

export async function updatePiece(actor: Actor, pieceId: number, rawInput: PieceInput): Promise<Result> {
  const [piece] = await db.select({ requestId: pieces.requestId }).from(pieces).where(eq(pieces.id, pieceId)).limit(1);
  if (!piece) return fail("Pezzo non trovato.");
  const denied = await requireWarehouseEditable(actor, piece.requestId);
  if (denied) return denied;
  const parsed = pieceInput.safeParse(rawInput);
  if (!parsed.success) return fail("Controlla le misure.", zodFieldErrors(parsed.error.issues));
  const productErr = await validatePieceProduct(piece.requestId, parsed.data.productId);
  if (productErr) return fail(productErr, { productId: productErr });
  await db.update(pieces).set(parsed.data).where(eq(pieces.id, pieceId));
  return { ok: true, message: "Pezzo aggiornato." };
}

export async function deletePiece(actor: Actor, pieceId: number): Promise<Result> {
  const [piece] = await db.select({ requestId: pieces.requestId }).from(pieces).where(eq(pieces.id, pieceId)).limit(1);
  if (!piece) return fail("Pezzo non trovato.");
  const denied = await requireWarehouseEditable(actor, piece.requestId);
  if (denied) return denied;
  await db.delete(pieces).where(eq(pieces.id, pieceId));
  return { ok: true, message: "Pezzo eliminato." };
}

/* ------------------------------------------------------------------ */
/* Logistica                                                           */
/* ------------------------------------------------------------------ */

export async function updateLogisticsData(actor: Actor, id: number, rawInput: LogisticsInput): Promise<Result> {
  if (!can(actor.role, "logistics.work")) return fail(DENIED);
  const parsed = logisticsInput.safeParse(rawInput);
  if (!parsed.success) return fail("Controlla i campi evidenziati.", zodFieldErrors(parsed.error.issues));
  const input = parsed.data;

  const [current] = await db.select().from(sampleRequests).where(eq(sampleRequests.id, id)).limit(1);
  if (!current) return fail(NOT_FOUND);
  if (!EDITABLE_IN.logistics.includes(current.status)) return statusError(current.status, "modificare i dati di spedizione");

  if (input.carrierId) {
    const [c] = await db.select({ id: carriers.id }).from(carriers).where(eq(carriers.id, input.carrierId)).limit(1);
    if (!c) return fail("Corriere non trovato.", { carrierId: "Corriere non trovato" });
  }
  if (input.pickupDate && input.shipmentDate && input.shipmentDate < input.pickupDate) {
    return fail("La data di spedizione non può precedere la data di ritiro.", {
      shipmentDate: "Precede la data di ritiro",
    });
  }
  if (current.status === "SPEDITA") {
    const fieldErrors: Record<string, string> = {};
    if (!input.carrierId) fieldErrors.carrierId = "Obbligatorio per una richiesta spedita";
    if (!input.pickupDate) fieldErrors.pickupDate = "Obbligatoria per una richiesta spedita";
    if (Object.keys(fieldErrors).length) return fail("Corriere e data di ritiro sono obbligatori per una richiesta spedita.", fieldErrors);
  }
  if (current.status === "COMPLETATA") {
    // Dopo la chiusura restano modificabili solo i dati "amministrativi" (il costo arriva spesso dopo)
    // e la data di spedizione, per correggere o completare il mese in cui contano i m².
    // Senza data nel form resta quella salvata: non si può svuotare.
    const shipmentDate = input.shipmentDate ?? current.shipmentDate;
    if (shipmentDate && current.pickupDate && shipmentDate < current.pickupDate) {
      return fail("La data di spedizione non può precedere la data di ritiro.", {
        shipmentDate: "Precede la data di ritiro",
      });
    }
    await db
      .update(sampleRequests)
      .set({
        ddtNumber: input.ddtNumber,
        shippingCost: input.shippingCost ?? null,
        logisticsNotes: input.logisticsNotes,
        shipmentDate,
      })
      .where(eq(sampleRequests.id, id));
    return { ok: true, message: "Dati amministrativi aggiornati." };
  }

  await db
    .update(sampleRequests)
    .set({
      carrierId: input.carrierId ?? null,
      pickupDate: input.pickupDate,
      trackingNumber: input.trackingNumber,
      shipmentDate: input.shipmentDate,
      ddtNumber: input.ddtNumber,
      ...(input.deliveryFormReady !== undefined ? { deliveryFormReady: input.deliveryFormReady } : {}),
      shippingCost: input.shippingCost ?? null,
      logisticsNotes: input.logisticsNotes,
    })
    .where(eq(sampleRequests.id, id));

  if (current.status === "SPEDITA") {
    const confirmation = await maybeSendShipmentConfirmation(actor.id, id);
    if (confirmation) return { ok: true, message: confirmation };
  }
  return { ok: true, message: "Dati di spedizione salvati." };
}

export async function uploadDdt(
  actor: Actor,
  id: number,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<Result> {
  if (!can(actor.role, "logistics.work")) return fail(DENIED);
  const [current] = await db
    .select({ status: sampleRequests.status, notificationSentAt: sampleRequests.notificationSentAt })
    .from(sampleRequests)
    .where(eq(sampleRequests.id, id))
    .limit(1);
  if (!current) return fail(NOT_FOUND);
  if (!EDITABLE_IN.logistics.includes(current.status)) return statusError(current.status, "caricare il DDT");
  if (!DDT_MIME_TYPES.includes(file.type)) return fail("Formato non supportato: carica un PDF, JPG o PNG.");
  if (file.bytes.byteLength === 0) return fail("Il file è vuoto.");
  if (file.bytes.byteLength > DDT_MAX_BYTES) return fail("Il file supera i 10 MB.");

  await db.transaction(async (tx) => {
    await tx.delete(attachments).where(and(eq(attachments.requestId, id), eq(attachments.kind, "DDT")));
    await tx.insert(attachments).values({
      requestId: id,
      kind: "DDT",
      fileName: file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "ddt.pdf",
      mimeType: file.type,
      sizeBytes: file.bytes.byteLength,
      data: Buffer.from(file.bytes),
      uploadedById: actor.id,
    });
  });
  if (current.notificationSentAt) {
    return {
      ok: true,
      message:
        "DDT caricato. La conferma di spedizione è già stata inviata: usa il pulsante di invio della conferma per mandarlo al cliente.",
    };
  }
  if (current.status === "COMPLETATA") {
    return {
      ok: true,
      message: "DDT caricato. La richiesta è stata completata senza conferma email: il DDT resta archiviato nella richiesta.",
    };
  }
  return { ok: true, message: "DDT caricato: verrà allegato alla conferma di spedizione." };
}

export async function deleteDdt(actor: Actor, id: number): Promise<Result> {
  if (!can(actor.role, "logistics.work")) return fail(DENIED);
  const [current] = await db
    .select({ status: sampleRequests.status })
    .from(sampleRequests)
    .where(eq(sampleRequests.id, id))
    .limit(1);
  if (!current) return fail(NOT_FOUND);
  if (!EDITABLE_IN.logistics.includes(current.status)) return statusError(current.status, "rimuovere il DDT");
  await db.delete(attachments).where(and(eq(attachments.requestId, id), eq(attachments.kind, "DDT")));
  return { ok: true, message: "DDT rimosso." };
}

/* ------------------------------------------------------------------ */
/* Flusso di stato                                                     */
/* ------------------------------------------------------------------ */

/**
 * Fa avanzare la richiesta allo stato successivo (`to` deve essere quello successivo),
 * poi esegue le automazioni del blueprint:
 *  - → In preparazione: Automazione 1, avviso al magazzino;
 *  - → Pronta per il ritiro con bolla richiesta: Automazione 3, avviso alla logistica;
 *  - → Spedita: se tracking e data spedizione ci sono già, Automazione 2 e chiusura.
 */
export async function advanceStatus(
  actor: Actor,
  id: number,
  to: RequestStatus,
  options: TransitionOptions & { note?: string | null } = {},
): Promise<Result> {
  const loaded = await loadSnapshot(id);
  if (!loaded) return fail(NOT_FOUND);
  const { snapshot } = loaded;
  const from = snapshot.status;

  const permission = transitionPermission(from);
  if (!permission || nextStatus(from) !== to) {
    return fail(`Passaggio non consentito da «${STATUS_LABELS[from]}» a «${STATUS_LABELS[to]}».`);
  }
  if (!can(actor.role, permission)) return fail(DENIED);

  const problems = transitionProblems(snapshot, to, options);
  if (problems.length) return fail(problems.join(" "));

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(sampleRequests)
      .set({ status: to })
      .where(and(eq(sampleRequests.id, id), eq(sampleRequests.status, from)))
      .returning({ id: sampleRequests.id });
    if (rows.length === 0) return false;
    await tx.insert(statusEvents).values({
      requestId: id,
      fromStatus: from,
      toStatus: to,
      userId: actor.id,
      note: options.note?.trim() || (to === "PRONTA_RITIRO" && snapshot.piecesCount === 0 ? "Nessun pezzo da misurare" : null),
    });
    return true;
  });
  if (!updated) return fail("La richiesta è stata modificata da un altro utente: ricarica la pagina.");

  let message = `Richiesta passata a «${STATUS_LABELS[to]}».`;
  if (to === "IN_PREPARAZIONE") {
    const n = await sendRequestNotification("AVVISO_MAGAZZINO", id, actor.id);
    message = `Richiesta inviata al magazzino. ${notificationMessage(n, "Avviso email al magazzino inviato") ?? ""}`.trim();
  } else if (to === "PRONTA_RITIRO" && snapshot.deliveryFormRequired) {
    const n = await sendRequestNotification("AVVISO_BOLLA", id, actor.id);
    message = `Richiesta pronta per il ritiro. ${notificationMessage(n, "Avviso bolla inviato alla logistica") ?? ""}`.trim();
  } else if (to === "SPEDITA") {
    const confirmation = await maybeSendShipmentConfirmation(actor.id, id);
    message = confirmation
      ? `Richiesta spedita. ${confirmation}`
      : snapshot.notificationSentAt
        ? "Richiesta segnata come spedita. La conferma era già stata inviata: per mandarla di nuovo usa «Invia conferma al cliente», altrimenti «Completa senza email»."
        : "Richiesta segnata come spedita. Inserisci tracking e data di spedizione per inviare la conferma al cliente.";
  }
  return { ok: true, message };
}

/**
 * Automazione 2: se la richiesta è «Spedita» con tracking e data di spedizione e la conferma
 * non è ancora partita, invia l'email al cliente (agente in CC) e chiude la richiesta.
 * La colonna notification_sent_at fa da "lucchetto" per evitare doppi invii concorrenti.
 * Restituisce un messaggio per l'utente, o null se non c'era nulla da fare.
 */
export async function maybeSendShipmentConfirmation(actorId: number | null, id: number): Promise<string | null> {
  const loaded = await loadSnapshot(id);
  if (!loaded || !shouldSendShipmentConfirmation(loaded.snapshot)) return null;
  if (!loaded.snapshot.contactHasEmail) {
    return "Conferma di spedizione NON inviata: il contatto non ha un indirizzo email valido. Aggiungilo in anagrafica e usa «Invia conferma», oppure completa la richiesta senza email.";
  }

  const claimed = await db
    .update(sampleRequests)
    .set({ notificationSentAt: new Date() })
    .where(
      and(eq(sampleRequests.id, id), eq(sampleRequests.status, "SPEDITA"), isNull(sampleRequests.notificationSentAt)),
    )
    .returning({ id: sampleRequests.id });
  if (claimed.length === 0) return null;

  let n: NotificationResult;
  try {
    n = await sendRequestNotification("CONFERMA_SPEDIZIONE", id, actorId);
  } catch (err) {
    await db.update(sampleRequests).set({ notificationSentAt: null }).where(eq(sampleRequests.id, id));
    throw err;
  }
  if (n.status === "ERRORE") {
    await db.update(sampleRequests).set({ notificationSentAt: null }).where(eq(sampleRequests.id, id));
    return `Conferma di spedizione NON inviata: ${n.error}. La richiesta resta «Spedita»: riprova con «Invia conferma».`;
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .update(sampleRequests)
      .set({ status: "COMPLETATA", completedAt: new Date() })
      .where(and(eq(sampleRequests.id, id), eq(sampleRequests.status, "SPEDITA")))
      .returning({ id: sampleRequests.id });
    if (rows.length) {
      await tx.insert(statusEvents).values({
        requestId: id,
        fromStatus: "SPEDITA",
        toStatus: "COMPLETATA",
        userId: null,
        note: `Conferma di spedizione ${n.status === "SIMULATA" ? "simulata" : "inviata"} a ${n.to.join(", ")}`,
      });
    }
  });
  return n.status === "SIMULATA"
    ? "Conferma di spedizione registrata (modalità prova, non inviata). Richiesta completata."
    : `Conferma di spedizione inviata a ${n.to.join(", ")}. Richiesta completata.`;
}

/**
 * «Invia conferma»: nuovo tentativo dopo un errore, o reinvio esplicito anche se già inviata
 * (es. dopo aver caricato il DDT o riaperto la richiesta). Una richiesta «Spedita» si chiude.
 */
export async function resendShipmentConfirmation(actor: Actor, id: number): Promise<Result> {
  if (!can(actor.role, "logistics.work")) return fail(DENIED);
  const loaded = await loadSnapshot(id);
  if (!loaded) return fail(NOT_FOUND);
  const s = loaded.snapshot;
  if (s.status !== "SPEDITA" && s.status !== "COMPLETATA") return statusError(s.status, "inviare la conferma");
  if (!s.trackingNumber?.trim() || !s.shipmentDate) {
    return fail("Inserisci numero di tracking e data di spedizione prima di inviare la conferma.");
  }
  if (s.status === "SPEDITA" && s.notificationSentAt === null) {
    const msg = await maybeSendShipmentConfirmation(actor.id, id);
    const [after] = await db
      .select({ status: sampleRequests.status })
      .from(sampleRequests)
      .where(eq(sampleRequests.id, id))
      .limit(1);
    if (after?.status !== "COMPLETATA") return fail(msg ?? "Conferma non inviata.");
    return { ok: true, message: msg ?? "Conferma inviata." };
  }
  const n = await sendRequestNotification("CONFERMA_SPEDIZIONE", id, actor.id);
  if (n.status === "ERRORE") return fail(`Email non inviata: ${n.error}`);
  const closed = await db.transaction(async (tx) => {
    await tx.update(sampleRequests).set({ notificationSentAt: new Date() }).where(eq(sampleRequests.id, id));
    if (s.status !== "SPEDITA") return false;
    const rows = await tx
      .update(sampleRequests)
      .set({ status: "COMPLETATA", completedAt: new Date() })
      .where(and(eq(sampleRequests.id, id), eq(sampleRequests.status, "SPEDITA")))
      .returning({ id: sampleRequests.id });
    if (rows.length === 0) return false;
    await tx.insert(statusEvents).values({
      requestId: id,
      fromStatus: "SPEDITA",
      toStatus: "COMPLETATA",
      userId: actor.id,
      note: `Conferma di spedizione ${n.status === "SIMULATA" ? "simulata" : "inviata"} di nuovo a ${n.to.join(", ")}`,
    });
    return true;
  });
  const message = notificationMessage(n, "Conferma di spedizione inviata di nuovo");
  return { ok: true, message: closed ? `${message} Richiesta completata.` : message };
}

/**
 * Chiude una richiesta «Spedita» senza email (es. ritiro in sede, consegna a mano, contatto senza email).
 * Senza data di spedizione vale la data di ritiro (obbligatoria per «Spedita»): così i m² entrano
 * nel report del mese in cui i campioni sono partiti.
 */
export async function completeWithoutEmail(actor: Actor, id: number, note: string): Promise<Result> {
  if (!can(actor.role, "logistics.work")) return fail(DENIED);
  if (!note.trim()) return fail("Indica il motivo.", { note: "Indica il motivo" });
  const done = await db.transaction(async (tx) => {
    const rows = await tx
      .update(sampleRequests)
      .set({
        status: "COMPLETATA",
        completedAt: new Date(),
        shipmentDate: sql`coalesce(${sampleRequests.shipmentDate}, ${sampleRequests.pickupDate})`,
      })
      .where(and(eq(sampleRequests.id, id), eq(sampleRequests.status, "SPEDITA")))
      .returning({ id: sampleRequests.id });
    if (rows.length === 0) return false;
    await tx.insert(statusEvents).values({
      requestId: id,
      fromStatus: "SPEDITA",
      toStatus: "COMPLETATA",
      userId: actor.id,
      note: `Completata senza conferma email: ${note.trim()}`,
    });
    return true;
  });
  if (!done) return fail("Si possono completare manualmente solo le richieste «Spedita».");
  return { ok: true, message: "Richiesta completata senza invio della conferma." };
}

/**
 * Correzione: riporta la richiesta allo stato precedente (motivo obbligatorio). Nessuna email automatica.
 * Solo l'amministratore può riaprire una richiesta completata: la conferma già inviata resta registrata,
 * quindi salvare i dati di spedizione non la reinvia; per mandarla di nuovo (e richiudere) si usa
 * «Invia conferma», altrimenti «Completa senza email».
 */
export async function revertStatus(actor: Actor, id: number, note: string): Promise<Result> {
  if (!can(actor.role, "requests.revert")) return fail(DENIED);
  if (!note.trim()) return fail("Indica il motivo della correzione.", { note: "Indica il motivo" });
  const [current] = await db
    .select({ status: sampleRequests.status })
    .from(sampleRequests)
    .where(eq(sampleRequests.id, id))
    .limit(1);
  if (!current) return fail(NOT_FOUND);
  const prev = previousStatus(current.status);
  if (!prev) return fail("La richiesta è già nel primo stato.");
  if (current.status === "COMPLETATA" && actor.role !== "ADMIN") {
    return fail("Solo l'amministratore può riaprire una richiesta completata.");
  }
  const done = await db.transaction(async (tx) => {
    const rows = await tx
      .update(sampleRequests)
      // notification_sent_at resta: niente nuovo invio automatico al prossimo salvataggio della logistica.
      // Una richiesta chiusa con «Completa senza email» non ha conferma registrata e la invierà normalmente.
      .set({ status: prev, ...(current.status === "COMPLETATA" ? { completedAt: null } : {}) })
      .where(and(eq(sampleRequests.id, id), eq(sampleRequests.status, current.status)))
      .returning({ id: sampleRequests.id });
    if (rows.length === 0) return false;
    await tx.insert(statusEvents).values({
      requestId: id,
      fromStatus: current.status,
      toStatus: prev,
      userId: actor.id,
      note: `Correzione: ${note.trim()}`,
    });
    return true;
  });
  if (!done) return fail("La richiesta è stata modificata da un altro utente: ricarica la pagina.");
  return { ok: true, message: `Richiesta riportata a «${STATUS_LABELS[prev]}».` };
}

/* ------------------------------------------------------------------ */
/* Statistiche rapide per i badge della navigazione                    */
/* ------------------------------------------------------------------ */

/**
 * Conteggi per stato; `bolle` = richieste «Pronta per il ritiro» con bolla richiesta e non ancora pronta,
 * con la stessa regola di `bollaSatisfied` (casella «bolla pronta», numero DDT o DDT caricato).
 */
export async function countByStatus(): Promise<Record<RequestStatus, number> & { bolle: number }> {
  const rows = await db
    .select({ status: sampleRequests.status, n: count() })
    .from(sampleRequests)
    .groupBy(sampleRequests.status);
  const [bolle] = await db
    .select({ n: count() })
    .from(sampleRequests)
    .where(
      and(
        eq(sampleRequests.status, "PRONTA_RITIRO"),
        eq(sampleRequests.deliveryFormRequired, true),
        eq(sampleRequests.deliveryFormReady, false),
        sql`coalesce(trim(${sampleRequests.ddtNumber}), '') = ''`,
        sql`not exists (select 1 from ${attachments} where ${attachments.requestId} = ${sampleRequests.id} and ${attachments.kind} = 'DDT')`,
      ),
    );
  const out = { NUOVA: 0, IN_PREPARAZIONE: 0, PRONTA_RITIRO: 0, SPEDITA: 0, COMPLETATA: 0, bolle: bolle.n };
  for (const r of rows) out[r.status] = r.n;
  return out;
}
