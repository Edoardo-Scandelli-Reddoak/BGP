import type { Metadata } from "next";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { CostBreakdown } from "@/components/report/cost-breakdown";
import { KpiTile, StatusCountLink } from "@/components/report/kpi-tile";
import { MonthlyBars } from "@/components/report/monthly-bars";
import { PeriodFilter } from "@/components/report/period-filter";
import { StatusDistribution } from "@/components/report/status-distribution";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { RequestStatus } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { formatEuro, formatM2, formatNumber, todayIso } from "@/lib/format";
import { MISSING_LABEL_FILTER } from "@/lib/products/labels";
import {
  dashboardCostComponents,
  getByAgent,
  getByBrand,
  getByCategory,
  getByContact,
  getByCountry,
  getByProduct,
  getDashboardKpi,
  getMonthlySeries,
  getStatusDistribution,
  type CostComponent,
  type CostSummary,
  type LabelRow,
} from "@/lib/reports/dashboard";
import { NONE_VALUE, toQueryString } from "@/lib/reports/history-filters";
import { DEFAULT_PRESET, firstParam, resolvePeriod } from "@/lib/reports/period";
import { getProductLabelCoverage } from "@/lib/reports/product-labels";
import { countByStatus } from "@/lib/requests/service";
import { can, type Permission } from "@/lib/roles";
import { getSetting } from "@/lib/settings";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/status";

export const metadata: Metadata = { title: "Cruscotto direzione" };

const TOP = 15;
/** Oltre queste voci di costo la tabella clienti mostra il totale con il dettaglio su una seconda riga. */
const MAX_COST_COLUMNS = 3;
/** Pagina delle impostazioni con le voci di costo (solo amministratori). */
const COSTS_SETTINGS_HREF = "/impostazioni/costi";
const BREAKDOWNS = ["clienti", "prodotti", "marchi", "categorie", "paesi", "agenti"] as const;
type Breakdown = (typeof BREAKDOWNS)[number];

/** Vista di lavoro di ciascuno stato aperto (se il ruolo non la vede, si apre lo storico filtrato). */
const OPEN_VIEWS: { status: RequestStatus; href: string; permission: Permission }[] = [
  { status: "NUOVA", href: "/richieste", permission: "requests.manage" },
  { status: "IN_PREPARAZIONE", href: "/magazzino", permission: "warehouse.work" },
  { status: "PRONTA_RITIRO", href: "/logistica", permission: "logistics.work" },
  { status: "SPEDITA", href: "/logistica/spedite", permission: "logistics.work" },
];

const NONE = <span className="text-slate-400">—</span>;

