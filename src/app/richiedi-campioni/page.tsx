import type { Metadata } from "next";
import { connection } from "next/server";
import { PublicRequestSection } from "@/components/pubblico/public-request-form";
import { PUBLIC_MAX_PRODUCTS, PUBLIC_MAX_QUANTITY } from "@/lib/requests/public";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Richiedi campioni",
  description: "Modulo per agenti e clienti BGP: richiesta di campioni di parquet.",
};

export default async function PublicRequestPage() {
  // Le impostazioni (modulo attivo, testo) si leggono a ogni visita, non al build.
  await connection();
  const settings = await getSettings();

  if (!settings.publicFormEnabled) {
    return (
      <section className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200 sm:p-10">
        <h1 className="text-xl font-semibold text-slate-900">Modulo non disponibile</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          Al momento non è possibile richiedere campioni da questa pagina. Per una richiesta contatta il tuo agente o
          l&apos;ufficio commerciale BGP.
        </p>
        {settings.companyContacts ? <p className="mt-4 text-sm font-medium text-slate-800">{settings.companyContacts}</p> : null}
      </section>
    );
  }

  const intro = settings.publicFormIntro.split(/\n{2,}|\n/).filter((p) => p.trim());

  return (
    <>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Richiedi i campioni BGP</h1>
        {intro.map((p, i) => (
          <p key={i} className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
            {p}
          </p>
        ))}
      </div>
      <PublicRequestSection maxProducts={PUBLIC_MAX_PRODUCTS} maxQuantity={PUBLIC_MAX_QUANTITY} />
    </>
  );
}
