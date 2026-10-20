"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

/** Codice dell'errore (digest) da comunicare all'amministratore: corrisponde alla riga nei log del server. */
function errorCode(error: unknown): string | null {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string") return error.digest;
  return null;
}

/** Errore imprevisto in una pagina dell'area di lavoro: il menu resta disponibile e si può riprovare. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const code = errorCode(error);

  return (
    <Card className="mx-auto mt-6 max-w-xl">
      <CardBody className="px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Si è verificato un errore imprevisto</h1>
        <p className="mt-2 text-sm text-slate-600">
          L&apos;operazione non è andata a buon fine. Riprova tra qualche istante: se il problema continua, avvisa
          l&apos;amministratore{code ? " indicando il codice qui sotto" : ""}.
        </p>
        {code ? <p className="mt-3 font-mono text-xs text-slate-500">Codice errore: {code}</p> : null}
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button onClick={() => retry()}>Riprova</Button>
          <Link href="/" className={buttonClasses("secondary", "md")}>
            Vai alla pagina iniziale
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
