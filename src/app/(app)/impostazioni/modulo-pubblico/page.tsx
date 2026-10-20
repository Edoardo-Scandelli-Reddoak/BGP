import type { Metadata } from "next";
import Link from "next/link";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { contacts, sampleRequests } from "@/db/schema";
import { CopyField, PublicFormSettingsForm } from "@/components/impostazioni/general-settings-forms";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { appUrl } from "@/lib/email/notifications";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Modulo pubblico — Impostazioni" };

export default async function PublicFormSettingsPage() {
  await requireUser("settings.manage");
  const [settings, [received], [newRequests], [toReview]] = await Promise.all([
    getSettings(),
    db
      .select({ n: count() })
      .from(sampleRequests)
      .where(
        and(
          eq(sampleRequests.source, "MODULO_PUBBLICO"),
          gte(sampleRequests.receivedAt, sql`now() - interval '30 days'`),
        ),
      ),
    db
      .select({ n: count() })
      .from(sampleRequests)
      .where(and(eq(sampleRequests.source, "MODULO_PUBBLICO"), eq(sampleRequests.status, "NUOVA"))),
    db
      .select({ n: count() })
      .from(contacts)
      .where(and(eq(contacts.needsReview, true), eq(contacts.active, true))),
  ]);
  const publicUrl = `${appUrl()}/richiedi-campioni`;

  return (
    <>
      {!settings.publicFormEnabled ? (
        <Alert tone="warning" title="Il modulo pubblico è disattivato">
          Chi apre il link vede il messaggio «modulo non disponibile». Riattivalo qui sotto quando vuoi ricevere richieste.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Link da condividere"
            description="Agenti e clienti richiedono i campioni da qui, senza login. Le richieste arrivano al back office come «Nuova richiesta»."
          />
          <CardBody className="space-y-3">
            <CopyField value={publicUrl} label="Indirizzo del modulo pubblico" />
            <Link
              href="/richiedi-campioni"
              target="_blank"
              className="inline-flex text-sm font-medium text-brand-700 hover:underline"
            >
              Apri il modulo in una nuova scheda ↗
            </Link>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Attività" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-4">
              <DetailItem label="Richieste dal modulo, ultimi 30 giorni">{String(received.n)}</DetailItem>
              <DetailItem label="In attesa del back office">{String(newRequests.n)}</DetailItem>
              <DetailItem label="Contatti nuovi da verificare">
                {toReview.n > 0 ? (
                  <Link href="/anagrafiche/contatti?verifica=1" className="font-medium text-brand-700 hover:underline">
                    {toReview.n} in anagrafica
                  </Link>
                ) : (
                  "0"
                )}
              </DetailItem>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Impostazioni del modulo"
          description="Protezioni attive: campo nascosto anti-spam e massimo 5 richieste all'ora per indirizzo IP (100 all'ora in totale)."
        />
        <CardBody>
          <PublicFormSettingsForm
            values={{ publicFormEnabled: settings.publicFormEnabled, publicFormIntro: settings.publicFormIntro }}
          />
        </CardBody>
      </Card>
    </>
  );
}
