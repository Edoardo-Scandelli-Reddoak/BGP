import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { RequestStatus } from "@/db/schema";
import { TIME_ZONE } from "@/lib/format";
import { STATUS_ORDER } from "@/lib/status";
import { receivedBetween, shippedBetween } from "./conditions";
import { addMonths, monthsBetween, monthStart } from "./period";

/**
 * Dati del cruscotto direzione. Tutte le aggregazioni sono in SQL (GROUP BY).
 * Convenzione: "richieste" = ricevute nel periodo; spedizioni, m² e costi = richieste con data di
 * spedizione nel periodo (stato Spedita o Completata), come nel report m² mensile.
 */

export type DashboardKpi = {
  received: number;
  shipped: number;
  m2: number;
  /** Somma dei costi di spedizione inseriti dalla logistica (null se nessun costo). */
  cost: number | null;
  /** Spedizioni con un costo inserito (base del costo medio). */
  costCount: number;
  avgCost: number | null;
  /** Giorni medi dalla ricezione alla spedizione. */
  avgDays: number | null;
};

export type MonthPoint = { month: string; received: number; shipped: number; m2: number };

export type Ranked<T> = { rows: T[]; total: number };

export type ContactRow = {
  contactId: number;
  name: string;
  requests: number;
  shipments: number;
  m2: number;
  cost: number | null;
  avgCost: number | null;
};

export type ProductRow = {
  productId: number;
  code: string;
  description: string;
  requests: number;
  pieces: number;
  m2: number;
};

export type CountryRow = { country: string | null; requests: number; shipments: number; m2: number; cost: number | null };

export type AgentRow = { agentId: number | null; name: string | null; requests: number; shipments: number; m2: number; cost: number | null };

type Range = { da: string; a: string };

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Righe ricevute o spedite nel periodo, con i flag per distinguere i due insiemi. */
function baseCte({ da, a }: Range): SQL {
  const rec = receivedBetween(da, a);
  const shp = shippedBetween(da, a);
  return sql`
    base as (
      select sample_requests.id, sample_requests.contact_id, sample_requests.shipping_cost,
             ${rec} as rec, ${shp} as shp
      from sample_requests
      where ${rec} or ${shp}
    ),
    m2 as (
      select pieces.request_id, sum(pieces.area_m2) as m2
      from pieces join base on base.id = pieces.request_id and base.shp
      group by pieces.request_id
    )`;
}

function limitClause(limit: number | null): SQL {
  return limit ? sql`limit ${limit}` : sql``;
}

