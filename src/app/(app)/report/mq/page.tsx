import type { Metadata } from "next";
import Link from "next/link";
import { AutoSubmitSelect } from "@/components/report/auto-submit-select";
import { KpiTile } from "@/components/report/kpi-tile";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { currentMonthIso, formatDate, formatM2, formatMonth, requestCode } from "@/lib/format";
import { getMonthlyM2Report } from "@/lib/reports/m2";
import { addMonths, firstParam, isIsoMonth, recentMonths } from "@/lib/reports/period";
import { canViewRequestInStatus } from "@/lib/roles";

export const metadata: Metadata = { title: "Report m² mensile" };

const MONTHS_IN_SELECT = 24;

export default async function M2ReportPage(props: PageProps<"/report/mq">) {
  const user = await requireUser("reports.m2");
  const sp = await props.searchParams;
  const current = currentMonthIso();
  const requested = firstParam(sp.mese);
  const month = isIsoMonth(requested) ? requested : current;

  const report = await getMonthlyM2Report(month);
  const monthLabel = formatMonth(month);
  const options = recentMonths(current, MONTHS_IN_SELECT);
  if (!options.includes(month)) options.push(month);
  options.sort().reverse();

  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const navLink = "inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium ring-1 ring-inset ring-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  const csvHref = `/api/report/mq?mese=${month}`;

  return (
    <>
      <PageHeader
        eyebrow="Ufficio CRM"
        title="Report m² mensile"
        description="Metri quadrati di campioni spediti nel mese, per prodotto: il riepilogo da registrare nel CRM."
        actions={
          <a href={csvHref} download className={buttonClasses("primary", "md")}>
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Esporta CSV
          </a>
        }
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <form method="get" action="/report/mq" className="flex flex-wrap items-end gap-2">
            <Link href={`/report/mq?mese=${prev}`} className={navLink} aria-label={`Mese precedente: ${formatMonth(prev)}`}>
              ←<span className="ml-1 hidden sm:inline">Precedente</span>
            </Link>
            <div className="space-y-1">
              <Label htmlFor="mese" className="text-xs">
                Mese di spedizione
              </Label>
              <AutoSubmitSelect id="mese" name="mese" defaultValue={month} className="w-48 capitalize">
                {options.map((m) => (
                  <option key={m} value={m} className="capitalize">
                    {formatMonth(m)}
                  </option>
                ))}
              </AutoSubmitSelect>
            </div>
            <button type="submit" className={buttonClasses("secondary", "md")}>
              Mostra
            </button>
            {month < current ? (
              <Link href={`/report/mq?mese=${next}`} className={navLink} aria-label={`Mese successivo: ${formatMonth(next)}`}>
                <span className="mr-1 hidden sm:inline">Successivo</span>→
              </Link>
            ) : null}
          </form>
          {month !== current ? (
            <Link href="/report/mq" className="text-sm font-medium text-brand-700 hover:text-brand-900">
              Torna al mese corrente
            </Link>
          ) : null}
        </div>

        <Alert tone="info" title="Regola di calcolo">
          I m² sono conteggiati nel mese della <strong>data di spedizione</strong> della richiesta (stato Spedita o
          Completata). I m² di ogni pezzo sono lunghezza × larghezza × quantità / 10.000, dalle misure registrate dal
          magazzino.
        </Alert>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile label="m² spediti" value={formatM2(report.totals.m2)} hint={<span className="capitalize">{monthLabel}</span>} />
          <KpiTile label="Pezzi" value={report.totals.pieces} />
          <KpiTile label="Richieste spedite" value={report.shipments.length} hint={report.totals.requests !== report.shipments.length ? `${report.totals.requests} con misure` : undefined} />
          <KpiTile label="Prodotti diversi" value={report.totals.products} />
        </div>

        {report.shipmentsWithoutPieces > 0 ? (
          <Alert tone="warning" title="Spedizioni senza misure">
            {report.shipmentsWithoutPieces === 1
              ? "1 spedizione del mese non ha misure dei pezzi registrate e non contribuisce ai m²."
              : `${report.shipmentsWithoutPieces} spedizioni del mese non hanno misure dei pezzi registrate e non contribuiscono ai m².`}
          </Alert>
        ) : null}

        <Card>
          <CardHeader
            title={<span>m² per prodotto · <span className="capitalize">{monthLabel}</span></span>}
            description="Ordinati per m² decrescenti. Richieste = richieste spedite che contengono il prodotto."
          />
          {report.rows.length === 0 ? (
            <EmptyState
              title={`Nessuna spedizione in ${monthLabel}`}
              description="Non ci sono richieste con data di spedizione in questo mese. Scegli un altro mese per vedere il riepilogo."
              action={
                month !== current ? (
                  <Link href="/report/mq" className={buttonClasses("secondary", "sm")}>
                    Vai al mese corrente
                  </Link>
                ) : (
                  <Link href={`/report/mq?mese=${prev}`} className={buttonClasses("secondary", "sm")}>
                    Vai a {formatMonth(prev)}
                  </Link>
                )
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Codice</TH>
                  <TH>Descrizione</TH>
                  <TH>Marchio</TH>
                  <TH className="text-right">Richieste</TH>
                  <TH className="text-right">Pezzi</TH>
                  <TH className="text-right">m²</TH>
                </tr>
              </THead>
              <TBody>
                {report.rows.map((r) => (
                  <TR key={r.productId}>
                    <TD className="whitespace-nowrap font-mono text-xs font-medium text-slate-900">{r.code}</TD>
                    <TD className="min-w-72 max-w-xl text-slate-600">{r.description}</TD>
                    <TD className="whitespace-nowrap">{r.brand || <span className="text-slate-400">—</span>}</TD>
                    <TD className="text-right tabular-nums">{r.requests}</TD>
                    <TD className="text-right tabular-nums">{r.pieces}</TD>
                    <TD className="whitespace-nowrap text-right font-medium tabular-nums text-slate-900">{formatM2(r.m2)}</TD>
                  </TR>
                ))}
              </TBody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <th scope="row" colSpan={3} className="px-4 py-3 text-left text-sm font-semibold text-slate-900">
                    Totale {monthLabel}
                  </th>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">{report.totals.requests}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">{report.totals.pieces}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">
                    {formatM2(report.totals.m2)}
                  </td>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Spedizioni del mese"
            description={
              report.shipments.length === 1
                ? "1 richiesta con data di spedizione nel mese."
                : `${report.shipments.length} richieste con data di spedizione nel mese.`
            }
          />
          {report.shipments.length === 0 ? (
            <EmptyState title="Nessuna spedizione" description={`Nessuna richiesta risulta spedita in ${monthLabel}.`} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Richiesta</TH>
                  <TH>Spedita il</TH>
                  <TH>Contatto</TH>
                  <TH>Paese</TH>
                  <TH className="text-right">Pezzi</TH>
                  <TH className="text-right">m²</TH>
                </tr>
              </THead>
              <TBody>
                {report.shipments.map((s) => (
                  <TR key={s.id}>
                    <TD className="whitespace-nowrap font-medium">
                      {canViewRequestInStatus(user.role, s.status) ? (
                        <Link href={`/richieste/${s.id}`} className="text-brand-700 hover:text-brand-900 hover:underline">
                          {requestCode(s.id)}
                        </Link>
                      ) : (
                        requestCode(s.id)
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(s.shipmentDate)}</TD>
                    <TD className="min-w-56">{s.contactName}</TD>
                    <TD className="whitespace-nowrap">{s.country || <span className="text-slate-400">Non indicato</span>}</TD>
                    <TD className="text-right tabular-nums">{s.pieces}</TD>
                    <TD className={cn("whitespace-nowrap text-right tabular-nums", s.pieces === 0 && "text-amber-700")}>
                      {s.pieces === 0 ? "Senza misure" : formatM2(s.m2)}
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
