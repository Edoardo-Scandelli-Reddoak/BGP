"use client";

import { useId, useState } from "react";
import { ProductPicker } from "@/components/pickers/product-picker";
import type { ProductOption } from "@/components/pickers/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/form";

/** Riga dell'elenco prodotti nel form (quantità come testo per non bloccare la digitazione). */
export type ItemRow = {
  productId: number;
  code: string;
  description: string;
  active: boolean;
  quantity: string;
  notes: string;
};

export function itemsToPayload(items: ItemRow[]): string {
  return JSON.stringify(items.map((i) => ({ productId: i.productId, quantity: i.quantity, notes: i.notes })));
}

/**
 * Editor dei prodotti richiesti: aggiunta con ricerca, quantità, nota per riga, rimozione.
 * Se un prodotto è già in elenco ne aumenta la quantità invece di duplicarlo.
 */
export function ItemsEditor({
  items,
  onChange,
  errors = {},
}: {
  items: ItemRow[];
  onChange: (items: ItemRow[]) => void;
  errors?: Record<string, string>;
}) {
  const pickerId = useId();
  const [notice, setNotice] = useState<{ productId: number; text: string } | null>(null);

  function add(p: ProductOption) {
    const existing = items.find((i) => i.productId === p.id);
    if (existing) {
      const qty = Math.max(1, Number.parseInt(existing.quantity, 10) || 0) + 1;
      onChange(items.map((i) => (i.productId === p.id ? { ...i, quantity: String(qty) } : i)));
      setNotice({ productId: p.id, text: `${p.code} era già in elenco: quantità portata a ${qty}.` });
      return;
    }
    onChange([
      ...items,
      { productId: p.id, code: p.code, description: p.description, active: p.active, quantity: "1", notes: "" },
    ]);
    setNotice(null);
  }

  function update(productId: number, patch: Partial<ItemRow>) {
    onChange(items.map((i) => (i.productId === productId ? { ...i, ...patch } : i)));
  }

  function remove(productId: number) {
    onChange(items.filter((i) => i.productId !== productId));
    if (notice?.productId === productId) setNotice(null);
  }

  const listError = errors.items;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={pickerId} className="block text-sm font-medium text-slate-700">
          Aggiungi prodotto
        </label>
        <ProductPicker id={pickerId} onSelect={add} invalid={Boolean(listError) && items.length === 0} />
        <p className="text-xs text-slate-500">Cerca per codice articolo o per parole della descrizione (es. «rovere spazzolato»).</p>
      </div>

      {notice ? (
        <p role="status" className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900">
          {notice.text}
        </p>
      ) : null}
      {listError ? (
        <p role="alert" className="text-sm text-red-600">
          {listError}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Nessun prodotto: cerca e seleziona i prodotti richiesti.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {items.map((item, index) => {
            const qtyError = errors[`items.${index}.quantity`];
            const notesError = errors[`items.${index}.notes`];
            const productError = errors[`items.${index}.productId`];
            const qtyId = `${pickerId}-qty-${item.productId}`;
            const notesId = `${pickerId}-notes-${item.productId}`;
            return (
              <li
                key={item.productId}
                className={cn(
                  "grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,14rem)_auto] sm:items-start",
                  notice?.productId === item.productId && "bg-brand-50/60",
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-brand-800">{item.code}</span>
                    {!item.active ? <Badge tone="red">Non attivo</Badge> : null}
                  </div>
                  <p className="truncate text-sm text-slate-600" title={item.description}>
                    {item.description || "—"}
                  </p>
                  {productError ? <p className="text-sm text-red-600">{productError}</p> : null}
                </div>
                <div>
                  <label htmlFor={qtyId} className="block text-xs font-medium text-slate-500 sm:sr-only">
                    Quantità
                  </label>
                  <Input
                    id={qtyId}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={9999}
                    step={1}
                    required
                    value={item.quantity}
                    aria-invalid={qtyError ? true : undefined}
                    aria-label={`Quantità ${item.code}`}
                    onChange={(e) => update(item.productId, { quantity: e.target.value })}
                    onBlur={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      if (!Number.isFinite(n) || n < 1) update(item.productId, { quantity: "1" });
                    }}
                  />
                  {qtyError ? <p className="mt-1 text-xs text-red-600">{qtyError}</p> : null}
                </div>
                <div>
                  <label htmlFor={notesId} className="block text-xs font-medium text-slate-500 sm:sr-only">
                    Nota
                  </label>
                  <Input
                    id={notesId}
                    value={item.notes}
                    maxLength={500}
                    placeholder="Nota (opzionale)"
                    aria-invalid={notesError ? true : undefined}
                    aria-label={`Nota ${item.code}`}
                    onChange={(e) => update(item.productId, { notes: e.target.value })}
                  />
                  {notesError ? <p className="mt-1 text-xs text-red-600">{notesError}</p> : null}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => remove(item.productId)}
                    className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                    aria-label={`Rimuovi ${item.code}`}
                  >
                    Rimuovi
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Elenco in sola lettura (quando i prodotti non sono più modificabili). */
export function ItemsReadOnly({ items, reason }: { items: ItemRow[]; reason: string }) {
  return (
    <div className="space-y-2">
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">{reason}</p>
      <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        {items.map((item) => (
          <li key={item.productId} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="font-mono font-semibold text-brand-800">{item.code}</span>
              <span className="block truncate text-slate-600" title={item.description}>
                {item.description}
              </span>
              {item.notes ? <span className="block text-xs text-slate-500">Nota: {item.notes}</span> : null}
            </span>
            <span className="shrink-0 font-medium text-slate-900">× {item.quantity}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
