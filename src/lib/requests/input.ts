import { z } from "zod";

/**
 * Pezzi di validazione condivisi dagli input delle richieste (servizio interno e modulo pubblico).
 * Modulo puro: nessun accesso al database.
 */

/** Testo facoltativo: spazi tolti, stringa vuota, null o assente → null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Massimo ${max} caratteri`)
    .nullish()
    .transform((v) => (v ? v : null));

type MergeableItem = {
  productId: number;
  quantity: number;
  notes?: string | null;
  sampleFormat?: string | null;
  formatNote?: string | null;
};

/** Testo con a capo uniformi ("\r\n" dei browser → "\n") e senza spazi ai bordi. */
export function normalizeMultiline(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

/**
 * Unisce le righe dello stesso prodotto nello stesso formato sommando le quantità (e accodando le
 * note). Lo stesso prodotto in formati diversi (es. mazzetta e doghe intere) resta su righe separate.
 */
export function mergeItems<T extends MergeableItem>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = [item.productId, item.sampleFormat ?? "", item.formatNote?.trim().toLowerCase() ?? ""].join("|");
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...item });
      continue;
    }
    prev.quantity += item.quantity;
    if (item.notes) prev.notes = prev.notes ? `${prev.notes}; ${item.notes}` : item.notes;
  }
  return [...map.values()];
}
