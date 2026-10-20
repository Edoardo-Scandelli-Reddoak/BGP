import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { carriers, contacts, sampleRequests } from "@/db/schema";
import type { ProductLabelField } from "@/lib/products/labels";
import { likePattern } from "@/lib/search";
import { SHIPPED_STATUSES } from "@/lib/status";
import { effectiveShipmentDate, receivedBetween, romeDayStart } from "./conditions";
import { NONE_VALUE, type HistoryFilters } from "./history-filters";
import { addDays } from "./period";

export const HISTORY_PAGE_SIZE = 50;
/** Limite di sicurezza per l'export CSV. */
export const HISTORY_EXPORT_MAX = 20000;

const agent = alias(contacts, "agent");
/** Agente di riferimento: il contatto stesso se è un agente, altrimenti l'agente del cliente. */
const agentOf = sql<number | null>`(case when ${contacts.type} = 'AGENTE' then ${contacts.id} else ${contacts.agentId} end)`;

function words(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

/**
 * La richiesta contiene almeno un prodotto con quel marchio / quella categoria (stessi valori del
 * cruscotto: spazi esterni tolti); NONE_VALUE = almeno un prodotto senza valore in anagrafica.
 */
function hasProductLabel(field: ProductLabelField, value: string): SQL {
  const column = sql.raw(field === "brand" ? "pr.brand" : "pr.category");
  const match = value === NONE_VALUE ? sql`nullif(trim(${column}), '') is null` : sql`trim(${column}) = ${value}`;
  return sql`exists (
    select 1 from request_items ri join products pr on pr.id = ri.product_id
    where ri.request_id = ${sampleRequests.id} and ${match})`;
}

function buildConditions(f: HistoryFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.da && f.a) conds.push(receivedBetween(f.da, f.a));
  else if (f.da) conds.push(sql`${sampleRequests.receivedAt} >= ${romeDayStart(f.da)}`);
  else if (f.a) conds.push(sql`${sampleRequests.receivedAt} < ${romeDayStart(addDays(f.a, 1))}`);

  if (f.stato) conds.push(eq(sampleRequests.status, f.stato));
  if (f.origine) conds.push(eq(sampleRequests.source, f.origine));

  if (f.contatto) {
    // anche il destinatario: le richieste degli agenti sono spesso per un loro cliente
    for (const w of words(f.contatto)) {
      const p = likePattern(w);
      conds.push(
        or(ilike(contacts.name, p), ilike(contacts.company, p), ilike(contacts.email, p), ilike(sampleRequests.recipientName, p))!,
      );
    }
  }

  if (f.prodotto) {
    // tutte le parole devono comparire nello stesso prodotto (codice o descrizione)
    const match = sql.join(
      words(f.prodotto).map((w) => sql`(pr.code ilike ${likePattern(w)} or pr.description ilike ${likePattern(w)})`),
      sql` and `,
    );
    conds.push(sql`exists (
      select 1 from request_items ri join products pr on pr.id = ri.product_id
      where ri.request_id = ${sampleRequests.id} and ${match})`);
  }

  if (f.marchio) conds.push(hasProductLabel("brand", f.marchio));
  if (f.categoria) conds.push(hasProductLabel("category", f.categoria));

  // le richieste intestate a un agente contano per l'agente stesso (come nel cruscotto)
  if (f.agente === NONE_VALUE) conds.push(and(isNull(contacts.agentId), ne(contacts.type, "AGENTE"))!);
  else if (typeof f.agente === "number") conds.push(eq(agentOf, f.agente));

  if (f.paese === NONE_VALUE) conds.push(sql`nullif(trim(${contacts.country}), '') is null`);
  else if (f.paese) conds.push(sql`trim(${contacts.country}) = ${f.paese}`);

  return conds.length ? and(...conds) : undefined;
}

/** Riga richiesta: codice prodotto e formato del campione (valori di src/lib/sample-formats.ts). */
export type HistoryProductItem = { code: string; format: string | null; note: string | null };

function parseProductItems(value: unknown): HistoryProductItem[] {
  const list: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(list) ? (list as HistoryProductItem[]) : [];
}

/** Prodotti nell'ordine di inserimento, con il formato (lo stesso prodotto può comparire in due formati). */
const productItems = sql<HistoryProductItem[]>`(
  select coalesce(
    json_agg(json_build_object('code', pr.code, 'format', ri.sample_format, 'note', ri.format_note) order by ri.id),
    '[]'::json)
  from request_items ri join products pr on pr.id = ri.product_id
  where ri.request_id = ${sampleRequests.id})`.mapWith(parseProductItems);

