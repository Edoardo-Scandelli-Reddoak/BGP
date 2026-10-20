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
import type { RequestStatus } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { CRM_COLUMNS, CRM_GROUP_BY_LABELS, crmFileName, type CrmExportConfig } from "@/lib/config/crm-export";
import { currentMonthIso, formatDate, formatM2, formatMonth, requestCode } from "@/lib/format";
import { getMonthlyM2Report, type M2Shipment } from "@/lib/reports/m2";
import { addMonths, firstParam, isIsoMonth, recentMonths } from "@/lib/reports/period";
import { can, canViewRequestInStatus } from "@/lib/roles";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Report m² mensile" };

const MONTHS_IN_SELECT = 24;
/** Pagina delle impostazioni dell'export (solo amministratori). */
const CRM_SETTINGS_HREF = "/impostazioni/export-crm";

const SEPARATOR_LABELS: Record<CrmExportConfig["separator"], string> = {
  ";": "punto e virgola",
  ",": "virgola",
  "\t": "tabulazione",
};

/** "CSV per prodotto · colonne: Codice, Descrizione, …" e i dettagli del file e dell'invio. */
function describeCrmExport(config: CrmExportConfig, month: string) {
  const summary = `${config.format === "XLSX" ? "Excel" : "CSV"} ${CRM_GROUP_BY_LABELS[config.groupBy].toLowerCase()} · colonne: ${config.columns
    .map((c) => CRM_COLUMNS[c])
    .join(", ")}`;
  const details = [
    `file ${crmFileName(config, month)}`,
    ...(config.format === "CSV"
      ? [
          `separatore ${SEPARATOR_LABELS[config.separator]}`,
          `decimali con ${config.decimal === "," ? "la virgola" : "il punto"}`,
        ]
      : []),
    config.header ? "con intestazione" : "senza intestazione",
  ];
  const n = config.autoSend.recipients.length;
  const sending = [
    config.autoSend.enabled && n > 0
      ? `invio automatico via email il giorno ${config.autoSend.day} di ogni mese (mese precedente) a ${n} destinatar${n === 1 ? "io" : "i"}`
      : null,
    config.webhook.enabled ? "invio automatico al CRM (webhook) attivo" : null,
  ].filter((x): x is string => x !== null);
  return { summary, details: details.join(" · "), sending: sending.length ? sending.join(" · ") : "invio automatico non attivo" };
}

/** Data del mese di conteggio: la data di spedizione, oppure quella di ritiro se manca. */
function ShipmentDate({ shipment }: { shipment: M2Shipment }) {
  return (
    <>
      {formatDate(shipment.shipmentDate)}
      {shipment.pickupDateUsed ? <span className="text-xs text-amber-700"> (data di ritiro)</span> : null}
    </>
  );
}

