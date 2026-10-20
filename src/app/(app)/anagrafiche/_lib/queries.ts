import "server-only";
import { cache } from "react";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  contacts,
  pieces,
  products,
  requestItems,
  sampleRequests,
  type ContactType,
  type Language,
} from "@/db/schema";
import { likePattern } from "@/lib/search";
import { SHIPPED_STATUSES } from "@/lib/status";
import { parseDbId } from "@/lib/validation";
import { PAGE_SIZE } from "@/components/anagrafiche/constants";

function words(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

/* ------------------------------------------------------------------ */
/* Contatti                                                            */
/* ------------------------------------------------------------------ */

export type ContactFilters = {
  q: string;
  type: ContactType | null;
  /** id dell'agente, oppure "nessuno" per i clienti direzionali (senza agente). */
  agent: number | "nessuno" | null;
  language: Language | null;
  /** valore del paese, oppure "-" per "Non indicato". */
  country: string | null;
  review: boolean;
  /** "1" solo attivi (predefinito), "0" solo disattivati, "tutti". */
  active: "1" | "0" | "tutti";
};

type Params = Record<string, string | string[] | undefined>;

export function param(sp: Params, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function parseContactFilters(sp: Params): ContactFilters {
  const tipo = param(sp, "tipo");
  const agente = param(sp, "agente");
  const lingua = param(sp, "lingua");
  const attivi = param(sp, "attivi");
  return {
    q: param(sp, "q").slice(0, 200),
    type: tipo === "AGENTE" || tipo === "CLIENTE" ? tipo : null,
    agent: agente === "nessuno" ? "nessuno" : parseDbId(agente),
    language: lingua === "it" || lingua === "en" || lingua === "fr" || lingua === "de" ? lingua : null,
    country: param(sp, "paese").slice(0, 80) || null,
    review: param(sp, "verifica") === "1",
    active: attivi === "0" ? "0" : attivi === "tutti" ? "tutti" : "1",
  };
}

function contactWhere(f: ContactFilters): SQL | undefined {
  const conds: SQL[] = [];
  for (const w of words(f.q)) {
    const p = likePattern(w);
    conds.push(
      or(
        ilike(contacts.name, p),
        ilike(contacts.company, p),
        ilike(contacts.email, p),
        ilike(contacts.defaultAddress, p),
        ilike(contacts.phone, p),
      )!,
    );
  }
  if (f.type) conds.push(eq(contacts.type, f.type));
  if (f.agent === "nessuno") conds.push(eq(contacts.type, "CLIENTE"), isNull(contacts.agentId));
  else if (f.agent) conds.push(eq(contacts.agentId, f.agent));
  if (f.language) conds.push(eq(contacts.language, f.language));
  if (f.country === "-") conds.push(or(isNull(contacts.country), eq(contacts.country, ""))!);
  else if (f.country) conds.push(eq(contacts.country, f.country));
  if (f.review) conds.push(eq(contacts.needsReview, true));
  if (f.active === "1") conds.push(eq(contacts.active, true));
  else if (f.active === "0") conds.push(eq(contacts.active, false));
  return conds.length ? and(...conds) : undefined;
}

export async function listContacts(f: ContactFilters, page: number) {
  const where = contactWhere(f);
  const agent = alias(contacts, "agent");
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: contacts.id,
        type: contacts.type,
        name: contacts.name,
        company: contacts.company,
        email: contacts.email,
        language: contacts.language,
        country: contacts.country,
        active: contacts.active,
        needsReview: contacts.needsReview,
        agentId: contacts.agentId,
        agentName: agent.name,
        // conteggi correlati (indici su contact_id e agent_id), solo per le 50 righe della pagina.
        // Qualificatori espliciti: drizzle li omette nelle select su una sola tabella.
        requestsCount: sql<number>`(select count(*) from sample_requests r where r.contact_id = "contacts"."id")`.mapWith(Number),
        clientsCount: sql<number>`(case when "contacts"."type" = 'AGENTE' then (select count(*) from contacts c2 where c2.agent_id = "contacts"."id") else 0 end)`.mapWith(Number),
      })
      .from(contacts)
      .leftJoin(agent, eq(agent.id, contacts.agentId))
      .where(where)
      .orderBy(asc(contacts.name), asc(contacts.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(contacts).where(where),
  ]);
  return { rows, total };
}

export type ContactListRow = Awaited<ReturnType<typeof listContacts>>["rows"][number];

/** Agenti per i filtri e per il campo "Agente di riferimento" (sono poche decine). */
export async function listAgents() {
  return db
    .select({ id: contacts.id, name: contacts.name, active: contacts.active })
    .from(contacts)
    .where(eq(contacts.type, "AGENTE"))
    .orderBy(asc(contacts.name));
}

