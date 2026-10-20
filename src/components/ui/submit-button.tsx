"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button";

type Props = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingText?: string;
  /** Se impostato, chiede conferma prima di inviare il form. */
  confirmMessage?: string;
};

/** Pulsante di invio che si disabilita mentre la server action è in corso. */
export function SubmitButton({
  variant = "primary",
  size = "md",
  className,
  children,
  pendingText,
  confirmMessage,
  disabled,
  onClick,
  ...props
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
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
