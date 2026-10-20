import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contacts, products, type Language } from "@/db/schema";
import {
  agentKey,
  customerKey,
  parseContactRows,
  parseProductRows,
  type ParsedCustomer,
  type RawRow,
} from "./parse";

export type ImportSummary = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: { row: number; reason: string }[];
  agentsCreated?: number;
  agentsUpdated?: number;
};

const CHUNK = 500;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Lingua dell'agente: la più frequente tra i suoi clienti (gli agenti esteri scrivono in inglese/francese/tedesco). */
function agentLanguages(customers: ParsedCustomer[]): Map<string, Language> {
  const votes = new Map<string, Map<Language, number>>();
  for (const c of customers) {
    if (!c.agentKey) continue;
    const m = votes.get(c.agentKey) ?? new Map<Language, number>();
    m.set(c.language, (m.get(c.language) ?? 0) + 1);
    votes.set(c.agentKey, m);
  }
  const out = new Map<string, Language>();
  for (const [k, m] of votes) out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

/**
 * Importa/aggiorna i contatti dal file Airtable di BGP.
 * - Gli agenti (colonne Agent name / Agent email) diventano contatti di tipo AGENTE.
 * - I clienti sono riconosciuti tra un import e l'altro per nome + indirizzo:
 *   se esistono vengono aggiornati (email, agente, lingua, paese), altrimenti creati.
 * - I contatti già presenti e assenti dal file non vengono toccati.
 */
export async function importContacts(rows: RawRow[]): Promise<ImportSummary> {
  const { agents, customers } = parseContactRows(rows);
  const langs = agentLanguages(customers.rows);

  const existing = await db
    .select({
      id: contacts.id,
      type: contacts.type,
      name: contacts.name,
      email: contacts.email,
      defaultAddress: contacts.defaultAddress,
      country: contacts.country,
      language: contacts.language,
      agentId: contacts.agentId,
      phone: contacts.phone,
    })
    .from(contacts);

  const agentIdByKey = new Map<string, number>();
  for (const c of existing.filter((c) => c.type === "AGENTE")) agentIdByKey.set(agentKey(c.name, c.email), c.id);

  let agentsCreated = 0;
  let agentsUpdated = 0;
  for (const a of agents) {
    const id = agentIdByKey.get(a.key);
    if (id) {
      const cur = existing.find((c) => c.id === id)!;
      if (cur.name !== a.name || (a.email && cur.email !== a.email)) {
        await db.update(contacts).set({ name: a.name, email: a.email ?? cur.email }).where(eq(contacts.id, id));
        agentsUpdated++;
      }
    } else {
      const [row] = await db
        .insert(contacts)
        .values({ type: "AGENTE", name: a.name, email: a.email, language: langs.get(a.key) ?? "it" })
        .returning({ id: contacts.id });
      agentIdByKey.set(a.key, row.id);
      agentsCreated++;
    }
  }

  const customerByKey = new Map(
    existing.filter((c) => c.type === "CLIENTE").map((c) => [customerKey(c.name, c.defaultAddress), c]),
  );
  const toInsert: (typeof contacts.$inferInsert)[] = [];
  let updated = 0;
  let unchanged = 0;
  for (const c of customers.rows) {
    const agentId = c.agentKey ? (agentIdByKey.get(c.agentKey) ?? null) : null;
    const cur = customerByKey.get(c.key);
    if (!cur) {
      toInsert.push({
        type: "CLIENTE",
        name: c.name,
        email: c.email,
        defaultAddress: c.defaultAddress,
        country: c.country,
        language: c.language,
        phone: c.phone,
        agentId,
      });
      continue;
    }
    const patch = {
      email: c.email ?? cur.email,
      country: c.country ?? cur.country,
      language: c.language,
      agentId,
      phone: c.phone ?? cur.phone,
    };
    const changed =
      patch.email !== cur.email ||
      patch.country !== cur.country ||
      patch.language !== cur.language ||
      patch.agentId !== cur.agentId ||
      patch.phone !== cur.phone;
    if (changed) {
      await db.update(contacts).set(patch).where(eq(contacts.id, cur.id));
      updated++;
    } else unchanged++;
  }
  for (const part of chunks(toInsert)) await db.insert(contacts).values(part);

  return {
    created: toInsert.length,
    updated,
    unchanged,
    skipped: customers.skipped,
    agentsCreated,
    agentsUpdated,
  };
}

/**
 * Importa/aggiorna il catalogo prodotti (codice + descrizione).
 * I prodotti esistenti vengono riconosciuti dal codice (senza distinzione maiuscole) e riattivati.
 */
export async function importProducts(rows: RawRow[]): Promise<ImportSummary> {
  const parsed = parseProductRows(rows);
  const existing = await db
    .select({ id: products.id, code: products.code, description: products.description, active: products.active })
    .from(products);
  const byCode = new Map(existing.map((p) => [p.code.toUpperCase(), p]));

  const toInsert: (typeof products.$inferInsert)[] = [];
  const toUpdate: { id: number; description: string }[] = [];
  const toReactivate: number[] = [];
  let unchanged = 0;
  for (const p of parsed.rows) {
    const cur = byCode.get(p.code.toUpperCase());
    if (!cur) toInsert.push({ code: p.code, description: p.description, active: true });
    else if (cur.description !== p.description && p.description) toUpdate.push({ id: cur.id, description: p.description });
    else if (!cur.active) toReactivate.push(cur.id);
    else unchanged++;
  }
  for (const part of chunks(toInsert)) await db.insert(products).values(part);
  for (const u of toUpdate) {
    await db.update(products).set({ description: u.description, active: true }).where(eq(products.id, u.id));
  }
  for (const part of chunks(toReactivate)) {
    await db.update(products).set({ active: true }).where(inArray(products.id, part));
  }
  return {
    created: toInsert.length,
    updated: toUpdate.length + toReactivate.length,
    unchanged,
    skipped: parsed.skipped,
  };
}
