import type { RequestStatus } from "@/db/schema";
import { cn } from "@/components/ui/cn";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { STATUS_LABELS, STATUS_ORDER, STATUS_OWNER } from "@/lib/status";

export function ownerLabel(status: RequestStatus): string {
  const owner = STATUS_OWNER[status];
  return owner === "SISTEMA" ? "Automatico" : ROLE_LABELS[owner];
}

/**
 * I 5 passi del flusso con responsabile e momento in cui sono stati raggiunti
 * (ultimo evento di storico verso quello stato, così dopo una correzione vale l'ultimo passaggio).
 */
export function StatusStepper({
  status,
  receivedAt,
  events,
}: {
  status: RequestStatus;
  receivedAt: Date;
  events: { fromStatus: RequestStatus | null; toStatus: RequestStatus; createdAt: Date }[];
}) {
  const current = STATUS_ORDER.indexOf(status);
  const reachedAt = new Map<RequestStatus, Date>([["NUOVA", receivedAt]]);
  // L'evento di creazione non conta: per il primo passo vale la data di ricezione.
  for (const e of events) if (e.fromStatus !== null) reachedAt.set(e.toStatus, e.createdAt);

  return (
    <nav aria-label="Avanzamento della richiesta">
      <ol className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-5 sm:overflow-visible sm:pb-0">
        {STATUS_ORDER.map((s, i) => {
          const done = i < current || (i === current && s === "COMPLETATA");
          const isCurrent = i === current && !done;
          const at = i <= current ? reachedAt.get(s) : undefined;
          return (
            <li
              key={s}
              aria-current={i === current ? "step" : undefined}
              className={cn(
                "min-w-40 flex-1 rounded-lg px-3 py-2.5 ring-inset sm:min-w-0",
                isCurrent && "bg-brand-50 ring-2 ring-brand-600",
                done && "bg-white ring-1 ring-emerald-200",
                !isCurrent && !done && "bg-slate-50 ring-1 ring-slate-200",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    isCurrent && "bg-brand-700 text-white",
                    done && "bg-emerald-600 text-white",
                    !isCurrent && !done && "bg-slate-200 text-slate-500",
                  )}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold leading-tight",
                    isCurrent ? "text-brand-900" : done ? "text-slate-900" : "text-slate-500",
                  )}
                >
                  {STATUS_LABELS[s]}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{ownerLabel(s)}</p>
              <p className={cn("text-xs", at ? "text-slate-700" : "text-slate-400")}>
                {at ? formatDateTime(at) : i === current ? "In corso" : "—"}
              </p>
              <span className="sr-only">
                {done ? "Completato" : isCurrent ? "Passo attuale" : "Da fare"}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
