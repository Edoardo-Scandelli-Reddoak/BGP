import { dateFromIso, TIME_ZONE, todayIso } from "@/lib/format";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data (fuso di Roma) in formato YYYY-MM-DD. */
export function romeIsoDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(value);
}

/** Giorni di calendario trascorsi dalla data indicata (fuso di Roma). */
export function daysSince(value: Date): number {
  const diff = dateFromIso(todayIso()).getTime() - dateFromIso(romeIsoDate(value)).getTime();
  return Math.max(0, Math.round(diff / DAY_MS));
}

export function ageLabel(days: number): string {
  if (days === 0) return "oggi";
  if (days === 1) return "ieri";
  return `da ${days} giorni`;
}

/** Prima riga utile dell'indirizzo + località (versione breve per le liste). */
export function shortAddress(address: string | null | undefined, max = 60): string {
  const lines = (address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  // La prima riga è di solito il nome del destinatario: mostriamo le righe successive.
  const text = (lines.length > 1 ? lines.slice(1) : lines).join(", ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
