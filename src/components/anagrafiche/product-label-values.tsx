"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useState, type FormEvent } from "react";
import { editProductLabelValue } from "@/app/(app)/anagrafiche/prodotti/actions";
import { ActionMessage } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/form";
import { formatNumber } from "@/lib/format";
import {
  cleanLabel,
  labelKey,
  labelsByUsage,
  MISSING_LABEL_FILTER,
  PRODUCT_LABEL_MAX,
  PRODUCT_LABEL_NAMES,
  PRODUCT_LABEL_PARAMS,
  renameTarget,
  type ProductLabelField,
} from "@/lib/products/labels";
import { PendingButton } from "./form-helpers";

export type LabelValueUsage = { value: string; total: number; active: number };

const PRODUCTS = "/anagrafiche/prodotti";

/** Articoli per le frasi di conferma: «il marchio» / «la categoria», «al marchio» / «alla categoria». */
const WORDS: Record<ProductLabelField, { the: string; to: string }> = {
  brand: { the: "il marchio", to: "al marchio" },
  category: { the: "la categoria", to: "alla categoria" },
};

function productsText(n: number): string {
  return n === 1 ? "1 prodotto" : `${formatNumber(n, 0)} prodotti`;
}

function activeText(n: number): string {
  return `${formatNumber(n, 0)} attiv${n === 1 ? "o" : "i"}`;
}

/** «A», «B» */
function quoted(values: string[]): string {
  return values.map((v) => `«${v}»`).join(", ");
}

/** Testo per i valori che spariscono con un'unione: «la variante «A»» / «le varianti «A», «B»». */
function variantsText(values: string[]): string {
  return `${values.length === 1 ? "la variante" : "le varianti"} ${quoted(values)}`;
}

/**
 * Sezione «Marchi» o «Categorie»: ogni valore in uso con i prodotti (attivi / totali) e il link
 * all'elenco filtrato, le azioni «Rinomina» (anche unione con un valore esistente) e «Togli dai prodotti»,
 * i prodotti senza valore e i suggerimenti del blueprint non ancora usati.
 */
