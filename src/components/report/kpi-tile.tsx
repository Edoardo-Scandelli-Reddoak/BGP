import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Indicatore numerico del cruscotto: etichetta, valore e nota facoltativa. */
export function KpiTile({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200", className)}>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** Contatore di uno stato con collegamento alla vista di lavoro. */
export function StatusCountLink({
  href,
  color,
  label,
  count,
  hint,
}: {
  href: string;
  color: string;
  label: string;
  count: number;
  hint?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:ring-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
          {label}
        </span>
        {hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-2xl font-semibold text-slate-900">{count}</span>
        <span className="text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden>
          →
        </span>
      </span>
    </Link>
  );
}
