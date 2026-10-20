import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { PAGE_SIZE } from "@/components/anagrafiche/constants";
import { FilterSelect } from "@/components/anagrafiche/form-helpers";
import { FilterField, listHref } from "@/components/anagrafiche/list-ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { formatEuro, formatM2, formatNumber } from "@/lib/format";
import { can } from "@/lib/roles";
import { getSetting } from "@/lib/settings";
import { listProductFacets, listProducts, param, parseProductFilters } from "../_lib/queries";

export const metadata: Metadata = { title: "Prodotti" };

const BASE = "/anagrafiche/prodotti";

export default async function ProductsPage({ searchParams }: PageProps<"/anagrafiche/prodotti">) {
  const user = await requireUser("registry.view");
  const sp = await searchParams;
  const filters = parseProductFilters(sp);
  const page = parsePage(sp.pagina);
  const canEdit = can(user.role, "registry.edit");

  const [{ rows, total }, facets, costConfig] = await Promise.all([
    listProducts(filters, page),
    listProductFacets(),
    getSetting("costConfig"),
  ]);
  // Colonna del prezzo al m² solo se serve: prezzi già indicati o valore dei campioni dai prezzi attivo nei costi.
  const showPrice =
    rows.some((p) => p.pricePerM2 !== null) || (costConfig.perM2.enabled && costConfig.perM2.useProductPrice);

  const params: Record<string, string | undefined> = {
    q: filters.q || undefined,
    attivi: filters.active || undefined,
    marchio: filters.brand ?? undefined,
    categoria: filters.category ?? undefined,
    ordina: filters.sort === "codice" ? undefined : filters.sort,
  };
  const hasFilters = Boolean(params.q || params.attivi || params.marchio || params.categoria);
  const brandOptions = withCurrent(facets.brands, filters.brand);
  const categoryOptions = withCurrent(facets.categories, filters.category);

  return (
    <>
      <PageHeader
        eyebrow="Anagrafiche"
        title="Prodotti"
        description="Catalogo degli articoli campionabili, con l'utilizzo nelle richieste e i m² inviati."
        actions={
          canEdit ? (
            <>
              <LinkButton href="/anagrafiche/import">Importa da file</LinkButton>
              <LinkButton href={`${BASE}/nuovo`} variant="primary">
                Nuovo prodotto
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="space-y-4">
        {param(sp, "eliminato") === "1" ? <Alert tone="success">Prodotto eliminato.</Alert> : null}

        <Card>
          <Form
            key={JSON.stringify(params)}
            action={BASE}
            className="space-y-3 border-b border-slate-100 px-4 py-4 sm:px-5"
            role="search"
            aria-label="Filtra prodotti"
          >
            <div className="flex gap-2">
              <Label htmlFor="q" className="sr-only">
                Cerca
              </Label>
              <Input
                id="q"
                name="q"
                type="search"
                defaultValue={filters.q}
                placeholder="Cerca per codice o parole della descrizione (es. rovere spazzolato 190)…"
                className="flex-1"
              />
              <Button type="submit" variant="primary">
                Cerca
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <FilterField label="Stato" id="f-attivi">
                <FilterSelect id="f-attivi" name="attivi" defaultValue={filters.active}>
                  <option value="">Tutti</option>
                  <option value="1">Solo attivi</option>
                  <option value="0">Solo disattivati</option>
                </FilterSelect>
              </FilterField>
              <FilterField label="Marchio" id="f-marchio">
                <FilterSelect
                  id="f-marchio"
                  name="marchio"
                  defaultValue={filters.brand ?? ""}
                  disabled={brandOptions.length === 0}
                  title={brandOptions.length === 0 ? "Nessun prodotto ha ancora un marchio" : undefined}
                >
                  <option value="">Tutti</option>
                  {brandOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>
              <FilterField label="Categoria" id="f-categoria">
                <FilterSelect
                  id="f-categoria"
                  name="categoria"
                  defaultValue={filters.category ?? ""}
                  disabled={categoryOptions.length === 0}
                  title={categoryOptions.length === 0 ? "Nessun prodotto ha ancora una categoria" : undefined}
                >
                  <option value="">Tutte</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>
              <FilterField label="Ordina per" id="f-ordina">
                <FilterSelect id="f-ordina" name="ordina" defaultValue={filters.sort}>
                  <option value="codice">Codice</option>
                  <option value="richiesti">Più richiesti</option>
                  <option value="mq">m² inviati</option>
                </FilterSelect>
              </FilterField>
            </div>
            {hasFilters ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">
                  {formatNumber(total, 0)} prodott{total === 1 ? "o" : "i"} trovat{total === 1 ? "o" : "i"}
                </span>
                <Link href={BASE} className="font-medium text-brand-700 hover:underline">
                  Azzera filtri
                </Link>
              </div>
            ) : null}
          </Form>

          {rows.length === 0 && total > 0 ? (
            <EmptyState
              title="Pagina non disponibile"
              description={`I risultati sono ${total}: questa pagina è oltre la fine dell'elenco.`}
              action={<LinkButton href={listHref(BASE, params)}>Vai alla prima pagina</LinkButton>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={hasFilters ? "Nessun prodotto corrisponde ai filtri" : "Nessun prodotto in catalogo"}
              description={
                hasFilters
                  ? "Prova a cercare solo una parte del codice o meno parole."
                  : "Importa il listino prodotti da file oppure crea il primo prodotto."
              }
              action={
                hasFilters ? (
                  <LinkButton href={BASE}>Azzera filtri</LinkButton>
                ) : canEdit ? (
                  <LinkButton href="/anagrafiche/import" variant="primary">
                    Importa da file
                  </LinkButton>
                ) : null
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Codice</TH>
                  <TH>Descrizione</TH>
                  <TH>Marchio</TH>
                  <TH>Categoria</TH>
                  <TH>Stato</TH>
                  {showPrice ? <TH className="text-right">Prezzo al m²</TH> : null}
                  <TH className="text-right">Volte richiesto</TH>
                  <TH className="text-right">m² inviati</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <TR key={p.id} className={p.active ? undefined : "bg-slate-50/70 text-slate-500"}>
                    <TD className="whitespace-nowrap">
                      <Link href={`${BASE}/${p.id}`} className="font-mono font-medium text-brand-800 hover:underline">
                        {p.code}
                      </Link>
                    </TD>
                    <TD className="min-w-72 max-w-xl">
                      <span className="line-clamp-2" title={p.description}>
                        {p.description || <span className="text-slate-400">—</span>}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap">{p.brand || <span className="text-slate-400">—</span>}</TD>
                    <TD className="whitespace-nowrap">{p.category || <span className="text-slate-400">—</span>}</TD>
                    <TD>{p.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="slate">Disattivato</Badge>}</TD>
                    {showPrice ? (
                      <TD className="whitespace-nowrap text-right tabular-nums">
                        {p.pricePerM2 !== null ? formatEuro(p.pricePerM2) : <span className="text-slate-400">—</span>}
                      </TD>
                    ) : null}
                    <TD className="text-right tabular-nums">{p.times || <span className="text-slate-400">0</span>}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      {p.m2 > 0 ? formatM2(p.m2) : <span className="text-slate-400">—</span>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {rows.length > 0 ? (
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath={BASE} params={params} />
          ) : null}
        </Card>
      </div>
    </>
  );
}

/** Mantiene nel menu il valore filtrato anche se non è più presente in anagrafica. */
function withCurrent(values: string[], current: string | null): string[] {
  return current && !values.includes(current) ? [current, ...values] : values;
}
