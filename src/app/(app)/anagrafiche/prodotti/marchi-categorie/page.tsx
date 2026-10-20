import type { Metadata } from "next";
import Link from "next/link";
import { ProductLabelValues } from "@/components/anagrafiche/product-label-values";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { labelKey, MISSING_LABEL_FILTER, type ProductLabelField } from "@/lib/products/labels";
import { PRODUCT_LABEL_SUGGESTIONS, productLabelUsage, type LabelUsage } from "@/lib/products/labels-db";
import { can } from "@/lib/roles";

export const metadata: Metadata = { title: "Marchi e categorie" };

/** Suggerimenti del blueprint BGP non ancora usati da nessun prodotto (confronto senza maiuscole e spazi). */
function unusedSuggestions(field: ProductLabelField, usage: LabelUsage): string[] {
  const used = new Set(usage.values.map((v) => labelKey(v.value)));
  return PRODUCT_LABEL_SUGGESTIONS[field].filter((s) => !used.has(labelKey(s)));
}

export default async function ProductLabelsPage() {
  const user = await requireUser("registry.view");
  const canEdit = can(user.role, "registry.edit");
  const [brands, categories] = await Promise.all([productLabelUsage("brand"), productLabelUsage("category")]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/anagrafiche/prodotti" className="hover:underline">
            ← Prodotti
          </Link>
        }
        title="Marchi e categorie"
        description={
          canEdit
            ? "Valori usati nei prodotti, con quanti prodotti li hanno. Rinomina un valore per correggerne la grafia o unirlo a un altro; toglilo per lasciare i prodotti senza."
            : "Valori usati nei prodotti, con quanti prodotti li hanno."
        }
      />

      <div className="space-y-6">
        {canEdit ? (
          <Alert tone="info">
            Per assegnare marchio e categoria a molti prodotti insieme cerca nell&apos;
            <Link
              href={`/anagrafiche/prodotti?attivi=1&marchio=${MISSING_LABEL_FILTER}`}
              className="font-semibold underline underline-offset-2"
            >
              elenco prodotti
            </Link>{" "}
            per codice o parole della descrizione (es. «battiscopa» o «collezione NAIF») e usa «Assegna marchio e
            categoria» sotto i filtri.
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <ProductLabelValues
            field="brand"
            values={brands.values}
            missing={brands.missing}
            unusedSuggestions={unusedSuggestions("brand", brands)}
            canEdit={canEdit}
          />
          <ProductLabelValues
            field="category"
            values={categories.values}
            missing={categories.missing}
            unusedSuggestions={unusedSuggestions("category", categories)}
            canEdit={canEdit}
          />
        </div>
      </div>
    </>
  );
}
