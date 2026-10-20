import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl bg-white shadow-sm ring-1 ring-slate-200", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

/** Coppia etichetta/valore per le schede di dettaglio. */
export function DetailItem({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900 break-words">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}
