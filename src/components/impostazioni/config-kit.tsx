"use client";

import { useEffect, type ComponentProps, type ReactNode } from "react";
import { ActionMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/form";
import { PendingButton } from "./form-kit";

/** Avvisa il browser se si chiude o ricarica la pagina con modifiche non salvate. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/**
 * Barra di salvataggio in fondo ai form delle configurazioni: resta visibile mentre si scorre,
 * segnala le modifiche non salvate e mostra l'esito.
 */
export function SaveBar({
  dirty,
  pending,
  result,
  onReset,
  saveLabel = "Salva impostazioni",
  errorCount = 0,
}: {
  dirty: boolean;
  pending: boolean;
  result: { ok: boolean; message?: string; error?: string } | null;
  onReset: () => void;
  saveLabel?: string;
  errorCount?: number;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:px-5 sm:shadow-sm sm:ring-1 sm:ring-slate-200">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 sm:flex-1" aria-live="polite">
          {result && (!result.ok || !dirty) ? (
            <ActionMessage state={result} />
          ) : errorCount > 0 ? (
            <p className="text-sm text-red-700">
              {errorCount === 1 ? "Un campo da correggere" : `${errorCount} campi da correggere`} prima di salvare.
            </p>
          ) : dirty ? (
            <p className="flex items-center gap-2 text-sm text-amber-800">
              <span className="size-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
              Modifiche non salvate
            </p>
          ) : (
            <p className="text-sm text-slate-500">Nessuna modifica da salvare.</p>
          )}
        </div>
        {/* Su telefono i pulsanti vanno uno sotto l'altro (le etichette sono lunghe), il salvataggio sopra. */}
        <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
          <Button variant="ghost" onClick={onReset} disabled={!dirty || pending} className="w-full sm:w-auto">
            Annulla modifiche
          </Button>
          <PendingButton pending={pending} pendingText="Salvataggio…" disabled={!dirty} className="w-full sm:w-auto">
            {saveLabel}
          </PendingButton>
        </div>
      </div>
    </div>
  );
}

/** Campo numerico con l'unità a destra (es. «€ per collo»). */
export function UnitInput({ unit, className, ...props }: ComponentProps<"input"> & { unit: string }) {
  return (
    <div className="relative">
      <Input inputMode="decimal" autoComplete="off" className={cn("pr-28 text-right tabular-nums", className)} {...props} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">{unit}</span>
    </div>
  );
}

/** Interruttore attiva/disattiva con etichetta (checkbox nativa, accessibile da tastiera). */
export function ToggleRow({
  checked,
  onChange,
  label,
  description,
  children,
  id,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  id: string;
}) {
  return (
    <div className={cn("rounded-lg p-4 ring-1 ring-inset transition-colors", checked ? "bg-white ring-brand-200" : "bg-slate-50 ring-slate-200")}>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
          aria-describedby={description ? `${id}-desc` : undefined}
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            {label}
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                checked ? "bg-emerald-50 text-emerald-800" : "bg-slate-200/70 text-slate-600",
              )}
            >
              {checked ? "Attiva" : "Non attiva"}
            </span>
          </label>
          {description ? (
            <p id={`${id}-desc`} className="mt-0.5 text-sm text-slate-600">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children ? <div className={cn("mt-4 sm:pl-7", !checked && "opacity-70")}>{children}</div> : null}
    </div>
  );
}

/** Messaggio di errore sotto un controllo (stesso stile di Field). */
export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-sm text-red-600" role="alert">
      {children}
    </p>
  );
}

/** Genera un segreto casuale (32 byte, esadecimale) nel browser. */
export function randomSecretHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
