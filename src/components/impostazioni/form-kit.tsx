"use client";

import { startTransition, useActionState, useEffect, useRef, type ComponentProps, type FormEvent } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

export type FormActionState<T = undefined> = ActionResult<T> | null;
export type FormAction<T = undefined> = (prev: FormActionState<T>, formData: FormData) => Promise<ActionResult<T>>;

/**
 * useActionState con invio tramite onSubmit: a differenza di <form action>, React non svuota
 * i campi dopo l'invio, quindi in caso di errore l'utente non perde quello che ha scritto.
 * `resetOnSuccess` svuota il form dopo un esito positivo (form di creazione).
 */
export function useFormAction<T = undefined>(action: FormAction<T>, options: { resetOnSuccess?: boolean } = {}) {
  const [state, dispatch, pending] = useActionState<FormActionState<T>, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const resetOnSuccess = options.resetOnSuccess ?? false;

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }

  function fieldError(name: string): string | undefined {
    return state && !state.ok ? state.fieldErrors?.[name] : undefined;
  }

  return { state, pending, formRef, onSubmit, fieldError };
}

type PendingButtonProps = ComponentProps<"button"> & {
  pending: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingText?: string;
  /** Se impostato, chiede conferma prima di inviare. */
  confirmMessage?: string;
};

/** Pulsante di invio per i form gestiti con useFormAction (equivalente di SubmitButton). */
export function PendingButton({
  pending,
  variant = "primary",
  size = "md",
  pendingText,
  confirmMessage,
  className,
  children,
  disabled,
  onClick,
  type = "submit",
  ...props
}: PendingButtonProps) {
  return (
    <button
      type={type}
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClasses(variant, size, className)}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
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
