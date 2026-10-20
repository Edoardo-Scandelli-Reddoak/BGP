import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const CONTROL =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:ring-red-500";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium text-slate-700", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(CONTROL, "h-10", className)} {...props} />;
}

export function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(CONTROL, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(CONTROL, "h-10 pr-8", className)} {...props} />;
}

export function Checkbox({ className, label, hint, ...props }: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-3 text-sm", className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
        {...props}
      />
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        {hint ? <span className="block text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Campo di form con etichetta, suggerimento ed errore. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
