import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { pieces, products, sampleRequests } from "@/db/schema";
import { computeRequestCost, type CostConfig, type CostLine } from "@/lib/config/costs";
import type { RequestDetail } from "./queries";

/** Costo di una richiesta (pannelli e dettaglio) secondo le voci configurate. */
export function requestCost(detail: RequestDetail, config: CostConfig): { total: number; lines: CostLine[] } {
  return computeRequestCost(
    {
      shippingCost: detail.shippingCost,
      packagesCount: detail.packagesCount,
      weightKg: detail.weightKg,
      pieces: detail.pieces.map((p) => ({
        areaM2: Number(p.areaM2 || 0),
        productPricePerM2: p.product.pricePerM2 ?? null,
      })),
      extraCosts: detail.extraCosts ?? null,
    },
    config,
  );
}

const num = (n: number) => sql.raw(String(Number.isFinite(n) ? n : 0));

/**
 * Espressioni SQL (per riga di sample_requests) delle voci di costo attive, da sommare nei report:
 * stessa logica di computeRequestCost. Gli importi della configurazione sono numeri validati.
 */
export function costSqlComponents(config: CostConfig): { key: string; label: string; expr: SQL }[] {
  const out: { key: string; label: string; expr: SQL }[] = [];
  if (config.courier.enabled) {
    out.push({ key: "courier", label: config.courier.label, expr: sql`coalesce(${sampleRequests.shippingCost}, 0)` });
  }
  if (config.perRequest.enabled) {
    out.push({ key: "perRequest", label: config.perRequest.label, expr: sql`${num(config.perRequest.amount)}` });
  }
  if (config.perPackage.enabled) {
    out.push({
      key: "perPackage",
      label: config.perPackage.label,
      expr: sql`${num(config.perPackage.amount)} * coalesce(${sampleRequests.packagesCount}, 0)`,
    });
  }
  if (config.perKg.enabled) {
    out.push({
      key: "perKg",
      label: config.perKg.label,
      expr: sql`${num(config.perKg.amount)} * coalesce(${sampleRequests.weightKg}, 0)`,
    });
  }
  if (config.perM2.enabled) {
    const price = config.perM2.useProductPrice
      ? sql`coalesce(${products.pricePerM2}, ${num(config.perM2.amount)})`
      : sql`${num(config.perM2.amount)}`;
    out.push({
      key: "perM2",
      label: config.perM2.label,
      expr: sql`coalesce((select sum(${pieces.areaM2} * ${price}) from ${pieces} join ${products} on ${products.id} = ${pieces.productId} where ${pieces.requestId} = ${sampleRequests.id}), 0)`,
    });
  }
  for (const m of config.manual) {
    if (!m.enabled || !/^m_[a-z0-9_]{1,40}$/.test(m.key)) continue;
    out.push({
      key: m.key,
      label: m.label,
      expr: sql`coalesce((${sampleRequests.extraCosts} ->> ${m.key})::numeric, 0)`,
    });
  }
  return out;
}

/** Costo totale di una richiesta in SQL (0 se nessuna voce è attiva). */
export function costSqlTotal(config: CostConfig): SQL {
  const parts = costSqlComponents(config).map((c) => c.expr);
  return parts.length ? sql`(${sql.join(parts, sql` + `)})` : sql`0`;
}