export function ProductLabelValues({
  field,
  values,
  missing,
  unusedSuggestions,
  canEdit,
}: {
  field: ProductLabelField;
  values: LabelValueUsage[];
  missing: { total: number; active: number };
  unusedSuggestions: string[];
  canEdit: boolean;
}) {
  const uid = useId();
  const names = PRODUCT_LABEL_NAMES[field];
  const words = WORDS[field];
  const param = PRODUCT_LABEL_PARAMS[field];
  const [state, dispatch, pending] = useActionState(editProductLabelValue, null);
  /** Valore con il form «Rinomina» aperto. */
  const [open, setOpen] = useState<string | null>(null);
  /** Ultima operazione inviata ("rinomina:valore" / "togli:valore"): pulsante in corso ed errori del form. */
  const [sent, setSent] = useState<string | null>(null);
  // dopo un'operazione riuscita il form «Rinomina» si chiude (il valore unito resta in elenco)
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setOpen(null);
  }
  const renameError = state && !state.ok ? state.fieldErrors?.to : undefined;
  const listHref = (value: string) => `${PRODUCTS}?${new URLSearchParams({ [param]: value })}`;
  // stessa priorità della server action per scegliere la grafia in caso di unione
  const existing = labelsByUsage(values);
  const totalOf = (list: string[]) => list.reduce((sum, v) => sum + (values.find((x) => x.value === v)?.total ?? 0), 0);

  function send(e: FormEvent<HTMLFormElement>, key: string, confirmText: string | null) {
    e.preventDefault();
    if (confirmText && !window.confirm(confirmText)) return;
    const fd = new FormData(e.currentTarget);
    setSent(key);
    startTransition(() => dispatch(fd));
  }

  function submitRename(e: FormEvent<HTMLFormElement>, row: LabelValueUsage) {
    const to = String(new FormData(e.currentTarget).get("to") ?? "");
    const target = renameTarget(row.value, to, existing);
    // nome vuoto o invariato: nessuna conferma, lo segnala la server action
    let confirmText: string | null = null;
    if (target && (target.merged || target.value !== row.value)) {
      const moved = target.sources;
      const gone = moved.length === 1 ? `«${moved[0]}» sparirà` : "quei valori spariranno";
      confirmText = !target.merged
        ? `Rinominare ${words.the} «${row.value}» in «${target.value}» su ${productsText(row.total)}?`
        : target.value === row.value
          ? `Unire ${variantsText(moved)} (${productsText(totalOf(moved))}) ${words.to} «${row.value}»?\n\n` +
            `I prodotti passeranno a «${row.value}» e ${gone} dall'elenco.`
          : `«${cleanLabel(to)}» corrisponde ${words.to} già esistente «${target.value}» (${productsText(totalOf([target.value]))}).\n\n` +
            `I prodotti con ${quoted(moved)} (${productsText(totalOf(moved))}) verranno uniti a «${target.value}» e ${gone} dall'elenco. Continuare?`;
    }
    send(e, `rinomina:${row.value}`, confirmText);
  }

  return (
    <Card>
      <CardHeader
        title={names.plural}
        description={
          values.length === 0
            ? "Nessun valore in uso."
            : `${values.length} valor${values.length === 1 ? "e" : "i"} in uso · ${names.missing.toLowerCase()}: ${productsText(missing.total)}`
        }
      />
      {state && (state.ok || !state.fieldErrors?.to) ? (
        <div className="px-4 pt-4 sm:px-5">
          <ActionMessage state={state} />
        </div>
      ) : null}

      {values.length === 0 ? (
        <EmptyState
          title={`Nessun prodotto ha ancora ${field === "brand" ? "un marchio" : "una categoria"}`}
          description={
            canEdit
              ? "Cerca i prodotti nell'elenco per codice o descrizione e assegna il valore a tutti i risultati in un colpo solo."
              : "I valori compariranno qui quando il back office li avrà assegnati ai prodotti."
          }
          action={
            canEdit ? (
              <LinkButton href={`${PRODUCTS}?attivi=1&${param}=${MISSING_LABEL_FILTER}`}>
                Prodotti {names.missing.toLowerCase()}
              </LinkButton>
            ) : null
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {values.map((row) => {
            const isOpen = canEdit && open === row.value;
            const twin = values.find((v) => v.value !== row.value && labelKey(v.value) === labelKey(row.value));
            const formId = `${uid}-rename-${values.indexOf(row)}`;
            const clearKey = `togli:${row.value}`;
            const renameKey = `rinomina:${row.value}`;
            return (
              <li key={row.value} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <Link href={listHref(row.value)} className="break-words font-medium text-brand-800 hover:underline">
                      {row.value}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {productsText(row.total)} · {activeText(row.active)}
                    </p>
                    {twin ? (
                      <p className="mt-0.5 break-words text-xs text-amber-700">
                        Scritto in modo simile a «{twin.value}»: usa «Rinomina» per unirli.
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? formId : undefined}
                        onClick={() => setOpen(isOpen ? null : row.value)}
                      >
                        Rinomina
                      </Button>
                      <form
                        onSubmit={(e) =>
                          send(
                            e,
                            clearKey,
                            `Togliere ${words.the} «${row.value}» da ${productsText(row.total)}?\n\nI prodotti resteranno ${names.missing.toLowerCase()}.`,
                          )
                        }
                      >
                        <input type="hidden" name="op" value="togli" />
                        <input type="hidden" name="field" value={field} />
                        <input type="hidden" name="value" value={row.value} />
                        <PendingButton
                          size="sm"
                          variant="dangerGhost"
                          pending={pending && sent === clearKey}
                          pendingText="Rimozione…"
                          disabled={pending}
                        >
                          Togli dai prodotti
                        </PendingButton>
                      </form>
                    </div>
                  ) : null}
                </div>
                {isOpen ? (
                  <RenameForm
                    id={formId}
                    field={field}
                    row={row}
                    existing={existing}
                    datalistId={`${uid}-values`}
                    pending={pending && sent === renameKey}
                    disabled={pending}
                    error={sent === renameKey ? renameError : undefined}
                    onSubmit={(e) => submitRename(e, row)}
                    onCancel={() => setOpen(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <Link href={listHref(MISSING_LABEL_FILTER)} className="font-medium text-slate-700 hover:underline">
            {names.missing}
          </Link>
          <p className="text-xs text-slate-500">
            {productsText(missing.total)} · {activeText(missing.active)}
          </p>
        </div>
        {canEdit && missing.active > 0 && values.length > 0 ? (
          <LinkButton size="sm" href={`${PRODUCTS}?attivi=1&${param}=${MISSING_LABEL_FILTER}`}>
            Completa i prodotti attivi
          </LinkButton>
        ) : null}
      </div>

      {unusedSuggestions.length > 0 ? (
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <p className="text-xs text-slate-500">Previsti dal blueprint BGP e non ancora usati:</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {unusedSuggestions.map((s) => (
              <li key={s}>
                <Badge tone="slate">{s}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canEdit ? (
        <datalist id={`${uid}-values`}>
          {[...values.map((v) => v.value), ...unusedSuggestions].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ) : null}
    </Card>
  );
}

/** Form «Rinomina» di un valore: avvisa subito se il nuovo nome coincide con un valore esistente (unione). */
function RenameForm({
  id,
  field,
  row,
  existing,
  datalistId,
  pending,
  disabled,
  error,
  onSubmit,
  onCancel,
}: {
  id: string;
  field: ProductLabelField;
  row: LabelValueUsage;
  existing: string[];
  datalistId: string;
  pending: boolean;
  disabled: boolean;
  error?: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(row.value);
  const target = renameTarget(row.value, draft, existing);
  const inputId = `${id}-to`;
  const descId = `${id}-desc`;
  return (
    <form id={id} onSubmit={onSubmit} className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
      <input type="hidden" name="op" value="rinomina" />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={row.value} />
      <Label htmlFor={inputId} className="break-words">
        Nuovo nome di «{row.value}»
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          name="to"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={PRODUCT_LABEL_MAX}
          list={datalistId}
          autoComplete="off"
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={descId}
          className="min-w-0 sm:flex-1"
        />
        <div className="flex gap-2">
          <PendingButton
            size="md"
            pending={pending}
            pendingText="Salvataggio…"
            disabled={disabled}
            className="flex-1 sm:flex-none"
          >
            {target?.merged ? "Unisci" : "Rinomina"}
          </PendingButton>
          <Button variant="ghost" onClick={onCancel}>
            Annulla
          </Button>
        </div>
      </div>
      <div id={descId} className="break-words">
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : target?.merged && target.value === row.value ? (
          <p className="text-xs text-amber-800">
            {target.sources.length === 1
              ? `Esiste anche ${quoted(target.sources)}, scritto in modo simile: i suoi prodotti`
              : `Esistono anche ${quoted(target.sources)}, scritti in modo simile: i loro prodotti`}{" "}
            passeranno a «{row.value}».
          </p>
        ) : target?.merged ? (
          <p className="text-xs text-amber-800">
            Esiste già «{target.value}»: i prodotti con «{row.value}» verranno uniti a quel valore.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Cambia il valore su {row.total === 1 ? "1 prodotto" : `tutti i ${productsText(row.total)}`}. Se scrivi un
            valore già esistente i prodotti vengono uniti.
          </p>
        )}
      </div>
    </form>
  );
}
