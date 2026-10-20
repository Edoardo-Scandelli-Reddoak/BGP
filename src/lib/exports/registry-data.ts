import "server-only";
import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { contacts, pieces, products, requestItems, sampleRequests } from "@/db/schema";
import { SHIPPED_STATUSES } from "@/lib/status";
import type { ContactExportRow, ProductExportRow } from "./registry-xlsx";

/**
 * Righe degli export delle anagrafiche. La condizione `where` è quella degli elenchi
 * (contactWhere / productWhere in anagrafiche/_lib/queries.ts): il file contiene ciò che l'elenco mostra.
 */

/** Clienti (mai gli agenti: compaiono nelle colonne Agent) con il loro agente, ordinati come l'elenco contatti. */
export async function getContactExportRows(where: SQL | undefined): Promise<ContactExportRow[]> {
  const agent = alias(contacts, "agent");
  return db
    .select({
      name: contacts.name,
      email: contacts.email,
      defaultAddress: contacts.defaultAddress,
      agentName: agent.name,
      agentEmail: agent.email,
      language: contacts.language,
      country: contacts.country,
      phone: contacts.phone,
    })
    .from(contacts)
    .leftJoin(agent, eq(agent.id, contacts.agentId))
    .where(and(eq(contacts.type, "CLIENTE"), where))
    .orderBy(asc(contacts.name), asc(contacts.id));
}

/** Numero di contatti per una condizione degli elenchi (es. clienti senza paese). */
export async function countContacts(where: SQL | undefined): Promise<number> {
  const [row] = await db.select({ n: count() }).from(contacts).where(where);
  return row?.n ?? 0;
}

/** Prodotti filtrati, nello stesso ordine dell'elenco: codice, più richiesti o più m² spediti. */
export async function getProductExportRows(
  where: SQL | undefined,
  sort: "codice" | "richiesti" | "mq" = "codice",
): Promise<ProductExportRow[]> {
  const columns = {
    code: products.code,
    description: products.description,
    brand: products.brand,
    category: products.category,
    pricePerM2: products.pricePerM2,
    active: products.active,
  };
  if (sort === "richiesti") {
    const usage = db
      .select({ productId: requestItems.productId, times: sql<number>`count(*)`.as("times") })
      .from(requestItems)
      .groupBy(requestItems.productId)
      .as("usage");
    return db
      .select(columns)
      .from(products)
      .leftJoin(usage, eq(usage.productId, products.id))
      .where(where)
      .orderBy(sql`${usage.times} desc nulls last`, asc(products.code));
  }
  if (sort === "mq") {
    const shipped = db
      .select({ productId: pieces.productId, m2: sql<string>`sum(${pieces.areaM2})`.as("m2") })
      .from(pieces)
      .innerJoin(sampleRequests, eq(sampleRequests.id, pieces.requestId))
      .where(inArray(sampleRequests.status, SHIPPED_STATUSES))
      .groupBy(pieces.productId)
      .as("shipped");
    return db
      .select(columns)
      .from(products)
      .leftJoin(shipped, eq(shipped.productId, products.id))
      .where(where)
      .orderBy(sql`${shipped.m2} desc nulls last`, asc(products.code));
  }
  return db.select(columns).from(products).where(where).orderBy(asc(products.code));
}
