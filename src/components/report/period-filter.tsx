import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input, Label } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import {
  DEFAULT_PRESET,
  PERIOD_PRESET_LABELS,
  PERIOD_PRESETS,
  presetRange,
  type Period,
} from "@/lib/reports/period";

/** Filtro del periodo (?da=&a=): periodi predefiniti + intervallo libero. */
export function PeriodFilter({ basePath, period, today }: { basePath: string; period: Period; today: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Periodo</p>
          <nav aria-label="Periodi predefiniti" className="mt-2 flex flex-wrap gap-2">
            {PERIOD_PRESETS.map((p) => {
              const r = presetRange(p, today);
              const href = p === DEFAULT_PRESET ? basePath : `${basePath}?da=${r.da}&a=${r.a}`;
              const active = period.preset === p;
              return (
                <Link
                  key={p}
                  href={href}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors",
                    active
                      ? "bg-brand-700 text-white ring-brand-700"
                      : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
                  )}
                >
                  {PERIOD_PRESET_LABELS[p]}
                </Link>
              );
            })}
          </nav>
        </div>
        <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="periodo-da" className="text-xs">
              Dal
            </Label>
            <Input id="periodo-da" type="date" name="da" defaultValue={period.da} className="w-40" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="periodo-a" className="text-xs">
              Al
            </Label>
            <Input id="periodo-a" type="date" name="a" defaultValue={period.a} className="w-40" required />
          </div>
          <button type="submit" className={buttonClasses("secondary", "md")}>
            Applica
          </button>
        </form>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        Dati dal <strong className="font-semibold text-slate-900">{formatDate(period.da)}</strong> al{" "}
        <strong className="font-semibold text-slate-900">{formatDate(period.a)}</strong>
        {period.preset ? <span className="text-slate-500"> · {PERIOD_PRESET_LABELS[period.preset].toLowerCase()}</span> : null}
      </p>
    </div>
  );
}
