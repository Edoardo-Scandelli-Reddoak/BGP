import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { oneLine } from "@/components/logistica/utils";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatNumber, requestCode } from "@/lib/format";
import { listReadyForPickup, type ReadyForPickupRow } from "./_lib/queries";

export const metadata: Metadata = { title: "Pronte per il ritiro" };

function BollaBadge({ row }: { row: ReadyForPickupRow }) {
  if (!row.deliveryFormRequired) return null;
  return <Badge tone={row.bollaReady ? "green" : "amber"}>{row.bollaReady ? "Bolla pronta" : "Bolla da preparare"}</Badge>;
}

function BollaCell({ row }: { row: ReadyForPickupRow }) {
  if (!row.deliveryFormRequired) return <span className="text-xs text-slate-400">Non richiesta</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <BollaBadge row={row} />
      {row.ddtNumber ? <span className="text-xs text-slate-500">DDT {row.ddtNumber}</span> : null}
    </div>
  );
}

function weightLabel(row: ReadyForPickupRow): string {
  return row.weightKg !== null ? `${formatNumber(row.weightKg, 2)} kg` : "—";
}

function pickupLabel(row: ReadyForPickupRow): string {
  return row.pickupDate ? `Ritiro il ${formatDate(row.pickupDate)}` : "Data di ritiro da definire";
}

export default async function ReadyForPickupPage() {
  await requireUser("logistics.work");
  const rows = await listReadyForPickup();
  const bolleTodo = rows.filter((r) => !r.bollaReady).length;

  return (
    <>
      <PageHeader
        eyebrow="Logistica"
        title="Pronte per il ritiro"
        description={
          rows.length
            ? `${rows.length} ${rows.length === 1 ? "richiesta pronta" : "richieste pronte"} per il ritiro, dalla più vecchia.${
                bolleTodo ? ` ${bolleTodo} con bolla di consegna da preparare.` : ""
              }`
            : "Le richieste preparate dal magazzino, in attesa del corriere."
        }
        actions={
          bolleTodo ? (
            <LinkButton href="/logistica/bolle" variant="secondary">
              Bolle da preparare ({bolleTodo})
            </LinkButton>
          ) : null
        }
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Nessuna richiesta pronta per il ritiro"
            description="Quando il magazzino segna una richiesta come pronta, compare qui con colli, peso e destinazione."
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Richiesta</TH>
                    <TH>Contatto e destinazione</TH>
                    <TH className="text-right">Colli</TH>
                    <TH className="text-right">Peso</TH>
                    <TH>Bolla</TH>
                    <TH>Corriere e ritiro</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap">
                        <Link href={`/richieste/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                          {requestCode(r.id)}
                        </Link>
                        <p className="text-xs text-slate-500">Ricevuta il {formatDate(r.receivedAt)}</p>
                        {r.readySince ? <p className="text-xs text-slate-500">Pronta dal {formatDate(r.readySince)}</p> : null}
                      </TD>
                      <TD className="max-w-sm">
                        <p className="font-medium text-slate-900">{r.contactName}</p>
                        <p className="line-clamp-2 text-xs text-slate-600" title={oneLine(r.destinationAddress) || undefined}>
                          {oneLine(r.destinationAddress) || "Destinazione non indicata"}
                        </p>
                        {r.contactCountry ? <p className="text-xs text-slate-500">{r.contactCountry}</p> : null}
                      </TD>
                      <TD className="text-right tabular-nums">{r.packagesCount ?? "—"}</TD>
                      <TD className="text-right whitespace-nowrap tabular-nums">{weightLabel(r)}</TD>
                      <TD>
                        <BollaCell row={r} />
                      </TD>
                      <TD>
                        {r.carrierName || r.pickupDate ? (
                          <>
                            <p className="whitespace-nowrap text-slate-900">{r.carrierName ?? "Corriere da scegliere"}</p>
                            <p className="text-xs text-slate-500">{pickupLabel(r)}</p>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">Da definire</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/richieste/${r.id}`} className="block px-4 py-4 active:bg-slate-100">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold text-brand-700">{requestCode(r.id)}</p>
                        <p className="mt-0.5 truncate font-medium text-slate-900">{r.contactName}</p>
                      </div>
                      <BollaBadge row={r} />
                    </div>
                    {r.destinationAddress ? (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{oneLine(r.destinationAddress)}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span className="tabular-nums">
                        {r.packagesCount ?? "—"} coll{r.packagesCount === 1 ? "o" : "i"} · {weightLabel(r)}
                      </span>
                      <span>{r.readySince ? `Pronta dal ${formatDate(r.readySince)}` : `Ricevuta il ${formatDate(r.receivedAt)}`}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {r.carrierName || r.pickupDate ? (
                        <>
                          <span className="font-medium text-slate-800">{r.carrierName ?? "Corriere da scegliere"}</span> ·{" "}
                          {pickupLabel(r)}
                        </>
                      ) : (
                        <span className="text-slate-400">Corriere e ritiro da definire</span>
                      )}
                    </p>
                    {r.deliveryFormRequired && r.ddtNumber ? (
                      <p className="mt-1 text-xs text-slate-500">DDT {r.ddtNumber}</p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}
