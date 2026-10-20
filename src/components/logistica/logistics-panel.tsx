import type { ReactNode } from "react";
import { asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { carriers } from "@/db/schema";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import type { SessionUser } from "@/lib/auth/session";
import { confirmationRecipients, trackingUrl } from "@/lib/email/notifications";
import { formatDate, formatDateTime, formatEuro, LANGUAGE_LABELS } from "@/lib/format";
import type { RequestDetail } from "@/lib/requests/queries";
import {
  bollaSatisfied,
  EDITABLE_IN,
  shipmentConfirmationProblems,
  transitionProblems,
  type WorkflowSnapshot,
} from "@/lib/requests/workflow";
import { can } from "@/lib/roles";
import { ConfirmationActions } from "./confirmation-actions";
import { DdtSection, type DdtFileInfo } from "./ddt-section";
import { LogisticsForm, type CarrierOption } from "./logistics-form";
import { formatBytes } from "./utils";

const DESCRIPTIONS = {
  PRONTA_RITIRO: "Indica corriere e data di ritiro, prepara la bolla se richiesta, poi segna la richiesta come spedita.",
  SPEDITA: "Inserisci numero di tracking e data di spedizione: parte l'email di conferma al cliente e la richiesta si chiude.",
  COMPLETATA: "Spedizione conclusa. Restano modificabili numero DDT, costo e note.",
} as const;

const EMAIL_STATUS_LABELS = { INVIATA: "inviata", SIMULATA: "registrata in modalità prova", ERRORE: "non riuscita" } as const;

async function loadCarriers(currentId: number | null): Promise<CarrierOption[]> {
  return db
    .select({ id: carriers.id, name: carriers.name, active: carriers.active })
    .from(carriers)
    .where(currentId ? or(eq(carriers.active, true), eq(carriers.id, currentId)) : eq(carriers.active, true))
    .orderBy(asc(carriers.sortOrder), asc(carriers.name));
}

function ProblemList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {items.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{children}</h3>
      {aside}
    </div>
  );
}

/**
 * Pannello "Spedizione" della pagina di dettaglio /richieste/[id] (stati Pronta per il ritiro,
 * Spedita, Completata). Modificabile da chi ha logistics.work; per gli altri è in sola lettura.
 */
