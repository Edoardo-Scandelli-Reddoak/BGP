import type { Language } from "@/db/schema";

const LOCALES: Record<Language, string> = { it: "it-IT", en: "en-GB", fr: "fr-FR", de: "de-DE" };

export const LANGUAGE_LABELS: Record<Language, string> = {
  it: "Italiano",
  en: "English",
  fr: "Français",
  de: "Deutsch",
};

export const TIME_ZONE = "Europe/Rome";

/** Codice leggibile della richiesta, es. CAMP-00042. */
export function requestCode(id: number): string {
  return `CAMP-${String(id).padStart(5, "0")}`;
}

/** Accetta "CAMP-00042", "camp42", "#42" o "42" e restituisce l'id numerico. */
export function parseRequestCode(value: string): number | null {
  const m = value.trim().match(/^(?:camp-?|#)?0*(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
}

/** Data (Date o stringa YYYY-MM-DD) in formato gg/mm/aaaa. */
export function formatDate(value: Date | string | null | undefined, lang: Language = "it"): string {
  if (!value) return "";
  const d = typeof value === "string" ? dateFromIso(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALES[lang], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: typeof value === "string" ? "UTC" : TIME_ZONE,
  }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined, lang: Language = "it"): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(d);
}

export function formatNumber(value: number | null | undefined, decimals = 2, lang: Language = "it"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat(LOCALES[lang], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatM2(value: number | null | undefined, lang: Language = "it"): string {
  const n = formatNumber(value ?? 0, 2, lang);
  return `${n} m²`;
}

export function formatKg(value: number | null | undefined, lang: Language = "it"): string {
  if (value === null || value === undefined) return "";
  return `${formatNumber(value, 2, lang)} kg`;
}

export function formatEuro(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
}

/** "2026-10-20" → Date a mezzanotte UTC (per date senza ora). */
export function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** Data odierna nel fuso di Roma, formato YYYY-MM-DD (per input type="date"). */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

/** Mese corrente nel fuso di Roma, formato YYYY-MM. */
export function currentMonthIso(): string {
  return todayIso().slice(0, 7);
}

const MONTHS_IT = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

/** "2026-10" → "ottobre 2026" */
export function formatMonth(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return `${MONTHS_IT[(m || 1) - 1]} ${y}`;
}

/** Converte "12,5" o "12.5" in numero; stringa vuota → null. */
export function parseDecimal(value: FormDataEntryValue | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/\s/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

/** m² di un pezzo: lunghezza (cm) × larghezza (cm) × quantità / 10.000 (formula del blueprint). */
export function pieceAreaM2(lengthCm: number, widthCm: number, quantity = 1): number {
  return Math.round(((lengthCm * widthCm * quantity) / 10000) * 10000) / 10000;
}
