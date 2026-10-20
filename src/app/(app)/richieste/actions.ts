"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { fail, NOT_AUTHORIZED, type ActionResult } from "@/lib/action-result";
import { getAuthorizedUser } from "@/lib/auth/session";
import {
  advanceStatus,
  createRequest,
  deleteRequest,
  getWorkflowSnapshot,
  revertStatus,
  updateRequestInfo,
  type RequestInfoInput,
} from "@/lib/requests/service";
import { parseDbId } from "@/lib/validation";

type State = ActionResult | null;

const INVALID_ID = fail("Richiesta non valida.");

function validId(id: unknown): id is number {
  return typeof id === "number" && parseDbId(id) === id;
}

/**
 * Errori imprevisti (database, rete): diventano un messaggio nel form, che così conserva i dati inseriti,
 * invece di sostituire la pagina con la schermata di errore. redirect() e notFound() passano invariati.
 */
async function guarded(run: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await run();
  } catch (err) {
    unstable_rethrow(err);
    console.error("[richieste] errore imprevisto in una server action", err);
    return fail("Errore imprevisto: l'operazione non è stata completata. Riprova tra qualche istante.");
  }
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Prodotti serializzati dal form in un campo nascosto (JSON). La validazione vera la fa il servizio. */
function parseItems(raw: string): RequestInfoInput["items"] | null {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return value.slice(0, 200).map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return {
        productId: item.productId,
        quantity: item.quantity,
        sampleFormat: typeof item.sampleFormat === "string" ? item.sampleFormat : null,
        formatNote: typeof item.formatNote === "string" ? item.formatNote : null,
        notes: typeof item.notes === "string" ? item.notes : null,
      };
    });
  } catch {
    return null;
  }
}

/** Radio «Preavviso telefonico»: "si" / "no"; nessuna scelta = non ancora indicato (null). */
function phoneNoticeFrom(formData: FormData): boolean | null {
  const v = text(formData, "phoneNotice");
  return v === "si" ? true : v === "no" ? false : null;
}

function readRequestInfo(formData: FormData): RequestInfoInput | null {
  const items = parseItems(text(formData, "items"));
  if (items === null) return null;
  const phoneNotice = phoneNoticeFrom(formData);
  return {
    contactId: text(formData, "contactId"),
    recipientName: text(formData, "recipientName"),
    attentionOf: text(formData, "attentionOf"),
    destinationAddress: text(formData, "destinationAddress"),
    // Vuoto = paese del contatto (lo decide il servizio).
    destinationCountry: text(formData, "destinationCountry"),
    phoneNotice,
    // Con «No» il numero non serve (il servizio lo azzera comunque).
    phoneNoticeNumber: phoneNotice ? text(formData, "phoneNoticeNumber") : null,
    notes: text(formData, "notes"),
    deliveryFormRequired: formData.get("deliveryFormRequired") === "on",
    receivedAt: text(formData, "receivedAt") || null,
    items,
  };
}

/** Nuova richiesta: «Salva» oppure «Salva e invia al magazzino» (campo intent=send). */
export async function createRequestAction(_prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("requests.manage");
  if (!user) return NOT_AUTHORIZED;
  const input = readRequestInfo(formData);
  if (!input) return fail("Elenco prodotti non valido: ricarica la pagina e riprova.");

  const sendToWarehouse = text(formData, "intent") === "send";
  return guarded(async () => {
    const res = await createRequest(user, input, { sendToWarehouse });
    if (!res.ok) return res;
    const id = res.data?.id;
    revalidatePath("/", "layout");
    if (!id) return { ok: true, message: res.message };

    let ok = "creata";
    if (sendToWarehouse) {
      const snapshot = await getWorkflowSnapshot(id);
      ok = snapshot && snapshot.status !== "NUOVA" ? "inviata" : "non-inviata";
    }
    redirect(`/richieste/${id}?ok=${ok}`);
  });
}

/**
 * Modifica dei dati della richiesta. Con intent=send («Salva e invia al magazzino», solo per le nuove)
 * dopo il salvataggio la richiesta passa a «In preparazione», come nella creazione.
 */
export async function updateRequestAction(id: number, _prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("requests.manage");
  if (!user) return NOT_AUTHORIZED;
  if (!validId(id)) return INVALID_ID;
  const input = readRequestInfo(formData);
  if (!input) return fail("Elenco prodotti non valido: ricarica la pagina e riprova.");

  return guarded(async () => {
    const res = await updateRequestInfo(user, id, input);
    if (!res.ok) return res;
    revalidatePath("/", "layout");
    if (text(formData, "intent") !== "send") return res;

    const sent = await advanceStatus(user, id, "IN_PREPARAZIONE");
    if (!sent.ok) {
      return {
        ok: true,
        message: `Modifiche salvate. Attenzione: la richiesta non è stata inviata al magazzino (${sent.error})`,
      };
    }
    revalidatePath("/", "layout");
    redirect(`/richieste/${id}?ok=inviata`);
  });
}

/** «Invia al magazzino»: Nuova richiesta → In preparazione (parte l'avviso email al magazzino). */
export async function sendToWarehouseAction(id: number, _prev: State, _formData: FormData): Promise<ActionResult> {
  void _formData;
  const user = await getAuthorizedUser("requests.manage");
  if (!user) return NOT_AUTHORIZED;
  if (!validId(id)) return INVALID_ID;
  return guarded(async () => {
    const res = await advanceStatus(user, id, "IN_PREPARAZIONE");
    if (!res.ok) return res;
    revalidatePath("/", "layout");
    // Il pulsante sparisce col cambio di stato: l'esito (anche dell'email) si mostra come avviso nella pagina.
    redirect(`/richieste/${id}?ok=inviata`);
  });
}

export async function deleteRequestAction(id: number, _prev: State, _formData: FormData): Promise<ActionResult> {
  void _formData;
  const user = await getAuthorizedUser("requests.manage");
  if (!user) return NOT_AUTHORIZED;
  if (!validId(id)) return INVALID_ID;
  return guarded(async () => {
    const res = await deleteRequest(user, id);
    if (!res.ok) return res;
    revalidatePath("/", "layout");
    redirect(`/richieste?eliminata=${id}`);
  });
}

/** Correzione: riporta la richiesta allo stato precedente, con motivo obbligatorio. */
export async function revertRequestAction(id: number, _prev: State, formData: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("requests.revert");
  if (!user) return NOT_AUTHORIZED;
  if (!validId(id)) return INVALID_ID;
  const note = text(formData, "note").trim().slice(0, 1000);
  if (!note) return fail("Indica il motivo della correzione.", { note: "Indica il motivo" });
  return guarded(async () => {
    const res = await revertStatus(user, id, note);
    if (!res.ok) return res;
    revalidatePath("/", "layout");
    redirect(`/richieste/${id}?ok=riportata`);
  });
}
