import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "success" | "warning" | "error";

const TONES: Record<Tone, string> = {
  info: "bg-brand-50 text-brand-900 ring-brand-200",
  success: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  error: "bg-red-50 text-red-800 ring-red-200",
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg px-4 py-3 text-sm ring-1 ring-inset", TONES[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title ? "mt-1" : undefined)}>{children}</div> : null}
    </div>
  );
}

/** Mostra l'esito di una server action (ActionResult) sopra o sotto un form. */
export function ActionMessage({
  state,
  className,
}: {
  state: { ok: boolean; message?: string; error?: string } | null | undefined;
  className?: string;
}) {
  if (!state) return null;
  if (state.ok) {
    if (!state.message) return null;
    const warn = /attenzione|non inviat/i.test(state.message);
    return (
      <Alert tone={warn ? "warning" : "success"} className={className}>
        {state.message}
      </Alert>
    );
  }
  return (
    <Alert tone="error" className={className}>
      {state.error}
    </Alert>
  );
}