export default async function ManagementDashboardPage(props: PageProps<"/direzione">) {
  const user = await requireUser("management.view");
  const sp = await props.searchParams;
  const today = todayIso();
  const period = resolvePeriod({ da: firstParam(sp.da), a: firstParam(sp.a) }, today);
  const tuttiParam = firstParam(sp.tutti);
  const expanded = BREAKDOWNS.find((b) => b === tuttiParam) ?? null;
  const limitFor = (b: Breakdown) => (expanded === b ? null : TOP);

  // costi = somma delle voci attive in Impostazioni → Costi
  const costConfig = await getSetting("costConfig");
  const costComponents = dashboardCostComponents(costConfig);
  const hasCosts = costComponents.length > 0;
  const costColumns = costComponents.length > 1 && costComponents.length <= MAX_COST_COLUMNS ? costComponents : [];
  const costPartsOnSecondLine = costComponents.length > MAX_COST_COLUMNS;

  const [kpi, statusCounts, series, openCounts, byContact, byProduct, byBrand, byCategory, labelCoverage, byCountry, byAgent] =
    await Promise.all([
      getDashboardKpi(period, costConfig),
      getStatusDistribution(period),
      getMonthlySeries(period),
      countByStatus(),
      getByContact(period, limitFor("clienti"), costConfig),
      getByProduct(period, limitFor("prodotti")),
      getByBrand(period, limitFor("marchi")),
      getByCategory(period, limitFor("categorie")),
      getProductLabelCoverage(),
      getByCountry(period, limitFor("paesi"), costConfig),
      getByAgent(period, limitFor("agenti")),
    ]);

  // parametri del periodo da conservare nei link (nessuno per il periodo predefinito)
  const periodParams = period.preset === DEFAULT_PRESET ? {} : { da: period.da, a: period.a };
  // approfondimento nello storico: tutte le richieste del cliente / prodotto / paese / agente
  const storico = (extra: Record<string, string | undefined>) => `/direzione/storico${toQueryString(extra)}`;
  const toggleHref = (b: Breakdown) =>
    `/direzione${toQueryString({ ...periodParams, tutti: expanded === b ? undefined : b })}#${b}`;

  // marchio e categoria: finché nessun prodotto li ha, al posto della tabella un invito a compilarli
  const registryAccess = can(user.role, "registry.edit") ? "edit" : can(user.role, "registry.view") ? "view" : null;

  const canEditCosts = can(user.role, "settings.manage");
  const costsSettings = canEditCosts ? (
    <Link href={COSTS_SETTINGS_HREF} className="font-medium underline hover:text-brand-700">
      Impostazioni → Costi
    </Link>
  ) : (
    <strong>Impostazioni → Costi</strong>
  );

  const hasSeries = series.some((p) => p.received > 0 || p.m2 > 0);
  const receivedInPeriod = Object.values(statusCounts).reduce((s, n) => s + n, 0);

  return (
    <>
      <PageHeader
        eyebrow="Direzione"
        title="Cruscotto direzione"
        description="Volumi, m², costi e tempi delle richieste di campioni nel periodo scelto."
        actions={
          <>
            <LinkButton href="/direzione/storico">Storico completo</LinkButton>
            <LinkButton href="/report/mq">Report m² mensile</LinkButton>
          </>
        }
      />

      <div className="space-y-6">
        <PeriodFilter basePath="/direzione" period={period} today={today} />

        <section aria-labelledby="kpi-title">
          <h2 id="kpi-title" className="sr-only">
            Indicatori del periodo
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiTile label="Richieste ricevute" value={kpi.received} hint="Data di ricezione nel periodo" />
            <KpiTile label="Spedite" value={kpi.shipped} hint="Data di spedizione (o di ritiro) nel periodo" />
            <KpiTile label="m² spediti" value={formatM2(kpi.m2)} hint="Dalle misure del magazzino" />
            <KpiTile
              label="Costi totali"
              value={kpi.cost === null ? NONE : formatEuro(kpi.cost)}
              hint={
                !hasCosts
                  ? "Nessuna voce di costo attiva"
                  : kpi.avgCost === null
                    ? "Nessun costo nel periodo"
                    : `Media ${formatEuro(kpi.avgCost)} su ${kpi.costCount} spedizion${kpi.costCount === 1 ? "e" : "i"}`
              }
            />
            <KpiTile
              label="Tempo medio di evasione"
              value={kpi.avgDays === null ? NONE : `${formatNumber(kpi.avgDays, 1)} giorni`}
              hint="Dalla ricezione alla spedizione"
              className="col-span-2 md:col-span-1"
            />
          </div>
          {costComponents.length > 1 && kpi.cost !== null ? (
            <Card className="mt-3">
              <CardHeader
                title="Costi totali per voce"
                description="Spedizioni del periodo, voci attive in Impostazioni → Costi"
              />
              <CardBody>
                <CostBreakdown parts={costComponents.map((c) => ({ ...c, amount: kpi.costParts[c.key] ?? 0 }))} />
              </CardBody>
            </Card>
          ) : null}
        </section>

        <section aria-labelledby="open-title">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="open-title" className="text-base font-semibold text-slate-900">
              Richieste aperte adesso
            </h2>
            <p className="text-xs text-slate-500">Situazione attuale, indipendente dal periodo</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {OPEN_VIEWS.map((v) => (
              <StatusCountLink
                key={v.status}
                href={can(user.role, v.permission) ? v.href : `/direzione/storico?stato=${v.status}`}
                color={STATUS_COLORS[v.status]}
                label={STATUS_LABELS[v.status]}
                count={openCounts[v.status]}
                hint={
                  v.status === "PRONTA_RITIRO" && openCounts.bolle > 0
                    ? `di cui ${openCounts.bolle} con bolla da preparare`
                    : v.status === "SPEDITA"
                      ? "In attesa di tracking"
                      : undefined
                }
              />
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Richieste ricevute per mese" description="Ultimi 12 mesi del periodo" />
            <CardBody className="pt-8">
              {hasSeries ? (
                <MonthlyBars
                  points={series.map((p) => ({ month: p.month, value: p.received }))}
                  unit="count"
                  unitLabel="richieste"
                  barClassName="bg-brand-600"
                  caption="Richieste ricevute per mese"
                />
              ) : (
                <EmptyState title="Nessun dato nel periodo" />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="m² spediti per mese" description="Per mese della data di spedizione (o di ritiro, se manca)" />
            <CardBody className="pt-8">
              {hasSeries ? (
                <MonthlyBars
                  points={series.map((p) => ({ month: p.month, value: p.m2 }))}
                  unit="m2"
                  unitLabel="m²"
                  barClassName="bg-accent-500"
                  caption="m² spediti per mese"
                />
              ) : (
                <EmptyState title="Nessun dato nel periodo" />
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Stato delle richieste ricevute nel periodo"
            description={`${receivedInPeriod} richiest${receivedInPeriod === 1 ? "a" : "e"}, per stato attuale`}
          />
          <CardBody>
            {receivedInPeriod > 0 ? (
              <StatusDistribution counts={statusCounts} />
            ) : (
              <p className="text-sm text-slate-500">Nessuna richiesta ricevuta nel periodo.</p>
            )}
          </CardBody>
        </Card>

        <Alert tone="info" title="Come leggere le tabelle">
          <strong>Richieste</strong> = ricevute nel periodo.{" "}
          {hasCosts ? (
            <>
              <strong>Spedite</strong>, <strong>m²</strong> e <strong>costi</strong>
            </>
          ) : (
            <>
              <strong>Spedite</strong> e <strong>m²</strong>
            </>
          )}{" "}
          = richieste con data di spedizione nel periodo (se la logistica non l&apos;ha ancora inserita, vale la data
          di ritiro).
          {hasCosts ? (
            <>
              {costComponents.length === 1 ? (
                <>
                  {" "}Il costo di una spedizione è la voce «{costComponents[0].label}», l&apos;unica attiva in {costsSettings}.
                </>
              ) : (
                <>
                  {" "}Il costo di una spedizione è la somma delle voci attive in {costsSettings}:{" "}
                  {LIST_FORMAT.format(costComponents.map((c) => c.label))}.
                </>
              )}
            </>
          ) : null}
        </Alert>

        {!hasCosts ? (
          <Alert tone="warning" title="Costi non calcolati">
            Nessuna voce di costo è attiva in {costsSettings}: il cruscotto non mostra i costi per cliente e per paese.{" "}
            {canEditCosts
              ? "Attiva almeno una voce (ad esempio il costo del corriere) per vederli."
              : "Le voci si attivano dalle impostazioni (amministratore)."}
          </Alert>
        ) : null}

        <BreakdownCard
          id="clienti"
          title={hasCosts ? "Costi e volumi per cliente" : "Volumi per cliente"}
          description={hasCosts ? "Ordinati per costo totale" : "Ordinati per m² spediti"}
          total={byContact.total}
          shown={byContact.rows.length}
          expanded={expanded === "clienti"}
          toggleHref={toggleHref("clienti")}
        >
          <Table>
            <THead>
              <tr>
                <TH>Cliente</TH>
                <TH className="text-right">Richieste</TH>
                <TH className="text-right">Spedite</TH>
                <TH className="text-right">m²</TH>
                {costColumns.map((c) => (
                  <TH key={c.key} className="text-right">
                    <span className="inline-block max-w-40 whitespace-normal">{c.label}</span>
                  </TH>
                ))}
                {hasCosts ? (
                  <>
                    <TH className="text-right">Costo totale</TH>
                    <TH className="text-right">Costo medio</TH>
                  </>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {byContact.rows.map((r) => (
                <TR key={r.contactId}>
                  <TD className="min-w-56">
                    <Link href={storico({ contatto: r.name })} className="text-brand-700 hover:text-brand-900 hover:underline">
                      {r.name}
                    </Link>
                  </TD>
                  <TD className="text-right tabular-nums">{r.requests}</TD>
                  <TD className="text-right tabular-nums">{r.shipments}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatM2(r.m2)}</TD>
                  {costColumns.map((c) => (
                    <TD key={c.key} className="whitespace-nowrap text-right tabular-nums">
                      {r.cost === null ? NONE : formatEuro(r.costParts[c.key] ?? 0)}
                    </TD>
                  ))}
                  {hasCosts ? (
                    <>
                      <TD className="whitespace-nowrap text-right font-medium tabular-nums">
                        {r.cost === null ? NONE : formatEuro(r.cost)}
                        {costPartsOnSecondLine && r.cost !== null ? <CostPartsLine row={r} components={costComponents} /> : null}
                      </TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{r.avgCost === null ? NONE : formatEuro(r.avgCost)}</TD>
                    </>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </BreakdownCard>

        <BreakdownCard
          id="prodotti"
          title="Per prodotto"
          description="Ordinati per m² spediti"
          total={byProduct.total}
          shown={byProduct.rows.length}
          expanded={expanded === "prodotti"}
          toggleHref={toggleHref("prodotti")}
        >
          <Table>
            <THead>
              <tr>
                <TH>Codice</TH>
                <TH>Descrizione</TH>
                <TH className="text-right">Richieste</TH>
                <TH className="text-right">Pezzi</TH>
                <TH className="text-right">m²</TH>
              </tr>
            </THead>
            <TBody>
              {byProduct.rows.map((r) => (
                <TR key={r.productId}>
                  <TD className="whitespace-nowrap font-mono text-xs font-medium">
                    <Link href={storico({ prodotto: r.code })} className="text-brand-700 hover:text-brand-900 hover:underline">
                      {r.code}
                    </Link>
                  </TD>
                  <TD className="min-w-72 max-w-xl text-slate-600">
                    <span className="line-clamp-2" title={r.description}>
                      {r.description}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{r.requests}</TD>
                  <TD className="text-right tabular-nums">{r.pieces}</TD>
                  <TD className="whitespace-nowrap text-right font-medium tabular-nums">{formatM2(r.m2)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </BreakdownCard>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <BreakdownCard
            id="marchi"
            title="Per marchio"
            description="Marchio dei prodotti richiesti · una richiesta con più marchi conta per ciascuno"
            total={byBrand.total}
            shown={byBrand.rows.length}
            expanded={expanded === "marchi"}
            toggleHref={toggleHref("marchi")}
            notice={
              labelCoverage.brand === 0 ? <MissingLabelNotice field="marchio" access={registryAccess} /> : undefined
            }
          >
            <LabelTable heading="Marchio" rows={byBrand.rows} href={(label) => storico({ marchio: label ?? NONE_VALUE })} />
          </BreakdownCard>

          <BreakdownCard
            id="categorie"
            title="Per categoria"
            description="Categoria dei prodotti richiesti · una richiesta con più categorie conta per ciascuna"
            total={byCategory.total}
            shown={byCategory.rows.length}
            expanded={expanded === "categorie"}
            toggleHref={toggleHref("categorie")}
            notice={
              labelCoverage.category === 0 ? <MissingLabelNotice field="categoria" access={registryAccess} /> : undefined
            }
          >
            <LabelTable
              heading="Categoria"
              rows={byCategory.rows}
              href={(label) => storico({ categoria: label ?? NONE_VALUE })}
            />
          </BreakdownCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <BreakdownCard
            id="paesi"
            title="Per paese"
            description="Paese del contatto"
            total={byCountry.total}
            shown={byCountry.rows.length}
            expanded={expanded === "paesi"}
            toggleHref={toggleHref("paesi")}
          >
            <Table>
              <THead>
                <tr>
                  <TH>Paese</TH>
                  <TH className="text-right">Richieste</TH>
                  <TH className="text-right">m²</TH>
                  {hasCosts ? <TH className="text-right">Costo totale</TH> : null}
                </tr>
              </THead>
              <TBody>
                {byCountry.rows.map((r) => (
                  <TR key={r.country ?? NONE_VALUE}>
                    <TD>
                      <Link
                        href={storico({ paese: r.country ?? NONE_VALUE })}
                        className="text-brand-700 hover:text-brand-900 hover:underline"
                      >
                        {r.country ?? "Non indicato"}
                      </Link>
                    </TD>
                    <TD className="text-right tabular-nums">{r.requests}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{formatM2(r.m2)}</TD>
                    {hasCosts ? (
                      <TD className="whitespace-nowrap text-right tabular-nums">{r.cost === null ? NONE : formatEuro(r.cost)}</TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </BreakdownCard>

          <BreakdownCard
            id="agenti"
            title="Per agente"
            description="Agente di riferimento del cliente"
            total={byAgent.total}
            shown={byAgent.rows.length}
            expanded={expanded === "agenti"}
            toggleHref={toggleHref("agenti")}
          >
            <Table>
              <THead>
                <tr>
                  <TH>Agente</TH>
                  <TH className="text-right">Richieste</TH>
                  <TH className="text-right">m²</TH>
                </tr>
              </THead>
              <TBody>
                {byAgent.rows.map((r) => (
                  <TR key={r.agentId ?? NONE_VALUE}>
                    <TD className="min-w-56">
                      <Link
                        href={storico({ agente: r.agentId === null ? NONE_VALUE : String(r.agentId) })}
                        className="text-brand-700 hover:text-brand-900 hover:underline"
                      >
                        {r.name ?? "Direzionale (senza agente)"}
                      </Link>
                    </TD>
                    <TD className="text-right tabular-nums">{r.requests}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{formatM2(r.m2)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </BreakdownCard>
        </div>
      </div>
    </>
  );
}

const LIST_FORMAT = new Intl.ListFormat("it", { style: "long", type: "conjunction" });

/** Dettaglio per voce sotto il costo totale (quando le voci sono troppe per avere una colonna ciascuna). */
function CostPartsLine({ row, components }: { row: CostSummary; components: CostComponent[] }) {
  const parts = components.filter((c) => (row.costParts[c.key] ?? 0) > 0);
  if (parts.length === 0) return null;
  return (
    <span className="mt-0.5 ml-auto block max-w-64 whitespace-normal text-xs font-normal text-slate-500">
      {parts.map((c, i) => (
        <Fragment key={c.key}>
          {i > 0 ? " · " : null}
          <span className="whitespace-nowrap">
            {c.label} {formatEuro(row.costParts[c.key])}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function BreakdownCard({
  id,
  title,
  description,
  total,
  shown,
  expanded,
  toggleHref,
  notice,
  children,
}: {
  id: Breakdown;
  title: string;
  description: string;
  total: number;
  shown: number;
  expanded: boolean;
  toggleHref: string;
  /** Messaggio al posto della tabella (es. dati non ancora disponibili in anagrafica). */
  notice?: ReactNode;
  children: ReactNode;
}) {
  const canToggle = !notice && (expanded || total > shown);
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader
        title={title}
        description={
          notice
            ? description
            : total > shown
              ? `${description} · primi ${shown} di ${total}`
              : total > 0
                ? `${description} · ${total} in tutto`
                : description
        }
        actions={
          canToggle ? (
            <Link href={toggleHref} scroll={false} className="text-sm font-medium text-brand-700 hover:text-brand-900">
              {expanded ? `Mostra solo i primi ${TOP}` : `Mostra tutti (${total})`}
            </Link>
          ) : null
        }
      />
      {notice ?? (total === 0 ? <EmptyState title="Nessun dato nel periodo" description="Prova a scegliere un periodo più ampio." /> : children)}
    </Card>
  );
}

/** Tabella per marchio o per categoria; ogni riga apre lo storico filtrato («Non indicato» compreso). */
function LabelTable({ heading, rows, href }: { heading: string; rows: LabelRow[]; href: (label: string | null) => string }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>{heading}</TH>
          <TH className="text-right">Richieste</TH>
          <TH className="text-right">Prodotti</TH>
          <TH className="text-right">Pezzi</TH>
          <TH className="text-right">m²</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.label ?? NONE_VALUE}>
            <TD className="min-w-40">
              <Link href={href(r.label)} className="text-brand-700 hover:text-brand-900 hover:underline">
                {r.label ?? "Non indicato"}
              </Link>
            </TD>
            <TD className="text-right tabular-nums">{r.requests}</TD>
            <TD className="text-right tabular-nums">{r.products}</TD>
            <TD className="text-right tabular-nums">{r.pieces}</TD>
            <TD className="whitespace-nowrap text-right font-medium tabular-nums">{formatM2(r.m2)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

const MISSING_LABEL_TEXT = {
  marchio: {
    title: "Marchio non ancora indicato nell'anagrafica prodotti",
    assign: "Assegna i marchi ai prodotti",
    view: "Vedi i prodotti senza marchio",
    byBackOffice: "Lo assegna il back office dall'anagrafica prodotti.",
  },
  categoria: {
    title: "Categoria non ancora indicata nell'anagrafica prodotti",
    assign: "Assegna le categorie ai prodotti",
    view: "Vedi i prodotti senza categoria",
    byBackOffice: "La assegna il back office dall'anagrafica prodotti.",
  },
} as const;

/** Nessun prodotto ha ancora un marchio (o una categoria): invito a compilarli, con il link se il ruolo vede l'anagrafica. */
function MissingLabelNotice({ field, access }: { field: "marchio" | "categoria"; access: "edit" | "view" | null }) {
  const text = MISSING_LABEL_TEXT[field];
  return (
    <CardBody className="space-y-2 text-sm">
      <p className="font-medium text-slate-900">{text.title}</p>
      <p className="text-slate-600">
        Quando i prodotti avranno {field === "marchio" ? "un marchio" : "una categoria"}, qui compariranno richieste,
        pezzi e m² per {field}.{access === null ? ` ${text.byBackOffice}` : null}
      </p>
      {access ? (
        <Link
          href={`/anagrafiche/prodotti?${field}=${MISSING_LABEL_FILTER}`}
          className="inline-block font-medium text-brand-700 hover:text-brand-900 hover:underline"
        >
          {access === "edit" ? text.assign : text.view}
        </Link>
      ) : null}
    </CardBody>
  );
}
