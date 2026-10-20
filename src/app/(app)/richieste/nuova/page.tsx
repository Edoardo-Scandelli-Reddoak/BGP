import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { RequestForm, type FormContact } from "@/components/richieste/request-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { todayIso } from "@/lib/format";
import { can } from "@/lib/roles";
import { parseDbId } from "@/lib/validation";

export const metadata: Metadata = { title: "Nuova richiesta" };

async function loadContact(id: number): Promise<FormContact | null> {
  const c = await db.query.contacts.findFirst({
    where: eq(contacts.id, id),
    with: { agent: { columns: { name: true, email: true } } },
  });
  if (!c) return null;
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    company: c.company,
    email: c.email,
    phone: c.phone,
    defaultAddress: c.defaultAddress,
    country: c.country,
    language: c.language,
    agentName: c.agent?.name ?? null,
    agentEmail: c.agent?.email ?? null,
    needsReview: c.needsReview,
    active: c.active,
  };
}

export default async function NuovaRichiestaPage({ searchParams }: PageProps<"/richieste/nuova">) {
  const user = await requireUser("requests.manage");
  const { contatto } = await searchParams;
  // Id fuori dai limiti di Postgres → «contatto non trovato», mai un errore del database.
  const contactId = parseDbId(Array.isArray(contatto) ? contatto[0] : contatto);
  const contact = contactId ? await loadContact(contactId) : null;
  const contactNotFound = contatto !== undefined && !contact;
  const today = todayIso();

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/richieste" className="hover:underline">
            ← Richieste aperte
          </Link>
        }
        title="Nuova richiesta di campioni"
        description="Inserisci contatto, prodotti e indirizzo. Puoi salvare la richiesta e inviarla al magazzino in un secondo momento."
      />
      {contactNotFound ? (
        <Alert tone="warning" className="mb-4">
          Il contatto indicato non è stato trovato: selezionalo dalla ricerca.
        </Alert>
      ) : null}
      {contact && contact.active === false ? (
        <Alert tone="warning" className="mb-4">
          Il contatto selezionato è disattivato: riattivalo in anagrafica o scegline un altro.
        </Alert>
      ) : null}
      <Card className="max-w-4xl">
        <CardBody className="py-6">
          <RequestForm
            mode="create"
            today={today}
            newContactHref={
              can(user.role, "registry.edit")
                ? `/anagrafiche/contatti/nuovo?ritorno=${encodeURIComponent("/richieste/nuova")}`
                : undefined
            }
            initial={{
              contact,
              destinationAddress: contact ? [contact.name, contact.defaultAddress?.trim()].filter(Boolean).join("\n") : "",
              notes: "",
              deliveryFormRequired: false,
              receivedDate: today,
              items: [],
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
