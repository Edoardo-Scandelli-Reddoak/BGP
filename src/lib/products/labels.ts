/**
 * Marchio e categoria dei prodotti: testo libero, ma senza doppioni che differiscono solo per
 * maiuscole o spazi («gaia parquet» e «Gaia  Parquet» diventano il valore già in anagrafica).
 * Modulo puro: usato da import, assegnazione in blocco, form prodotto e gestione dei valori.
 */

export type ProductLabelField = "brand" | "category";

export const PRODUCT_LABEL_NAMES: Record<ProductLabelField, { singular: string; plural: string; missing: string }> = {
  brand: { singular: "Marchio", plural: "Marchi", missing: "Senza marchio" },
  category: { singular: "Categoria", plural: "Categorie", missing: "Senza categoria" },
};

/** Valore del filtro per i prodotti senza marchio / senza categoria (come «paese=-» nei contatti). */
export const MISSING_LABEL_FILTER = "-";

export const PRODUCT_LABEL_MAX = 100;

/** Spazi normalizzati; vuoto → null. */
export function cleanLabel(value: string | null | undefined): string | null {
  const s = (value ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, PRODUCT_LABEL_MAX) : null;
}

/** Chiave di confronto: senza maiuscole, spazi e accenti. */
export function labelKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Valore da salvare: se in anagrafica esiste già lo stesso valore scritto diversamente
 * (maiuscole, spazi, accenti) si usa quello esistente, altrimenti il valore ripulito.
 */
export function canonicalLabel(value: string | null | undefined, existing: Iterable<string | null>): string | null {
  const clean = cleanLabel(value);
  if (!clean) return null;
  const key = labelKey(clean);
  for (const e of existing) {
    if (e && labelKey(e) === key) return e;
  }
  return clean;
}

/** Indice chiave → valore esistente, per canonicalizzare molti valori (import). */
export function labelIndex(existing: Iterable<string | null>): Map<string, string> {
  const index = new Map<string, string>();
  for (const e of existing) {
    const clean = cleanLabel(e);
    if (clean && !index.has(labelKey(clean))) index.set(labelKey(clean), e!);
  }
  return index;
}

/** Come `canonicalLabel`, con un indice che si arricchisce dei valori nuovi (es. righe dello stesso file). */
export function canonicalWithIndex(value: string | null | undefined, index: Map<string, string>): string | null {
  const clean = cleanLabel(value);
  if (!clean) return null;
  const key = labelKey(clean);
  const found = index.get(key);
  if (found) return found;
  index.set(key, clean);
  return clean;
}

/** Parametro dell'elenco prodotti (e dell'export) che filtra il campo: ?marchio=… / ?categoria=… */
export const PRODUCT_LABEL_PARAMS: Record<ProductLabelField, "marchio" | "categoria"> = {
  brand: "marchio",
  category: "categoria",
};

/** Ordine alfabetico senza maiuscole e accenti: le varianti dello stesso valore restano vicine. */
export function compareLabels(a: string, b: string): number {
  const ka = labelKey(a);
  const kb = labelKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Valori dal più usato al meno usato (a parità, in ordine alfabetico): priorità per `renameTarget`. */
export function labelsByUsage(values: { value: string; total: number }[]): string[] {
  return [...values].sort((a, b) => b.total - a.total || compareLabels(a.value, b.value)).map((v) => v.value);
}

/**
 * Esito di «Rinomina» di un valore: se il nuovo nome corrisponde (senza maiuscole, spazi e accenti)
 * a un altro valore già usato, diventa un'unione e si tiene una grafia esistente: quella scritta se
 * coincide con una delle varianti (anche il valore rinominato: «Gaia» → «Gaia» unisce a «Gaia» le
 * varianti come «GAIA»), altrimenti la prima delle varianti in `existing` (passare `labelsByUsage`: la più usata).
 * `sources` sono i valori da sostituire con `value` (il valore rinominato, se cambia, e le altre varianti),
 * così dopo l'unione ne resta una sola. null se il nuovo nome è vuoto.
 */
export function renameTarget(
  from: string,
  to: string | null | undefined,
  existing: Iterable<string>,
): { value: string; merged: boolean; sources: string[] } | null {
  const clean = cleanLabel(to);
  if (!clean) return null;
  const key = labelKey(clean);
  const variants = [...existing].filter((v) => labelKey(v) === key);
  const twins = variants.filter((v) => v !== from);
  if (twins.length === 0) return { value: clean, merged: false, sources: [from] };
  const value = clean === from || twins.includes(clean) ? clean : (variants[0] ?? clean);
  return { value, merged: true, sources: [from, ...twins].filter((v) => v !== value) };
}
