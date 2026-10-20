"use client";

import { SearchPicker } from "@/components/ui/search-picker";
import type { ProductOption } from "./types";

/** Ricerca prodotti per codice o descrizione. `publicMode` usa l'endpoint senza login del modulo pubblico. */
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
      renderItem={(p) => (
        <div>
          <span className="font-mono text-xs font-semibold text-brand-800">{p.code}</span>
          <span className="ml-2 text-slate-700">{p.description}</span>
        </div>
      )}
    />
  );
}
