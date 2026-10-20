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

type MergeableItem = { productId: number; quantity: number; notes?: string | null };

/** Unisce le righe dello stesso prodotto sommando le quantità (e accodando le note, se presenti). */
export function mergeItems<T extends MergeableItem>(items: T[]): T[] {
  const map = new Map<number, T>();
  for (const item of items) {
    const prev = map.get(item.productId);
    if (!prev) {
      map.set(item.productId, { ...item });
      continue;
    }
    prev.quantity += item.quantity;
    if (item.notes) prev.notes = prev.notes ? `${prev.notes}; ${item.notes}` : item.notes;
  }
  return [...map.values()];
}
