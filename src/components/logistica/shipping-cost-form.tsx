"use client";

import { useId } from "react";
import { saveShippingCost } from "@/app/(app)/logistica/actions";
import { cn } from "@/components/ui/cn";
import { formatNumber } from "@/lib/format";
import { ActionButton } from "./action-button";
import { useActionForm } from "./use-action-form";

/** Costo di spedizione modificabile direttamente dall'elenco delle completate. */
export function ShippingCostForm({ requestId, cost, version }: { requestId: number; cost: number | null; version: string }) {
  const uid = useId();
  const { state, pending, onSubmit } = useActionForm(saveShippingCost.bind(null, requestId));
  const error = state && !state.ok ? state.error : null;
  return (
    <form onSubmit={onSubmit} className="min-w-44">
      <div className="flex items-center gap-1.5">
        <label htmlFor={uid} className="sr-only">
          Costo spedizione in euro
        </label>
        <span className="text-sm text-slate-500" aria-hidden>
          €
        </span>
        <input
          key={version}
          id={uid}
          name="shippingCost"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          defaultValue={cost === null ? "" : formatNumber(cost, 2)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${uid}-msg`}
          className="block h-9 w-24 rounded-lg border-0 bg-white px-2.5 text-right text-sm tabular-nums text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 aria-[invalid=true]:ring-red-500"
        />
        <ActionButton variant="secondary" size="sm" pending={pending} pendingText="…" className="h-9">
          Salva
        </ActionButton>
      </div>
      <p id={`${uid}-msg`} aria-live="polite" className={cn("mt-1 text-xs empty:hidden", error ? "text-red-600" : "text-emerald-700")}>
        {error ?? (state?.ok ? state.message : "")}
      </p>
    </form>
  );
}
