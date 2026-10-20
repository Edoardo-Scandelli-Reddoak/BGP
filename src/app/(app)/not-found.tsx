import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/roles";

/** 404 dentro l'area di lavoro (es. link a una richiesta eliminata): resta il menu laterale. */
export default async function AppNotFound() {
  // Il layout ha già verificato la sessione (getCurrentUser è memorizzato per il render).
  const user = await getCurrentUser();
  const home = user ? ROLE_HOME[user.role] : "/";
  return (
    <Card className="mx-auto mt-6 max-w-xl">
      <CardBody className="px-6 py-10 text-center">
        <p className="text-sm font-semibold text-brand-600">Errore 404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Richiesta o pagina non trovata</h1>
        <p className="mt-2 text-sm text-slate-600">
          Quello che cerchi non esiste più o il link non è corretto. Una richiesta eliminata, per esempio, non è più
          consultabile.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href={home} className={buttonClasses("primary", "md")}>
            Torna al tuo elenco
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
