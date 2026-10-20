import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND_SUGGESTIONS, CATEGORY_SUGGESTIONS, mergeSuggestions } from "@/components/anagrafiche/constants";
import { RecordActionForm } from "@/components/anagrafiche/form-helpers";
import { StatTile } from "@/components/anagrafiche/list-ui";
import { ProductForm } from "@/components/anagrafiche/product-form";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getAuthorizedUser, requireUser } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatKg, formatM2, formatNumber, requestCode } from "@/lib/format";
import { can } from "@/lib/roles";
import { deleteProduct } from "../../actions";
import { getProductDetail, listProductFacets, param, type ProductDetail } from "../../_lib/queries";

function parseIdParam(value: string): number | null {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}

export async function generateMetadata({ params }: PageProps<"/anagrafiche/prodotti/[id]">): Promise<Metadata> {
  const id = parseIdParam((await params).id);
  const user = await getAuthorizedUser("registry.view");
  const data = id && user ? await getProductDetail(id) : null;
  return { title: data ? `Prodotto ${data.product.code}` : "Prodotto" };
}

export default async function ProductDetailPage({ params, searchParams }: PageProps<"/anagrafiche/prodotti/[id]">) {
  const user = await requireUser("registry.view");
  const id = parseIdParam((await params).id);
  if (!id) notFound();
  const data = await getProductDetail(id);
  if (!data) notFound();
  const sp = await searchParams;

  const { product, stats, requests } = data;
  const canEdit = can(user.role, "registry.edit");
  const facets = canEdit ? await listProductFacets() : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/anagrafiche/prodotti" className="hover:underline">
            ← Prodotti
          </Link>
        }
        title={<span className="font-mono">{product.code}</span>}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {product.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="slate">Disattivato</Badge>}
            {product.brand ? <Badge tone="blue">{product.brand}</Badge> : null}
            {product.category ? <Badge tone="violet">{product.category}</Badge> : null}
          </span>
        }
      />

      <div className="space-y-6">
        {param(sp, "creato") === "1" ? <Alert tone="success">Prodotto creato.</Alert> : null}
        {!product.active ? (
          <Alert tone="info">
            Prodotto disattivato: non compare nei moduli di richiesta. Lo storico resta consultabile.
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Dati del prodotto"
              description={canEdit ? "I campi con * sono obbligatori." : "Sola lettura."}
            />
            <CardBody>
              {canEdit && facets ? (
                <ProductForm
                  version={product.updatedAt.toISOString()}
                  initial={{
                    id: product.id,
                    code: product.code,
                    description: product.description,
                    brand: product.brand ?? "",
                    category: product.category ?? "",
                    format: product.format ?? "",
                    finish: product.finish ?? "",
                    unitWeightKg: product.unitWeightKg === null ? "" : String(product.unitWeightKg).replace(".", ","),
                    active: product.active,
                  }}
                  brands={mergeSuggestions(BRAND_SUGGESTIONS, facets.brands)}
                  categories={mergeSuggestions(CATEGORY_SUGGESTIONS, facets.categories)}
                  cancelHref="/anagrafiche/prodotti"
                />
              ) : (
                <ProductReadOnly data={data} />
              )}
            </CardBody>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Utilizzo" description="Richieste di campioni che includono il prodotto." />
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-3">
                  <StatTile label="Volte richiesto" value={formatNumber(stats.items, 0)} />
                  <StatTile label="Quantità richiesta" value={formatNumber(stats.quantity, 0)} />
                  <StatTile label="m² inviati" value={formatM2(stats.m2Shipped)} />
                  <StatTile label="Pezzi inviati" value={formatNumber(stats.piecesShipped, 0)} />
                </dl>
                <p className="text-sm text-slate-600">
                  Ultima spedizione:{" "}
                  <span className="font-medium text-slate-900">
                    {stats.lastShipment ? formatDate(stats.lastShipment) : "nessuna"}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  Creato il {formatDateTime(product.createdAt)} · aggiornato il {formatDateTime(product.updatedAt)}
                </p>
              </CardBody>
            </Card>

            {canEdit ? <DeleteProductCard data={data} /> : null}
          </div>
        </div>

        <Card>
          <CardHeader
            title="Richieste con questo prodotto"
            description={
              stats.requests === 0
                ? "Il prodotto non è mai stato richiesto."
                : `${stats.requests} richiest${stats.requests === 1 ? "a" : "e"}`
            }
          />
          {requests.length === 0 ? (
            <EmptyState title="Nessuna richiesta" description="Le richieste che includono il prodotto compariranno qui." />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Codice</TH>
                    <TH>Ricevuta il</TH>
                    <TH>Contatto</TH>
                    <TH>Stato</TH>
                    <TH className="text-right">Q.tà</TH>
                    <TH className="text-right">m² misurati</TH>
                  </tr>
                </THead>
                <TBody>
                  {requests.map((r, i) => (
                    <TR key={`${r.requestId}-${i}`}>
                      <TD>
                        <Link href={`/richieste/${r.requestId}`} className="font-mono font-medium text-brand-800 hover:underline">
                          {requestCode(r.requestId)}
                        </Link>
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(r.receivedAt)}</TD>
                      <TD className="min-w-48">
                        <Link href={`/anagrafiche/contatti/${r.contactId}`} className="hover:underline">
                          {r.contactName}
                        </Link>
                      </TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD className="text-right tabular-nums">{r.quantity}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">
                        {r.m2 > 0 ? formatM2(r.m2) : <span className="text-slate-400">—</span>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {stats.items > requests.length ? (
                <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                  Mostrate le {requests.length} richieste più recenti.
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

function ProductReadOnly({ data }: { data: ProductDetail }) {
  const p = data.product;
  return (
    <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <DetailItem label="Codice articolo">
        <span className="font-mono">{p.code}</span>
      </DetailItem>
      <DetailItem label="Peso unitario">{p.unitWeightKg !== null ? formatKg(p.unitWeightKg) : null}</DetailItem>
      <DetailItem label="Descrizione" className="sm:col-span-2">
        {p.description}
      </DetailItem>
      <DetailItem label="Marchio">{p.brand}</DetailItem>
      <DetailItem label="Categoria">{p.category}</DetailItem>
      <DetailItem label="Formato">{p.format}</DetailItem>
      <DetailItem label="Finitura">{p.finish}</DetailItem>
    </dl>
  );
}

function DeleteProductCard({ data }: { data: ProductDetail }) {
  const { product, stats } = data;
  const used = stats.items > 0;
  return (
    <Card>
      <CardHeader title="Elimina prodotto" />
      <CardBody className="space-y-3 text-sm text-slate-600">
        {used ? (
          <p>
            Non eliminabile: il prodotto compare in {stats.requests} richiest{stats.requests === 1 ? "a" : "e"}. Per
            nasconderlo dai moduli togli la spunta «Prodotto attivo» e salva.
          </p>
        ) : (
          <>
            <p>Il prodotto non è mai stato richiesto e può essere eliminato definitivamente.</p>
            <RecordActionForm
              action={deleteProduct}
              id={product.id}
              label="Elimina prodotto"
              pendingText="Eliminazione…"
              variant="danger"
              confirmMessage={`Eliminare definitivamente il prodotto ${product.code}? L'operazione non si può annullare.`}
            />
          </>
        )}
      </CardBody>
    </Card>
  );
}
