/** Costanti condivise tra le pagine anagrafiche (server) e i form (client). */

export const PAGE_SIZE = 50;

/** Limite dei file di import (.xlsx / .csv). */
export const IMPORT_MAX_BYTES = 15 * 1024 * 1024;
export const IMPORT_EXTENSIONS = [".xlsx", ".csv"];

/** Suggerimenti per il campo Paese (si può comunque scrivere un valore libero). */
export const COUNTRY_SUGGESTIONS = [
  "Italia",
  "Svizzera",
  "Francia",
  "Germania",
  "Austria",
  "Belgio",
  "Slovenia",
  "Spagna",
  "Regno Unito",
  "Principato di Monaco",
  "San Marino",
  "Paesi Bassi",
  "Lussemburgo",
  "Croazia",
  "Portogallo",
  "Grecia",
  "Polonia",
  "Repubblica Ceca",
  "Danimarca",
  "Svezia",
  "Norvegia",
  "Irlanda",
  "Stati Uniti",
  "Canada",
  "Emirati Arabi Uniti",
];

export const BRAND_SUGGESTIONS = ["SmartFloors", "Gaia Parquet", "AFAP", "Aquawood", "Rubia"];

export const CATEGORY_SUGGESTIONS = ["Legno", "SPC", "Rivestimento", "Tecnico", "Accessori"];

export const CONTACT_TYPE_LABELS = { CLIENTE: "Cliente", AGENTE: "Agente" } as const;

/** Unisce suggerimenti fissi e valori già presenti in anagrafica, senza duplicati. */
export function mergeSuggestions(base: string[], extra: (string | null)[]): string[] {
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

/** Solo percorsi interni ("/richieste/nuova"), mai URL esterni o "//host". */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return null;
  if (s.length > 300 || /[\s\\]/.test(s)) return null;
  return s;
}
