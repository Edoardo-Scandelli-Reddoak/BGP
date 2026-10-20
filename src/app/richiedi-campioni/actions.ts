"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { getClientIp } from "@/lib/request-ip";
import { createPublicRequest, type PublicRequestResult } from "@/lib/requests/public";

const MAX_ITEMS_JSON = 20_000;

function parseItems(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || value.length > MAX_ITEMS_JSON) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

/** Radio «Preavviso telefonico» Sì/No: nessuna scelta → undefined (campo obbligatorio). */
function parseYesNo(value: FormDataEntryValue | null): boolean | undefined {
  if (value === "SI") return true;
  if (value === "NO") return false;
  return undefined;
}

/** Invio del modulo pubblico (senza login): validazione, limiti e salvataggio in src/lib/requests/public.ts. */
export async function submitPublicRequest(
  _prev: ActionResult<PublicRequestResult> | null,
  fd: FormData,
): Promise<ActionResult<PublicRequestResult>> {
  const text = (key: string) => {
    const v = fd.get(key);
    return typeof v === "string" ? v : undefined;
  };
  const result = await createPublicRequest(
    {
      requesterType: text("requesterType"),
      requesterName: text("requesterName"),
      requesterEmail: text("requesterEmail"),
      requesterPhone: text("requesterPhone"),
      recipientName: text("recipientName"),
      recipientIsPrivate: fd.get("recipientIsPrivate") === "on",
      attentionOf: fd.get("recipientIsPrivate") === "on" ? undefined : text("attentionOf"),
      recipientEmail: text("requesterType") === "AGENTE" ? text("recipientEmail") : undefined,
      address: text("address"),
      country: text("country"),
      language: text("language"),
      phoneNotice: parseYesNo(fd.get("phoneNotice")),
      phoneNoticeNumber: fd.get("phoneNotice") === "SI" ? text("phoneNoticeNumber") : undefined,
      notes: text("notes"),
      items: parseItems(fd.get("items")),
      consent: fd.get("consent") === "on",
      website: text("website"),
      formToken: text("formToken"),
    },
    // IP solo da un proxy fidato (TRUST_PROXY), altrimenti null: valgono i limiti per email e totali.
    await getClientIp(),
  );
  if (result.ok && result.data?.code) revalidatePath("/", "layout");
  return result;
}
