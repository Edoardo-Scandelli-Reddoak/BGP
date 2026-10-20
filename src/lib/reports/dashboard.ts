import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { RequestStatus } from "@/db/schema";
import type { CostConfig } from "@/lib/config/costs";
import { TIME_ZONE } from "@/lib/format";
import type { ProductLabelField } from "@/lib/products/labels";
import { costSqlComponents } from "@/lib/requests/costs";
import { getSetting } from "@/lib/settings";
import { STATUS_ORDER } from "@/lib/status";
import { effectiveShipmentDate, receivedBetween, shippedBetween } from "./conditions";
import { addMonths, monthsBetween, monthStart } from "./period";
import { productLabelSql } from "./product-labels";

/**
 * Dati del cruscotto direzione. Tutte le aggregazioni sono in SQL (GROUP BY).
 * Convenzione: "richieste" = ricevute nel periodo; spedizioni, m² e costi = richieste con data di
 * spedizione effettiva nel periodo (stato Spedita o Completata; senza data di spedizione vale la data
 * di ritiro del corriere), come nel report m² mensile.
 * Costi: somma delle voci attive in Impostazioni → Costi (src/lib/requests/costs.ts), arrotondate al
 * centesimo per richiesta come nel dettaglio della richiesta.
 */

/** Voce di costo attiva, nell'ordine delle colonne. */
export type CostComponent = { key: string; label: string };

/** Costi di un gruppo di spedizioni: null se nessuna spedizione del gruppo ha un costo. */
export type CostSummary = {
  cost: number | null;
  /** Importo per voce (chiave della voce → euro). */
  costParts: Record<string, number>;
  /** Spedizioni con un costo (base del costo medio). */
  costCount: number;
  avgCost: number | null;
};

export type DashboardKpi = CostSummary & {
  received: number;
  shipped: number;
  m2: number;
  /** Giorni medi dalla ricezione alla spedizione (data effettiva). */
  avgDays: number | null;
};

export type MonthPoint = { month: string; received: number; shipped: number; m2: number };

export type Ranked<T> = { rows: T[]; total: number };

export type ContactRow = CostSummary & {
  contactId: number;
  name: string;
  requests: number;
  shipments: number;
  m2: number;
};

export type ProductRow = {
  productId: number;
  code: string;
  description: string;
  requests: number;
  pieces: number;
  m2: number;
};

/** Marchio o categoria del prodotto (null = non indicato in anagrafica). */
export type LabelRow = {
  label: string | null;
  /** Richieste ricevute nel periodo con almeno un prodotto del gruppo (una sola volta per richiesta). */
  requests: number;
  /** Prodotti diversi del gruppo richiesti o spediti nel periodo. */
  products: number;
  pieces: number;
  m2: number;
};

export type CountryRow = CostSummary & { country: string | null; requests: number; shipments: number; m2: number };

export type AgentRow = { agentId: number | null; name: string | null; requests: number; shipments: number; m2: number };

type Range = { da: string; a: string };

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Voci di costo attive, nell'ordine delle colonne dei report. */
export function dashboardCostComponents(config: CostConfig): CostComponent[] {
  return costSqlComponents(config).map(({ key, label }) => ({ key, label }));
}

/**
 * Voci di costo in SQL: `columns` aggiunge a una select su sample_requests le colonne c0, c1…
 * (importo della voce per richiesta, al centesimo); `aggregates` le somma su una CTE che le contiene
 * (insieme a shipping_cost), limitandosi alle righe che soddisfano `filter`; `summary` legge il risultato.
 */
