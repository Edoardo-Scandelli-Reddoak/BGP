"use client";

import type { ComponentProps } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "@/components/ui/button";

type Props = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Un'azione del form è in corso: il pulsante si disabilita. */
  pending: boolean;
  /** Questo è il pulsante premuto: mostra lo spinner. */
  active?: boolean;
  pendingText?: string;
};

/** Pulsante di invio per i form gestiti con useActionForm. */
export function ActionButton({
  variant = "primary",
  size = "md",
  pending,
  active = true,
  pendingText,
  className,
  children,
  disabled,
  ...props
}: Props) {
  const busy = pending && active;
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={busy || undefined}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {busy ? (
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
