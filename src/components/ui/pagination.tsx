import Link from "next/link";
import { cn } from "./cn";

/**
 * Paginazione basata su query string (?pagina=N). `params` sono gli altri parametri da conservare.
 */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params = {},
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) {
    return <p className="px-5 py-3 text-xs text-slate-500">{total} risultat{total === 1 ? "o" : "i"}</p>;
  }
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("pagina", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls = "rounded-md px-3 py-1.5 text-sm ring-1 ring-inset ring-slate-300 bg-white hover:bg-slate-50";
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3" aria-label="Paginazione">
      <p className="text-xs text-slate-500">
        {from}–{to} di {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkCls} href={href(page - 1)}>
            ← Precedente
          </Link>
        ) : null}
        <span className="text-xs text-slate-500">
          Pagina {page} di {pages}
        </span>
        {page < pages ? (
          <Link className={cn(linkCls)} href={href(page + 1)}>
            Successiva →
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Legge ?pagina=N in modo sicuro. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(n) && n > 0 && n <= 100_000 ? n : 1;
}
