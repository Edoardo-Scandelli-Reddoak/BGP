import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format";
import { MISSING_LABEL_FILTER } from "@/lib/products/labels";
import { distinctLabels, productLabelCompletion } from "@/lib/products/labels-db";
import { can } from "@/lib/roles";
import { countContactsToReview, registryCounts } from "./_lib/queries";

export const metadata: Metadata = { title: "Anagrafiche" };

const n = (v: number) => formatNumber(v, 0);

export default async function RegistryIndexPage() {
  const user = await requireUser("registry.view");
  const canEdit = can(user.role, "registry.edit");
  const [counts, toReview, completion, brands, categories] = await Promise.all([
    registryCounts(),
    countContactsToReview(),
    productLabelCompletion(),
    distinctLabels("brand"),
    distinctLabels("category"),
  ]);
  const incomplete = completion.missingBrand > 0 || completion.missingCategory > 0;

  return (
    <>
      <PageHeader
        title="Anagrafiche"
        description="Contatti e prodotti usati nelle richieste di campioni."
      />

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <IndexCard
          href="/anagrafiche/contatti"
          title="Contatti"
          summary={`${n(counts.customers)} clienti · ${n(counts.agents)} agenti`}
          note={
            toReview > 0 ? (
              <Link href="/anagrafiche/contatti?verifica=1" className="font-medium text-amber-800 hover:underline">
                {toReview === 1 ? "1 contatto da verificare" : `${n(toReview)} contatti da verificare`}
              </Link>
            ) : null
          }
        />
        <IndexCard
          href="/anagrafiche/prodotti"
          title="Prodotti"
          summary={`${n(counts.products)} prodotti · ${n(counts.activeProducts)} attivi`}
          note={
            incomplete ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {completion.missingBrand > 0 ? (
                  <Link
                    href={`/anagrafiche/prodotti?attivi=1&marchio=${MISSING_LABEL_FILTER}`}
                    className="font-medium text-amber-800 hover:underline"
                  >
                    Senza marchio: {n(completion.missingBrand)} attivi
                  </Link>
                ) : null}
                {completion.missingCategory > 0 ? (
                  <Link
                    href={`/anagrafiche/prodotti?attivi=1&categoria=${MISSING_LABEL_FILTER}`}
                    className="font-medium text-amber-800 hover:underline"
                  >
                    Senza categoria: {n(completion.missingCategory)} attivi
                  </Link>
                ) : null}
              </span>
            ) : null
          }
        />
        <IndexCard
          href="/anagrafiche/prodotti/marchi-categorie"
          title="Marchi e categorie"
          summary={`${n(brands.length)} marchi · ${n(categories.length)} categorie in uso`}
          note={canEdit ? "Rinomina, unisci o togli i valori assegnati ai prodotti." : null}
        />
        {canEdit ? (
          <IndexCard
            href="/anagrafiche/import"
            title="Importa da file"
            summary="Elenco clienti da Airtable e listino prodotti (.xlsx o .csv)."
          />
        ) : null}
      </ul>
    </>
  );
}

function IndexCard({ href, title, summary, note }: { href: string; title: string; summary: string; note?: ReactNode }) {
  return (
    <li className="min-w-0">
      <Card className="h-full px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          <Link href={href} className="text-brand-800 hover:underline">
            {title} →
          </Link>
        </h2>
        <p className="mt-1 text-sm text-slate-600">{summary}</p>
        {note ? <div className="mt-2 text-sm text-slate-500">{note}</div> : null}
      </Card>
    </li>
  );
}