export default async function M2ReportPage(props: PageProps<"/report/mq">) {
  const user = await requireUser("reports.m2");
  const sp = await props.searchParams;
  const current = currentMonthIso();
  const requested = firstParam(sp.mese);
  const month = isIsoMonth(requested) ? requested : current;

  const [report, crmExport] = await Promise.all([getMonthlyM2Report(month), getSetting("crmExport")]);
  const exportInfo = describeCrmExport(crmExport, month);
  // Spedite senza data di spedizione: il report le conta nel mese della data di ritiro.
  const countedByPickup = report.shipments.filter((s) => s.pickupDateUsed);
  const requestLink = (id: number, status: RequestStatus) =>
    canViewRequestInStatus(user.role, status) ? (
      <Link href={`/richieste/${id}`} className="text-brand-700 hover:text-brand-900 hover:underline">
        {requestCode(id)}
      </Link>
    ) : (
      requestCode(id)
    );
  const monthLabel = formatMonth(month);
  const options = recentMonths(current, MONTHS_IN_SELECT);
  if (!options.includes(month)) options.push(month);
  options.sort().reverse();

  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const navLink = "inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium ring-1 ring-inset ring-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  const exportHref = `/api/report/crm?mese=${month}`;

  return (
    <>
      <PageHeader
        eyebrow="Ufficio CRM"
        title="Report m² mensile"
        description="Metri quadrati di campioni spediti nel mese, per prodotto: il riepilogo da registrare nel CRM."
        actions={
          <a href={exportHref} download className={buttonClasses("primary", "md")} aria-describedby="crm-export-info">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {crmExport.format === "XLSX" ? "Esporta Excel" : "Esporta CSV"}
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

        <div
          id="crm-export-info"
          className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 rounded-xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200"
        >
          <div className="min-w-0">
            <p className="text-slate-900">
              <span className="font-medium">Export per il CRM:</span> {exportInfo.summary}
            </p>
            <p className="mt-0.5 text-xs break-words text-slate-500">
              {exportInfo.details} · {exportInfo.sending}
            </p>
            {crmExport.groupBy !== "PRODOTTO" ? (
              <p className="mt-0.5 text-xs text-slate-500">
                Il file è raggruppato {CRM_GROUP_BY_LABELS[crmExport.groupBy].toLowerCase()}: le righe non coincidono con la
                tabella per prodotto qui sotto (i totali di m² e pezzi sì).
              </p>
            ) : null}
          </div>
          {can(user.role, "settings.manage") ? (
            <Link href={CRM_SETTINGS_HREF} className="text-sm font-medium whitespace-nowrap text-brand-700 hover:text-brand-900">
              Impostazioni → Export CRM
            </Link>
          ) : null}
        </div>

        <Alert tone="info" title="Regola di calcolo">
          I m² sono conteggiati nel mese della <strong>data di spedizione</strong> della richiesta (stato Spedita o
          Completata); se la logistica non l&apos;ha ancora inserita, vale la <strong>data di ritiro</strong>. I m² di
          ogni pezzo sono lunghezza × larghezza × quantità / 10.000, dalle misure registrate dal magazzino.
        </Alert>

        {countedByPickup.length > 0 ? (
          <Alert
            tone="warning"
            title={
              countedByPickup.length === 1
                ? "1 spedizione senza data di spedizione"
                : `${countedByPickup.length} spedizioni senza data di spedizione`
            }
          >
            <p>
              {countedByPickup.length === 1 ? "È conteggiata" : "Sono conteggiate"} nel mese della data di ritiro. Se la
              logistica inserisce una data di spedizione in un altro mese, i m² si spostano in quel mese.
            </p>
            <ul className="mt-2 space-y-0.5">
              {countedByPickup.map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{requestLink(r.id, r.status)}</span> · {r.contactName} · ritiro il{" "}
                  {formatDate(r.shipmentDate)}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

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
              description="Non ci sono richieste spedite in questo mese. Scegli un altro mese per vedere il riepilogo."
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
            <>
              <div className="hidden md:block">
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
                        <TD className="min-w-56 max-w-xl text-slate-600">
                          <span className="line-clamp-2" title={r.description}>
                            {r.description}
                          </span>
                        </TD>
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
              </div>

              {/* Su telefono: codice e m² in evidenza, descrizione su due righe. */}
              <div className="md:hidden">
                <ul className="divide-y divide-slate-100">
                  {report.rows.map((r) => (
                    <li key={r.productId} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-xs font-medium text-slate-900">{r.code}</span>
                        <span className="whitespace-nowrap font-semibold tabular-nums text-slate-900">{formatM2(r.m2)}</span>
                      </div>
                      {r.description ? <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{r.description}</p> : null}
                      <p className="mt-1 text-xs text-slate-500">
                        {r.brand ? `${r.brand} · ` : ""}
                        {r.requests} richiest{r.requests === 1 ? "a" : "e"} · {r.pieces} pezz{r.pieces === 1 ? "o" : "i"}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="flex items-baseline justify-between gap-3 border-t-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
                  <span>
                    Totale <span className="capitalize">{monthLabel}</span>
                    <span className="block text-xs font-normal text-slate-500">
                      {report.totals.requests} richiest{report.totals.requests === 1 ? "a" : "e"} · {report.totals.pieces}{" "}
                      pezz{report.totals.pieces === 1 ? "o" : "i"}
                    </span>
                  </span>
                  <span className="whitespace-nowrap tabular-nums">{formatM2(report.totals.m2)}</span>
                </div>
              </div>
            </>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Spedizioni del mese"
            description={
              report.shipments.length === 1
                ? "1 richiesta spedita nel mese."
                : `${report.shipments.length} richieste spedite nel mese.`
            }
          />
          {report.shipments.length === 0 ? (
            <EmptyState title="Nessuna spedizione" description={`Nessuna richiesta risulta spedita in ${monthLabel}.`} />
          ) : (
            <>
              <div className="hidden md:block">
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
                        <TD className="whitespace-nowrap font-medium">{requestLink(s.id, s.status)}</TD>
                        <TD className="whitespace-nowrap">
                          <ShipmentDate shipment={s} />
                        </TD>
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
              </div>

              <ul className="divide-y divide-slate-100 md:hidden">
                {report.shipments.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-sm font-semibold">{requestLink(s.id, s.status)}</span>
                      <span
                        className={cn(
                          "whitespace-nowrap tabular-nums",
                          s.pieces === 0 ? "text-sm text-amber-700" : "font-semibold text-slate-900",
                        )}
                      >
                        {s.pieces === 0 ? "Senza misure" : formatM2(s.m2)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-900">{s.contactName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      <ShipmentDate shipment={s} />
                      {s.country ? ` · ${s.country}` : ""} · {s.pieces} pezz{s.pieces === 1 ? "o" : "i"}
                    </p>
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
