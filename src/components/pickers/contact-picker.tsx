"use client";

import { SearchPicker } from "@/components/ui/search-picker";
import type { ContactOption } from "./types";

/** Ricerca contatti per nome, email o indirizzo. `type` limita ad agenti o clienti. */
export function ContactPicker({
  onSelect,
  type,
  placeholder = "Cerca cliente o agente per nome, email, città…",
  id,
  invalid,
}: {
  onSelect: (c: ContactOption) => void;
  type?: "AGENTE" | "CLIENTE";
  placeholder?: string;
  id?: string;
  invalid?: boolean;
}) {
  return (
    <SearchPicker<ContactOption>
      id={id}
      invalid={invalid}
      endpoint="/api/contatti/search"
      extraParams={type ? { tipo: type } : undefined}
      placeholder={placeholder}
      getKey={(c) => c.id}
      onSelect={onSelect}
      renderItem={(c) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900">{c.name}</span>
            <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase text-slate-600">
              {c.type === "AGENTE" ? "Agente" : "Cliente"}
            </span>
          </div>
          <div className="truncate text-xs text-slate-500">
            {[c.email, c.defaultAddress, c.agentName ? `Agente: ${c.agentName}` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
      )}
    />
  );
}
