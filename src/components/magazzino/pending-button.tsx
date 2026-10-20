"use client";

import type { ComponentProps } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "@/components/ui/button";

type Props = ComponentProps<"button"> & {
  pending: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingText?: string;
  /** Se impostato, chiede conferma prima dell'invio. */
  confirmMessage?: string;
};

/**
 * Pulsante di invio per i form gestiti con useFormAction (lo stato "in corso" arriva da useActionState,
 * non da useFormStatus).
 */
export function PendingButton({
  pending,
  variant = "primary",
  size = "lg",
  pendingText,
  confirmMessage,
  disabled,
  className,
  children,
  onClick,
  type = "submit",
  ...props
}: Props) {
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
