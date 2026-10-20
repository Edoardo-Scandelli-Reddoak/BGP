import type { RequestStatus } from "@/db/schema";
import { formatNumber } from "@/lib/format";
import { STATUS_COLORS, STATUS_LABELS, STATUS_ORDER } from "@/lib/status";

/** Barra in pila con la distribuzione per stato, legenda con conteggi e percentuali. */
export function StatusDistribution({ counts }: { counts: Record<RequestStatus, number> }) {
  const total = STATUS_ORDER.reduce((s, st) => s + counts[st], 0);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const visible = STATUS_ORDER.filter((s) => counts[s] > 0);

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {visible.map((s) => (
          <div
            key={s}
            className="h-full min-w-1"
            style={{ flexGrow: counts[s], flexBasis: 0, backgroundColor: STATUS_COLORS[s] }}
            title={`${STATUS_LABELS[s]}: ${counts[s]}`}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-5">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="flex items-center justify-between gap-2 text-sm lg:block">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} aria-hidden />
              {STATUS_LABELS[s]}
            </span>
            <span className="tabular-nums text-slate-900 lg:mt-0.5 lg:block lg:pl-[18px]">
              <span className="font-semibold">{counts[s]}</span>
              <span className="ml-1.5 text-xs text-slate-500">{formatNumber(pct(counts[s]), 0)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
