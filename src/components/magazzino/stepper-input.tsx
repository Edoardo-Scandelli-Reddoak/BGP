"use client";

import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/form";

const STEP_BUTTON =
  "h-12 w-12 shrink-0 bg-slate-100 text-xl font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-200 disabled:text-slate-300 disabled:hover:bg-slate-100";

/** Campo numerico intero con pulsanti − / + grandi, pensato per il telefono. */
export function StepperInput({
  id,
  name,
  value,
  onChange,
  min = 0,
  max = 999,
  placeholder,
  invalid,
  label,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  invalid?: boolean;
  /** Oggetto dei pulsanti per gli screen reader, es. "quantità". */
  label: string;
}) {
  const n = Number(value);
  const current = value.trim() && Number.isInteger(n) ? n : null;

  function step(delta: number) {
    const base = current ?? (delta > 0 ? min - 1 : min + 1);
    onChange(String(Math.min(max, Math.max(min, base + delta))));
  }

  return (
    <div className="flex">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={current !== null && current <= min}
        aria-label={`Diminuisci ${label}`}
        className={cn(STEP_BUTTON, "rounded-l-lg")}
      >
        −
      </button>
      <Input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        aria-invalid={invalid || undefined}
        className="h-12 min-w-0 rounded-none text-center text-base! tabular-nums"
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={current !== null && current >= max}
        aria-label={`Aumenta ${label}`}
        className={cn(STEP_BUTTON, "rounded-r-lg")}
      >
        +
      </button>
    </div>
  );
}
