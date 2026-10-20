"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Ultima rete di sicurezza: errori nel layout principale. Sostituisce l'intero documento,
 * quindi ha i propri <html>/<body> e importa gli stili (niente font del layout).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const code = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <html lang="it">
      <body className="min-h-dvh bg-slate-50 font-sans text-slate-900 antialiased">
        <title>Errore · Campionature BGP</title>
        <main className="flex min-h-dvh items-center justify-center px-4 py-12">
          <div className="w-full max-w-md text-center">
            <p className="text-lg font-extrabold tracking-tight text-brand-900">BGP Campionature</p>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">Si è verificato un errore imprevisto</h1>
            <p className="mt-2 text-sm text-slate-600">
              L&apos;applicazione non è riuscita a caricare la pagina. Riprova tra qualche istante: se il problema
              continua, avvisa l&apos;amministratore{code ? " indicando il codice qui sotto" : ""}.
            </p>
            {code ? <p className="mt-3 font-mono text-xs text-slate-500">Codice errore: {code}</p> : null}
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => retry()}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-800"
              >
                Riprova
              </button>
              {/* <a> e non <Link>: dopo un errore del layout conviene ricaricare il documento intero. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
              >
                Vai alla pagina iniziale
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
