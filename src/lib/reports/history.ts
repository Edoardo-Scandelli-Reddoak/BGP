import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { carriers, contacts, sampleRequests } from "@/db/schema";
import { likePattern } from "@/lib/search";
import { receivedBetween, romeDayStart } from "./conditions";
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

function buildConditions(f: HistoryFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.da && f.a) conds.push(receivedBetween(f.da, f.a));
  else if (f.da) conds.push(sql`${sampleRequests.receivedAt} >= ${romeDayStart(f.da)}`);
  else if (f.a) conds.push(sql`${sampleRequests.receivedAt} < ${romeDayStart(addDays(f.a, 1))}`);

  if (f.stato) conds.push(eq(sampleRequests.status, f.stato));
  if (f.origine) conds.push(eq(sampleRequests.source, f.origine));

  if (f.contatto) {
    for (const w of words(f.contatto)) {
      const p = likePattern(w);
      conds.push(or(ilike(contacts.name, p), ilike(contacts.company, p), ilike(contacts.email, p))!);
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

  if (f.marchio) {
    conds.push(sql`exists (
      select 1 from request_items ri join products pr on pr.id = ri.product_id
      where ri.request_id = ${sampleRequests.id} and trim(pr.brand) = ${f.marchio})`);
  }

  // le richieste intestate a un agente contano per l'agente stesso (come nel cruscotto)
  if (f.agente === NONE_VALUE) conds.push(and(isNull(contacts.agentId), ne(contacts.type, "AGENTE"))!);
  else if (typeof f.agente === "number") conds.push(eq(agentOf, f.agente));

  if (f.paese === NONE_VALUE) conds.push(sql`nullif(trim(${contacts.country}), '') is null`);
  else if (f.paese) conds.push(sql`trim(${contacts.country}) = ${f.paese}`);

  return conds.length ? and(...conds) : undefined;
}

const productCodes = sql<string | null>`(
  select string_agg(pr.code, ', ' order by ri.id)
  from request_items ri join products pr on pr.id = ri.product_id
  where ri.request_id = ${sampleRequests.id})`;

const totalM2 = sql<number>`(
  select coalesce(sum(pc.area_m2), 0)::float8 from pieces pc where pc.request_id = ${sampleRequests.id})`.mapWith(Number);

const historyColumns = {
  id: sampleRequests.id,
  receivedAt: sampleRequests.receivedAt,
  status: sampleRequests.status,
  source: sampleRequests.source,
  contactId: contacts.id,
  contactName: contacts.name,
  country: contacts.country,
  agentName: agent.name,
  productCodes,
  packagesCount: sampleRequests.packagesCount,
  weightKg: sampleRequests.weightKg,
  m2: totalM2,
  carrierName: carriers.name,
  carrierTrackingUrl: carriers.trackingUrlTemplate,
  pickupDate: sampleRequests.pickupDate,
  trackingNumber: sampleRequests.trackingNumber,
  shipmentDate: sampleRequests.shipmentDate,
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
};

/** Valori per le tendine dei filtri (agenti, paesi dei contatti con richieste, marchi). */
export async function getHistoryFilterOptions(): Promise<HistoryFilterOptions> {
  const [agents, countries, brands] = await Promise.all([
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
    db.execute<{ brand: string }>(sql`
      select distinct trim(brand) as brand from products
      where brand is not null and trim(brand) <> ''
      order by 1`),
  ]);
  return {
    agents,
    countries: countries.map((c) => c.country).filter((c): c is string => !!c),
    hasMissingCountry: countries.some((c) => !c.country),
    brands: brands.map((b) => b.brand),
  };
}
