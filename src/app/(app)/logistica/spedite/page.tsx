import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BollaRefs } from "@/components/logistica/bolla-info";
import { PhoneNoticeBadge, RecipientSummary, recipientOf } from "@/components/logistica/delivery-info";
import { ShippingCostForm } from "@/components/logistica/shipping-cost-form";
import { requireUser } from "@/lib/auth/session";
import { parseEmailList } from "@/lib/email/recipients";
import { formatDate, formatDateTime, requestCode } from "@/lib/format";
import { getSetting } from "@/lib/settings";
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

function MissingBadges({ r }: { r: ShippedRow }) {
  const missing = missingItems(r);
  return (
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
  );
}

function LastConfirmation({ r }: { r: ShippedRow }) {
  const failed = r.lastConfirmation?.status === "ERRORE" ? r.lastConfirmation : null;
  if (failed) {
    return (
      <span className="text-red-700">
        Non riuscita il {formatDateTime(failed.createdAt)}: {failed.error || "errore sconosciuto"}
      </span>
    );
  }
  if (r.lastConfirmation) {
    return <span className="text-slate-500">Ultimo tentativo il {formatDateTime(r.lastConfirmation.createdAt)}</span>;
  }
  return <span className="text-slate-400">Non ancora inviata</span>;
}

/** Data in cui la richiesta è stata segnata «Spedita» (non è la data di spedizione inserita dalla logistica). */
function markedShippedLabel(r: ShippedRow): string | null {
  return r.shippedAt ? `Segnata spedita il ${formatDate(r.shippedAt)}` : null;
}

function ConfirmationBadge({ sent }: { sent: boolean }) {
  return sent ? <Badge tone="green">Inviata</Badge> : <Badge tone="slate">Senza email</Badge>;
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

  const [shipped, completed, withoutCost, { mode }] = await Promise.all([
    listShippedAwaitingTracking(),
    listRecentlyCompleted({ missingCostOnly }),
    countCompletedWithoutCost(),
    getSetting("bollaConfig"),
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
            <>
              <div className="hidden md:block">
                <Table>
                  <THead>
                    <tr>
                      <TH>Richiesta</TH>
                      <TH>Destinatario</TH>
                      <TH>Corriere e ritiro</TH>
                      <TH>Cosa manca</TH>
                      <TH>Ultima conferma</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {shipped.map((r) => (
                      <TR key={r.id}>
                        <TD className="whitespace-nowrap">
                          <Link href={`/richieste/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                            {requestCode(r.id)}
                          </Link>
                          {r.shippedAt ? <p className="text-xs text-slate-500">{markedShippedLabel(r)}</p> : null}
                        </TD>
                        <TD className="max-w-xs min-w-48">
                          <RecipientSummary r={r} contactName={r.contactName} />
                          <PhoneNoticeBadge phoneNotice={r.phoneNotice} number={r.phoneNoticeNumber} className="mt-1.5" />
                        </TD>
                        <TD className="max-w-48">
                          <p className="whitespace-nowrap">{r.carrierName ?? "—"}</p>
                          {r.pickupDate ? <p className="text-xs whitespace-nowrap text-slate-500">Ritiro il {formatDate(r.pickupDate)}</p> : null}
                          <BollaRefs bollaNumber={r.bollaNumber} ddtNumber={r.ddtNumber} mode={mode} className="mt-1" />
                        </TD>
                        <TD>
                          <MissingBadges r={r} />
                        </TD>
                        <TD className="min-w-48 text-xs">
                          <LastConfirmation r={r} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>

              <ul className="divide-y divide-slate-100 md:hidden">
                {shipped.map((r) => (
                  <li key={r.id}>
                    <Link href={`/richieste/${r.id}`} className="block px-4 py-4 active:bg-slate-100">
                      <p className="font-mono text-sm font-semibold text-brand-700">{requestCode(r.id)}</p>
                      <p className="mt-0.5 truncate font-medium text-slate-900">{recipientOf(r, r.contactName)}</p>
                      {r.attentionOf?.trim() ? (
                        <p className="truncate text-xs text-slate-700">Alla c.a. {r.attentionOf.trim()}</p>
                      ) : null}
                      <PhoneNoticeBadge phoneNotice={r.phoneNotice} number={r.phoneNoticeNumber} className="mt-1.5" />
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span>
                          <span className="font-medium text-slate-800">{r.carrierName ?? "Corriere non indicato"}</span>
                          {r.pickupDate ? ` · ritiro il ${formatDate(r.pickupDate)}` : ""}
                        </span>
                        {r.shippedAt ? <span>{markedShippedLabel(r)}</span> : null}
                      </div>
                      <BollaRefs bollaNumber={r.bollaNumber} ddtNumber={r.ddtNumber} mode={mode} className="mt-1" />
                      <div className="mt-2">
                        <MissingBadges r={r} />
                      </div>
                      <p className="mt-2 text-xs">
                        <LastConfirmation r={r} />
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
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
            <>
              <div className="hidden md:block">
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
                        <TD className="min-w-40 font-medium text-slate-900">{r.contactName}</TD>
                        <TD className="whitespace-nowrap">{r.carrierName ?? "—"}</TD>
                        <TD className="max-w-48">
                          <p className="whitespace-nowrap">{r.shipmentDate ? formatDate(r.shipmentDate) : "—"}</p>
                          {r.trackingNumber ? <p className="font-mono text-xs break-all text-slate-500">{r.trackingNumber}</p> : null}
                          <BollaRefs bollaNumber={r.bollaNumber} ddtNumber={r.ddtNumber} mode={mode} className="mt-1" />
                        </TD>
                        <TD>
                          <ConfirmationBadge sent={r.notificationSentAt !== null} />
                        </TD>
                        <TD>
                          <ShippingCostForm requestId={r.id} cost={r.shippingCost} version={r.updatedAt.toISOString()} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>

              {/* Su telefono: schede; il costo resta modificabile, quindi la scheda non è un unico link. */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {completed.map((r) => (
                  <li key={r.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/richieste/${r.id}`} className="font-mono text-sm font-semibold text-brand-700 hover:underline">
                          {requestCode(r.id)}
                        </Link>
                        <p className="mt-0.5 truncate font-medium text-slate-900">{r.contactName}</p>
                      </div>
                      <ConfirmationBadge sent={r.notificationSentAt !== null} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span className="font-medium text-slate-800">{r.carrierName ?? "Corriere non indicato"}</span>
                      <span>{r.shipmentDate ? `Spedita il ${formatDate(r.shipmentDate)}` : "Data di spedizione non indicata"}</span>
                      {r.trackingNumber ? <span className="font-mono break-all">{r.trackingNumber}</span> : null}
                    </div>
                    <BollaRefs bollaNumber={r.bollaNumber} ddtNumber={r.ddtNumber} mode={mode} className="mt-1" />
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-medium text-slate-500">Costo spedizione</p>
                      <ShippingCostForm requestId={r.id} cost={r.shippingCost} version={r.updatedAt.toISOString()} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
