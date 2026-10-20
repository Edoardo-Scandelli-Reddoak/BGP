import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { NAV } from "@/components/layout/nav-config";
import { LogisticsPanel } from "@/components/logistica/logistics-panel";
import { WarehousePanel } from "@/components/magazzino/warehouse-panel";
import { BackofficeActionsCard } from "@/components/richieste/backoffice-actions-card";
import { EmailsPanel } from "@/components/richieste/emails-panel";
import { HistoryPanel } from "@/components/richieste/history-panel";
import { NextStepCard } from "@/components/richieste/next-step-card";
import { RequestInfoCard, type RequestEditConfig } from "@/components/richieste/request-info-card";
import { RequestInfoView } from "@/components/richieste/request-info-view";
import { StatusStepper } from "@/components/richieste/status-stepper";
import { romeIsoDate } from "@/components/richieste/utils";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import type { SessionUser } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime, parseRequestCode, requestCode, todayIso } from "@/lib/format";
import { getRequestDetail, type RequestDetail } from "@/lib/requests/queries";
import { getWorkflowSnapshot } from "@/lib/requests/service";
import { EDITABLE_IN } from "@/lib/requests/workflow";
import { can, canViewRequestInStatus, ROLE_HOME } from "@/lib/roles";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/status";

type Flash = { tone: "success" | "warning"; text: string };

function parseId(raw: string): number | null {
  try {
    return parseRequestCode(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps<"/richieste/[id]">): Promise<Metadata> {
  const id = parseId((await params).id);
  return { title: id ? requestCode(id) : "Richiesta" };
}

/** Messaggi dopo un'azione con redirect (?ok=...): codici fissi, il testo non arriva dall'URL. */
function flashFor(code: string | undefined, request: RequestDetail): Flash | null {
  switch (code) {
    case "creata":
      return { tone: "success", text: "Richiesta creata. Quando i dati sono completi, inviala al magazzino." };
    case "inviata": {
      if (request.status === "NUOVA") return null;
      const mail = request.emails.find((e) => e.kind === "AVVISO_MAGAZZINO");
      if (!mail) return { tone: "success", text: "Richiesta inviata al magazzino." };
      if (mail.status === "ERRORE") {
        return {
          tone: "warning",
          text: `Richiesta inviata al magazzino, ma l'avviso email non è partito (${mail.error ?? "errore di invio"}). Avvisa il magazzino a voce e controlla le impostazioni email.`,
        };
      }
      if (mail.status === "SIMULATA") {
        return {
          tone: "success",
          text: "Richiesta inviata al magazzino. Modalità prova: l'avviso email è stato registrato ma non inviato.",
        };
      }
      return { tone: "success", text: `Richiesta inviata al magazzino. Avviso email inviato a ${mail.toAddresses}.` };
    }
    case "non-inviata":
      if (request.status !== "NUOVA") return null;
      return {
        tone: "warning",
        text: "Richiesta salvata, ma non inviata al magazzino: completa i dati indicati in «Prossimo passo» e poi usa «Invia al magazzino».",
      };
    case "riportata":
      return { tone: "success", text: `Richiesta riportata a «${STATUS_LABELS[request.status]}».` };
    default:
      return null;
  }
}

function backLink(user: SessionUser) {
  const href = ROLE_HOME[user.role];
  const item = NAV.flatMap((s) => s.items).find((i) => i.href === href);
  return { href, label: item?.label ?? "Torna all'elenco" };
}

function editConfig(request: RequestDetail, user: SessionUser): RequestEditConfig | null {
  if (!can(user.role, "requests.manage") || !EDITABLE_IN.info.includes(request.status)) return null;
  const c = request.contact;
  const itemsEditable = EDITABLE_IN.items.includes(request.status);
  return {
    requestId: request.id,
    today: todayIso(),
    itemsEditable,
    itemsLockedReason: itemsEditable
      ? undefined
      : `Nello stato «${STATUS_LABELS[request.status]}» i prodotti non sono più modificabili: per cambiarli riporta prima la richiesta a «In preparazione».`,
    initial: {
      contact: {
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
      },
      destinationAddress: request.destinationAddress,
      notes: request.notes ?? "",
      deliveryFormRequired: request.deliveryFormRequired,
      receivedDate: romeIsoDate(request.receivedAt),
      items: request.items.map((i) => ({
        productId: i.productId,
        code: i.product.code,
        description: i.product.description,
        active: i.product.active,
        quantity: String(i.quantity),
        notes: i.notes ?? "",
      })),
    },
  };
}

export default async function RichiestaDettaglioPage({ params, searchParams }: PageProps<"/richieste/[id]">) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (!id) notFound();

  const [request, snapshot] = await Promise.all([getRequestDetail(id), getWorkflowSnapshot(id)]);
  if (!request || !snapshot) notFound();
  if (!canViewRequestInStatus(user.role, request.status)) redirect(ROLE_HOME[user.role]);

  const { ok } = await searchParams;
  const flash = flashFor(typeof ok === "string" ? ok : undefined, request);
  const back = backLink(user);
  const step = STATUS_ORDER.indexOf(request.status);
  const code = requestCode(request.id);

  const infoPanel = (
    <RequestInfoCard
      edit={editConfig(request, user)}
      description={`${request.items.length} prodott${request.items.length === 1 ? "o" : "i"} · destinazione e contatto`}
    >
      <RequestInfoView request={request} canViewRegistry={can(user.role, "registry.view")} />
    </RequestInfoCard>
  );
  const warehousePanel = step >= 1 ? <WarehousePanel request={request} user={user} snapshot={snapshot} /> : null;
  const logisticsPanel = step >= 2 ? <LogisticsPanel request={request} user={user} snapshot={snapshot} /> : null;

  // Ogni ruolo vede per primo il pannello su cui lavora.
  const panels: [string, ReactNode][] =
    user.role === "MAGAZZINO"
      ? [["magazzino", warehousePanel], ["richiesta", infoPanel], ["spedizione", logisticsPanel]]
      : user.role === "LOGISTICA"
        ? [["spedizione", logisticsPanel], ["richiesta", infoPanel], ["magazzino", warehousePanel]]
        : [["richiesta", infoPanel], ["magazzino", warehousePanel], ["spedizione", logisticsPanel]];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={back.href} className="hover:underline">
            ← {back.label}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{code}</span>
            <StatusBadge status={request.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Ricevuta il {formatDateTime(request.receivedAt)}
              {request.createdBy ? ` · inserita da ${request.createdBy.name}` : ""}
            </span>
            {request.source === "MODULO_PUBBLICO" ? <Badge tone="violet">Modulo pubblico</Badge> : <Badge>Interna</Badge>}
            {request.deliveryFormRequired ? <Badge tone="amber">Bolla richiesta</Badge> : null}
          </span>
        }
      />

      {flash ? (
        <Alert tone={flash.tone} className="mb-6">
          {flash.text}
        </Alert>
      ) : null}

      <StatusStepper status={request.status} receivedAt={request.receivedAt} events={request.events} />

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <NextStepCard
            requestId={request.id}
            status={request.status}
            completedAt={request.completedAt}
            snapshot={snapshot}
            user={user}
          />
          {panels.map(([key, node]) => (node ? <Fragment key={key}>{node}</Fragment> : null))}
        </div>
        <div className="min-w-0 space-y-6">
          <BackofficeActionsCard requestId={request.id} status={request.status} user={user} />
          <HistoryPanel request={request} />
          <EmailsPanel emails={request.emails} />
        </div>
      </div>
    </>
  );
}
