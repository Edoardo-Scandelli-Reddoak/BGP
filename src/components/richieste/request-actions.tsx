"use client";

import { useActionState, useId } from "react";
import {
  deleteRequestAction,
  revertRequestAction,
  sendToWarehouseAction,
} from "@/app/(app)/richieste/actions";
import { ActionMessage } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";

type State = ActionResult | null;

/** «Invia al magazzino»: disabilitato finché mancano dati (i motivi sono elencati sopra il pulsante). */
export function SendToWarehouseForm({ requestId, blocked }: { requestId: number; blocked: boolean }) {
  const [state, action] = useActionState<State, FormData>(sendToWarehouseAction.bind(null, requestId), null);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton size="lg" className="w-full sm:w-auto" disabled={blocked} pendingText="Invio in corso…">
        Invia al magazzino
      </SubmitButton>
      <p className="text-xs text-slate-500">
        {blocked
          ? "Completa prima i dati indicati sopra."
          : "La richiesta passa a «In preparazione» e parte l'email di avviso al magazzino."}
      </p>
      <ActionMessage state={state} />
    </form>
  );
}

export function DeleteRequestForm({ requestId, code }: { requestId: number; code: string }) {
  const [state, action] = useActionState<State, FormData>(deleteRequestAction.bind(null, requestId), null);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton
        variant="danger"
        className="w-full sm:w-auto"
        pendingText="Eliminazione…"
        confirmMessage={`Eliminare definitivamente la richiesta ${code}? L'operazione non si può annullare.`}
      >
        Elimina richiesta
      </SubmitButton>
      <p className="text-xs text-slate-500">Solo per richieste ancora nuove (doppioni, richieste non valide dal modulo).</p>
      <ActionMessage state={state} />
    </form>
  );
}

export function RevertRequestForm({
  requestId,
  previousLabel,
  warning,
}: {
  requestId: number;
  previousLabel: string;
  warning?: string;
}) {
  const uid = useId();
  const [state, action] = useActionState<State, FormData>(revertRequestAction.bind(null, requestId), null);
  const noteError = state && !state.ok ? state.fieldErrors?.note : undefined;
  return (
    <details className="group rounded-lg ring-1 ring-slate-200 open:bg-slate-50/60" open={Boolean(state && !state.ok)}>
      <summary
        className={cn(
          buttonClasses("secondary", "md", "w-full cursor-pointer list-none sm:w-auto"),
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        Riporta allo stato precedente
      </summary>
      <form action={action} className="space-y-3 p-4">
        <p className="text-sm text-slate-700">
          La richiesta tornerà a <strong>«{previousLabel}»</strong>. Le email già inviate non vengono ripetute.
        </p>
        {warning ? <p className="text-sm font-medium text-amber-800">{warning}</p> : null}
        <Field label="Motivo della correzione" htmlFor={`${uid}-note`} required error={noteError}>
          <Textarea
            id={`${uid}-note`}
            name="note"
            rows={2}
            required
            maxLength={1000}
            placeholder="Es. misure da rifare, corriere sbagliato…"
            aria-invalid={noteError ? true : undefined}
          />
        </Field>
        <SubmitButton
          variant="secondary"
          className="w-full sm:w-auto"
          pendingText="Correzione in corso…"
          confirmMessage={`Riportare la richiesta a «${previousLabel}»?`}
        >
          Riporta a «{previousLabel}»
        </SubmitButton>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}
