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

export type ImportRowMessage = { row: number; reason: string };

export type ImportSummary = {
  created: number;
  updated: number;
  unchanged: number;
  /** Righe non importate. */
  skipped: ImportRowMessage[];
  /** Righe importate con un valore da verificare (es. lingua mancante impostata a italiano). */
  warnings: ImportRowMessage[];
  agentsCreated?: number;
  agentsUpdated?: number;
};

const CHUNK = 500;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Lingua dell'agente: la più frequente tra i suoi clienti (gli agenti esteri scrivono in inglese/francese/tedesco).
 * I clienti senza lingua non votano: un agente senza voti non compare nella mappa.
 */
function agentLanguages(customers: ParsedCustomer[]): Map<string, Language> {
  const votes = new Map<string, Map<Language, number>>();
  for (const c of customers) {
    if (!c.agentKey || !c.language) continue;
    const m = votes.get(c.agentKey) ?? new Map<Language, number>();
    m.set(c.language, (m.get(c.language) ?? 0) + 1);
    votes.set(c.agentKey, m);
  }
  const out = new Map<string, Language>();
  for (const [k, m] of votes) out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

/** Messaggio per una lingua mancante o non riconosciuta nel file. */
function languageProblem(c: ParsedCustomer): string {
  return c.languageRaw ? `lingua «${c.languageRaw}» non riconosciuta` : "lingua mancante";
}

/**
 * Importa/aggiorna i contatti dal file Airtable di BGP.
 * - Gli agenti (colonne Agent name / Agent email) diventano contatti di tipo AGENTE.
 * - I clienti sono riconosciuti tra un import e l'altro per nome + indirizzo:
 *   se esistono vengono aggiornati (email, agente, lingua, paese), altrimenti creati.
 * - Lingua mancante (obbligatoria per BGP): un contatto nuovo viene creato in italiano e segnato
 *   «da verificare», uno esistente mantiene la sua lingua; in entrambi i casi un avviso nel riepilogo.
 * - Il paese ricavato dall'indirizzo non sostituisce mai quello già salvato (una colonna Paese sì).
 * - I contatti già presenti e assenti dal file non vengono toccati.
 */
export async function importContacts(rows: RawRow[]): Promise<ImportSummary> {
  const { agents, customers } = parseContactRows(rows);
  const langs = agentLanguages(customers.rows);

  // Tutto o niente: un errore a metà non lascia un import parziale.
  return db.transaction(async (tx) => {
    const existing = await tx
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

    const warnings: ImportSummary["warnings"] = [];
    let agentsCreated = 0;
    let agentsUpdated = 0;
    for (const a of agents) {
      const id = agentIdByKey.get(a.key);
      if (id) {
        const cur = existing.find((c) => c.id === id)!;
        if (cur.name !== a.name || (a.email && cur.email !== a.email)) {
          await tx.update(contacts).set({ name: a.name, email: a.email ?? cur.email }).where(eq(contacts.id, id));
          agentsUpdated++;
        }
      } else {
        const language = langs.get(a.key);
        const [row] = await tx
          .insert(contacts)
          .values({ type: "AGENTE", name: a.name, email: a.email, language: language ?? "it", needsReview: !language })
          .returning({ id: contacts.id });
        agentIdByKey.set(a.key, row.id);
        agentsCreated++;
        if (!language) {
          warnings.push({
            row: a.row,
            reason: `Agente ${a.name}: nessun cliente con la lingua indicata, impostato italiano — da verificare`,
          });
        }
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
          language: c.language ?? "it",
          needsReview: c.language === null,
          phone: c.phone,
          agentId,
        });
        if (!c.language) {
          warnings.push({ row: c.row, reason: `${c.name}: ${languageProblem(c)}, impostato italiano — da verificare` });
        }
        continue;
      }
      // Lingua mancante nel file per un contatto già presente: si tiene quella in anagrafica,
      // senza avvisi (altrimenti ricomparirebbero a ogni import anche dopo la correzione).
      const patch = {
        email: c.email ?? cur.email,
        // il paese ricavato dall'indirizzo completa solo un paese mancante
        country: c.countryDerived ? (cur.country ?? c.country) : (c.country ?? cur.country),
        language: c.language ?? cur.language,
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
        await tx.update(contacts).set(patch).where(eq(contacts.id, cur.id));
        updated++;
      } else unchanged++;
    }
    for (const part of chunks(toInsert)) await tx.insert(contacts).values(part);

    return {
      created: toInsert.length,
      updated,
      unchanged,
      skipped: customers.skipped,
      warnings: warnings.sort((a, b) => a.row - b.row),
      agentsCreated,
      agentsUpdated,
    };
  });
}

/**
 * Importa/aggiorna il catalogo prodotti (codice + descrizione, facoltativi marchio, categoria e prezzo al m²).
 * I prodotti esistenti vengono riconosciuti dal codice (senza distinzione maiuscole) e riattivati.
 * Le celle vuote (o, per il prezzo, non numeriche) non cancellano i valori già salvati.
 */
export async function importProducts(rows: RawRow[]): Promise<ImportSummary> {
  const parsed = parseProductRows(rows);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: products.id,
        code: products.code,
        description: products.description,
        brand: products.brand,
        category: products.category,
        pricePerM2: products.pricePerM2,
        active: products.active,
      })
      .from(products);
    const byCode = new Map(existing.map((p) => [p.code.toUpperCase(), p]));

    type ProductPatch = Partial<Pick<typeof products.$inferInsert, "description" | "brand" | "category" | "pricePerM2">>;
    const toInsert: (typeof products.$inferInsert)[] = [];
    const toUpdate: { id: number; patch: ProductPatch }[] = [];
    const toReactivate: number[] = [];
    let unchanged = 0;
    for (const p of parsed.rows) {
      const cur = byCode.get(p.code.toUpperCase());
      if (!cur) {
        toInsert.push({
          code: p.code,
          description: p.description,
          brand: p.brand,
          category: p.category,
          pricePerM2: p.pricePerM2 ?? null,
          active: true,
        });
        continue;
      }
      const patch: ProductPatch = {};
      if (p.description && cur.description !== p.description) patch.description = p.description;
      if (p.brand && cur.brand !== p.brand) patch.brand = p.brand;
      if (p.category && cur.category !== p.category) patch.category = p.category;
      if (p.pricePerM2 !== undefined && (cur.pricePerM2 === null || Number(cur.pricePerM2) !== p.pricePerM2)) {
        patch.pricePerM2 = p.pricePerM2;
      }
      if (Object.keys(patch).length) toUpdate.push({ id: cur.id, patch });
      else if (!cur.active) toReactivate.push(cur.id);
      else unchanged++;
    }
    for (const part of chunks(toInsert)) await tx.insert(products).values(part);
    for (const u of toUpdate) {
      await tx.update(products).set({ ...u.patch, active: true }).where(eq(products.id, u.id));
    }
    for (const part of chunks(toReactivate)) {
      await tx.update(products).set({ active: true }).where(inArray(products.id, part));
    }
    return {
      created: toInsert.length,
      updated: toUpdate.length + toReactivate.length,
      unchanged,
      skipped: parsed.skipped,
      warnings: parsed.warnings ?? [],
    };
  });
}
