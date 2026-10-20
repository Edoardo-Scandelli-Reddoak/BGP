import { formatMonth, formatNumber } from "@/lib/format";

type Unit = "count" | "m2";

export type BarPoint = { month: string; value: number };

const STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** Massimo "tondo" dell'asse (es. 5,48 → 6; 18 → 20), con metà intera per i conteggi. */
function niceMax(max: number, integer: boolean): number {
  if (max <= 0) return integer ? 2 : 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const step = STEPS.find((s) => s * exp >= max - 1e-9) ?? 10;
  let nice = step * exp;
  if (integer) {
    nice = Math.max(2, Math.ceil(nice));
    if (nice % 2) nice += 1;
  }
  return nice;
}

function formatValue(value: number, unit: Unit): string {
  return unit === "m2" ? formatNumber(value, 2) : String(value);
}

function formatTick(value: number, unit: Unit): string {
  if (unit === "count") return String(value);
  return formatNumber(value, Number.isInteger(value) ? 0 : 1);
}

function shortMonth(month: string): string {
  return formatMonth(month).slice(0, 3);
}

/**
 * Istogramma mensile in puro HTML/CSS (nessuna libreria): una serie, asse con 3 tacche,
 * etichette solo sul valore massimo e sull'ultimo mese, dettaglio al passaggio del mouse
 * e tabella dei dati per lettori di schermo e consultazione.
 */
export function MonthlyBars({
  points,
  unit,
  unitLabel,
  barClassName,
  caption,
}: {
  points: BarPoint[];
  unit: Unit;
  /** Es. "richieste", "m²" (per descrizione, tooltip e tabella). */
  unitLabel: string;
  /** Colore delle barre (classe Tailwind bg-*). */
  barClassName: string;
  caption: string;
}) {
  const max = Math.max(0, ...points.map((p) => p.value));
  const top = niceMax(max, unit === "count");
  const ticks = [top, top / 2, 0];
  const maxIndex = max > 0 ? points.findIndex((p) => p.value === max) : -1;
  const lastIndex = points.length - 1;
  const total = points.reduce((s, p) => s + p.value, 0);

  return (
    <figure>
      <figcaption className="sr-only">
        {caption}: totale {formatValue(total, unit)} {unitLabel} in {points.length} mesi.
      </figcaption>
      <div aria-hidden className="flex">
        {/* asse verticale */}
        <div className="relative mr-2 h-40 w-8 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
          {ticks.map((t, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / 2) * 100}%` }}>
              {formatTick(t, unit)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40">
            {ticks.map((_, i) => (
              <div key={i} className="absolute inset-x-0 border-t border-slate-100" style={{ top: `${(i / 2) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end">
              {points.map((p, i) => {
                const pct = top > 0 ? (p.value / top) * 100 : 0;
                const labeled = p.value > 0 && (i === maxIndex || i === lastIndex);
                return (
                  <div key={p.month} className="group relative flex h-full flex-1 items-end justify-center px-px">
                    {/* area sensibile al passaggio del mouse: tutta la colonna */}
                    <div
                      className={`relative w-full max-w-6 rounded-t ${barClassName} ${p.value > 0 ? "" : "opacity-0"}`}
                      style={{ height: p.value > 0 ? `max(${pct}%, 2px)` : "0" }}
                    >
                      {labeled ? (
                        <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums text-slate-600">
                          {formatValue(p.value, unit)}
                        </span>
                      ) : null}
                    </div>
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
                      <span className="capitalize">{formatMonth(p.month)}</span>: {formatValue(p.value, unit)} {unitLabel}
                    </div>
                    <div className="absolute inset-y-0 left-0 right-0 group-hover:bg-slate-900/[0.03]" />
                  </div>
                );
              })}
            </div>
          </div>
          {/* etichette dei mesi */}
          <div className="mt-1.5 flex border-t border-slate-200 pt-1">
            {points.map((p, i) => {
              const showYear = i === 0 || p.month.endsWith("-01");
              return (
                <div key={p.month} className="flex-1 text-center text-[10px] leading-tight text-slate-500">
                  {shortMonth(p.month)}
                  <span className={`block text-slate-400 ${showYear ? "" : "invisible"}`}>&rsquo;{p.month.slice(2, 4)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:text-brand-900">Mostra i dati</summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th scope="col" className="py-1 font-medium">
                Mese
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                <span className="capitalize">{unitLabel}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {points.map((p) => (
              <tr key={p.month}>
                <td className="py-1 capitalize text-slate-700">{formatMonth(p.month)}</td>
                <td className="py-1 text-right tabular-nums text-slate-900">{formatValue(p.value, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