async function costSql(configOrCurrent?: CostConfig) {
  // senza configurazione esplicita valgono le voci salvate in Impostazioni → Costi
  const config = configOrCurrent ?? (await getSetting("costConfig"));
  const components = costSqlComponents(config);
  const col = (i: number) => sql.raw(`c${i}`);
  const columns = sql.join(
    components.map((c, i) => sql`, round((${c.expr})::numeric, 2) as ${col(i)}`),
    sql``,
  );
  const aggregates = (alias: string, filter: SQL): SQL => {
    const t = sql.raw(alias);
    const total = components.length ? sql`(${sql.join(components.map((_, i) => sql`${t}.${col(i)}`), sql` + `)})` : sql`0`;
    // con il corriere attivo conta come «con costo» anche una spedizione con costo corriere inserito pari a 0
    const hasCost = config.courier.enabled ? sql`(${total} > 0 or ${t}.shipping_cost is not null)` : sql`(${total} > 0)`;
    const parts = components.map((_, i) => sql`, (sum(${t}.${col(i)}) filter (where ${filter}))::float8 as ${sql.raw(`p${i}`)}`);
    const n = sql`count(*) filter (where ${filter} and ${hasCost})`;
    // cost_total è null se nessuna spedizione ha un costo (per ordinare con «nulls last»)
    return sql`(case when ${n} > 0 then sum(${total}) filter (where ${filter}) end)::float8 as cost_total,
      (${n})::int as cost_n
      ${sql.join(parts, sql``)}`;
  };
  const summary = (row: Record<string, unknown> | undefined): CostSummary => {
    const n = num(row?.cost_n);
    const total = num(row?.cost_total);
    return {
      cost: n > 0 ? total : null,
      costParts: Object.fromEntries(components.map((c, i) => [c.key, num(row?.[`p${i}`])])),
      costCount: n,
      avgCost: n > 0 ? total / n : null,
    };
  };
  return { columns, aggregates, summary };
}

