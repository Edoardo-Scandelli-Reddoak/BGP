"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { ActionResult } from "@/lib/action-result";
import { createPublicRequest, type PublicRequestResult } from "@/lib/requests/public";

const MAX_ITEMS_JSON = 20_000;

/** IP del visitatore: primo indirizzo di x-forwarded-for, altrimenti x-real-ip. */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || null;
}

function parseItems(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || value.length > MAX_ITEMS_JSON) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
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
      recipientEmail: text("requesterType") === "AGENTE" ? text("recipientEmail") : undefined,
      address: text("address"),
      country: text("country"),
      language: text("language"),
      notes: text("notes"),
      items: parseItems(fd.get("items")),
      consent: fd.get("consent") === "on",
      website: text("website"),
    },
    await clientIp(),
  );
  if (result.ok && result.data?.code) revalidatePath("/", "layout");
  return result;
}
