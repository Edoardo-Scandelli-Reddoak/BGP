import type { ReactNode } from "react";
import Link from "next/link";
import { asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { carriers } from "@/db/schema";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import type { SessionUser } from "@/lib/auth/session";
import { isAbroad, type BollaMode } from "@/lib/config/bolla";
import type { CostConfig, CostLine } from "@/lib/config/costs";
import { confirmationRecipients, trackingUrl } from "@/lib/email/notifications";
import { formatDate, formatDateTime, formatEuro, formatKg, formatM2, LANGUAGE_LABELS } from "@/lib/format";
import { requestCost } from "@/lib/requests/costs";
import type { RequestDetail } from "@/lib/requests/queries";
import {
  bollaSatisfied,
  EDITABLE_IN,
  shipmentConfirmationProblems,
  transitionProblems,
  type WorkflowSnapshot,
} from "@/lib/requests/workflow";
import { can } from "@/lib/roles";
import { peekNextBollaNumber } from "@/lib/requests/service";
import { getSetting } from "@/lib/settings";
import { BollaAutoReason, bollaInstructions, BollaStatusBadge } from "./bolla-info";
import { ConfirmationActions } from "./confirmation-actions";
import { DdtSection, type DdtFileInfo } from "./ddt-section";
import { attentionMissing, PhoneNoticeBadge, PhoneNoticeValue, recipientOf } from "./delivery-info";
import { GenerateBollaButton } from "./generate-bolla-button";
import { LogisticsForm, type CarrierOption } from "./logistics-form";
import { formatBytes } from "./utils";

const DESCRIPTIONS = {
  PRONTA_RITIRO: "Indica corriere e data di ritiro, prepara la bolla se richiesta, poi segna la richiesta come spedita.",
  SPEDITA: "Inserisci numero di tracking e data di spedizione: parte l'email di conferma al cliente e la richiesta si chiude.",
  COMPLETATA: "Spedizione conclusa. Restano modificabili data di spedizione, costi e note.",
} as const;

/** Pagina delle impostazioni dei costi (solo amministratori). */
const COST_SETTINGS_HREF = "/impostazioni/costi";

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

/** Dettaglio leggibile di una voce di costo (quantità × importo), in formato italiano. */
function costLineDetail(line: CostLine, request: RequestDetail, config: CostConfig): string | null {
  switch (line.key) {
    case "perPackage":
      return request.packagesCount ? `${request.packagesCount} × ${formatEuro(config.perPackage.amount)}` : null;
    case "perKg":
      return request.weightKg ? `${formatKg(request.weightKg)} × ${formatEuro(config.perKg.amount)}/kg` : null;
    case "perM2":
      return request.totalM2 > 0
        ? `${formatM2(request.totalM2)}${config.perM2.useProductPrice ? " · prezzo al m² del prodotto se indicato" : ` × ${formatEuro(config.perM2.amount)}/m²`}`
        : null;
    default:
      return null;
  }
}

/** Riepilogo «Costi della richiesta»: le voci attive in Impostazioni → Costi, con il totale. */
function CostSummary({ request, config, isAdmin }: { request: RequestDetail; config: CostConfig; isAdmin: boolean }) {
  const { total, lines } = requestCost(request, config);
  return (
    <div>
      {lines.length ? (
        <dl className="divide-y divide-slate-100 text-sm">
          {lines.map((line) => {
            const detail = costLineDetail(line, request, config);
            return (
              <div key={line.key} className="flex items-baseline justify-between gap-3 py-1.5">
                <dt className="min-w-0 text-slate-700">
                  {line.label}
                  {detail ? <span className="block text-xs text-slate-500">{detail}</span> : null}
                </dt>
                <dd className="whitespace-nowrap tabular-nums text-slate-900">{formatEuro(line.amount)}</dd>
              </div>
            );
          })}
          <div className="flex items-baseline justify-between gap-3 pt-2 pb-1 font-semibold text-slate-900">
            <dt>Totale</dt>
            <dd className="whitespace-nowrap tabular-nums">{formatEuro(total)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-slate-500">Nessun costo registrato per questa richiesta.</p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Voci configurate in{" "}
        {isAdmin ? (
          <Link href={COST_SETTINGS_HREF} className="font-medium text-brand-700 hover:underline">
            Impostazioni → Costi
          </Link>
        ) : (
          "Impostazioni → Costi"
        )}
        .
      </p>
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
  const [carrierOptions, bollaConfig, costConfig, nextBollaNumber] = await Promise.all([
    editable ? loadCarriers(request.carrierId) : Promise.resolve([]),
    getSetting("bollaConfig"),
    getSetting("costConfig"),
    peekNextBollaNumber(),
  ]);
  const mode: BollaMode = bollaConfig.mode;
  const bollaNumber = request.bollaNumber?.trim() || null;
  const autoReason = request.deliveryFormAutoReason?.trim() || null;
  // Il PDF non assegna numeri: con la sola bolla generata, prima della spedizione si scarica dopo
  // «Genera bolla»; le richieste già partite restano scaricabili.
  const pdfAvailable =
    canDownload && (mode === "ENTRAMBE" || (mode === "GENERATA" && (bollaNumber !== null || status !== "PRONTA_RITIRO")));

  const trackingHref = request.trackingNumber?.trim()
    ? trackingUrl(request.carrier?.trackingUrlTemplate, request.trackingNumber) || null
    : null;

  // Destinatari della conferma: stessa regola dell'invio (agente in copia solo per i clienti).
  const { to, cc } = confirmationRecipients(request.contact);
  const lastConfirmation = request.emails.find((e) => e.kind === "CONFERMA_SPEDIZIONE") ?? null;
  const confirmationProblems = shipmentConfirmationProblems(snapshot);
  const bollaOk = bollaSatisfied({ ...snapshot, bollaNumber, bollaMode: mode });
  const bollaUrl = `/api/richieste/${request.id}/bolla`;

  const ddt: DdtFileInfo | null = request.ddtAttachment
    ? {
        id: request.ddtAttachment.id,
        fileName: request.ddtAttachment.fileName,
        sizeLabel: formatBytes(request.ddtAttachment.sizeBytes),
        uploadedAtLabel: formatDateTime(request.ddtAttachment.createdAt),
      }
    : null;

  const bollaBadge = <BollaStatusBadge required={request.deliveryFormRequired} ready={bollaOk} showNotRequired />;

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

  /* --- Consegna: i dati che BGP chiede per ogni spedizione (Italia ed estero) --- */
  const delivery = (
    <CardBody className="border-t border-slate-100">
      <SectionTitle aside={<PhoneNoticeBadge phoneNotice={request.phoneNotice} number={request.phoneNoticeNumber} />}>
        Consegna
      </SectionTitle>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailItem label="Destinatario">
          <span className="font-medium">{recipientOf(request, request.contact.name)}</span>
        </DetailItem>
        <DetailItem label="Alla c.a.">
          {request.attentionOf?.trim() ||
            (attentionMissing(request) ? (
              <span className="text-amber-700">Non indicato (il destinatario sembra una ditta)</span>
            ) : null)}
        </DetailItem>
        <DetailItem label="Indirizzo di consegna">
          {request.destinationAddress.trim() ? (
            <span className="whitespace-pre-line">{request.destinationAddress.trim()}</span>
          ) : null}
          {isAbroad(request.destinationCountry) ? (
            <span className="block font-medium text-slate-700">Estero: {request.destinationCountry?.trim()}</span>
          ) : null}
        </DetailItem>
        <DetailItem label="Preavviso telefonico">
          <PhoneNoticeValue phoneNotice={request.phoneNotice} number={request.phoneNoticeNumber} />
        </DetailItem>
      </dl>
    </CardBody>
  );

  /* --- Destinatari e ultimo invio della conferma --- */
  // Stessa regola dell'invio: DDT caricato, altrimenti (se richiesta) la bolla in PDF del sistema.
  const pdfNumber = bollaNumber || request.ddtNumber?.trim();
  const attachmentLabel = request.ddtAttachment
    ? `DDT caricato (${request.ddtAttachment.fileName})`
    : request.deliveryFormRequired
      ? `bolla di consegna in PDF generata dal sistema${pdfNumber ? ` (N° ${pdfNumber})` : ""}`
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
        pdfAvailable ? (
          <a href={bollaUrl} target="_blank" rel="noopener" className={buttonClasses("secondary", "sm")}>
            Scarica bolla PDF
          </a>
        ) : null
      }
    />
  );

  /* --- Costi della richiesta (voci di Impostazioni → Costi) --- */
  const isAdmin = can(user.role, "settings.manage");
  const costs = (
    <CardBody className="border-t border-slate-100">
      <SectionTitle>Costi della richiesta</SectionTitle>
      <CostSummary request={request} config={costConfig} isAdmin={isAdmin} />
    </CardBody>
  );

  /* --- Sola lettura --- */
  if (!editable) {
    return (
      <Card>
        {header}
        <CardBody className="space-y-4">{notices}</CardBody>
        {delivery}
        <CardBody className="border-t border-slate-100">
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
            <DetailItem label="Bolla di consegna">
              {bollaBadge}
              <BollaAutoReason reason={autoReason} className="mt-1" />
            </DetailItem>
            {mode !== "GESTIONALE" || bollaNumber ? (
              <DetailItem label="Bolla generata">
                {bollaNumber ? (
                  <>
                    N° {bollaNumber}
                    {request.bollaGeneratedAt ? (
                      <span className="block text-xs text-slate-500">il {formatDateTime(request.bollaGeneratedAt)}</span>
                    ) : null}
                  </>
                ) : null}
              </DetailItem>
            ) : null}
            {mode !== "GENERATA" || request.ddtNumber ? <DetailItem label="Numero DDT">{request.ddtNumber}</DetailItem> : null}
            {mode !== "GENERATA" || ddt ? (
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
            ) : null}
            <DetailItem label="Costo spedizione">{formatEuro(request.shippingCost)}</DetailItem>
            <DetailItem label="Conferma inviata">{formatDateTime(request.notificationSentAt)}</DetailItem>
            <DetailItem label="Note logistica" className="sm:col-span-2 lg:col-span-3">
              {request.logisticsNotes ? <span className="whitespace-pre-line">{request.logisticsNotes}</span> : null}
            </DetailItem>
          </dl>
        </CardBody>
        {costs}
      </Card>
    );
  }

  /* --- Modificabile (logistica, back office, amministratore) --- */
  const completed = status === "COMPLETATA";
  return (
    <Card>
      {header}
      <CardBody className="space-y-3">{notices}</CardBody>
      {delivery}

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
          bollaMode={mode}
          courierCost={costConfig.courier}
          manualCosts={costConfig.manual
            .filter((m) => m.enabled)
            .map((m) => ({ key: m.key, label: m.label, amount: request.extraCosts?.[m.key] ?? null }))}
          autoConfirmation={to.length > 0 && request.notificationSentAt === null}
          ddtUploaded={ddt !== null}
          trackingHref={trackingHref}
        />
      </CardBody>

      <CardBody className="border-t border-slate-100">
        <SectionTitle aside={bollaBadge}>{mode === "GESTIONALE" ? "Bolla di consegna (DDT del gestionale)" : "Bolla di consegna"}</SectionTitle>
        <div className="space-y-4">
          {autoReason || (request.deliveryFormRequired && !bollaOk) ? (
            <div className="space-y-1">
              <BollaAutoReason reason={autoReason} />
              {request.deliveryFormRequired && !bollaOk ? (
                <p className="text-sm text-slate-600">{bollaInstructions(mode, autoReason !== null)}</p>
              ) : null}
            </div>
          ) : null}

          {/* La bolla si genera solo prima della spedizione (dopo consumerebbe un numero per merce già partita). */}
          {mode !== "GESTIONALE" && (bollaNumber || (status === "PRONTA_RITIRO" && request.deliveryFormRequired)) ? (
            <div className="flex flex-col gap-3 rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
              {bollaNumber ? (
                <>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold break-all text-slate-900">Bolla N° {bollaNumber}</p>
                    <p className="text-xs text-slate-500">
                      Generata dal sistema{request.bollaGeneratedAt ? ` il ${formatDateTime(request.bollaGeneratedAt)}` : ""}
                    </p>
                  </div>
                  <a href={bollaUrl} target="_blank" rel="noopener" className={buttonClasses("secondary", "sm", "w-full sm:w-auto")}>
                    Scarica bolla PDF
                  </a>
                </>
              ) : (
                <>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-slate-900">Bolla generata dal sistema</p>
                    <p className="text-xs text-slate-500">
                      Assegna il numero progressivo {nextBollaNumber} e la segna come pronta.
                      {mode === "ENTRAMBE" ? " Senza generarla, il PDF riporta il numero DDT o il codice della richiesta." : ""}
                    </p>
                  </div>
                  <GenerateBollaButton
                    requestId={request.id}
                    variant={request.deliveryFormRequired && !bollaOk ? "primary" : "secondary"}
                    size="sm"
                    className="w-full sm:w-auto"
                  />
                </>
              )}
            </div>
          ) : null}

          {mode === "GENERATA" && request.ddtNumber?.trim() ? (
            <p className="text-xs text-slate-500">
              Numero DDT del gestionale registrato in precedenza: <span className="break-all">{request.ddtNumber.trim()}</span>
            </p>
          ) : null}

          {mode !== "GENERATA" || ddt ? (
            <div>
              {mode === "ENTRAMBE" ? <h4 className="mb-2 text-sm font-medium text-slate-700">DDT del gestionale</h4> : null}
              {mode === "GENERATA" ? (
                <p className="mb-2 text-xs text-slate-500">
                  DDT caricato prima del passaggio alla bolla generata dal sistema: se resta, viene allegato alla conferma al
                  posto della bolla.
                </p>
              ) : null}
              <DdtSection
                requestId={request.id}
                ddt={ddt}
                editable
                canUpload={mode !== "GENERATA"}
                confirmationSent={request.notificationSentAt !== null}
                completed={completed}
              />
            </div>
          ) : null}
        </div>
      </CardBody>

      {costs}

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
