"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sampleRequests } from "@/db/schema";
import { fail, NOT_AUTHORIZED, type ActionResult } from "@/lib/action-result";
import { getAuthorizedUser } from "@/lib/auth/session";
import { parseDecimal } from "@/lib/format";
import {
  advanceStatus,
  completeWithoutEmail,
  DDT_MAX_BYTES,
  deleteDdt,
  resendShipmentConfirmation,
  updateLogisticsData,
  uploadDdt,
  type LogisticsInput,
} from "@/lib/requests/service";

type State = ActionResult | null;

const requestId = z.number().int().positive();

/** Valore testuale del form; campo vuoto (es. data non compilata) → null. */
function text(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Costo in euro dal form ("12,50" o "12.50"); undefined = valore non valido. */
function readCost(formData: FormData): number | null | undefined {
  const n = parseDecimal(text(formData, "shippingCost"));
  if (n === null) return null;
  return Number.isNaN(n) ? undefined : Math.round(n * 100) / 100;
}

function done(result: ActionResult): ActionResult {
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/**
 * Salva i dati di spedizione (corriere, date, tracking, DDT, costo, note).
 * Con intent=ship la richiesta viene anche segnata come «Spedita».
 */
export async function saveLogisticsData(id: number, _prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("logistics.work");
  if (!user) return NOT_AUTHORIZED;
  if (!requestId.safeParse(id).success) return fail("Richiesta non valida.");

  // Il form mostra campi diversi a seconda dello stato: se nel frattempo lo stato è cambiato
  // (es. richiesta riaperta), salvare svuoterebbe i campi non presenti.
  const expected = text(formData, "expectedStatus");
  const [current] = await db
    .select({ status: sampleRequests.status })
    .from(sampleRequests)
    .where(eq(sampleRequests.id, id))
    .limit(1);
  if (!current) return fail("Richiesta non trovata.");
  if (expected && expected !== current.status) {
    return fail("La richiesta è stata aggiornata nel frattempo: ricarica la pagina e controlla i dati.");
  }

  const shippingCost = readCost(formData);
  if (shippingCost === undefined) {
    return fail("Controlla i campi evidenziati.", { shippingCost: "Importo non valido (es. 12,50)" });
  }
  const input: LogisticsInput = {
    carrierId: text(formData, "carrierId"),
    pickupDate: text(formData, "pickupDate"),
    trackingNumber: text(formData, "trackingNumber"),
    shipmentDate: text(formData, "shipmentDate"),
    ddtNumber: text(formData, "ddtNumber"),
    shippingCost,
    logisticsNotes: text(formData, "logisticsNotes"),
  };
  // La casella «Bolla pronta» c'è solo se la bolla è richiesta: senza il campo il valore non cambia.
  if (formData.get("deliveryFormReadyField") === "1") {
    input.deliveryFormReady = formData.get("deliveryFormReady") === "on";
  }

  const saved = await updateLogisticsData(user, id, input);
  if (!saved.ok || formData.get("intent") !== "ship") return done(saved);

  const shipped = await advanceStatus(user, id, "SPEDITA");
  revalidatePath("/", "layout");
  if (!shipped.ok) {
    return fail(`Dati salvati, ma la richiesta non è stata segnata come spedita. ${shipped.error}`);
  }
  return shipped;
}

/** Riconosce il formato dal contenuto del file (non ci si fida di estensione e tipo dichiarato). */
function detectDdtType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", ext: "pdf" };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (starts([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}

export async function uploadDdtFile(id: number, _prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("logistics.work");
  if (!user) return NOT_AUTHORIZED;
  if (!requestId.safeParse(id).success) return fail("Richiesta non valida.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Seleziona il file del DDT.", { file: "Seleziona un file" });
  if (file.size > DDT_MAX_BYTES) return fail("Il file supera i 10 MB.", { file: "Massimo 10 MB" });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectDdtType(bytes);
  if (!type) return fail("Formato non supportato: carica un PDF, JPG o PNG.", { file: "Solo PDF, JPG o PNG" });

  // Nome leggibile con l'estensione corretta per il formato reale.
  const base = (file.name || "ddt").replace(/\.[^.]*$/, "").trim() || "ddt";
  return done(await uploadDdt(user, id, { name: `${base}.${type.ext}`, type: type.mime, bytes }));
}

export async function removeDdtFile(id: number, _prev: State, _formData: FormData): Promise<ActionResult> {
  void _formData;
  const user = await getAuthorizedUser("logistics.work");
  if (!user) return NOT_AUTHORIZED;
  if (!requestId.safeParse(id).success) return fail("Richiesta non valida.");
  return done(await deleteDdt(user, id));
}

/** «Invia conferma» / «Reinvia conferma» al cliente (agente in copia). */
export async function sendShipmentConfirmation(id: number, _prev: State, _formData: FormData): Promise<ActionResult> {
  void _formData;
  const user = await getAuthorizedUser("logistics.work");
  if (!user) return NOT_AUTHORIZED;
  if (!requestId.safeParse(id).success) return fail("Richiesta non valida.");
  const result = await resendShipmentConfirmation(user, id);
  // Anche un errore d'invio va registrato nel registro email: aggiorno comunque la pagina.
  revalidatePath("/", "layout");
  return result;
}

export async function completeWithoutConfirmation(id: number, _prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("logistics.work");
  if (!user) return NOT_AUTHORIZED;
  if (!requestId.safeParse(id).success) return fail("Richiesta non valida.");
  const note = (text(formData, "note") ?? "").trim();
  if (!note) return fail("Indica il motivo.", { note: "Indica il motivo" });
  if (note.length > 500) return fail("Motivo troppo lungo.", { note: "Massimo 500 caratteri" });
  return done(await completeWithoutEmail(user, id, note));
}

/**
 * Costo di spedizione inserito dall'elenco «Ultime completate».
 * Sulle richieste completate il servizio aggiorna insieme numero DDT, costo e note:
 * gli altri due valori vengono riletti dal database per non perderli.
 */
export async function saveShippingCost(id: number, _prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("logistics.work");
  if (!user) return NOT_AUTHORIZED;
  if (!requestId.safeParse(id).success) return fail("Richiesta non valida.");

  const shippingCost = readCost(formData);
  if (shippingCost === undefined) return fail("Importo non valido (es. 12,50).", { shippingCost: "Importo non valido" });

  const [current] = await db
    .select({
      status: sampleRequests.status,
      ddtNumber: sampleRequests.ddtNumber,
      logisticsNotes: sampleRequests.logisticsNotes,
    })
    .from(sampleRequests)
    .where(eq(sampleRequests.id, id))
    .limit(1);
  if (!current) return fail("Richiesta non trovata.");
  if (current.status !== "COMPLETATA") return fail("Apri la richiesta per modificare i dati di spedizione.");

  const result = await updateLogisticsData(user, id, {
    ddtNumber: current.ddtNumber,
    logisticsNotes: current.logisticsNotes,
    shippingCost,
  });
  return done(result.ok ? { ok: true, message: shippingCost === null ? "Costo rimosso." : "Costo salvato." } : result);
}
