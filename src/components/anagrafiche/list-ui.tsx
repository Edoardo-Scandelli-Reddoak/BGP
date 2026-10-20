import type { ReactNode } from "react";
import { Label } from "@/components/ui/form";

/** Etichetta compatta per i filtri degli elenchi anagrafici. */
export function FilterField({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs text-slate-500">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** Riquadro numerico per le statistiche delle schede di dettaglio. */
export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
      {hint ? <dd className="text-xs text-slate-500">{hint}</dd> : null}
    </div>
  );
}

/** URL dell'elenco con i filtri correnti (prima pagina). */
export function listHref(basePath: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
