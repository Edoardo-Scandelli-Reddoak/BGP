"use client";

import { SearchPicker } from "@/components/ui/search-picker";
import type { ProductOption } from "./types";

/** Ricerca prodotti per codice, descrizione, marchio o categoria. `publicMode` usa l'endpoint senza login del modulo pubblico. */
export function ProductPicker({
  onSelect,
  publicMode = false,
  placeholder = "Cerca per codice o descrizione…",
  id,
  invalid,
}: {
  onSelect: (p: ProductOption) => void;
  publicMode?: boolean;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
}) {
  return (
    <SearchPicker<ProductOption>
      id={id}
      invalid={invalid}
      endpoint={publicMode ? "/api/public/prodotti" : "/api/prodotti/search"}
      placeholder={placeholder}
      getKey={(p) => p.id}
      onSelect={onSelect}
      renderItem={(p) => {
        const labels = [p.brand, p.category].filter(Boolean).join(" · ");
        return (
          <div className="min-w-0">
            <div>
              <span className="font-mono text-xs font-semibold text-brand-800">{p.code}</span>
              <span className="ml-2 text-slate-700">{p.description}</span>
            </div>
            {labels ? <div className="truncate text-xs text-slate-500">{labels}</div> : null}
          </div>
        );
      }}
    />
  );
}
