import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ShippingCostForm } from "@/components/logistica/shipping-cost-form";
import { requireUser } from "@/lib/auth/session";
import { parseEmailList } from "@/lib/email/recipients";
import { formatDate, formatDateTime, requestCode } from "@/lib/format";
import {
  countCompletedWithoutCost,
  listRecentlyCompleted,
  listShippedAwaitingTracking,
  type ShippedRow,
} from "../_lib/queries";

export const metadata: Metadata = { title: "Spedite: manca tracking" };

function missingItems(r: ShippedRow): string[] {
  const out: string[] = [];
  if (!r.trackingNumber?.trim()) out.push("Tracking");
  if (!r.shipmentDate) out.push("Data di spedizione");
  if (parseEmailList(r.contactEmail).length === 0) out.push("Email del contatto");
  return out;
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
        active ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
      )}
    >
      {children}
    </Link>
  );
}

export default async function ShippedPage(props: PageProps<"/logistica/spedite">) {
  await requireUser("logistics.work");
  const sp = await props.searchParams;
  const missingCostOnly = sp.costo === "mancante";

  const [shipped, completed, withoutCost] = await Promise.all([
    listShippedAwaitingTracking(),
    listRecentlyCompleted({ missingCostOnly }),
    countCompletedWithoutCost(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Logistica"
        title="Spedite: manca tracking"
        description="Richieste partite ma senza conferma al cliente: appena inserisci tracking e data di spedizione parte l'email e la richiesta si chiude."
      />

      <div className="space-y-8">
        <Card>
          <CardHeader
            title="In attesa di tracking"
            description={
              shipped.length
                ? `${shipped.length} ${shipped.length === 1 ? "richiesta spedita" : "richieste spedite"} da completare.`
                : undefined
            }
          />
          {shipped.length === 0 ? (
            <EmptyState
              title="Nessuna richiesta in attesa"
              description="Tutte le richieste spedite hanno tracking e conferma inviata al cliente."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Richiesta</TH>
                  <TH>Contatto</TH>
                  <TH>Corriere e ritiro</TH>
                  <TH>Cosa manca</TH>
                  <TH>Ultima conferma</TH>
                </tr>
              </THead>
              <TBody>
                {shipped.map((r) => {
                  const missing = missingItems(r);
                  const failed = r.lastConfirmation?.status === "ERRORE" ? r.lastConfirmation : null;
                  return (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap">
                        <Link href={`/richieste/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                          {requestCode(r.id)}
                        </Link>
                        {r.shippedAt ? <p className="text-xs text-slate-500">Spedita il {formatDate(r.shippedAt)}</p> : null}
                      </TD>
                      <TD className="min-w-48 font-medium text-slate-900">{r.contactName}</TD>
                      <TD className="whitespace-nowrap">
                        <p>{r.carrierName ?? "—"}</p>
                        {r.pickupDate ? <p className="text-xs text-slate-500">Ritiro il {formatDate(r.pickupDate)}</p> : null}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {missing.length ? (
                            missing.map((m) => (
                              <Badge key={m} tone={m === "Email del contatto" ? "red" : "amber"}>
                                {m}
                              </Badge>
                            ))
                          ) : (
                            <Badge tone="red">Conferma da inviare</Badge>
                          )}
                        </div>
                      </TD>
                      <TD className="min-w-56 text-xs">
                        {failed ? (
                          <span className="text-red-700">
                            Non riuscita il {formatDateTime(failed.createdAt)}: {failed.error || "errore sconosciuto"}
                          </span>
                        ) : r.lastConfirmation ? (
                          <span className="text-slate-500">Ultimo tentativo il {formatDateTime(r.lastConfirmation.createdAt)}</span>
                        ) : (
                          <span className="text-slate-400">Non ancora inviata</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Ultime completate"
            description="Le ultime 30 richieste chiuse. Il costo di spedizione si può inserire anche qui, quando arriva la fattura del corriere."
            actions={
              <nav className="flex gap-2" aria-label="Filtro completate">
                <FilterLink href="/logistica/spedite" active={!missingCostOnly}>
                  Tutte
                </FilterLink>
                <FilterLink href="/logistica/spedite?costo=mancante" active={missingCostOnly}>
                  Senza costo ({withoutCost})
                </FilterLink>
              </nav>
            }
          />
          {completed.length === 0 ? (
            <EmptyState
              title={missingCostOnly ? "Nessuna richiesta senza costo" : "Nessuna richiesta completata"}
              description={missingCostOnly ? "Tutte le richieste completate hanno il costo di spedizione." : undefined}
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Richiesta</TH>
                  <TH>Contatto</TH>
                  <TH>Corriere</TH>
                  <TH>Spedizione</TH>
                  <TH>Conferma</TH>
                  <TH>Costo spedizione</TH>
                </tr>
              </THead>
              <TBody>
                {completed.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap">
                      <Link href={`/richieste/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                        {requestCode(r.id)}
                      </Link>
                      {r.completedAt ? <p className="text-xs text-slate-500">Chiusa il {formatDate(r.completedAt)}</p> : null}
                    </TD>
                    <TD className="min-w-48 font-medium text-slate-900">{r.contactName}</TD>
                    <TD className="whitespace-nowrap">{r.carrierName ?? "—"}</TD>
                    <TD className="whitespace-nowrap">
                      <p>{r.shipmentDate ? formatDate(r.shipmentDate) : "—"}</p>
                      {r.trackingNumber ? <p className="font-mono text-xs text-slate-500">{r.trackingNumber}</p> : null}
                    </TD>
                    <TD>
                      {r.notificationSentAt ? (
                        <Badge tone="green">Inviata</Badge>
                      ) : (
                        <Badge tone="slate">Senza email</Badge>
                      )}
                    </TD>
                    <TD>
                      <ShippingCostForm requestId={r.id} cost={r.shippingCost} version={r.updatedAt.toISOString()} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