export async function LogisticsPanel({
  request,
  user,
  snapshot,
}: {
  request: RequestDetail;
  user: SessionUser;
  snapshot: WorkflowSnapshot;
}) {
  const status = request.status;
  if (status !== "PRONTA_RITIRO" && status !== "SPEDITA" && status !== "COMPLETATA") return null;

  const editable = can(user.role, "logistics.work") && EDITABLE_IN.logistics.includes(status);
  const canDownload =
    can(user.role, "logistics.work") || can(user.role, "requests.manage") || can(user.role, "management.view");
  const carrierOptions = editable ? await loadCarriers(request.carrierId) : [];

  const trackingHref = request.trackingNumber?.trim()
    ? trackingUrl(request.carrier?.trackingUrlTemplate, request.trackingNumber) || null
    : null;

  // Destinatari della conferma: stessa regola dell'invio (agente in copia solo per i clienti).
  const { to, cc } = confirmationRecipients(request.contact);
  const lastConfirmation = request.emails.find((e) => e.kind === "CONFERMA_SPEDIZIONE") ?? null;
  const confirmationProblems = shipmentConfirmationProblems(snapshot);
  const bollaOk = bollaSatisfied(snapshot);
  const bollaUrl = `/api/richieste/${request.id}/bolla`;

  const ddt: DdtFileInfo | null = request.ddtAttachment
    ? {
        id: request.ddtAttachment.id,
        fileName: request.ddtAttachment.fileName,
        sizeLabel: formatBytes(request.ddtAttachment.sizeBytes),
        uploadedAtLabel: formatDateTime(request.ddtAttachment.createdAt),
      }
    : null;

  const bollaBadge = request.deliveryFormRequired ? (
    bollaOk ? (
      <Badge tone="green">Bolla pronta</Badge>
    ) : (
      <Badge tone="amber">Bolla da preparare</Badge>
    )
  ) : (
    <Badge tone="slate">Bolla non richiesta</Badge>
  );

  /* --- Avvisi sullo stato --- */
  const notices: ReactNode[] = [];
  if (status === "PRONTA_RITIRO") {
    const problems = transitionProblems(snapshot, "SPEDITA");
    notices.push(
      problems.length ? (
        <Alert key="ship" tone="warning" title="Per segnarla come spedita manca:">
          <ProblemList items={problems} />
        </Alert>
      ) : (
        <Alert key="ship" tone="success">
          Tutto pronto: quando il corriere ritira il collo, segna la richiesta come spedita.
        </Alert>
      ),
    );
  } else if (status === "SPEDITA") {
    if (lastConfirmation?.status === "ERRORE") {
      notices.push(
        <Alert key="err" tone="error" title="Ultimo invio della conferma non riuscito">
          {formatDateTime(lastConfirmation.createdAt)} — {lastConfirmation.error || "errore sconosciuto"}
        </Alert>,
      );
    }
    notices.push(
      request.notificationSentAt ? (
        // Richiesta riportata a «Spedita» dopo la chiusura: l'invio automatico non riparte.
        <Alert key="conf" tone="info" title="Richiesta riaperta dopo l'invio della conferma">
          La conferma è già stata inviata il {formatDateTime(request.notificationSentAt)}: salvando i dati non ne parte
          un&apos;altra. Usa «Invia conferma al cliente» per reinviarla oppure «Completa senza email» per chiuderla.
        </Alert>
      ) : confirmationProblems.length ? (
        <Alert key="conf" tone="warning" title="Per inviare la conferma al cliente manca:">
          <ProblemList items={confirmationProblems} />
          {editable ? (
            <p className="mt-2">
              Appena salvi numero di tracking e data di spedizione parte l&apos;email di conferma e la richiesta viene
              completata.
            </p>
          ) : null}
        </Alert>
      ) : (
        <Alert key="conf" tone="info">
          Dati completi ma conferma non ancora inviata: usa «Invia conferma al cliente» oppure completa senza email.
        </Alert>
      ),
    );
  } else {
    // La chiusura automatica (conferma inviata) è registrata senza utente; «Completa senza email» con l'utente.
    const closing = [...request.events].reverse().find((e) => e.toStatus === "COMPLETATA");
    const closedManually = Boolean(closing && closing.userId !== null);
    notices.push(
      closedManually || !request.notificationSentAt ? (
        <Alert key="done" tone="info" title={`Completata il ${formatDateTime(request.completedAt)} senza conferma email`}>
          {closing?.note?.replace(/^Completata senza conferma email:\s*/, "Motivo: ") ?? null}
          {request.notificationSentAt ? (
            <p className="mt-1">Una conferma era già stata inviata il {formatDateTime(request.notificationSentAt)}.</p>
          ) : null}
        </Alert>
      ) : (
        <Alert key="done" tone="success">
          Completata il {formatDateTime(request.completedAt)}. Conferma di spedizione inviata il{" "}
          {formatDateTime(request.notificationSentAt)}.
        </Alert>
      ),
    );
  }

  /* --- Destinatari e ultimo invio della conferma --- */
  const attachmentLabel = request.ddtAttachment
    ? `DDT caricato (${request.ddtAttachment.fileName})`
    : request.deliveryFormRequired
      ? "bolla di consegna in PDF generata dal sistema"
      : null;
  const recipients = (
    <div className="space-y-1 text-sm text-slate-700">
      <p>
        <span className="text-slate-500">{status === "COMPLETATA" ? "Il reinvio andrà a:" : "La conferma andrà a:"}</span>{" "}
        {to.length ? (
          <span className="break-all">{to.join(", ")}</span>
        ) : (
          <span className="font-medium text-red-700">nessun indirizzo email valido</span>
        )}
        {cc.length ? (
          <>
            {" · "}
            <span className="text-slate-500">in copia:</span> <span className="break-all">{cc.join(", ")}</span>
          </>
        ) : null}
        {" · "}
        <span className="text-slate-500">lingua:</span> {LANGUAGE_LABELS[request.contact.language]}
      </p>
      {attachmentLabel ? <p className="text-xs text-slate-500">Allegato: {attachmentLabel}</p> : null}
      {lastConfirmation ? (
        <p className="text-xs text-slate-500">
          Ultimo invio: {formatDateTime(lastConfirmation.createdAt)} · {EMAIL_STATUS_LABELS[lastConfirmation.status]} · a{" "}
          {lastConfirmation.toAddresses}
          {lastConfirmation.ccAddresses ? ` (cc ${lastConfirmation.ccAddresses})` : ""}
        </p>
      ) : null}
    </div>
  );

  const header = (
    <CardHeader
      title="Spedizione"
      description={DESCRIPTIONS[status]}
      actions={
        canDownload ? (
          <a href={bollaUrl} target="_blank" rel="noopener" className={buttonClasses("secondary", "sm")}>
            Genera bolla PDF
          </a>
        ) : null
      }
    />
  );

  /* --- Sola lettura --- */
  if (!editable) {
    return (
      <Card>
        {header}
        <CardBody className="space-y-4">
          {notices}
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem label="Corriere">{request.carrier?.name}</DetailItem>
            <DetailItem label="Data di ritiro">{formatDate(request.pickupDate)}</DetailItem>
            <DetailItem label="Data di spedizione">{formatDate(request.shipmentDate)}</DetailItem>
            <DetailItem label="Numero di tracking">
              {request.trackingNumber ? (
                trackingHref ? (
                  <a href={trackingHref} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">
                    {request.trackingNumber} ↗
                  </a>
                ) : (
                  request.trackingNumber
                )
              ) : null}
            </DetailItem>
            <DetailItem label="Bolla di consegna">{bollaBadge}</DetailItem>
            <DetailItem label="Numero DDT">{request.ddtNumber}</DetailItem>
            <DetailItem label="DDT caricato">
              {ddt ? (
                canDownload ? (
                  <a href={`/api/richieste/${request.id}/ddt`} target="_blank" rel="noopener" className="font-medium break-all text-brand-700 hover:underline">
                    {ddt.fileName}
                  </a>
                ) : (
                  ddt.fileName
                )
              ) : null}
            </DetailItem>
            <DetailItem label="Costo spedizione">{formatEuro(request.shippingCost)}</DetailItem>
            <DetailItem label="Conferma inviata">{formatDateTime(request.notificationSentAt)}</DetailItem>
            <DetailItem label="Note logistica" className="sm:col-span-2 lg:col-span-3">
              {request.logisticsNotes ? <span className="whitespace-pre-line">{request.logisticsNotes}</span> : null}
            </DetailItem>
          </dl>
        </CardBody>
      </Card>
    );
  }

  /* --- Modificabile (logistica, back office, amministratore) --- */
  const completed = status === "COMPLETATA";
  return (
    <Card>
      {header}
      <CardBody className="space-y-3">{notices}</CardBody>

      {completed ? (
        <CardBody className="border-t border-slate-100">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem label="Corriere">{request.carrier?.name}</DetailItem>
            <DetailItem label="Data di ritiro">{formatDate(request.pickupDate)}</DetailItem>
            <DetailItem label="Numero di tracking">
              {request.trackingNumber ? (
                trackingHref ? (
                  <a href={trackingHref} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">
                    {request.trackingNumber} ↗
                  </a>
                ) : (
                  request.trackingNumber
                )
              ) : null}
            </DetailItem>
            <DetailItem label="Data di spedizione">{formatDate(request.shipmentDate)}</DetailItem>
          </dl>
        </CardBody>
      ) : null}

      <CardBody className="border-t border-slate-100">
        <LogisticsForm
          requestId={request.id}
          mode={completed ? "completed" : "full"}
          version={request.updatedAt.toISOString()}
          status={status}
          carriers={carrierOptions}
          values={{
            carrierId: request.carrierId,
            pickupDate: request.pickupDate,
            trackingNumber: request.trackingNumber,
            shipmentDate: request.shipmentDate,
            ddtNumber: request.ddtNumber,
            deliveryFormReady: request.deliveryFormReady,
            shippingCost: request.shippingCost,
            logisticsNotes: request.logisticsNotes,
          }}
          deliveryFormRequired={request.deliveryFormRequired}
          autoConfirmation={to.length > 0 && request.notificationSentAt === null}
          ddtUploaded={ddt !== null}
          trackingHref={trackingHref}
        />
      </CardBody>

      <CardBody className="border-t border-slate-100">
        <SectionTitle aside={bollaBadge}>Documento di trasporto (DDT)</SectionTitle>
        {request.deliveryFormRequired && !bollaOk ? (
          <p className="mb-3 text-sm text-slate-600">
            Il back office ha chiesto la bolla di consegna: scarica la bolla generata, oppure carica il DDT del gestionale,
            oppure spunta «Bolla pronta».
          </p>
        ) : null}
        <DdtSection
          requestId={request.id}
          ddt={ddt}
          editable
          confirmationSent={request.notificationSentAt !== null}
          completed={completed}
        />
      </CardBody>

      <CardBody className="border-t border-slate-100">
        <SectionTitle>Conferma di spedizione al cliente</SectionTitle>
        {recipients}
        {status === "SPEDITA" || status === "COMPLETATA" ? (
          <div className="mt-4">
            <ConfirmationActions
              requestId={request.id}
              status={status}
              canSend={confirmationProblems.length === 0}
              alreadySent={request.notificationSentAt !== null}
              recipients={[to.join(", "), cc.length ? `in copia ${cc.join(", ")}` : ""].filter(Boolean).join(" ")}
            />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