/** Righe ricevute o spedite nel periodo, con i flag per distinguere i due insiemi e le voci di costo. */
function baseCte({ da, a }: Range, costColumns: SQL): SQL {
  const rec = receivedBetween(da, a);
  const shp = shippedBetween(da, a);
  return sql`
    base as (
      select sample_requests.id, sample_requests.contact_id, sample_requests.shipping_cost,
             ${rec} as rec, ${shp} as shp
             ${costColumns}
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

export async function getDashboardKpi(range: Range, costConfig?: CostConfig): Promise<DashboardKpi> {
  const costs = await costSql(costConfig);
  const [rec] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from sample_requests where ${receivedBetween(range.da, range.a)}`,
  );
  const [shp] = await db.execute<Record<string, unknown>>(sql`
    with shp as (
      select sample_requests.id, sample_requests.shipping_cost,
             ${effectiveShipmentDate} - (sample_requests.received_at at time zone ${TIME_ZONE})::date as days
             ${costs.columns}
      from sample_requests
      where ${shippedBetween(range.da, range.a)}
    )
    select count(*)::int as n,
           avg(shp.days)::float8 as avg_days,
           (select coalesce(sum(pieces.area_m2), 0)::float8 from pieces
             where pieces.request_id in (select id from shp)) as m2,
           ${costs.aggregates("shp", sql`true`)}
    from shp`);
  return {
    received: num(rec?.n),
    shipped: num(shp?.n),
    m2: num(shp?.m2),
    avgDays: numOrNull(shp?.avg_days),
    ...costs.summary(shp),
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
      select to_char(${effectiveShipmentDate}, 'YYYY-MM') as month,
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
export async function getByContact(range: Range, limit: number | null, costConfig?: CostConfig): Promise<Ranked<ContactRow>> {
  const costs = await costSql(costConfig);
  const rows = await db.execute<
    Record<string, unknown> & { contact_id: number; name: string; requests: number; shipments: number; m2: number; total: number }
  >(sql`
    with ${baseCte(range, costs.columns)}
    select contacts.id as contact_id, contacts.name,
           count(*) filter (where base.rec)::int as requests,
           count(*) filter (where base.shp)::int as shipments,
           coalesce(sum(m2.m2), 0)::float8 as m2,
           ${costs.aggregates("base", sql`base.shp`)},
           (count(*) over ())::int as total
    from base
    join contacts on contacts.id = base.contact_id
    left join m2 on m2.request_id = base.id
    group by contacts.id, contacts.name
    order by cost_total desc nulls last, m2 desc, requests desc, contacts.name
    ${limitClause(limit)}`);
  return {
    total: num(rows[0]?.total),
    rows: rows.map((r) => ({
      contactId: r.contact_id,
      name: r.name,
      requests: num(r.requests),
      shipments: num(r.shipments),
      m2: num(r.m2),
      ...costs.summary(r),
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

/**
 * Per marchio o categoria del prodotto, con le regole di getByProduct: richieste = ricevute nel periodo
 * (distinte: una richiesta con due prodotti dello stesso marchio conta una volta, con due marchi conta
 * per entrambi); pezzi e m² = richieste spedite nel periodo. Senza valore in anagrafica → riga con label null.
 */
async function getByProductLabel(field: ProductLabelField, range: Range, limit: number | null): Promise<Ranked<LabelRow>> {
  const label = productLabelSql(field);
  const received = receivedBetween(range.da, range.a);
  const shipped = shippedBetween(range.da, range.a);
  const rows = await db.execute<{
    label: string | null;
    requests: number;
    products: number;
    pieces: number;
    m2: number;
    total: number;
  }>(sql`
    with req as (
      select ${label} as label, count(distinct request_items.request_id) as n
      from request_items
      join sample_requests on sample_requests.id = request_items.request_id
      join products on products.id = request_items.product_id
      where ${received}
      group by 1
    ),
    shp as (
      select ${label} as label, sum(pieces.quantity) as qty, sum(pieces.area_m2) as m2
      from pieces
      join sample_requests on sample_requests.id = pieces.request_id
      join products on products.id = pieces.product_id
      where ${shipped}
      group by 1
    ),
    prod as (
      select ${label} as label, count(*) as n
      from products
      where products.id in (
              select request_items.product_id from request_items
              join sample_requests on sample_requests.id = request_items.request_id
              where ${received})
         or products.id in (
              select pieces.product_id from pieces
              join sample_requests on sample_requests.id = pieces.request_id
              where ${shipped})
      group by 1
    )
    select prod.label,
           coalesce(req.n, 0)::int as requests,
           prod.n::int as products,
           coalesce(shp.qty, 0)::int as pieces,
           coalesce(shp.m2, 0)::float8 as m2,
           (count(*) over ())::int as total
    from prod
    left join req on req.label is not distinct from prod.label
    left join shp on shp.label is not distinct from prod.label
    order by m2 desc, requests desc, label nulls last
    ${limitClause(limit)}`);
  return {
    total: num(rows[0]?.total),
    rows: rows.map((r) => ({
      label: r.label,
      requests: num(r.requests),
      products: num(r.products),
      pieces: num(r.pieces),
      m2: num(r.m2),
    })),
  };
}

export function getByBrand(range: Range, limit: number | null): Promise<Ranked<LabelRow>> {
  return getByProductLabel("brand", range, limit);
}

export function getByCategory(range: Range, limit: number | null): Promise<Ranked<LabelRow>> {
  return getByProductLabel("category", range, limit);
}

export async function getByCountry(range: Range, limit: number | null, costConfig?: CostConfig): Promise<Ranked<CountryRow>> {
  const costs = await costSql(costConfig);
  const rows = await db.execute<
    Record<string, unknown> & { country: string | null; requests: number; shipments: number; m2: number; total: number }
  >(sql`
    with ${baseCte(range, costs.columns)}
    select nullif(trim(contacts.country), '') as country,
           count(*) filter (where base.rec)::int as requests,
           count(*) filter (where base.shp)::int as shipments,
           coalesce(sum(m2.m2), 0)::float8 as m2,
           ${costs.aggregates("base", sql`base.shp`)},
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
      ...costs.summary(r),
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
    total: number;
  }>(sql`
    with ${baseCte(range, sql``)}
    select agent.id as agent_id, agent.name,
           count(*) filter (where base.rec)::int as requests,
           count(*) filter (where base.shp)::int as shipments,
           coalesce(sum(m2.m2), 0)::float8 as m2,
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
    })),
  };
}
