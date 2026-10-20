"use client";

import { useId, useState, type ReactNode } from "react";
import { ProductPicker } from "@/components/pickers/product-picker";
import type { ProductOption } from "@/components/pickers/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Input, Select } from "@/components/ui/form";
import {
  SAMPLE_FORMAT_LABELS,
  SAMPLE_FORMATS,
  isSampleFormat,
  sampleFormatText,
  suggestSampleFormat,
  type SampleFormat,
} from "@/lib/sample-formats";

/** Riga dell'elenco prodotti nel form (quantità come testo per non bloccare la digitazione). */
export type ItemRow = {
  /** Chiave stabile della riga: lo stesso prodotto può comparire in più formati. */
  key: string;
  productId: number;
  code: string;
  description: string;
  active: boolean;
  quantity: string;
  /** "" = formato non ancora scelto. */
  sampleFormat: SampleFormat | "";
  formatNote: string;
  notes: string;
};

let rowSeq = 0;
function newRowKey(productId: number): string {
  rowSeq += 1;
  return `nuovo-${productId}-${rowSeq}`;
}

export function itemsToPayload(items: ItemRow[]): string {
  return JSON.stringify(
    items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      sampleFormat: i.sampleFormat || null,
      formatNote: i.formatNote,
      notes: i.notes,
    })),
  );
}

/** Righe che al salvataggio verranno unite (stesso prodotto, formato e dettaglio): come mergeItems del servizio. */
function mergeKey(i: ItemRow): string {
  return [i.productId, i.sampleFormat, i.formatNote.trim().toLowerCase()].join("|");
}

