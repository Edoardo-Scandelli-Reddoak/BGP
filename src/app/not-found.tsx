import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/layout/brand";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pagina non trovata" };

/** 404 per gli indirizzi che non corrispondono a nessuna pagina (fuori dall'area di lavoro). */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <p className="text-sm font-semibold text-brand-600">Errore 404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Pagina non trovata</h1>
        <p className="mt-2 text-sm text-slate-600">
          L&apos;indirizzo non corrisponde a nessuna pagina: forse il link è incompleto o la pagina non esiste più.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/" className={buttonClasses("primary", "md")}>
            Vai alla pagina iniziale
          </Link>
        </div>
      </div>
    </main>
  );
}
