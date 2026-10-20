import { formatEuro, formatNumber } from "@/lib/format";

/** Ripartizione dei costi del periodo per voce: importo, quota sul totale e barra proporzionale. */
export function CostBreakdown({ parts }: { parts: { key: string; label: string; amount: number }[] }) {
  const total = parts.reduce((s, p) => s + p.amount, 0);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {parts.map((p) => (
        <li key={p.key} className="min-w-0 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-slate-600" title={p.label}>
              {p.label}
            </span>
            <span className="text-xs tabular-nums text-slate-500">{formatNumber(pct(p.amount), 0)}%</span>
          </div>
          <p className="font-semibold tabular-nums text-slate-900">{formatEuro(p.amount)}</p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct(p.amount)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