export async function getDashboardKpi(range: Range): Promise<DashboardKpi> {
  const [rec] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from sample_requests where ${receivedBetween(range.da, range.a)}`,
  );
  const [shp] = await db.execute<{
    n: number;
    cost: number | null;
    n_cost: number;
    avg_cost: number | null;
    avg_days: number | null;
    m2: number | null;
  }>(sql`
    select count(*)::int as n,
           sum(shipping_cost)::float8 as cost,
           count(shipping_cost)::int as n_cost,
           avg(shipping_cost)::float8 as avg_cost,
           avg(shipment_date - (received_at at time zone ${TIME_ZONE})::date)::float8 as avg_days,
           (select coalesce(sum(pieces.area_m2), 0)::float8 from pieces
             where pieces.request_id in (select id from sample_requests where ${shippedBetween(range.da, range.a)})) as m2
    from sample_requests
    where ${shippedBetween(range.da, range.a)}`);
  return {
    received: num(rec?.n),
    shipped: num(shp?.n),
    m2: num(shp?.m2),
    cost: numOrNull(shp?.cost),
    costCount: num(shp?.n_cost),
    avgCost: numOrNull(shp?.avg_cost),
    avgDays: numOrNull(shp?.avg_days),
  };
}

/** Stato attuale delle richieste ricevute nel periodo. */
export async function getStatusDistribution(range: Range): Promise<Record<RequestStatus, number>> {
  const rows = await db.execute<{ status: RequestStatus; n: number }>(
    sql`select status, count(*)::int as n from sample_requests where ${receivedBetween(range.da, range.a)} group by status`,
  );
  const out = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<RequestStatus, number>;
  for (const r of rows) out[r.status] = num(r.n);
  return out;
}

/** Mesi mostrati nei grafici: al massimo gli ultimi 12 del periodo. */
export function chartMonths(range: Range): string[] {
  const last = range.a.slice(0, 7);
  const first = range.da.slice(0, 7) > addMonths(last, -11) ? range.da.slice(0, 7) : addMonths(last, -11);
  return monthsBetween(first, last);
}

export async function getMonthlySeries(range: Range): Promise<MonthPoint[]> {
  const months = chartMonths(range);
  if (months.length === 0) return [];
  // il grafico parte dal primo mese mostrato, ma mai prima dell'inizio del periodo
  const start = monthStart(months[0]) > range.da ? monthStart(months[0]) : range.da;
  const [received, shipped] = await Promise.all([
    db.execute<{ month: string; n: number }>(sql`
      select to_char(received_at at time zone ${TIME_ZONE}, 'YYYY-MM') as month, count(*)::int as n
      from sample_requests
      where ${receivedBetween(start, range.a)}
      group by 1`),
    db.execute<{ month: string; n: number; m2: number }>(sql`
      select to_char(sample_requests.shipment_date, 'YYYY-MM') as month,
             count(distinct sample_requests.id)::int as n,
             coalesce(sum(pieces.area_m2), 0)::float8 as m2
      from sample_requests
      left join pieces on pieces.request_id = sample_requests.id
      where ${shippedBetween(start, range.a)}
      group by 1`),
  ]);
  const rec = new Map(received.map((r) => [r.month, num(r.n)]));
  const shp = new Map(shipped.map((r) => [r.month, { n: num(r.n), m2: num(r.m2) }]));
  return months.map((month) => ({
    month,
    received: rec.get(month) ?? 0,
    shipped: shp.get(month)?.n ?? 0,
    m2: shp.get(month)?.m2 ?? 0,
  }));
}

/** Costi e volumi per cliente (il "costo per cliente" richiesto da BGP). */
export async function getByContact(range: Range, limit: number | null): Promise<Ranked<ContactRow>> {
  const rows = await db.execute<{
    contact_id: number;
    name: string;
    requests: number;
    shipments: number;
    m2: number;
    cost: number | null;
    avg_cost: number | null;
    total: number;
  }>(sql`
    with ${baseCte(range)}
    select contacts.id as contact_id, contacts.name,
           count(*) filter (where base.rec)::int as requests,
           count(*) filter (where base.shp)::int as shipments,
           coalesce(sum(m2.m2), 0)::float8 as m2,
           (sum(base.shipping_cost) filter (where base.shp))::float8 as cost,
           (avg(base.shipping_cost) filter (where base.shp))::float8 as avg_cost,
           (count(*) over ())::int as total
    from base
    join contacts on contacts.id = base.contact_id
    left join m2 on m2.request_id = base.id
    group by contacts.id, contacts.name
    order by cost desc nulls last, m2 desc, requests desc, contacts.name
    ${limitClause(limit)}`);
  return {
    total: num(rows[0]?.total),
    rows: rows.map((r) => ({
      contactId: r.contact_id,
      name: r.name,
      requests: num(r.requests),
      shipments: num(r.shipments),
      m2: num(r.m2),
      cost: numOrNull(r.cost),
      avgCost: numOrNull(r.avg_cost),
    })),
  };
}

export async function getByProduct(range: Range, limit: number | null): Promise<Ranked<ProductRow>> {
  const rows = await db.execute<{
    product_id: number;
    code: string;
    description: string;
    requests: number;
    pieces: number;
    m2: number;
    total: number;
  }>(sql`
    with req as (
      select request_items.product_id, count(distinct request_items.request_id) as n
      from request_items
      join sample_requests on sample_requests.id = request_items.request_id
      where ${receivedBetween(range.da, range.a)}
      group by request_items.product_id
    ),
    shp as (
      select pieces.product_id, sum(pieces.quantity) as qty, sum(pieces.area_m2) as m2
      from pieces
      join sample_requests on sample_requests.id = pieces.request_id
      where ${shippedBetween(range.da, range.a)}
      group by pieces.product_id
    )
    select products.id as product_id, products.code, products.description,
           coalesce(req.n, 0)::int as requests,
           coalesce(shp.qty, 0)::int as pieces,
           coalesce(shp.m2, 0)::float8 as m2,
           (count(*) over ())::int as total
    from req
    full join shp on shp.product_id = req.product_id
    join products on products.id = coalesce(req.product_id, shp.product_id)
    order by m2 desc, requests desc, products.code
    ${limitClause(limit)}`);
  return {
    total: num(rows[0]?.total),
    rows: rows.map((r) => ({
      productId: r.product_id,
      code: r.code,
      description: r.description,
      requests: num(r.requests),
      pieces: num(r.pieces),
      m2: num(r.m2),
    })),
  };
}

export async function getByCountry(range: Range, limit: number | null): Promise<Ranked<CountryRow>> {
  const rows = await db.execute<{
    country: string | null;
    requests: number;
    shipments: number;
    m2: number;
    cost: number | null;
    total: number;
  }>(sql`
    with ${baseCte(range)}
    select nullif(trim(contacts.country), '') as country,
           count(*) filter (where base.rec)::int as requests,
           count(*) filter (where base.shp)::int as shipments,
           coalesce(sum(m2.m2), 0)::float8 as m2,
           (sum(base.shipping_cost) filter (where base.shp))::float8 as cost,
           (count(*) over ())::int as total
    from base
    join contacts on contacts.id = base.contact_id
    left join m2 on m2.request_id = base.id
    group by 1
    order by m2 desc, requests desc, country nulls last
    ${limitClause(limit)}`);
  return {
    total: num(rows[0]?.total),
    rows: rows.map((r) => ({
      country: r.country,
      requests: num(r.requests),
      shipments: num(r.shipments),
      m2: num(r.m2),
      cost: numOrNull(r.cost),
    })),
  };
}

/** Per agente di riferimento; le richieste intestate a un agente contano per l'agente stesso. */
export async function getByAgent(range: Range, limit: number | null): Promise<Ranked<AgentRow>> {
  const rows = await db.execute<{
    agent_id: number | null;
    name: string | null;
    requests: number;
    shipments: number;
    m2: number;
    cost: number | null;
    total: number;
  }>(sql`
    with ${baseCte(range)}
    select agent.id as agent_id, agent.name,
           count(*) filter (where base.rec)::int as requests,
           count(*) filter (where base.shp)::int as shipments,
           coalesce(sum(m2.m2), 0)::float8 as m2,
           (sum(base.shipping_cost) filter (where base.shp))::float8 as cost,
           (count(*) over ())::int as total
    from base
    join contacts on contacts.id = base.contact_id
    left join contacts as agent
      on agent.id = case when contacts.type = 'AGENTE' then contacts.id else contacts.agent_id end
    left join m2 on m2.request_id = base.id
    group by agent.id, agent.name
    order by m2 desc, requests desc, agent.name nulls last
    ${limitClause(limit)}`);
  return {
    total: num(rows[0]?.total),
    rows: rows.map((r) => ({
      agentId: r.agent_id,
      name: r.name,
      requests: num(r.requests),
      shipments: num(r.shipments),
      m2: num(r.m2),
      cost: numOrNull(r.cost),
    })),
  };
}
