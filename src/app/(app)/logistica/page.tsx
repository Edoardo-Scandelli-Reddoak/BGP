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

function BollaCell({ row }: { row: ReadyForPickupRow }) {
  if (!row.deliveryFormRequired) return <span className="text-xs text-slate-400">Non richiesta</span>;
  const ready = row.deliveryFormReady || Boolean(row.ddtNumber?.trim()) || row.hasDdt;
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={ready ? "green" : "amber"}>{ready ? "Bolla pronta" : "Bolla da preparare"}</Badge>
      {row.ddtNumber ? <span className="text-xs text-slate-500">DDT {row.ddtNumber}</span> : null}
    </div>
  );
}

export default async function ReadyForPickupPage() {
  await requireUser("logistics.work");
  const rows = await listReadyForPickup();
  const bolleTodo = rows.filter(
    (r) => r.deliveryFormRequired && !(r.deliveryFormReady || r.ddtNumber?.trim() || r.hasDdt),
  ).length;

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
          <Table>
            <THead>
              <tr>
                <TH>Richiesta</TH>
                <TH>Contatto</TH>
                <TH>Destinazione</TH>
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
                  <TD className="min-w-48">
                    <p className="font-medium text-slate-900">{r.contactName}</p>
                    {r.contactCountry ? <p className="text-xs text-slate-500">{r.contactCountry}</p> : null}
                  </TD>
                  <TD className="min-w-56 max-w-sm text-slate-700">
                    <p className="line-clamp-2">{oneLine(r.destinationAddress) || "—"}</p>
                  </TD>
                  <TD className="text-right tabular-nums">{r.packagesCount ?? "—"}</TD>
                  <TD className="text-right whitespace-nowrap tabular-nums">
                    {r.weightKg !== null ? `${formatNumber(r.weightKg, 2)} kg` : "—"}
                  </TD>
                  <TD>
                    <BollaCell row={r} />
                  </TD>
                  <TD className="whitespace-nowrap">
                    {r.carrierName || r.pickupDate ? (
                      <>
                        <p className="text-slate-900">{r.carrierName ?? "Corriere da scegliere"}</p>
                        <p className="text-xs text-slate-500">
                          {r.pickupDate ? `Ritiro il ${formatDate(r.pickupDate)}` : "Data di ritiro da definire"}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">Da definire</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
