import type { RequestStatus } from "@/db/schema";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { SessionUser } from "@/lib/auth/session";
import { requestCode } from "@/lib/format";
import { can } from "@/lib/roles";
import { previousStatus, STATUS_LABELS } from "@/lib/status";
import { DeleteRequestForm, RevertRequestForm } from "./request-actions";

const REVERT_WARNINGS: Partial<Record<RequestStatus, string>> = {
  COMPLETATA: "La richiesta verrà riaperta come «Spedita»: la conferma al cliente non verrà inviata di nuovo in automatico.",
  IN_PREPARAZIONE: "Il magazzino non riceve avvisi della correzione: se ha già iniziato, avvisalo tu.",
};

/** Correzioni del back office: riportare allo stato precedente, eliminare una richiesta ancora nuova. */
export function BackofficeActionsCard({
  requestId,
  status,
  user,
}: {
  requestId: number;
  status: RequestStatus;
  user: SessionUser;
}) {
  const canDelete = status === "NUOVA" && can(user.role, "requests.manage");
  const previous = previousStatus(status);
  const canRevert =
    Boolean(previous) &&
    can(user.role, "requests.revert") &&
    (status !== "COMPLETATA" || user.role === "ADMIN");
  if (!canDelete && !canRevert) return null;

  return (
    <Card>
      <CardHeader title="Correzioni" description="Azioni riservate al back office." />
      <CardBody className="space-y-4">
        {canRevert && previous ? (
          <RevertRequestForm
            requestId={requestId}
            previousLabel={STATUS_LABELS[previous]}
            warning={REVERT_WARNINGS[status]}
          />
        ) : null}
        {canDelete ? <DeleteRequestForm requestId={requestId} code={requestCode(requestId)} /> : null}
      </CardBody>
    </Card>
  );
}
