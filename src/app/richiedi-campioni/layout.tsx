import Link from "next/link";
import { BrandMark } from "@/components/layout/brand";

/** Layout pubblico (senza login) del modulo di richiesta campioni per agenti e clienti. */
export default function PublicRequestLayout({ children }: LayoutProps<"/richiedi-campioni">) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="bg-brand-900">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <BrandMark inverted />
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-brand-200">Richiesta campioni</span>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">{children}</div>
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500 sm:px-6">
          <span>BGP Group S.r.l. · Clusone (BG)</span>
          <Link href="/login" className="font-medium text-slate-600 hover:text-brand-700">
            Area riservata BGP
          </Link>
        </div>
      </footer>
    </div>
  );
}
