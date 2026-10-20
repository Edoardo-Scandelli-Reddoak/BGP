"use client";

import { useId, useState, type FormEvent } from "react";
import { assignLabelsToFilteredProducts } from "@/app/(app)/anagrafiche/prodotti/actions";
import { ActionMessage, Alert } from "@/components/ui/alert";
import { cn } from "@/components/ui/cn";
import { Field, Input } from "@/components/ui/form";
import { formatNumber } from "@/lib/format";
import { cleanLabel, PRODUCT_LABEL_MAX } from "@/lib/products/labels";
import { PendingButton, useKeepValuesAction } from "./form-helpers";

/** Filtri dell'elenco prodotti (stessi parametri della pagina), rinviati alla server action. */
export type ProductListFilterParams = { q?: string; attivi?: string; marchio?: string; categoria?: string };

type Mode = "mancanti" | "sostituisci";

const MODES: { value: Mode; label: string; description: string }[] = [
  {
    value: "mancanti",
    label: "Solo dove manca",
    description: "Si compila solo il campo vuoto: marchio e categoria già presenti restano invariati.",
  },
  {
    value: "sostituisci",
    label: "Sostituisci anche i valori già presenti",
    description: "Tutti i prodotti dell'elenco avranno i valori indicati.",
  },
];

/** «ai 37 prodotti filtrati» / «a tutti i 4.817 prodotti del catalogo». */
function targetText(total: number, filtered: boolean): string {
  if (total === 0) return "ai prodotti filtrati";
  if (filtered) return total === 1 ? "al prodotto filtrato" : `ai ${formatNumber(total, 0)} prodotti filtrati`;
  return total === 1 ? "all'unico prodotto del catalogo" : `a tutti i ${formatNumber(total, 0)} prodotti del catalogo`;
}

/** Testo breve del pulsante (sta su una riga anche su telefono). */
function buttonText(total: number, filtered: boolean): string {
  if (total === 0) return "Nessun prodotto da aggiornare";
  if (total === 1) return "Assegna al prodotto";
  return `Assegna ${filtered ? "ai" : "a tutti i"} ${formatNumber(total, 0)} prodotti`;
}

/**
 * Pannello (chiuso all'inizio) per assegnare marchio e/o categoria a tutti i prodotti dell'elenco filtrato:
 * si cerca per parole della descrizione e si assegna in blocco. Chiede conferma indicando quanti prodotti.
 */
export function ProductBulkLabels({
  filters,
  total,
  filtered,
  filterText,
  brands,
  categories,
}: {
  filters: ProductListFilterParams;
  /** Prodotti dell'elenco filtrato (al momento del caricamento della pagina); 0 = nessuno, pulsante disattivato. */
  total: number;
  /** false = nessun filtro: l'assegnazione riguarda tutto il catalogo. */
  filtered: boolean;
  /** Descrizione dei filtri attivi per la conferma (es. «ricerca «battiscopa» · senza marchio»). */
  filterText: string;
  brands: string[];
  categories: string[];
}) {
  const uid = useId();
  const f = (name: string) => `${uid}-${name}`;
  const { state, onSubmit, pending, fieldErrors } = useKeepValuesAction(assignLabelsToFilteredProducts);
  const [mode, setMode] = useState<Mode>("mancanti");
  const target = targetText(total, filtered);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const brand = cleanLabel(String(fd.get("brand") ?? ""));
    const category = cleanLabel(String(fd.get("category") ?? ""));
    // senza valori nessuna conferma: la server action segnala i campi da compilare
    if (brand || category) {
      const what = [brand ? `marchio «${brand}»` : null, category ? `categoria «${category}»` : null]
        .filter(Boolean)
        .join(" e ");
      const lines = [
        filtered ? null : "ATTENZIONE: nessun filtro attivo.",
        `Assegnare ${what} ${target}${filtered && filterText ? ` (${filterText})` : ""}?`,
        mode === "sostituisci"
          ? "I valori già presenti verranno sostituiti."
          : "Solo dove manca: i valori già presenti restano invariati.",
      ].filter(Boolean);
      if (!window.confirm(lines.join("\n\n"))) {
        e.preventDefault();
        return;
      }
    }
    onSubmit(e);
  }

  return (
    <details className="group border-b border-slate-100">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-600 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">Assegna marchio e categoria {target}</span>
          <span className="block text-xs text-slate-500">
            {total === 0
              ? "Nessun prodotto corrisponde ai filtri attuali."
              : "Vale per tutti i prodotti dell'elenco con i filtri attuali, non solo per quelli della pagina."}
          </span>
        </span>
        <svg
          viewBox="0 0 20 20"
          className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </summary>

      <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-5 pt-1 sm:px-5">
        {Object.entries(filters).map(([name, value]) =>
          value ? <input key={name} type="hidden" name={name} value={value} /> : null,
        )}
        <p className="text-sm text-slate-600">
          Restringi l&apos;elenco con la ricerca, ad esempio «battiscopa» o «collezione NAIF», controlla i risultati e
          assegna qui il marchio e/o la categoria. Lascia vuoto un campo per non modificarlo; per correggere o togliere un
          valore usa la pagina «Marchi e categorie».
        </p>

        {filtered ? null : (
          <Alert tone="warning">
            Nessun filtro attivo: l&apos;assegnazione riguarda <strong>tutti i {formatNumber(total, 0)} prodotti</strong>{" "}
            del catalogo.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Marchio" htmlFor={f("brand")} error={fieldErrors.brand}>
            <Input
              id={f("brand")}
              name="brand"
              list={f("brands")}
              maxLength={PRODUCT_LABEL_MAX}
              autoComplete="off"
              placeholder="Es. Gaia Parquet"
              aria-invalid={!!fieldErrors.brand || undefined}
            />
          </Field>
          <Field label="Categoria" htmlFor={f("category")} error={fieldErrors.category}>
            <Input
              id={f("category")}
              name="category"
              list={f("categories")}
              maxLength={PRODUCT_LABEL_MAX}
              autoComplete="off"
              placeholder="Es. Legno"
              aria-invalid={!!fieldErrors.category || undefined}
            />
          </Field>
          <datalist id={f("brands")}>
            {brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <datalist id={f("categories")}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Prodotti che hanno già un valore</legend>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ring-inset transition-colors",
                  mode === m.value ? "bg-brand-50 ring-2 ring-brand-600" : "bg-white ring-slate-200 hover:bg-slate-50",
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                  className="mt-0.5 size-4 shrink-0 border-slate-300 text-brand-700 focus:ring-brand-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{m.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-600">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <ActionMessage state={state} />

        <div className="flex justify-end">
          <PendingButton
            pending={pending}
            disabled={pending || total === 0}
            pendingText="Assegnazione…"
            variant={filtered ? "primary" : "danger"}
            className="w-full sm:w-auto"
          >
            {buttonText(total, filtered)}
          </PendingButton>
        </div>
      </form>
    </details>
  );
}
