import type { Language } from "@/db/schema";

/**
 * Formato del campione richiesto (dati obbligatori indicati da BGP per prendere in carico una
 * richiesta: «doghe intere, mezze doghe, mazzette, pannelli, espositori completo o solo culle, ecc.»).
 * Modulo puro: usato da form, servizio, email e bolla.
 */
export const SAMPLE_FORMATS = [
  "DOGHE_INTERE",
  "MEZZE_DOGHE",
  "MAZZETTA",
  "PANNELLO",
  "ESPOSITORE_COMPLETO",
  "ESPOSITORE_CULLE",
  "ALTRO",
] as const;

export type SampleFormat = (typeof SAMPLE_FORMATS)[number];

export const SAMPLE_FORMAT_LABELS: Record<SampleFormat, string> = {
  DOGHE_INTERE: "Doghe intere",
  MEZZE_DOGHE: "Mezze doghe",
  MAZZETTA: "Mazzetta",
  PANNELLO: "Pannello",
  ESPOSITORE_COMPLETO: "Espositore completo",
  ESPOSITORE_CULLE: "Espositore: solo culle",
  ALTRO: "Altro",
};

/** Etichette per le email ai clienti esteri (lingua del contatto). */
const LABELS_BY_LANGUAGE: Record<Exclude<Language, "it">, Record<SampleFormat, string>> = {
  en: {
    DOGHE_INTERE: "Full-length planks",
    MEZZE_DOGHE: "Half-length planks",
    MAZZETTA: "Sample fan",
    PANNELLO: "Sample panel",
    ESPOSITORE_COMPLETO: "Complete display stand",
    ESPOSITORE_CULLE: "Display stand: holders only",
    ALTRO: "Other",
  },
  fr: {
    DOGHE_INTERE: "Lames entières",
    MEZZE_DOGHE: "Demi-lames",
    MAZZETTA: "Nuancier",
    PANNELLO: "Panneau échantillon",
    ESPOSITORE_COMPLETO: "Présentoir complet",
    ESPOSITORE_CULLE: "Présentoir : supports seuls",
    ALTRO: "Autre",
  },
  de: {
    DOGHE_INTERE: "Ganze Dielen",
    MEZZE_DOGHE: "Halbe Dielen",
    MAZZETTA: "Musterfächer",
    PANNELLO: "Musterpaneel",
    ESPOSITORE_COMPLETO: "Komplettes Display",
    ESPOSITORE_CULLE: "Display: nur Halterungen",
    ALTRO: "Sonstiges",
  },
};

export function isSampleFormat(value: unknown): value is SampleFormat {
  return typeof value === "string" && (SAMPLE_FORMATS as readonly string[]).includes(value);
}

/** "Mezze doghe", "Altro: campione tagliato 30 cm", "Pannello (2 colori)"; "" se non indicato. */
export function sampleFormatText(
  format: string | null | undefined,
  note?: string | null,
  lang: Language = "it",
): string {
  if (!isSampleFormat(format)) return note?.trim() ?? "";
  const label = lang === "it" ? SAMPLE_FORMAT_LABELS[format] : LABELS_BY_LANGUAGE[lang][format];
  const extra = note?.trim();
  if (!extra) return label;
  return format === "ALTRO" ? `${label}: ${extra}` : `${label} (${extra})`;
}

/** Formato mancante o «Altro» senza descrizione: la richiesta non può essere presa in carico. */
export function sampleFormatMissing(format: string | null | undefined, note?: string | null): boolean {
  if (!isSampleFormat(format)) return true;
  return format === "ALTRO" && !note?.trim();
}

/** Proposta di formato dal codice/descrizione del prodotto (es. MAZZ… → Mazzetta); modificabile. */
export function suggestSampleFormat(code: string, description: string): SampleFormat | null {
  const c = code.toUpperCase();
  const d = description.toLowerCase();
  if (c.startsWith("MAZZ") || d.startsWith("mazzetta")) return "MAZZETTA";
  if (c.startsWith("PAN") || d.startsWith("pannell")) return "PANNELLO";
  // Solo gli espositori veri: le «Doghe … per Espositore» (codici DESP…) sono doghe.
  if (d.startsWith("espositor") || (c.startsWith("ESP") && !d.startsWith("dogh"))) return "ESPOSITORE_COMPLETO";
  return null;
}

/** Ragione sociale di una ditta (per ricordare di indicare «alla c.a.» di chi). */
export function looksLikeCompany(name: string | null | undefined): boolean {
  // Confini di parola Unicode (\b non riconosce le lettere accentate: «Società»).
  return /(?<![\p{L}\p{N}])(s\.?\s?r\.?\s?l|s\.?\s?p\.?\s?a|s\.?\s?n\.?\s?c|s\.?\s?a\.?\s?s|srls|soc\.?|societ[aà]|gmbh|ag|sarl|sas|sasu|sa|bv|d\.?o\.?o|ltd|llc|inc|group|studio|spa|snc|sagl|s\.?a\.?g\.?l)(?![\p{L}\p{N}])\.?/iu.test(
    name ?? "",
  );
}
