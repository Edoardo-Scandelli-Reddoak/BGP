"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/action-result";

type FormAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

type Options = {
  /** Messaggio di conferma calcolato al momento dell'invio (null = nessuna conferma). */
  confirm?: (formData: FormData) => string | null;
};

/**
 * useActionState con invio da onSubmit: a differenza di <form action>, React non svuota i campi
 * dopo l'invio, così se il server rifiuta i dati l'utente li ritrova per correggerli.
 * Il pulsante premuto viaggia nel FormData (name/value) e può chiedere conferma con data-confirm.
 */
export function useActionForm(action: FormAction, options: Options = {}) {
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const [intent, setIntent] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    const message = submitter?.dataset.confirm || options.confirm?.(formData);
    if (message && !window.confirm(message)) return;
    setIntent(submitter?.getAttribute("value") ?? null);
    startTransition(() => dispatch(formData));
  }

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return { state, pending, intent, onSubmit, fieldErrors };
}
