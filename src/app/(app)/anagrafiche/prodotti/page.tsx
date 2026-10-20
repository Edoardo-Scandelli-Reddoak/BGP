import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import {
  BRAND_SUGGESTIONS,
  CATEGORY_SUGGESTIONS,
  mergeSuggestions,
  PAGE_SIZE,
} from "@/components/anagrafiche/constants";
import { FilterSelect } from "@/components/anagrafiche/form-helpers";
import { FilterField, listHref } from "@/components/anagrafiche/list-ui";
import { ProductBulkLabels } from "@/components/anagrafiche/product-bulk-labels";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { formatEuro, formatM2, formatNumber } from "@/lib/format";
import { MISSING_LABEL_FILTER, PRODUCT_LABEL_NAMES } from "@/lib/products/labels";
import { productLabelCompletion } from "@/lib/products/labels-db";
import { can } from "@/lib/roles";
import { getSetting } from "@/lib/settings";
import {
  listProductFacets,
  listProducts,
  param,
  parseProductFilters,
  type ProductFilters,
} from "../_lib/queries";

export const metadata: Metadata = { title: "Prodotti" };

const BASE = "/anagrafiche/prodotti";

export default async function ProductsPage({ searchParams }: PageProps<"/anagrafiche/prodotti">) {
  const user = await requireUser("registry.view");
  const sp = await searchParams;
  const filters = parseProductFilters(sp);
  const page = parsePage(sp.pagina);
  const canEdit = can(user.role, "registry.edit");

  const [{ rows, total }, facets, costConfig, completion] = await Promise.all([
    listProducts(filters, page),
    listProductFacets(),
    getSetting("costConfig"),
    productLabelCompletion(),
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
  // filtri che restringono l'elenco (l'ordinamento no): li riusano l'export e l'assegnazione in blocco
  const listFilters = { q: params.q, attivi: params.attivi, marchio: params.marchio, categoria: params.categoria };
  const hasFilters = Object.values(listFilters).some(Boolean);
  // l'export segue anche l'ordinamento dell'elenco
  const exportHref = listHref("/api/export/prodotti", { ...listFilters, ordina: params.ordina });
  const brandOptions = withCurrent(facets.brands, filters.brand);
  const categoryOptions = withCurrent(facets.categories, filters.category);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/anagrafiche" className="hover:underline">
            Anagrafiche
          </Link>
        }
        title="Prodotti"
        description="Catalogo degli articoli campionabili, con l'utilizzo nelle richieste e i m² inviati."
        actions={
          <>
            <LinkButton href={`${BASE}/marchi-categorie`}>Marchi e categorie</LinkButton>
            <a
              href={exportHref}
              download
              className={buttonClasses("secondary", "md")}
              title={hasFilters ? "Scarica i prodotti dell'elenco filtrato" : "Scarica tutti i prodotti"}
            >
              <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Esporta Excel
            </a>
            {canEdit ? (
              <>
                <LinkButton href="/anagrafiche/import">Importa da file</LinkButton>
                <LinkButton href={`${BASE}/nuovo`} variant="primary">
                  Nuovo prodotto
                </LinkButton>
              </>
            ) : null}
          </>
        }
      />

      <div className="space-y-4">
        {param(sp, "eliminato") === "1" ? <Alert tone="success">Prodotto eliminato.</Alert> : null}
        <CompletionSummary completion={completion} canEdit={canEdit} />

        <Card>
          <Form
            key={`filtri-${JSON.stringify(params)}`}
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
                <FilterSelect id="f-marchio" name="marchio" defaultValue={filters.brand ?? ""}>
                  <option value="">Tutti</option>
                  <option value={MISSING_LABEL_FILTER}>{PRODUCT_LABEL_NAMES.brand.missing}</option>
                  {brandOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>
              <FilterField label="Categoria" id="f-categoria">
                <FilterSelect id="f-categoria" name="categoria" defaultValue={filters.category ?? ""}>
                  <option value="">Tutte</option>
                  <option value={MISSING_LABEL_FILTER}>{PRODUCT_LABEL_NAMES.category.missing}</option>
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

          {/* con filtri resta anche a elenco vuoto: dopo «Senza marchio» + assegnazione i prodotti escono
              dall'elenco e l'esito deve restare visibile */}
          {canEdit && (total > 0 || hasFilters) ? (
            <ProductBulkLabels
              key={`assegna-${JSON.stringify(listFilters)}`}
              filters={listFilters}
              total={total}
              filtered={hasFilters}
              filterText={describeFilters(filters)}
              brands={mergeSuggestions(BRAND_SUGGESTIONS, facets.brands)}
              categories={mergeSuggestions(CATEGORY_SUGGESTIONS, facets.categories)}
            />
          ) : null}

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
  return current && current !== MISSING_LABEL_FILTER && !values.includes(current) ? [current, ...values] : values;
}

/** Filtri attivi in breve, per la conferma dell'assegnazione in blocco. */
function describeFilters(f: ProductFilters): string {
  const parts: string[] = [];
  if (f.q) parts.push(`ricerca «${f.q}»`);
  if (f.active === "1") parts.push("solo attivi");
  else if (f.active === "0") parts.push("solo disattivati");
  if (f.brand) parts.push(f.brand === MISSING_LABEL_FILTER ? "senza marchio" : `marchio «${f.brand}»`);
  if (f.category) parts.push(f.category === MISSING_LABEL_FILTER ? "senza categoria" : `categoria «${f.category}»`);
  return parts.join(" · ");
}

/** «Marchio mancante su 4.817 prodotti attivi · Categoria mancante su 4.817», con i link agli elenchi filtrati. */
function CompletionSummary({
  completion,
  canEdit,
}: {
  completion: { missingBrand: number; missingCategory: number };
  canEdit: boolean;
}) {
  const { missingBrand, missingCategory } = completion;
  if (missingBrand === 0 && missingCategory === 0) return null;
  const link = "font-semibold underline underline-offset-2";
  const activeProducts = (n: number) => `${formatNumber(n, 0)} prodott${n === 1 ? "o attivo" : "i attivi"}`;
  return (
    <Alert tone="info">
      <p>
        {missingBrand > 0 ? (
          <>
            Marchio mancante su{" "}
            <Link href={`${BASE}?attivi=1&marchio=${MISSING_LABEL_FILTER}`} className={link}>
              {activeProducts(missingBrand)}
            </Link>
          </>
        ) : null}
        {missingBrand > 0 && missingCategory > 0 ? " · " : null}
        {missingCategory > 0 ? (
          <>
            Categoria mancante su{" "}
            <Link href={`${BASE}?attivi=1&categoria=${MISSING_LABEL_FILTER}`} className={link}>
              {missingBrand > 0 ? formatNumber(missingCategory, 0) : activeProducts(missingCategory)}
            </Link>
          </>
        ) : null}
      </p>
      {canEdit ? (
        <p className="mt-1 text-brand-800">
          Cerca per parole della descrizione (es. «battiscopa» o «collezione NAIF») e usa «Assegna marchio e categoria»
          sotto i filtri per completarli in blocco.
        </p>
      ) : null}
    </Alert>
  );
}