function RowField({
  label,
  htmlFor,
  required,
  error,
  errorId,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  errorId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-500">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Editor dei prodotti richiesti: aggiunta con ricerca, quantità, formato del campione, nota per riga.
 * Se il prodotto è già in elenco nello stesso formato ne aumenta la quantità; in un formato diverso
 * aggiunge una nuova riga (es. mazzetta + doghe intere dello stesso articolo).
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
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(null);

  function add(p: ProductOption) {
    const suggested = suggestSampleFormat(p.code, p.description) ?? "";
    const sameProduct = items.filter((i) => i.productId === p.id);
    const existing = sameProduct.find((i) => i.sampleFormat === suggested && !i.formatNote.trim());
    if (existing) {
      const qty = Math.max(1, Number.parseInt(existing.quantity, 10) || 0) + 1;
      onChange(items.map((i) => (i.key === existing.key ? { ...i, quantity: String(qty) } : i)));
      const format = existing.sampleFormat ? ` (${SAMPLE_FORMAT_LABELS[existing.sampleFormat]})` : "";
      setNotice({
        key: existing.key,
        text:
          `${p.code}${format} era già in elenco: quantità portata a ${qty}.` +
          (existing.sampleFormat
            ? ""
            : " Per richiederlo anche in un altro formato, scegli prima il formato della riga esistente e poi aggiungilo di nuovo."),
      });
      return;
    }
    const row: ItemRow = {
      key: newRowKey(p.id),
      productId: p.id,
      code: p.code,
      description: p.description,
      active: p.active,
      quantity: "1",
      sampleFormat: suggested,
      formatNote: "",
      notes: "",
    };
    onChange([...items, row]);
    setNotice(
      sameProduct.length > 0
        ? { key: row.key, text: `${p.code} è già in elenco: aggiunta una nuova riga per richiederlo in un altro formato.` }
        : null,
    );
  }

  function update(key: string, patch: Partial<ItemRow>) {
    onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function remove(key: string) {
    onChange(items.filter((i) => i.key !== key));
    if (notice?.key === key) setNotice(null);
  }

  const listError = errors.items;
  const seen = new Set<string>();

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={pickerId} className="block text-sm font-medium text-slate-700">
          Aggiungi prodotto
        </label>
        <ProductPicker id={pickerId} onSelect={add} invalid={Boolean(listError) && items.length === 0} />
        <p className="text-xs text-slate-500">
          Cerca per codice articolo o per parole della descrizione (es. «rovere spazzolato»). Lo stesso prodotto si può
          aggiungere più volte in formati diversi.
        </p>
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
            const err = (field: string) => errors[`items.${index}.${field}`];
            const qtyError = err("quantity");
            const formatError = err("sampleFormat");
            const formatNoteError = err("formatNote");
            const notesError = err("notes");
            const productError = err("productId");
            const id = (field: string) => `${pickerId}-${field}-${item.key}`;
            const isOther = item.sampleFormat === "ALTRO";
            const duplicate = seen.has(mergeKey(item));
            seen.add(mergeKey(item));
            return (
              <li
                key={item.key}
                className={cn("space-y-3 px-3 py-3", notice?.key === item.key && "bg-brand-50/60")}
              >
                <div className="flex items-start justify-between gap-3">
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
                  <button
                    type="button"
                    onClick={() => remove(item.key)}
                    className="inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                    aria-label={`Rimuovi ${item.code}${item.sampleFormat ? ` (${SAMPLE_FORMAT_LABELS[item.sampleFormat]})` : ""}`}
                  >
                    Rimuovi
                  </button>
                </div>
                <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 sm:grid-cols-[5.5rem_minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)]">
                  <RowField label="Quantità" htmlFor={id("qty")} required error={qtyError} errorId={id("qty-err")}>
                    <Input
                      id={id("qty")}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={9999}
                      step={1}
                      required
                      value={item.quantity}
                      aria-invalid={qtyError ? true : undefined}
                      aria-describedby={qtyError ? id("qty-err") : undefined}
                      onChange={(e) => update(item.key, { quantity: e.target.value })}
                      onBlur={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        if (!Number.isFinite(n) || n < 1) update(item.key, { quantity: "1" });
                      }}
                    />
                  </RowField>
                  <RowField label="Formato" htmlFor={id("format")} required error={formatError} errorId={id("format-err")}>
                    <Select
                      id={id("format")}
                      value={item.sampleFormat}
                      aria-invalid={formatError ? true : undefined}
                      aria-describedby={formatError ? id("format-err") : undefined}
                      onChange={(e) => {
                        const value = e.target.value;
                        update(item.key, { sampleFormat: isSampleFormat(value) ? value : "" });
                      }}
                    >
                      <option value="">Scegli il formato…</option>
                      {SAMPLE_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {SAMPLE_FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </Select>
                  </RowField>
                  <RowField
                    label="Dettaglio formato"
                    htmlFor={id("format-note")}
                    required={isOther}
                    error={formatNoteError}
                    errorId={id("format-note-err")}
                    className="col-span-2 sm:col-span-1"
                  >
                    <Input
                      id={id("format-note")}
                      value={item.formatNote}
                      maxLength={200}
                      placeholder={isOther ? "Descrivi il formato richiesto" : "Es. solo culle, 2 colori"}
                      aria-invalid={formatNoteError ? true : undefined}
                      aria-describedby={formatNoteError ? id("format-note-err") : undefined}
                      onChange={(e) => update(item.key, { formatNote: e.target.value })}
                    />
                  </RowField>
                  <RowField
                    label="Nota"
                    htmlFor={id("notes")}
                    error={notesError}
                    errorId={id("notes-err")}
                    className="col-span-2 sm:col-span-1"
                  >
                    <Input
                      id={id("notes")}
                      value={item.notes}
                      maxLength={500}
                      placeholder="Opzionale"
                      aria-invalid={notesError ? true : undefined}
                      aria-describedby={notesError ? id("notes-err") : undefined}
                      onChange={(e) => update(item.key, { notes: e.target.value })}
                    />
                  </RowField>
                </div>
                {duplicate ? (
                  <p className="text-xs text-amber-800">
                    Stesso prodotto e formato di una riga precedente: al salvataggio le quantità vengono sommate.
                  </p>
                ) : null}
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
        {items.map((item) => {
          const format = sampleFormatText(item.sampleFormat, item.formatNote);
          return (
            <li key={item.key} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-mono font-semibold text-brand-800">{item.code}</span>
                <span className="block truncate text-slate-600" title={item.description}>
                  {item.description}
                </span>
                {format ? (
                  <span className="block text-xs text-slate-700">Formato: {format}</span>
                ) : (
                  <span className="block text-xs text-slate-500">Formato non indicato</span>
                )}
                {item.notes ? <span className="block text-xs text-slate-500">Nota: {item.notes}</span> : null}
              </span>
              <span className="shrink-0 font-medium text-slate-900">× {item.quantity}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
