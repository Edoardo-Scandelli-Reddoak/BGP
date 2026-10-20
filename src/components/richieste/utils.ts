import { isSampleFormat, type SampleFormat } from "@/lib/sample-formats";

/** Conferma prima di inviare al magazzino una richiesta con contatto creato dal modulo pubblico e non ancora verificato. */
export const CONTACT_REVIEW_CONFIRM =
  "Il contatto è stato creato dal modulo pubblico e non è ancora verificato (lingua, email, agente). Inviare comunque la richiesta al magazzino?";

/** Età di una richiesta in parole ("oggi", "ieri", "da 3 giorni"); i giorni si calcolano con daysSince di @/lib/format. */
export function ageLabel(days: number): string {
  if (days === 0) return "oggi";
  if (days === 1) return "ieri";
  return `da ${days} giorni`;
}

/**
 * Indirizzo su una riga (versione breve per le liste). L'indirizzo di consegna non contiene più il
 * destinatario, che sta in un campo a parte: si mostrano tutte le righe.
 */
export function shortAddress(address: string | null | undefined, max = 60): string {
  const text = (address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Dati della consegna precompilati dal contatto scelto (modificabili nel form). */
export type ContactPrefill = { recipientName: string; destinationAddress: string; country: string; phone: string };

export const EMPTY_PREFILL: ContactPrefill = { recipientName: "", destinationAddress: "", country: "", phone: "" };

/**
 * Destinatario = nome del contatto, indirizzo = indirizzo predefinito (senza riga del nome), paese di
 * consegna = paese del contatto, telefono per il preavviso.
 */
export function contactPrefill(c: {
  name: string;
  defaultAddress?: string | null;
  country?: string | null;
  phone?: string | null;
}): ContactPrefill {
  return {
    recipientName: c.name.trim(),
    destinationAddress: c.defaultAddress?.trim() ?? "",
    country: c.country?.trim() ?? "",
    phone: c.phone?.trim() ?? "",
  };
}

/** Formato letto dal database per il form (valori sconosciuti → da scegliere). */
export function formatFromDb(value: string | null | undefined): SampleFormat | "" {
  return isSampleFormat(value) ? value : "";
}
