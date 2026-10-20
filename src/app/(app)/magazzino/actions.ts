"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, NOT_AUTHORIZED, type ActionResult } from "@/lib/action-result";
import { getAuthorizedUser, type SessionUser } from "@/lib/auth/session";
import { formatCm } from "@/components/magazzino/format";
import { formatM2, parseDecimal, pieceAreaM2 } from "@/lib/format";
import {
  addPiece as addPieceService,
  advanceStatus,
  deletePiece as deletePieceService,
  updatePiece as updatePieceService,
  updateWarehouseData,
  type PieceInput,
  type WarehouseInput,
} from "@/lib/requests/service";

/**
 * Server action del magazzino (coda e pannello «Preparazione magazzino» nel dettaglio richiesta).
 * Leggono il form, convertono i numeri scritti all'italiana ("4,8") e delegano al servizio,
 * che riapplica permessi, stato ammesso e validazione.
 */

type State = ActionResult | null;

const idSchema = z.coerce.number().int().positive();

function readId(formData: FormData, name: string): number | null {
  const parsed = idSchema.safeParse(formData.get(name));
  return parsed.success ? parsed.data : null;
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Una cifra decimale come nel database (numeric 10,1): l'anteprima m² usa lo stesso arrotondamento. */
function roundCm(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* Colli, peso, note                                                   */
/* ------------------------------------------------------------------ */

function readWarehouseForm(
  formData: FormData,
): { ok: true; input: WarehouseInput } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};

  const packagesRaw = text(formData, "packagesCount").trim();
  let packagesCount: number | null = null;
  if (packagesRaw) {
    const n = Number(packagesRaw);
    if (!Number.isInteger(n) || n < 0) fieldErrors.packagesCount = "Numero colli non valido";
    else packagesCount = n;
  }

  const weight = parseDecimal(formData.get("weightKg"));
  if (weight !== null && (Number.isNaN(weight) || weight < 0)) fieldErrors.weightKg = "Peso non valido (es. 4,8)";

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return {
    ok: true,
    input: {
      packagesCount,
      weightKg: weight === null || Number.isNaN(weight) ? null : weight,
      warehouseNotes: text(formData, "warehouseNotes"),
    },
  };
}

async function saveWarehouse(user: SessionUser, requestId: number, formData: FormData): Promise<ActionResult> {
  const form = readWarehouseForm(formData);
  if (!form.ok) return fail("Controlla i campi evidenziati.", form.fieldErrors);
  return updateWarehouseData(user, requestId, form.input);
}

export async function updateWarehouse(_prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("warehouse.work");
  if (!user) return NOT_AUTHORIZED;
  const requestId = readId(formData, "requestId");
  if (!requestId) return fail("Richiesta non valida.");

  const res = await saveWarehouse(user, requestId, formData);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/**
 * «Pronta per il ritiro». Se il form contiene anche colli/peso/note (pulsante nel pannello),
 * li salva prima di far avanzare la richiesta: così basta un tocco dopo aver pesato i colli.
 */
export async function markReady(_prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("warehouse.work");
  if (!user) return NOT_AUTHORIZED;
  const requestId = readId(formData, "requestId");
  if (!requestId) return fail("Richiesta non valida.");

  if (formData.get("saveData") === "1") {
    const saved = await saveWarehouse(user, requestId, formData);
    if (!saved.ok) return saved;
  }

  const res = await advanceStatus(user, requestId, "PRONTA_RITIRO", {
    acknowledgeNoPieces: formData.get("acknowledgeNoPieces") === "on",
  });
  // I dati di magazzino possono essere stati salvati anche se il passaggio di stato non è riuscito.
  revalidatePath("/", "layout");
  return res;
}

/* ------------------------------------------------------------------ */
/* Pezzi misurati                                                      */
/* ------------------------------------------------------------------ */

function readPieceForm(
  formData: FormData,
): { ok: true; input: PieceInput & { lengthCm: number; widthCm: number; quantity: number } } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};

  const productId = readId(formData, "productId");
  if (!productId) fieldErrors.productId = "Seleziona il prodotto";

  const length = parseDecimal(formData.get("lengthCm"));
  if (length === null) fieldErrors.lengthCm = "Indica la lunghezza";
  else if (Number.isNaN(length)) fieldErrors.lengthCm = "Lunghezza non valida (es. 122,5)";

  const width = parseDecimal(formData.get("widthCm"));
  if (width === null) fieldErrors.widthCm = "Indica la larghezza";
  else if (Number.isNaN(width)) fieldErrors.widthCm = "Larghezza non valida (es. 19,5)";

  const qtyRaw = text(formData, "quantity").trim();
  const quantity = qtyRaw ? Number(qtyRaw) : 1;
  if (!Number.isInteger(quantity)) fieldErrors.quantity = "Quantità non valida";

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return {
    ok: true,
    input: {
      productId: productId!,
      lengthCm: roundCm(length!),
      widthCm: roundCm(width!),
      quantity,
      conditionNote: text(formData, "conditionNote"),
    },
  };
}

function pieceSummary(p: { lengthCm: number; widthCm: number; quantity: number }): string {
  return `${formatCm(p.lengthCm)} × ${formatCm(p.widthCm)} cm × ${p.quantity} = ${formatM2(
    pieceAreaM2(p.lengthCm, p.widthCm, p.quantity),
  )}`;
}

export async function addPiece(_prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("warehouse.work");
  if (!user) return NOT_AUTHORIZED;
  const requestId = readId(formData, "requestId");
  if (!requestId) return fail("Richiesta non valida.");

  const form = readPieceForm(formData);
  if (!form.ok) return fail("Controlla le misure.", form.fieldErrors);

  const res = await addPieceService(user, requestId, form.input);
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  return { ok: true, message: `Pezzo aggiunto: ${pieceSummary(form.input)}.` };
}

export async function updatePiece(_prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("warehouse.work");
  if (!user) return NOT_AUTHORIZED;
  const pieceId = readId(formData, "pieceId");
  if (!pieceId) return fail("Pezzo non valido.");

  const form = readPieceForm(formData);
  if (!form.ok) return fail("Controlla le misure.", form.fieldErrors);

  const res = await updatePieceService(user, pieceId, form.input);
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  return { ok: true, message: `Pezzo aggiornato: ${pieceSummary(form.input)}.` };
}

export async function deletePiece(_prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("warehouse.work");
  if (!user) return NOT_AUTHORIZED;
  const pieceId = readId(formData, "pieceId");
  if (!pieceId) return fail("Pezzo non valido.");

  const res = await deletePieceService(user, pieceId);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
