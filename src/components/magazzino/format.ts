/** Helper di visualizzazione della coda magazzino (formatCm e daysSince sono in @/lib/format). */

/** Attesa in coda: "Arrivata oggi", "Da ieri", "Da 3 giorni". */
export function waitingLabel(days: number): string {
  if (days <= 0) return "Arrivata oggi";
  if (days === 1) return "Da ieri";
  return `Da ${days} giorni`;
}

/** Parte che inizia con il CAP: "24020 ROVETTA (BG)", "75001 Paris", "D-80331 München". */
const CAP_AT_START = /^(?:[A-Z]{1,2}-)?\d{4,5}\s+\S/i;
/** CAP a metà riga senza virgola: "Via Roma 10 24020 Rovetta (BG)" (solo 5 cifre, per non scambiarlo col civico). */
const CAP_INSIDE = /(?:^|\s)((?:[A-Z]{1,2}-)?\d{5}\s+[^\d\s,][^,]*)$/i;
const DOMESTIC = /^(italia|italy)$/i;

/**
 * Riga "città" dell'indirizzo di consegna (che contiene solo l'indirizzo, senza destinatario):
 * dal CAP in poi, con il paese se estero.
 * "VIA ROMA 14, 24020 ROVETTA (BG)" → "24020 ROVETTA (BG)";
 * "Rue de Rivoli 10\n75001 Paris\nFrancia" → "75001 Paris, Francia".
 * Senza CAP riconoscibile: ultima riga (con la penultima se l'ultima sembra solo il paese).
 */
export function destinationCity(address: string | null | undefined): string {
  const lines = (address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  const parts = lines.flatMap((l) =>
    l
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  );
  let from = parts.findLastIndex((p) => CAP_AT_START.test(p));
  if (from === -1) {
    from = parts.findLastIndex((p) => CAP_INSIDE.test(p));
    if (from !== -1) parts[from] = parts[from].match(CAP_INSIDE)![1];
  }
  if (from !== -1) {
    return parts
      .slice(from)
      .filter((p) => !DOMESTIC.test(p))
      .join(", ");
  }

  const last = lines.at(-1)!;
  if (lines.length > 1 && !/\d/.test(last) && !DOMESTIC.test(last)) return `${lines.at(-2)}, ${last}`;
  return DOMESTIC.test(last) && lines.length > 1 ? lines.at(-2)! : last;
}
