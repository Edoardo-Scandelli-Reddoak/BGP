"use client";

import { startTransition, useActionState, type ComponentProps, type FormEvent } from "react";
import type { ActionResult } from "@/lib/action-result";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { ActionMessage } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { Select } from "@/components/ui/form";

export type FormAction<T = undefined> = (prev: ActionResult<T> | null, fd: FormData) => Promise<ActionResult<T>>;

/**
 * Esegue la server action senza il reset automatico del form di React 19:
 * se la validazione fallisce, quanto scritto dall'utente resta nei campi.
 */
export function useKeepValuesAction<T = undefined>(action: FormAction<T>) {
  const [state, dispatch, pending] = useActionState(action, null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return { state, onSubmit, pending, fieldErrors };
}

/** Pulsante di invio per i form gestiti con useKeepValuesAction (stato "in corso" esplicito). */
export function PendingButton({
  pending,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ComponentProps<"button"> & { pending: boolean; pendingText?: string; variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Form con un solo pulsante (elimina, segna come verificato…) che invia l'id del record. */
export function RecordActionForm({
  action,
  id,
  label,
  pendingText,
  confirmMessage,
  variant = "secondary",
  size = "md",
  className,
}: {
  action: FormAction;
  id: number;
  label: string;
  pendingText?: string;
  confirmMessage?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant={variant} size={size} pendingText={pendingText} confirmMessage={confirmMessage}>
        {label}
      </SubmitButton>
      <ActionMessage state={state} className="mt-3" />
    </form>
  );
}

/** Select dei filtri che invia subito il form di ricerca (GET) quando cambia. */
export function FilterSelect(props: ComponentProps<"select">) {
  return (
    <Select
      {...props}
      onChange={(e) => {
        props.onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
    />
  );
}
