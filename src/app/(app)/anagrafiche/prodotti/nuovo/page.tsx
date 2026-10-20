import type { Metadata } from "next";
import Link from "next/link";
import { BRAND_SUGGESTIONS, CATEGORY_SUGGESTIONS, mergeSuggestions } from "@/components/anagrafiche/constants";
import { ProductForm } from "@/components/anagrafiche/product-form";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { listProductFacets, param } from "../../_lib/queries";

export const metadata: Metadata = { title: "Nuovo prodotto" };

export default async function NewProductPage({ searchParams }: PageProps<"/anagrafiche/prodotti/nuovo">) {
  await requireUser("registry.edit");
  const sp = await searchParams;
  const facets = await listProductFacets();

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/anagrafiche/prodotti" className="hover:underline">
            ← Prodotti
          </Link>
        }
        title="Nuovo prodotto"
        description="Articolo campionabile: compare nei moduli di richiesta finché è attivo."
      />
      <div className="max-w-3xl">
        <Card>
          <CardBody>
            <ProductForm
              version="new"
              initial={{
                id: null,
                code: param(sp, "codice").slice(0, 60),
                description: "",
                brand: "",
                category: "",
                format: "",
                finish: "",
                unitWeightKg: "",
                pricePerM2: "",
                active: true,
              }}
              brands={mergeSuggestions(BRAND_SUGGESTIONS, facets.brands)}
              categories={mergeSuggestions(CATEGORY_SUGGESTIONS, facets.categories)}
              cancelHref="/anagrafiche/prodotti"
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
