import Link from "next/link";
import type { RequestStatus } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import type { SessionUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import {
  ADVANCE_LABELS,
  shipmentConfirmationProblems,
  transitionPermission,
  transitionProblems,
  type WorkflowSnapshot,
} from "@/lib/requests/workflow";
import { can } from "@/lib/roles";
import { nextStatus, STATUS_OWNER, STATUS_TODO } from "@/lib/status";
import { SendToWarehouseForm } from "./request-actions";
import { ownerLabel } from "./status-stepper";
import { CONTACT_REVIEW_CONFIRM } from "./utils";

const PANEL_HINT: Partial<Record<RequestStatus, string>> = {
  IN_PREPARAZIONE: "Il pulsante si trova nel pannello del magazzino.",
  PRONTA_RITIRO: "Il pulsante si trova nel pannello della spedizione.",
};

/** Contatto creato dal modulo pubblico e non ancora verificato: avviso (non blocca l'invio). */
function ContactReviewNote({ href, children }: { href: string | null; children: string }) {
  return (
    <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
      <p className="font-medium">Contatto da verificare</p>
      <p className="mt-0.5">
        {children}
        {href ? (
          <>
            {" "}
            <Link href={href} className="font-semibold underline underline-offset-2">
              Apri la scheda del contatto
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

function ProblemList({ title, problems }: { title: string; problems: string[] }) {
  return (
    <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

/** Box «Prossimo passo»: chi deve agire, cosa deve fare e, se tocca all'utente, cosa manca. */
export function NextStepCard({
  requestId,
  status,
  completedAt,
  snapshot,
  user,
  contactNeedsReview = false,
  contactHref = null,
  attentionMissing = false,
}: {
  requestId: number;
  status: RequestStatus;
  completedAt: Date | null;
  snapshot: WorkflowSnapshot;
  user: SessionUser;
  /** Contatto creato dal modulo pubblico e non ancora verificato in anagrafica. */
  contactNeedsReview?: boolean;
  /** Scheda anagrafica del contatto, se l'utente può aprirla. */
  contactHref?: string | null;
  /** Il destinatario sembra una ditta ma manca «alla c.a. di»: suggerimento, non blocca l'invio. */
  attentionMissing?: boolean;
}) {
  const next = nextStatus(status);
  const permission = transitionPermission(status);
  const canAdvance = Boolean(next && permission && can(user.role, permission));
  const problems = canAdvance && next ? transitionProblems(snapshot, next) : [];
  const followsShipment = status === "SPEDITA" && can(user.role, "logistics.work");
  const shipmentProblems = followsShipment ? shipmentConfirmationProblems(snapshot) : [];
  const canAct = canAdvance || followsShipment;
  // «Tocca a te» solo per il ruolo responsabile del passo (il back office può comunque sostituirsi).
  const yourTurn = STATUS_OWNER[status] === user.role || (status === "NUOVA" && can(user.role, "requests.manage"));
  const label = ADVANCE_LABELS[status];
  const reviewBeforeSend = status === "NUOVA" && contactNeedsReview;

  if (status === "COMPLETATA") {
    return (
      <Card className="bg-emerald-50/40">
        <CardBody className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Richiesta completata</h2>
            <p className="text-sm text-slate-600">
              {STATUS_TODO.COMPLETATA}
              {completedAt ? ` Chiusa il ${formatDateTime(completedAt)}.` : ""}
            </p>
          </div>
          <Badge tone="green">Chiusa</Badge>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className={cn(yourTurn && "outline-2 outline-brand-300")}>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Prossimo passo</h2>
          <Badge tone={yourTurn ? "blue" : "slate"}>
            {yourTurn ? "Tocca a te" : `In carico a: ${ownerLabel(status)}`}
          </Badge>
        </div>
        <p className="text-sm text-slate-700">{STATUS_TODO[status]}</p>

        {canAdvance && label ? (
          problems.length > 0 ? (
            <ProblemList title={`Per «${label}» manca ancora:`} problems={problems} />
          ) : reviewBeforeSend ? null : (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 ring-1 ring-inset ring-emerald-200">
              Tutto pronto per «{label}».
            </p>
          )
        ) : null}
        {canAdvance && reviewBeforeSend ? (
          <ContactReviewNote href={contactHref}>
            Contatto da verificare: controllalo in anagrafica (lingua, email, agente) prima di inviare.
          </ContactReviewNote>
        ) : null}
        {canAdvance && status === "NUOVA" && attentionMissing ? (
          <p className="rounded-lg bg-amber-50/60 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <span className="font-medium">Suggerimento:</span> il destinatario sembra una ditta. Se possibile indica
            «alla c.a. di» (la persona a cui sono destinati i campioni) con «Modifica»; non blocca l&apos;invio.
          </p>
        ) : null}
        {canAdvance && PANEL_HINT[status] ? <p className="text-xs text-slate-500">{PANEL_HINT[status]}</p> : null}

        {followsShipment && contactNeedsReview ? (
          <ContactReviewNote href={contactHref}>
            Il contatto non è ancora stato verificato: controlla lingua, email e agente prima della conferma al cliente.
          </ContactReviewNote>
        ) : null}
        {followsShipment ? (
          <p className="text-xs text-slate-500">
            {shipmentProblems.length > 0
              ? "Tracking e data di spedizione si inseriscono nel pannello della spedizione."
              : "Dati di spedizione completi: la conferma al cliente può partire dal pannello della spedizione."}
          </p>
        ) : null}

        {status === "NUOVA" && can(user.role, "requests.manage") ? (
          <SendToWarehouseForm
            requestId={requestId}
            blocked={problems.length > 0}
            confirmMessage={reviewBeforeSend ? CONTACT_REVIEW_CONFIRM : undefined}
          />
        ) : null}

        {!canAct ? (
          <p className="text-xs text-slate-500">Questo passo non è a tuo carico: da qui puoi seguirne l&apos;avanzamento.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
