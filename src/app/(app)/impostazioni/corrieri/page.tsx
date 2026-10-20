import type { Metadata } from "next";
import { asc, count, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { carriers, sampleRequests } from "@/db/schema";
import { CarrierItem, CreateCarrierForm } from "@/components/impostazioni/carrier-forms";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Corrieri — Impostazioni" };

export default async function CarriersSettingsPage() {
  await requireUser("settings.manage");
  const [rows, usage] = await Promise.all([
    db
      .select({
        id: carriers.id,
        name: carriers.name,
        trackingUrlTemplate: carriers.trackingUrlTemplate,
        active: carriers.active,
        sortOrder: carriers.sortOrder,
      })
      .from(carriers)
      .orderBy(asc(carriers.sortOrder), asc(carriers.name)),
    db
      .select({ carrierId: sampleRequests.carrierId, n: count() })
      .from(sampleRequests)
      .where(isNotNull(sampleRequests.carrierId))
      .groupBy(sampleRequests.carrierId),
  ]);
  const usedBy = new Map(usage.map((u) => [u.carrierId, u.n]));
  const nextSortOrder = rows.reduce((max, c) => Math.max(max, c.sortOrder + 1), 0);
  const activeCount = rows.filter((c) => c.active).length;

  return (
    <>
      <Card>
        <CardHeader
          title="Corrieri"
          description={`${activeCount} attiv${activeCount === 1 ? "o" : "i"}. La logistica sceglie il corriere; il link di tracking finisce nella conferma di spedizione al cliente. Un corriere già usato non si elimina: si disattiva.`}
        />
        {rows.length === 0 ? (
          <EmptyState title="Nessun corriere" description="Aggiungi il primo corriere con il modulo qui sotto." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => (
              <CarrierItem key={c.id} carrier={c} usedBy={usedBy.get(c.id) ?? 0} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Nuovo corriere" />
        <CardBody>
          <CreateCarrierForm nextSortOrder={nextSortOrder} />
        </CardBody>
      </Card>
    </>
  );
}
