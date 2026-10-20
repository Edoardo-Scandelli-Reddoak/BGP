import { z } from "zod";

/** Massimo valore di una colonna integer di Postgres (serial). */
export const MAX_DB_ID = 2_147_483_647;

/** Id di una riga del database: intero positivo entro i limiti di Postgres. */
export const dbId = z.coerce
  .number()
  .int("Identificativo non valido")
  .positive("Identificativo non valido")
  .max(MAX_DB_ID, "Identificativo non valido");

/** Id da stringa/form: null se mancante o fuori dai limiti (mai eccezioni dal database). */
export function parseDbId(value: unknown): number | null {
  const s = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= MAX_DB_ID ? n : null;
}
