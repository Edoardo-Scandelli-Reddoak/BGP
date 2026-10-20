import "server-only";
import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { contacts, products } from "@/db/schema";
import type { ContactOption, ProductOption } from "@/components/pickers/types";

/** Escape dei caratteri speciali di LIKE. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Ogni parola deve comparire nel codice o nella descrizione ("rovere spazzolato 190"). */
export async function searchProducts(q: string, opts: { onlyActive?: boolean; limit?: number } = {}): Promise<ProductOption[]> {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return [];
  const conds: SQL[] = words.map((w) => or(ilike(products.code, likePattern(w)), ilike(products.description, likePattern(w)))!);
  if (opts.onlyActive) conds.push(eq(products.active, true));
  const first = words[0];
  return db
    .select({ id: products.id, code: products.code, description: products.description, active: products.active })
    .from(products)
    .where(and(...conds))
    // prima le corrispondenze esatte o iniziali sul codice
    .orderBy(
      sql`case when upper(${products.code}) = upper(${first}) then 0 when ${products.code} ilike ${first + "%"} then 1 else 2 end`,
      asc(products.code),
    )
    .limit(opts.limit ?? 20);
}

export async function searchContacts(q: string, opts: { type?: "AGENTE" | "CLIENTE"; limit?: number } = {}): Promise<ContactOption[]> {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return [];
  const conds: SQL[] = words.map(
    (w) =>
      or(
        ilike(contacts.name, likePattern(w)),
        ilike(contacts.company, likePattern(w)),
        ilike(contacts.email, likePattern(w)),
        ilike(contacts.defaultAddress, likePattern(w)),
      )!,
  );
  conds.push(eq(contacts.active, true));
  if (opts.type) conds.push(eq(contacts.type, opts.type));
  const rows = await db.query.contacts.findMany({
    where: and(...conds),
    with: { agent: { columns: { name: true, email: true } } },
    orderBy: [asc(contacts.name)],
    limit: opts.limit ?? 20,
  });
  return rows.map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    email: c.email,
    defaultAddress: c.defaultAddress,
    country: c.country,
    language: c.language,
    agentName: c.agent?.name ?? null,
    agentEmail: c.agent?.email ?? null,
    needsReview: c.needsReview,
    company: c.company,
    phone: c.phone,
  }));
}
