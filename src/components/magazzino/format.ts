import { dateFromIso, formatNumber, TIME_ZONE } from "@/lib/format";

/** Misura in cm: senza decimali se intera ("122"), altrimenti una cifra ("19,5"). */
export function formatCm(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 1);
}

function romeDay(d: Date): number {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);
  return Math.round(dateFromIso(iso).getTime() / 86_400_000);
}

/** Giorni di calendario (fuso di Roma) trascorsi da una data. */
export function daysSince(date: Date, now: Date = new Date()): number {
  return Math.max(0, romeDay(now) - romeDay(date));
}

/** Attesa in coda: "Arrivata oggi", "Da ieri", "Da 3 giorni". */
export function waitingLabel(days: number): string {
  if (days <= 0) return "Arrivata oggi";
  if (days === 1) return "Da ieri";
  return `Da ${days} giorni`;
}

/**
 * Riga "città" dell'indirizzo di destinazione: ultima riga non vuota, e se contiene un CAP
 * la parte da lì in poi (es. "VIA ROMA 14, 24020 ROVETTA (BG)" → "24020 ROVETTA (BG)").
 */
export function destinationCity(address: string | null | undefined): string {
  const lines = (address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.at(-1) ?? "";
  const m = last.match(/(?:^|,\s*)(\d{4,5}\s+[^,]+)$/);
  return m ? m[1] : last;
}
