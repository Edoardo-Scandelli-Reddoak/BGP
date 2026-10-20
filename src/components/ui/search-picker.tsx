"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Campo di ricerca con elenco di risultati (combobox) che interroga un endpoint JSON:
 * GET {endpoint}?q=testo → T[]
 * Usato da ProductPicker e ContactPicker.
 */
export function SearchPicker<T>({
  endpoint,
  placeholder,
  renderItem,
  getKey,
  onSelect,
  minChars = 2,
  autoFocus,
  invalid,
  id,
  extraParams,
}: {
  endpoint: string;
  placeholder?: string;
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string | number;
  onSelect: (item: T) => void;
  minChars?: number;
  autoFocus?: boolean;
  invalid?: boolean;
  id?: string;
  extraParams?: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const extra = JSON.stringify(extraParams ?? {});

  useEffect(() => {
    const q = query.trim();
    if (q.length < minChars) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const sp = new URLSearchParams({ q, ...(JSON.parse(extra) as Record<string, string>) });
        const res = await fetch(`${endpoint}?${sp}`, { signal: ctrl.signal });
        if (res.ok) {
          setResults((await res.json()) as T[]);
          setActive(0);
          setOpen(true);
        }
      } catch {
        /* richiesta annullata */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, endpoint, minChars, extra]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(item: T) {
    onSelect(item);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length < minChars) {
            setResults([]);
            setOpen(false);
          }
        }}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="block h-10 w-full rounded-lg border-0 bg-white px-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 aria-[invalid=true]:ring-red-500"
      />
      {loading ? (
        <span className="pointer-events-none absolute right-3 top-3 size-4 animate-spin rounded-full border-2 border-slate-400 border-r-transparent" />
      ) : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">Nessun risultato</li>
          ) : (
            results.map((item, i) => (
              <li
                key={getKey(item)}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer px-3 py-2", i === active ? "bg-brand-50" : undefined)}
              >
                {renderItem(item)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
