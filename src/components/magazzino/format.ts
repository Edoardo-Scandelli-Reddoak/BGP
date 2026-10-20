/** Helper di visualizzazione della coda magazzino (formatCm e daysSince sono in @/lib/format). */

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
