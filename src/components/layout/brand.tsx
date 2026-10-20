import { cn } from "@/components/ui/cn";

/** Marchio testuale dell'app (il logo grafico BGP è nella firma delle email). */
export function BrandMark({ inverted = false, compact = false }: { inverted?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex flex-col gap-[3px]" aria-hidden>
        <span className="block h-[4px] w-6 rounded-full bg-accent-500" />
        <span className="block h-[4px] w-5 rounded-full bg-accent-500/80" />
        <span className="block h-[4px] w-4 rounded-full bg-accent-500/60" />
      </div>
      <div className="leading-tight">
        <div className={cn("text-lg font-extrabold tracking-tight", inverted ? "text-white" : "text-brand-900")}>BGP</div>
        {!compact ? (
          <div className={cn("text-[11px] font-medium uppercase tracking-[0.18em]", inverted ? "text-brand-200" : "text-slate-500")}>
            Campionature
          </div>
        ) : null}
      </div>
    </div>
  );
}
