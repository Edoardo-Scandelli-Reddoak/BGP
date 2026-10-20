"use client";

import { useId } from "react";
import { completeWithoutConfirmation, sendShipmentConfirmation } from "@/app/(app)/logistica/actions";
import { ActionMessage } from "@/components/ui/alert";
import { Field, Textarea } from "@/components/ui/form";
import { ActionButton } from "./action-button";
import { useActionForm } from "./use-action-form";

/**
 * Azioni sulla conferma di spedizione:
 *  - Spedita: «Invia conferma al cliente» e «Completa senza email» (motivo obbligatorio);
 *  - Completata: «Reinvia conferma».
 */
export function ConfirmationActions({
  requestId,
  status,
  canSend,
  alreadySent,
  recipients,
}: {
  requestId: number;
  status: "SPEDITA" | "COMPLETATA";
  /** Tracking, data di spedizione ed email del contatto presenti. */
  canSend: boolean;
  /** Conferma già partita in passato: l'invio è un reinvio e non chiude la richiesta. */
  alreadySent: boolean;
  /** Destinatari per il messaggio di conferma, es. "info@cliente.it". */
  recipients: string;
}) {
  const uid = useId();
  const send = useActionForm(sendShipmentConfirmation.bind(null, requestId));
  const complete = useActionForm(completeWithoutConfirmation.bind(null, requestId));

  return (
    <div className="space-y-4">
      <form onSubmit={send.onSubmit} className="space-y-3">
        <ActionButton
          variant={status === "SPEDITA" ? "primary" : "secondary"}
          pending={send.pending}
          disabled={!canSend}
          pendingText="Invio in corso…"
          className="w-full sm:w-auto"
          data-confirm={
            status === "COMPLETATA" || alreadySent
              ? `Inviare di nuovo l'email di conferma a ${recipients}?`
              : `Inviare ora l'email di conferma a ${recipients}? La richiesta verrà completata.`
          }
        >
          {status === "SPEDITA" ? "Invia conferma al cliente" : "Reinvia conferma"}
        </ActionButton>
        <ActionMessage state={send.state} />
      </form>

      {status === "SPEDITA" ? (
        <details className="group rounded-lg ring-1 ring-slate-200 open:bg-slate-50">
          <summary className="cursor-pointer list-none rounded-lg px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
            Completa senza email
            <span className="block pl-3 text-xs font-normal text-slate-500">
              Per ritiri in sede, consegne a mano o contatti senza email.
            </span>
          </summary>
          <form onSubmit={complete.onSubmit} className="space-y-3 px-4 pb-4">
            <Field label="Motivo" htmlFor={`${uid}-note`} required error={complete.fieldErrors.note}>
              <Textarea
                id={`${uid}-note`}
                name="note"
                rows={2}
                maxLength={500}
                required
                placeholder="Es. ritirato in sede dal cliente il 20/10"
                aria-invalid={complete.fieldErrors.note ? true : undefined}
              />
            </Field>
            <ActionButton
              variant="danger"
              pending={complete.pending}
              pendingText="Chiusura…"
              className="w-full sm:w-auto"
              data-confirm="Completare la richiesta senza inviare la conferma al cliente?"
            >
              Completa senza email
            </ActionButton>
          </form>
        </details>
      ) : null}
      {/* Fuori dal riquadro: dopo la chiusura il riquadro sparisce ma l'esito resta visibile. */}
      <ActionMessage state={complete.state} />
    </div>
  );
}
