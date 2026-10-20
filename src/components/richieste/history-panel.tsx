import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";
import type { RequestDetail } from "@/lib/requests/queries";
import { ROLE_LABELS } from "@/lib/roles";
import { STATUS_ORDER } from "@/lib/status";

/** Pannello «Storico»: cambi di stato con autore, data e note (dal più recente). */
export function HistoryPanel({ request }: { request: RequestDetail }) {
  const events = [...request.events].reverse();
  return (
    <Card>
      <CardHeader title="Storico" description="Chi ha fatto cosa e quando." />
      {events.length === 0 ? (
        <EmptyState title="Nessun evento registrato" />
      ) : (
        <ol className="px-5 py-4">
          {events.map((e, i) => {
            const isRevert =
              e.fromStatus !== null && STATUS_ORDER.indexOf(e.toStatus) < STATUS_ORDER.indexOf(e.fromStatus);
            const author = e.user
              ? `${e.user.name} · ${ROLE_LABELS[e.user.role]}`
              : e.fromStatus === null && request.source === "MODULO_PUBBLICO"
                ? "Modulo pubblico"
                : "Sistema";
            return (
              <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                {i < events.length - 1 ? (
                  <span aria-hidden className="absolute top-4 left-[5px] h-full w-px bg-slate-200" />
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    "relative mt-1.5 size-[11px] shrink-0 rounded-full ring-2 ring-white",
                    isRevert ? "bg-amber-500" : i === 0 ? "bg-brand-600" : "bg-slate-300",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900">
                    {e.fromStatus === null ? (
                      <span className="font-medium">Richiesta creata</span>
                    ) : isRevert ? (
                      <span className="font-medium text-amber-800">Riportata indietro</span>
                    ) : (
                      <span className="font-medium">Avanzata</span>
                    )}{" "}
                    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                      {e.fromStatus ? (
                        <>
                          <StatusBadge status={e.fromStatus} />
                          <span aria-hidden className="text-slate-400">
                            →
                          </span>
                          <span className="sr-only">a</span>
                        </>
                      ) : null}
                      <StatusBadge status={e.toStatus} />
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <time dateTime={e.createdAt.toISOString()}>{formatDateTime(e.createdAt)}</time> · {author}
                  </p>
                  {e.note ? <p className="mt-1 text-sm whitespace-pre-line text-slate-700">{e.note}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
