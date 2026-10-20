/** Conferma prima di inviare al magazzino una richiesta con contatto creato dal modulo pubblico e non ancora verificato. */
export const CONTACT_REVIEW_CONFIRM =
  "Il contatto è stato creato dal modulo pubblico e non è ancora verificato (lingua, email, agente). Inviare comunque la richiesta al magazzino?";

/** Età di una richiesta in parole ("oggi", "ieri", "da 3 giorni"); i giorni si calcolano con daysSince di @/lib/format. */
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
