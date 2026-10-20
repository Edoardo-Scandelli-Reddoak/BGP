import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/anagrafiche/contact-form";
import { COUNTRY_SUGGESTIONS, mergeSuggestions, safeReturnPath } from "@/components/anagrafiche/constants";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { listAgents, listCountries, param } from "../../_lib/queries";

export const metadata: Metadata = { title: "Nuovo contatto" };

export default async function NewContactPage({ searchParams }: PageProps<"/anagrafiche/contatti/nuovo">) {
  await requireUser("registry.edit");
  const sp = await searchParams;
  const ritorno = safeReturnPath(param(sp, "ritorno"));
  const tipo = param(sp, "tipo") === "AGENTE" ? "AGENTE" : "CLIENTE";
  const [agents, countries] = await Promise.all([listAgents(), listCountries()]);
  const backHref = ritorno ?? "/anagrafiche/contatti";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={backHref} className="hover:underline">
            {ritorno ? "← Torna alla richiesta" : "← Contatti"}
          </Link>
        }
        title="Nuovo contatto"
        description="Cliente o agente che riceve i campioni e le conferme di spedizione."
      />
      <div className="max-w-3xl space-y-4">
        {ritorno ? (
          <Alert tone="info">
            Dopo il salvataggio tornerai alla richiesta con il nuovo contatto già selezionato.
          </Alert>
        ) : null}
        <Card>
          <CardBody>
            <ContactForm
              version="new"
              initial={{
                id: null,
                type: tipo,
                name: param(sp, "nome").slice(0, 200),
                company: "",
                email: "",
                phone: "",
                country: "",
                defaultAddress: "",
                language: "it",
                agentId: null,
                notes: "",
                active: true,
              }}
              agents={agents}
              countries={mergeSuggestions(COUNTRY_SUGGESTIONS, countries)}
              ritorno={ritorno}
              cancelHref={backHref}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
