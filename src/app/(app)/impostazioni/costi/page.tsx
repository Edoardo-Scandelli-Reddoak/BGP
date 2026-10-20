import type { Metadata } from "next";
import Link from "next/link";
import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pieces, products, sampleRequests } from "@/db/schema";
import { CostSettingsForm, type CostSample } from "@/components/impostazioni/cost-settings-form";
import { Alert } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth/session";
import { DEFAULT_COST_CONFIG } from "@/lib/config/costs";
import { todayIso } from "@/lib/format";
import { shippedBetween } from "@/lib/reports/conditions";
import { addDays } from "@/lib/reports/period";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Costi per cliente — Impostazioni" };

/** Richieste con un importo (> 0) salvato, per chiave di voce manuale. */
async function manualCostUsage(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      key: sql<string>`e.key`,
      n: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(sql`${sampleRequests} cross join lateral jsonb_each_text(coalesce(${sampleRequests.extraCosts}, '{}'::jsonb)) as e`)
    .where(sql`e.value ~ '^[0-9.]+$' and e.value::numeric > 0`)
    .groupBy(sql`e.key`);
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}

/** Valori medi delle spedizioni degli ultimi 6 mesi, per l'esempio di calcolo. */
async function averageShipment(): Promise<CostSample> {
  const today = todayIso();
  const area = sql`(select coalesce(sum(${pieces.areaM2}), 0) from ${pieces} where ${pieces.requestId} = ${sampleRequests.id})`;
  const [row] = await db
    .select({
      n: count(),
      packages: sql<number | null>`avg(${sampleRequests.packagesCount})::float8`,
      kg: sql<number | null>`avg(${sampleRequests.weightKg})::float8`,
      m2: sql<number | null>`avg(${area})::float8`,
      courier: sql<number | null>`avg(${sampleRequests.shippingCost})::float8`,
    })
    .from(sampleRequests)
    .where(shippedBetween(addDays(today, -183), today));
  const round = (v: number | null | undefined, decimals: number, fallback: number) =>
    v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(Number(v).toFixed(decimals));
  if (!row || row.n === 0) return { packages: 1, kg: 5, m2: 1.5, courier: 15, basedOn: 0 };
  return {
    packages: Math.max(1, Math.round(round(row.packages, 0, 1))),
    kg: round(row.kg, 1, 5),
    m2: round(row.m2, 2, 1.5),
    courier: round(row.courier, 2, 15),
    basedOn: row.n,
  };
}

export default async function CostSettingsPage() {
  await requireUser("settings.manage");
  const [config, usage, [productStats], sample] = await Promise.all([
    getSetting("costConfig"),
    manualCostUsage(),
    db
      .select({ total: count(), withPrice: count(products.pricePerM2) })
      .from(products)
      .where(eq(products.active, true)),
    averageShipment(),
  ]);
  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_COST_CONFIG);

  return (
    <>
      <Alert tone="info" title="Come si calcolano i «costi per cliente»">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Ogni richiesta spedita ha un costo: la <strong>somma delle voci attive</strong> qui sotto. Nel{" "}
            <Link href="/direzione" className="font-medium underline">
              cruscotto della direzione
            </Link>{" "}
            i «costi per cliente» sommano le richieste spedite a quel cliente nel periodo scelto.
          </li>
          <li>
            I totali si ricalcolano sempre con le impostazioni attuali, anche per i mesi passati. Gli importi inseriti a
            mano dalla logistica (corriere e voci manuali) restano quelli salvati su ogni richiesta.
          </li>
          <li>
            {isDefault
              ? "Impostazione attuale: conta solo il costo del corriere, come finora."
              : "Impostazione iniziale: conta solo il costo del corriere."}
          </li>
        </ul>
      </Alert>
      <CostSettingsForm
        initial={config}
        manualUsage={usage}
        productsWithPrice={productStats?.withPrice ?? 0}
        productsTotal={productStats?.total ?? 0}
        sample={sample}
      />
    </>
  );
}
