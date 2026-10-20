import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import type { ProductLabelField } from "@/lib/products/labels";

/**
 * Marchio e categoria dei prodotti nei report (cruscotto, report m², export CRM).
 * Il valore è quello dell'anagrafica senza spazi esterni; vuoto o assente → null («Non indicato»).
 * Richiede la tabella `products` nella FROM senza alias.
 */
export function productLabelSql(field: ProductLabelField): SQL<string | null> {
  return sql<string | null>`nullif(trim(${field === "brand" ? products.brand : products.category}), '')`;
}

/** Prodotti in anagrafica e quanti hanno marchio / categoria (per i messaggi «non ancora indicato»). */
export type ProductLabelCoverage = { products: number; brand: number; category: number };

export async function getProductLabelCoverage(): Promise<ProductLabelCoverage> {
  const [row] = await db
    .select({
      products: sql<number>`count(*)::int`.mapWith(Number),
      brand: sql<number>`(count(*) filter (where ${productLabelSql("brand")} is not null))::int`.mapWith(Number),
      category: sql<number>`(count(*) filter (where ${productLabelSql("category")} is not null))::int`.mapWith(Number),
    })
    .from(products);
  return row ?? { products: 0, brand: 0, category: 0 };
}
