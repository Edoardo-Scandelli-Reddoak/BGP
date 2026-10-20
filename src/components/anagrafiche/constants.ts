/** Costanti condivise tra le pagine anagrafiche (server) e i form (client). */

import { COUNTRY_NAMES } from "@/lib/countries";

export const PAGE_SIZE = 50;

/** Limite dei file di import (.xlsx / .csv). */
export const IMPORT_MAX_BYTES = 15 * 1024 * 1024;
export const IMPORT_EXTENSIONS = [".xlsx", ".csv"];

/**
 * Suggerimenti per i campi Paese: i nomi canonici in italiano di src/lib/countries.ts, gli stessi
 * con cui vengono salvati i paesi riconosciuti (si può comunque scrivere un valore libero).
 */
export const COUNTRY_SUGGESTIONS = COUNTRY_NAMES;

export const BRAND_SUGGESTIONS = ["SmartFloors", "Gaia Parquet", "AFAP", "Aquawood", "Rubia"];

export const CATEGORY_SUGGESTIONS = ["Legno", "SPC", "Rivestimento", "Tecnico", "Accessori"];

export const CONTACT_TYPE_LABELS = { CLIENTE: "Cliente", AGENTE: "Agente" } as const;

/** Unisce suggerimenti fissi e valori già presenti in anagrafica, senza duplicati. */
export function mergeSuggestions(base: readonly string[], extra: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...base, ...extra]) {
    const s = v?.trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}
