"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/action-result";

export type FormActionState = ActionResult | null;
type ServerAction = (prev: FormActionState, formData: FormData) => Promise<ActionResult>;

/**
 * useActionState con invio da onSubmit invece che da <form action>.
 * Così React non azzera il form dopo l'azione: in caso di errore i valori digitati restano,
 * e dopo un salvataggio è il componente a decidere cosa svuotare (es. misure del pezzo).
 * `onResult` viene chiamata con l'esito, dentro la stessa transizione.
 */
export function useFormAction(action: ServerAction, onResult?: (result: ActionResult) => void) {
  // useActionState usa sempre l'ultima funzione passata, quindi onResult vede lo stato corrente.
  const [state, dispatch, pending] = useActionState<FormActionState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    onResult?.(result);
    return result;
  }, null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const formData = new FormData(e.currentTarget);
    // Pulsante che ha inviato il form (es. name="intent" value="ready"), come in un invio nativo.
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) formData.set(submitter.name, submitter.value);
    startTransition(() => dispatch(formData));
  }

  return { state, pending, onSubmit };
}

/** Errore di un campo restituito dall'azione (solo per l'ultimo esito negativo). */
export function fieldError(state: FormActionState, name: string): string | undefined {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}
