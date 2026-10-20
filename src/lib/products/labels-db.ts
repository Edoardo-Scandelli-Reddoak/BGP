import "server-only";
import { and, count, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { BRAND_SUGGESTIONS, CATEGORY_SUGGESTIONS } from "@/components/anagrafiche/constants";
import { canonicalLabel, cleanLabel, compareLabels, labelsByUsage, renameTarget, type ProductLabelField } from "./labels";

/**
 * Marchio e categoria dei prodotti sul database: valori in uso, assegnazione in blocco ai prodotti
 * filtrati, rinomina/unione e rimozione di un valore. Senza controllo dei permessi (lo fanno le
 * server action che lo usano), così si può provare direttamente nei test di integrazione.
 */

export const PRODUCT_LABEL_FIELDS: ProductLabelField[] = ["brand", "category"];

const COLUMNS = { brand: products.brand, category: products.category } as const;

/** Valori del blueprint BGP: proposti nei campi e usati come grafia di riferimento («aquawood» → «Aquawood»). */
export const PRODUCT_LABEL_SUGGESTIONS: Record<ProductLabelField, readonly string[]> = {
  brand: BRAND_SUGGESTIONS,
  category: CATEGORY_SUGGESTIONS,
};

/** Valore assente: null, vuoto o solo spazi (filtro «Senza marchio» / «Senza categoria»). */
export function labelMissing(field: ProductLabelField): SQL {
  return sql`coalesce(btrim(${COLUMNS[field]}), '') = ''`;
}

function labelPresent(field: ProductLabelField): SQL {
  return sql`coalesce(btrim(${COLUMNS[field]}), '') <> ''`;
}

/** `{ brand: v }` oppure `{ category: v }` per l'UPDATE. */
function setLabel(field: ProductLabelField, value: string | null) {
  return field === "brand" ? { brand: value } : { category: value };
}

const activeCount = () => sql<number>`count(*) filter (where ${products.active})`.mapWith(Number);

/** Valori distinti in uso, in ordine alfabetico (le varianti dello stesso valore restano vicine). */
export async function distinctLabels(field: ProductLabelField, opts: { excludeProductId?: number } = {}): Promise<string[]> {
  const col = COLUMNS[field];
  const rows = await db
    .selectDistinct({ v: col })
    .from(products)
    .where(and(labelPresent(field), opts.excludeProductId ? ne(products.id, opts.excludeProductId) : undefined));
  return rows.map((r) => r.v!).sort(compareLabels);
}

/**
 * Valore da salvare: la grafia già usata dagli altri prodotti (la più usata, come nell'import), poi
 * quella dei suggerimenti del blueprint, altrimenti il valore ripulito dagli spazi. `excludeProductId`
 * (modifica di un prodotto) esclude il prodotto stesso, così se ne può correggere la grafia.
 */
export async function canonicalProductLabel(
  field: ProductLabelField,
  value: string | null | undefined,
  opts: { excludeProductId?: number } = {},
): Promise<string | null> {
  if (!cleanLabel(value)) return null;
  const col = COLUMNS[field];
  const rows = await db
    .select({ value: col, total: count() })
    .from(products)
    .where(and(labelPresent(field), opts.excludeProductId ? ne(products.id, opts.excludeProductId) : undefined))
    .groupBy(col);
  const existing = labelsByUsage(rows.map((r) => ({ value: r.value!, total: r.total })));
  return canonicalLabel(value, [...existing, ...PRODUCT_LABEL_SUGGESTIONS[field]]);
}

export type LabelAssignment = {
  brand?: string | null;
  category?: string | null;
  /** false: solo dove il campo manca (campo per campo); true: sostituisce anche i valori presenti. */
  overwrite: boolean;
};

/**
 * Assegna marchio e/o categoria ai prodotti che soddisfano `where` (i filtri dell'elenco) con un solo
 * UPDATE. Un campo vuoto non viene toccato. Restituisce quanti prodotti sono cambiati e i valori
 * effettivamente salvati (allineati alla grafia già in uso).
 */
export async function assignProductLabels(
  where: SQL | undefined,
  input: LabelAssignment,
): Promise<{ updated: number; brand: string | null; category: string | null }> {
  const [brand, category] = await Promise.all([
    canonicalProductLabel("brand", input.brand),
    canonicalProductLabel("category", input.category),
  ]);
  const values = { brand, category };
  const set: { brand?: string | SQL; category?: string | SQL } = {};
  const changes: SQL[] = [];
  for (const field of PRODUCT_LABEL_FIELDS) {
    const value = values[field];
    if (!value) continue;
    const col = COLUMNS[field];
    if (input.overwrite) {
      set[field] = value;
      changes.push(sql`${col} is distinct from ${value}`);
    } else {
      set[field] = sql`case when ${labelMissing(field)} then ${value} else ${col} end`;
      changes.push(labelMissing(field));
    }
  }
  if (changes.length === 0) return { updated: 0, brand, category };

  // solo le righe che cambiano davvero: il conteggio restituito è quello dei prodotti modificati
  const rows = await db
    .update(products)
    .set(set)
    .where(and(where, or(...changes)))
    .returning({ id: products.id });
  return { updated: rows.length, brand, category };
}

export type RenameResult =
  /** `replaced`: valori sostituiti da `value` (non più in uso dopo l'operazione). */
  | { status: "ok"; updated: number; value: string; merged: boolean; replaced: string[] }
  | { status: "empty" | "unchanged" | "not-found" };

/**
 * Rinomina un valore su tutti i prodotti. Se il nuovo nome corrisponde a un altro valore esistente
 * (maiuscole, spazi, accenti) i prodotti vengono uniti a quel valore (vedi `renameTarget`).
 */
export async function renameProductLabel(field: ProductLabelField, from: string, to: string): Promise<RenameResult> {
  const { values } = await productLabelUsage(field);
  if (!values.some((v) => v.value === from)) return { status: "not-found" };
  const target = renameTarget(from, to, labelsByUsage(values));
  if (!target) return { status: "empty" };
  if (target.value === from && !target.merged) return { status: "unchanged" };

  const col = COLUMNS[field];
  const rows = await db
    .update(products)
    .set(setLabel(field, target.value))
    .where(inArray(col, target.sources))
    .returning({ id: products.id });
  return { status: "ok", updated: rows.length, value: target.value, merged: target.merged, replaced: target.sources };
}

/** Toglie un valore da tutti i prodotti che lo hanno (il campo torna vuoto). */
export async function clearProductLabel(field: ProductLabelField, value: string): Promise<number> {
  const rows = await db
    .update(products)
    .set(setLabel(field, null))
    .where(eq(COLUMNS[field], value))
    .returning({ id: products.id });
  return rows.length;
}

export type LabelUsage = {
  values: { value: string; total: number; active: number }[];
  missing: { total: number; active: number };
};

/** Valori in uso con il numero di prodotti (totali e attivi) e i prodotti senza valore. */
export async function productLabelUsage(field: ProductLabelField): Promise<LabelUsage> {
  const col = COLUMNS[field];
  const [values, [missing]] = await Promise.all([
    db
      .select({ value: col, total: count(), active: activeCount() })
      .from(products)
      .where(labelPresent(field))
      .groupBy(col),
    db.select({ total: count(), active: activeCount() }).from(products).where(labelMissing(field)),
  ]);
  return {
    values: values.map((v) => ({ value: v.value!, total: v.total, active: v.active })).sort((a, b) => compareLabels(a.value, b.value)),
    missing: { total: missing?.total ?? 0, active: missing?.active ?? 0 },
  };
}

/** Prodotti attivi senza marchio / senza categoria (riepilogo dell'elenco e dell'indice anagrafiche). */
export async function productLabelCompletion(): Promise<{ active: number; missingBrand: number; missingCategory: number }> {
  const [row] = await db
    .select({
      active: activeCount(),
      missingBrand: sql<number>`count(*) filter (where ${products.active} and ${labelMissing("brand")})`.mapWith(Number),
      missingCategory: sql<number>`count(*) filter (where ${products.active} and ${labelMissing("category")})`.mapWith(Number),
    })
    .from(products);
  return { active: row?.active ?? 0, missingBrand: row?.missingBrand ?? 0, missingCategory: row?.missingCategory ?? 0 };
}
