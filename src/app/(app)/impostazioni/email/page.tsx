import type { Metadata } from "next";
import Link from "next/link";
import { EmailSettingsForm, TestEmailForm } from "@/components/impostazioni/email-settings-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { isDryRun } from "@/lib/email/mailer";
import { appUrl } from "@/lib/email/notifications";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Email e notifiche — Impostazioni" };

export default async function EmailSettingsPage() {
  const user = await requireUser("settings.manage");
  const settings = await getSettings();

  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = process.env.SMTP_PORT?.trim() || "587";
  const smtpSecure = process.env.SMTP_SECURE === "true";
  const smtpAuth = Boolean(process.env.SMTP_USER?.trim());
  const dryRun = isDryRun();

  const missing: string[] = [];
  if (settings.warehouseEmails.length === 0) {
    missing.push(
      "Magazzino: l'avviso «nuovo campionario da preparare» (automazione 1) non ha destinatari e verrà registrato come errore.",
    );
  }
  if (settings.logisticsEmails.length === 0) {
    missing.push(
      "Logistica: l'avviso «bolla di consegna richiesta» (automazione 3) non ha destinatari e verrà registrato come errore.",
    );
  }

  return (
    <>
      {missing.length ? (
        <Alert tone="warning" title="Destinatari interni mancanti">
          <ul className="list-disc space-y-1 pl-5">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {dryRun ? (
        <Alert tone="warning" title="Modalità prova attiva (EMAIL_DRY_RUN)">
          Le email non vengono inviate: sono solo registrate nel{" "}
          <Link href="/impostazioni/registro-email" className="font-medium underline">
            registro email
          </Link>{" "}
          con esito «Simulata».
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Email automatiche"
          description="Destinatari interni, mittente e firma usati dalle tre email automatiche del flusso."
        />
        <CardBody>
          <EmailSettingsForm
            values={{
              mailFrom: settings.mailFrom,
              mailReplyTo: settings.mailReplyTo,
              mailSignature: settings.mailSignature,
              mailSignatureImage: settings.mailSignatureImage,
              warehouseEmails: settings.warehouseEmails,
              logisticsEmails: settings.logisticsEmails,
              shipmentBcc: settings.shipmentBcc,
            }}
          />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Server di posta (SMTP)"
            description="Configurato nelle variabili d'ambiente del server: per modificarlo serve l'intervento tecnico."
          />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4">
              <DetailItem label="Server">
                {smtpHost ? <span className="font-mono text-xs">{smtpHost}</span> : <Badge tone="red">Non configurato</Badge>}
              </DetailItem>
              <DetailItem label="Porta">
                <span className="font-mono text-xs">
                  {smtpPort}
                  {smtpSecure ? " (TLS)" : ""}
                </span>
              </DetailItem>
              <DetailItem label="Autenticazione">
                {smtpAuth ? <Badge tone="green">Utente impostato</Badge> : <Badge tone="slate">Nessuna</Badge>}
              </DetailItem>
              <DetailItem label="Modalità">
                {dryRun ? <Badge tone="amber">Prova: non invia</Badge> : <Badge tone="green">Invio reale</Badge>}
              </DetailItem>
              <DetailItem label="Indirizzo dell'app nei link" className="col-span-2">
                <span className="font-mono text-xs">{appUrl()}</span>
              </DetailItem>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Invia email di prova"
            description="Verifica che il server di posta funzioni e come appare la firma. L'invio viene registrato nel registro email."
          />
          <CardBody>
            <TestEmailForm defaultTo={user.email} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
