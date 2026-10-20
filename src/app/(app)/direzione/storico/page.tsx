import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { trackingUrl } from "@/lib/email/notifications";
import { formatDate, formatEuro, formatKg, formatM2, requestCode } from "@/lib/format";
import { historyProductsText } from "@/lib/reports/exports";
import { getHistoryFilterOptions, getHistoryPage, HISTORY_PAGE_SIZE } from "@/lib/reports/history";
import {
  hasActiveFilters,
  historyFiltersToParams,
  NONE_VALUE,
  parseHistoryFilters,
  SOURCE_LABELS,
  toQueryString,
} from "@/lib/reports/history-filters";
import { sampleFormatText } from "@/lib/sample-formats";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/status";

export const metadata: Metadata = { title: "Storico completo" };

/** Prodotti mostrati per riga (gli altri sono nel CSV e nel dettaglio della richiesta). */
const MAX_ITEMS = 3;
const DASH = <span className="text-slate-400">—</span>;

export default async function HistoryPage(props: PageProps<"/direzione/storico">) {
  await requireUser("management.view");
  const sp = await props.searchParams;
  const filters = parseHistoryFilters(sp);
  const page = parsePage(sp.pagina);

  const [{ rows, total }, options] = await Promise.all([getHistoryPage(filters, page), getHistoryFilterOptions()]);
  const params = historyFiltersToParams(filters);
  const exportHref = `/api/export/richieste${toQueryString(params)}`;
  const filtered = hasActiveFilters(filters);
  const agenteValue = filters.agente === undefined ? "" : String(filters.agente);
  // un paese filtrato ma non più presente tra i contatti con richieste resta selezionabile
  const countries =
    filters.paese && filters.paese !== NONE_VALUE && !options.countries.includes(filters.paese)
      ? [...options.countries, filters.paese]
      : options.countries;

  return (
    <>
      <PageHeader
        eyebrow="Direzione"
        title="Storico completo"
        description="Tutte le richieste di campioni, in ogni stato, dalla più recente. Sola consultazione."
        actions={
          <a href={exportHref} download className={buttonClasses("primary", "md")}>
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Esporta CSV
          </a>
        }
      />

      <div className="space-y-6">
        <Card>
          <form method="get" action="/direzione/storico" className="px-5 py-4" aria-label="Filtri dello storico">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Due colonne su lg: con una sola i campi data tagliano il giorno (gg/mm/aaaa + icona). */}
              <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                <div className="space-y-1.5">
                  <Label htmlFor="f-da">Ricevuta dal</Label>
                  <Input id="f-da" type="date" name="da" defaultValue={filters.da} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="f-a">al</Label>
                  <Input id="f-a" type="date" name="a" defaultValue={filters.a} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-stato">Stato</Label>
                <Select id="f-stato" name="stato" defaultValue={filters.stato ?? ""}>
                  <option value="">Tutti gli stati</option>
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-contatto">Contatto o destinatario</Label>
                <Input
                  id="f-contatto"
                  type="search"
                  name="contatto"
                  defaultValue={filters.contatto}
                  placeholder="Nome, azienda, email o destinatario"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-prodotto">Prodotto</Label>
                <Input
                  id="f-prodotto"
                  type="search"
                  name="prodotto"
                  defaultValue={filters.prodotto}
                  placeholder="Codice o descrizione"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-agente">Agente</Label>
                <Select id="f-agente" name="agente" defaultValue={agenteValue}>
                  <option value="">Tutti</option>
                  <option value={NONE_VALUE}>Direzionale (senza agente)</option>
                  {options.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-paese">Paese</Label>
                <Select id="f-paese" name="paese" defaultValue={filters.paese ?? ""}>
                  <option value="">Tutti</option>
                  {countries.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {options.hasMissingCountry || filters.paese === NONE_VALUE ? (
                    <option value={NONE_VALUE}>Non indicato</option>
                  ) : null}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-marchio">Marchio</Label>
                <Select
                  id="f-marchio"
                  name="marchio"
                  defaultValue={filters.marchio ?? ""}
                  disabled={options.brands.length === 0 && !filters.marchio}
                  aria-describedby={options.brands.length === 0 ? "f-marchio-hint" : undefined}
                >
                  <option value="">Tutti</option>
                  {options.brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                  {filters.marchio && !options.brands.includes(filters.marchio) ? (
                    <option value={filters.marchio}>{filters.marchio}</option>
                  ) : null}
                </Select>
                {options.brands.length === 0 ? (
                  <p id="f-marchio-hint" className="text-xs text-slate-500">
                    Nessun marchio nell&apos;anagrafica prodotti.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-origine">Origine</Label>
                <Select id="f-origine" name="origine" defaultValue={filters.origine ?? ""}>
                  <option value="">Tutte</option>
                  {(Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[]).map((k) => (
                    <option key={k} value={k}>
                      {SOURCE_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="submit" className={buttonClasses("primary", "md")}>
                Filtra
              </button>
              {filtered ? (
                <Link href="/direzione/storico" className={buttonClasses("ghost", "md")}>
                  Azzera filtri
                </Link>
              ) : null}
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader
            title={`${total} richiest${total === 1 ? "a" : "e"}`}
            description={filtered ? "Risultati con i filtri applicati. L'export CSV usa gli stessi filtri." : "Tutte le richieste registrate."}
          />
          {rows.length === 0 && total > 0 ? (
            <EmptyState
              title="Pagina non disponibile"
              description={`I risultati sono ${total}: questa pagina è oltre la fine dell'elenco.`}
              action={
                <Link href={`/direzione/storico${toQueryString(params)}`} className={buttonClasses("secondary", "sm")}>
                  Vai alla prima pagina
                </Link>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={filtered ? "Nessuna richiesta con questi filtri" : "Nessuna richiesta registrata"}
              description={filtered ? "Modifica o azzera i filtri per ampliare la ricerca." : undefined}
              action={
                filtered ? (
                  <Link href="/direzione/storico" className={buttonClasses("secondary", "sm")}>
                    Azzera filtri
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Codice</TH>
                    <TH>Ricevuta</TH>
                    <TH>Stato</TH>
                    <TH>Contatto</TH>
                    <TH>Destinatario</TH>
                    <TH>Agente</TH>
                    <TH>Paese</TH>
                    <TH>Prodotti</TH>
                    <TH className="text-right">Colli</TH>
                    <TH className="text-right">Peso</TH>
                    <TH className="text-right">m²</TH>
                    <TH>Corriere</TH>
                    <TH>Tracking</TH>
                    <TH>Spedita il</TH>
                    <TH className="text-right">Costo spedizione</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((r) => {
                    const hiddenItems = r.productItems.length - MAX_ITEMS;
                    const trackHref = trackingUrl(r.carrierTrackingUrl, r.trackingNumber);
                    return (
                      <TR key={r.id}>
                        <TD className="whitespace-nowrap font-medium">
                          <Link href={`/richieste/${r.id}`} className="text-brand-700 hover:text-brand-900 hover:underline">
                            {requestCode(r.id)}
                          </Link>
                          {r.source === "MODULO_PUBBLICO" ? (
                            <span className="block text-xs font-normal text-slate-500">Modulo pubblico</span>
                          ) : null}
                        </TD>
                        <TD className="whitespace-nowrap">{formatDate(r.receivedAt)}</TD>
                        <TD>
                          <StatusBadge status={r.status} />
                        </TD>
                        <TD className="min-w-48">{r.contactName}</TD>
                        <TD className="min-w-48">
                          {r.recipientName || DASH}
                          {r.attentionOf ? (
                            <span className="block text-xs text-slate-500">c.a. {r.attentionOf}</span>
                          ) : null}
                        </TD>
                        <TD className="min-w-40 text-slate-600">{r.agentName ?? <span className="text-slate-400">Direzionale</span>}</TD>
                        <TD className="whitespace-nowrap">{r.country || DASH}</TD>
                        <TD className="min-w-48 max-w-xs text-xs">
                          {r.productItems.length === 0 ? (
                            DASH
                          ) : (
                            // un prodotto per riga: codice e formato del campione (lo stesso codice può avere due formati)
                            <ul className="space-y-0.5">
                              {r.productItems.slice(0, MAX_ITEMS).map((item, i) => {
                                const format = sampleFormatText(item.format, item.note);
                                return (
                                  <li key={i}>
                                    <span className="whitespace-nowrap font-mono font-medium text-slate-900">{item.code}</span>
                                    {format ? <span className="text-slate-500"> · {format}</span> : null}
                                  </li>
                                );
                              })}
                              {hiddenItems > 0 ? (
                                <li className="text-slate-500" title={historyProductsText(r.productItems)}>
                                  +{hiddenItems} altr{hiddenItems === 1 ? "o" : "i"}
                                </li>
                              ) : null}
                            </ul>
                          )}
                        </TD>
                        <TD className="text-right tabular-nums">{r.packagesCount ?? DASH}</TD>
                        <TD className="whitespace-nowrap text-right tabular-nums">{r.weightKg === null ? DASH : formatKg(r.weightKg)}</TD>
                        <TD className="whitespace-nowrap text-right tabular-nums">{r.m2 > 0 ? formatM2(r.m2) : DASH}</TD>
                        <TD className="whitespace-nowrap">{r.carrierName ?? DASH}</TD>
                        <TD className="whitespace-nowrap font-mono text-xs">
                          {!r.trackingNumber ? (
                            DASH
                          ) : trackHref ? (
                            <a href={trackHref} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                              {r.trackingNumber}
                            </a>
                          ) : (
                            r.trackingNumber
                          )}
                        </TD>
                        <TD className="whitespace-nowrap">{r.shippedOn ? formatDate(r.shippedOn) : DASH}</TD>
                        <TD className="whitespace-nowrap text-right tabular-nums">{r.shippingCost === null ? DASH : formatEuro(r.shippingCost)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              <Pagination page={page} pageSize={HISTORY_PAGE_SIZE} total={total} basePath="/direzione/storico" params={params} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
