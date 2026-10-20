"use client";

import { generateDeliveryForm } from "@/app/(app)/logistica/actions";
import { ActionMessage } from "@/components/ui/alert";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ActionButton } from "./action-button";
import { useActionForm } from "./use-action-form";

/**
 * «Genera bolla»: assegna il prossimo numero progressivo della serie annuale e segna la bolla pronta.
 * Il numero non si può riusare, quindi si chiede conferma. Dopo la generazione la pagina si aggiorna
 * e al posto del pulsante compaiono numero e «Scarica bolla PDF».
 */
export function GenerateBollaButton({
  requestId,
  variant = "primary",
  size = "md",
  className,
}: {
  requestId: number;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { state, pending, onSubmit } = useActionForm(generateDeliveryForm.bind(null, requestId));
  return (
    <form onSubmit={onSubmit} className={cn("min-w-0", className)}>
      <ActionButton
        variant={variant}
        size={size}
        pending={pending}
        pendingText="Generazione…"
        className="w-full sm:w-auto"
        data-confirm="Generare la bolla di consegna? Riceve il prossimo numero progressivo, che non si può annullare né riusare."
      >
        Genera bolla
      </ActionButton>
      {/* Il successo si vede dal numero che compare; qui solo l'eventuale errore. */}
      {state && !state.ok ? <ActionMessage state={state} className="mt-2" /> : null}
    </form>
  );
}