export async function listCountries(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ country: contacts.country })
    .from(contacts)
    .where(and(isNotNull(contacts.country), ne(contacts.country, "")))
    .orderBy(asc(contacts.country));
  return rows.map((r) => r.country!).filter(Boolean);
}

export async function countContactsToReview(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(contacts)
    .where(and(eq(contacts.needsReview, true), eq(contacts.active, true)));
  return row?.n ?? 0;
}

export const getContactDetail = cache(async (id: number) => {
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, id),
    with: { agent: { columns: { id: true, name: true, email: true, active: true } } },
  });
  if (!contact) return null;

  const [[stats], [m2Row], [clients], requests] = await Promise.all([
    db
      .select({
        total: count(),
        shipped: sql<number>`count(*) filter (where ${inArray(sampleRequests.status, SHIPPED_STATUSES)})`.mapWith(Number),
        open: sql<number>`count(*) filter (where ${sampleRequests.status} <> 'COMPLETATA')`.mapWith(Number),
      })
      .from(sampleRequests)
      .where(eq(sampleRequests.contactId, id)),
    db
      .select({ m2: sql<number>`coalesce(sum(${pieces.areaM2}), 0)`.mapWith(Number) })
      .from(pieces)
      .innerJoin(sampleRequests, eq(sampleRequests.id, pieces.requestId))
      .where(and(eq(sampleRequests.contactId, id), inArray(sampleRequests.status, SHIPPED_STATUSES))),
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${contacts.active})`.mapWith(Number),
      })
      .from(contacts)
      .where(eq(contacts.agentId, id)),
    db
      .select({
        id: sampleRequests.id,
        status: sampleRequests.status,
        receivedAt: sampleRequests.receivedAt,
        shipmentDate: sampleRequests.shipmentDate,
        itemsCount: sql<number>`(select count(*) from request_items ri where ri.request_id = "sample_requests"."id")`.mapWith(Number),
        m2: sql<number>`(select coalesce(sum(p.area_m2), 0) from pieces p where p.request_id = "sample_requests"."id")`.mapWith(Number),
      })
      .from(sampleRequests)
      .where(eq(sampleRequests.contactId, id))
      .orderBy(desc(sampleRequests.receivedAt), desc(sampleRequests.id))
      .limit(100),
  ]);

  return {
    contact,
    stats: { requests: stats.total, shipped: stats.shipped, open: stats.open, m2Shipped: m2Row.m2 },
    clients: { total: clients.total, active: clients.active },
    requests,
  };
});

export type ContactDetail = NonNullable<Awaited<ReturnType<typeof getContactDetail>>>;

/** Vincoli per l'eliminazione: richieste collegate e (per gli agenti) clienti assegnati. */
export async function contactUsage(id: number) {
  const [[req], [cli]] = await Promise.all([
    db.select({ n: count() }).from(sampleRequests).where(eq(sampleRequests.contactId, id)),
    db.select({ n: count() }).from(contacts).where(eq(contacts.agentId, id)),
  ]);
  return { requests: req.n, clients: cli.n };
}

/* ------------------------------------------------------------------ */
/* Prodotti                                                            */
/* ------------------------------------------------------------------ */

export type ProductSort = "codice" | "richiesti" | "mq";

export type ProductFilters = {
  q: string;
  /** "" tutti (predefinito), "1" solo attivi, "0" solo disattivati. */
  active: "" | "1" | "0";
  brand: string | null;
  category: string | null;
  sort: ProductSort;
};

export function parseProductFilters(sp: Params): ProductFilters {
  const attivi = param(sp, "attivi");
  const ordina = param(sp, "ordina");
  return {
    q: param(sp, "q").slice(0, 200),
    active: attivi === "1" || attivi === "0" ? attivi : "",
    brand: param(sp, "marchio").slice(0, 100) || null,
    category: param(sp, "categoria").slice(0, 100) || null,
    sort: ordina === "richiesti" || ordina === "mq" ? ordina : "codice",
  };
}

function productWhere(f: ProductFilters): SQL | undefined {
  const conds: SQL[] = words(f.q).map(
    (w) => or(ilike(products.code, likePattern(w)), ilike(products.description, likePattern(w)))!,
  );
  if (f.active === "1") conds.push(eq(products.active, true));
  else if (f.active === "0") conds.push(eq(products.active, false));
  if (f.brand) conds.push(eq(products.brand, f.brand));
  if (f.category) conds.push(eq(products.category, f.category));
  return conds.length ? and(...conds) : undefined;
}

export async function listProducts(f: ProductFilters, page: number) {
  const where = productWhere(f);
  // aggregati calcolati una volta in SQL e uniti con LEFT JOIN (niente query per riga)
  const usage = db
    .select({ productId: requestItems.productId, times: sql<number>`count(*)`.as("times") })
    .from(requestItems)
    .groupBy(requestItems.productId)
    .as("usage");
  const shipped = db
    .select({ productId: pieces.productId, m2: sql<string>`sum(${pieces.areaM2})`.as("m2") })
    .from(pieces)
    .innerJoin(sampleRequests, eq(sampleRequests.id, pieces.requestId))
    .where(inArray(sampleRequests.status, SHIPPED_STATUSES))
    .groupBy(pieces.productId)
    .as("shipped");

  const order =
    f.sort === "richiesti"
      ? [sql`${usage.times} desc nulls last`, asc(products.code)]
      : f.sort === "mq"
        ? [sql`${shipped.m2} desc nulls last`, asc(products.code)]
        : [asc(products.code)];

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        code: products.code,
        description: products.description,
        brand: products.brand,
        category: products.category,
        active: products.active,
        times: usage.times,
        m2: shipped.m2,
      })
      .from(products)
      .leftJoin(usage, eq(usage.productId, products.id))
      .leftJoin(shipped, eq(shipped.productId, products.id))
      .where(where)
      .orderBy(...order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(products).where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, times: Number(r.times ?? 0), m2: Number(r.m2 ?? 0) })),
    total,
  };
}

/** Valori già usati per marchio e categoria (filtri e suggerimenti). */
export async function listProductFacets() {
  const [brands, categories] = await Promise.all([
    db
      .selectDistinct({ v: products.brand })
      .from(products)
      .where(and(isNotNull(products.brand), ne(products.brand, "")))
      .orderBy(asc(products.brand)),
    db
      .selectDistinct({ v: products.category })
      .from(products)
      .where(and(isNotNull(products.category), ne(products.category, "")))
      .orderBy(asc(products.category)),
  ]);
  return { brands: brands.map((r) => r.v!), categories: categories.map((r) => r.v!) };
}

export const getProductDetail = cache(async (id: number) => {
  const product = await db.query.products.findFirst({ where: eq(products.id, id) });
  if (!product) return null;

  const [[usage], [ship], requests] = await Promise.all([
    db
      .select({
        items: count(),
        requests: sql<number>`count(distinct ${requestItems.requestId})`.mapWith(Number),
        quantity: sql<number>`coalesce(sum(${requestItems.quantity}), 0)`.mapWith(Number),
      })
      .from(requestItems)
      .where(eq(requestItems.productId, id)),
    db
      .select({
        m2: sql<number>`coalesce(sum(${pieces.areaM2}), 0)`.mapWith(Number),
        pieces: sql<number>`coalesce(sum(${pieces.quantity}), 0)`.mapWith(Number),
        lastShipment: sql<string | null>`max(${sampleRequests.shipmentDate})`,
      })
      .from(pieces)
      .innerJoin(sampleRequests, eq(sampleRequests.id, pieces.requestId))
      .where(and(eq(pieces.productId, id), inArray(sampleRequests.status, SHIPPED_STATUSES))),
    db
      .select({
        requestId: sampleRequests.id,
        status: sampleRequests.status,
        receivedAt: sampleRequests.receivedAt,
        contactId: contacts.id,
        contactName: contacts.name,
        quantity: requestItems.quantity,
        m2: sql<number>`(select coalesce(sum(p.area_m2), 0) from pieces p where p.request_id = "sample_requests"."id" and p.product_id = "request_items"."product_id")`.mapWith(Number),
      })
      .from(requestItems)
      .innerJoin(sampleRequests, eq(sampleRequests.id, requestItems.requestId))
      .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
      .where(eq(requestItems.productId, id))
      .orderBy(desc(sampleRequests.receivedAt), desc(requestItems.id))
      .limit(50),
  ]);

  return {
    product,
    stats: {
      items: usage.items,
      requests: usage.requests,
      quantity: usage.quantity,
      m2Shipped: ship.m2,
      piecesShipped: ship.pieces,
      lastShipment: ship.lastShipment,
    },
    requests,
  };
});

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>;

/** Vincoli per l'eliminazione: prodotto presente in richieste o pezzi misurati. */
export async function productUsage(id: number) {
  const [[items], [pcs]] = await Promise.all([
    db.select({ n: count() }).from(requestItems).where(eq(requestItems.productId, id)),
    db.select({ n: count() }).from(pieces).where(eq(pieces.productId, id)),
  ]);
  return { items: items.n, pieces: pcs.n };
}

/* ------------------------------------------------------------------ */
/* Riepilogo anagrafiche (pagina import)                               */
/* ------------------------------------------------------------------ */

export async function registryCounts() {
  const [[c], [p]] = await Promise.all([
    db
      .select({
        customers: sql<number>`count(*) filter (where ${contacts.type} = 'CLIENTE')`.mapWith(Number),
        agents: sql<number>`count(*) filter (where ${contacts.type} = 'AGENTE')`.mapWith(Number),
      })
      .from(contacts),
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${products.active})`.mapWith(Number),
      })
      .from(products),
  ]);
  return { customers: c.customers, agents: c.agents, products: p.total, activeProducts: p.active };
}