const totalM2 = sql<number>`(
  select coalesce(sum(pc.area_m2), 0)::float8 from pieces pc where pc.request_id = ${sampleRequests.id})`.mapWith(Number);

/** «Spedita il»: data di spedizione effettiva (o di ritiro, se manca) delle sole richieste partite. */
const shippedOn = sql<string | null>`(case when ${inArray(sampleRequests.status, SHIPPED_STATUSES)} then ${effectiveShipmentDate} end)`;

const historyColumns = {
  id: sampleRequests.id,
  receivedAt: sampleRequests.receivedAt,
  status: sampleRequests.status,
  source: sampleRequests.source,
  contactId: contacts.id,
  contactName: contacts.name,
  recipientName: sampleRequests.recipientName,
  attentionOf: sampleRequests.attentionOf,
  country: contacts.country,
  agentName: agent.name,
  productItems,
  packagesCount: sampleRequests.packagesCount,
  weightKg: sampleRequests.weightKg,
  m2: totalM2,
  carrierName: carriers.name,
  carrierTrackingUrl: carriers.trackingUrlTemplate,
  pickupDate: sampleRequests.pickupDate,
  trackingNumber: sampleRequests.trackingNumber,
  shipmentDate: sampleRequests.shipmentDate,
  shippedOn,
  shippingCost: sampleRequests.shippingCost,
};

function historyQuery(f: HistoryFilters) {
  return db
    .select(historyColumns)
    .from(sampleRequests)
    .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
    .leftJoin(agent, eq(agent.id, agentOf))
    .leftJoin(carriers, eq(carriers.id, sampleRequests.carrierId))
    .where(buildConditions(f))
    .orderBy(desc(sampleRequests.receivedAt), desc(sampleRequests.id))
    .$dynamic();
}

export type HistoryRow = Awaited<ReturnType<typeof historyQuery>>[number];

export async function getHistoryPage(f: HistoryFilters, page: number): Promise<{ rows: HistoryRow[]; total: number }> {
  const [rows, [{ n }]] = await Promise.all([
    historyQuery(f)
      .limit(HISTORY_PAGE_SIZE)
      .offset((page - 1) * HISTORY_PAGE_SIZE),
    db
      .select({ n: count() })
      .from(sampleRequests)
      .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
      .where(buildConditions(f)),
  ]);
  return { rows, total: n };
}

export async function getHistoryForExport(f: HistoryFilters): Promise<HistoryRow[]> {
  return historyQuery(f).limit(HISTORY_EXPORT_MAX);
}

export type HistoryFilterOptions = {
  agents: { id: number; name: string }[];
  countries: string[];
  hasMissingCountry: boolean;
  brands: string[];
  /** Almeno una richiesta contiene un prodotto senza marchio (opzione «Non indicato»). */
  hasMissingBrand: boolean;
  categories: string[];
  hasMissingCategory: boolean;
};

/** Valori per le tendine dei filtri (agenti, paesi dei contatti con richieste, marchi e categorie). */
export async function getHistoryFilterOptions(): Promise<HistoryFilterOptions> {
  const [agents, countries, labels, missing] = await Promise.all([
    db
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.type, "AGENTE"))
      .orderBy(asc(contacts.name)),
    db.execute<{ country: string | null }>(sql`
      select distinct nullif(trim(contacts.country), '') as country
      from contacts
      where exists (select 1 from sample_requests sr where sr.contact_id = contacts.id)
      order by 1 nulls last`),
    db.execute<{ field: ProductLabelField; value: string }>(sql`
      select 'brand' as field, trim(brand) as value from products where nullif(trim(brand), '') is not null
      union
      select 'category', trim(category) from products where nullif(trim(category), '') is not null
      order by 1, 2`),
    db.execute<{ brand: boolean; category: boolean }>(sql`
      select
        exists (select 1 from request_items ri join products pr on pr.id = ri.product_id
                where nullif(trim(pr.brand), '') is null) as brand,
        exists (select 1 from request_items ri join products pr on pr.id = ri.product_id
                where nullif(trim(pr.category), '') is null) as category`),
  ]);
  const valuesOf = (field: ProductLabelField) => labels.filter((l) => l.field === field).map((l) => l.value);
  return {
    agents,
    countries: countries.map((c) => c.country).filter((c): c is string => !!c),
    hasMissingCountry: countries.some((c) => !c.country),
    brands: valuesOf("brand"),
    hasMissingBrand: !!missing[0]?.brand,
    categories: valuesOf("category"),
    hasMissingCategory: !!missing[0]?.category,
  };
}
