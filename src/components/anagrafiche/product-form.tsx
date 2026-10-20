"use client";

import { useId } from "react";
import { saveProduct } from "@/app/(app)/anagrafiche/actions";
import { ActionMessage } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { PendingButton, useKeepValuesAction } from "./form-helpers";

export type ProductFormValues = {
  id: number | null;
  code: string;
  description: string;
  brand: string;
  category: string;
  format: string;
  finish: string;
  /** Già formattato per l'input ("1,25"). */
  unitWeightKg: string;
  active: boolean;
};

export function ProductForm({
  initial,
  version,
  brands,
  categories,
  cancelHref,
}: {
  initial: ProductFormValues;
  /** Cambia quando il prodotto viene salvato: i campi si riallineano ai dati salvati. */
  version: string;
  brands: string[];
  categories: string[];
  cancelHref: string;
}) {
  const { state, onSubmit, pending, fieldErrors } = useKeepValuesAction(saveProduct);
  const isNew = initial.id === null;
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="id" value={initial.id ?? ""} />
      <ActionMessage state={state} />
      <ProductFields key={version} initial={initial} brands={brands} categories={categories} errors={fieldErrors} />
      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
        <LinkButton href={cancelHref} variant="ghost" className="w-full sm:w-auto">
          {isNew ? "Annulla" : "Torna all'elenco"}
        </LinkButton>
        <PendingButton pending={pending} pendingText="Salvataggio…" className="w-full sm:w-auto">
          {isNew ? "Crea prodotto" : "Salva modifiche"}
        </PendingButton>
      </div>
    </form>
  );
}

function ProductFields({
  initial,
  brands,
  categories,
  errors,
}: {
  initial: ProductFormValues;
  brands: string[];
  categories: string[];
  errors: Record<string, string>;
}) {
  const uid = useId();
  const f = (name: string) => `${uid}-${name}`;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field
        label="Codice articolo"
        htmlFor={f("code")}
        required
        error={errors.code}
        hint="Come nel gestionale BGP. Deve essere unico."
      >
        <Input
          id={f("code")}
          name="code"
          required
          maxLength={60}
          defaultValue={initial.code}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!errors.code || undefined}
        />
      </Field>

      <Field
        label="Peso unitario (kg)"
        htmlFor={f("unitWeightKg")}
        error={errors.unitWeightKg}
        hint="Facoltativo. Es. 1,25"
      >
        <Input
          id={f("unitWeightKg")}
          name="unitWeightKg"
          inputMode="decimal"
          maxLength={12}
          defaultValue={initial.unitWeightKg}
          aria-invalid={!!errors.unitWeightKg || undefined}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Descrizione"
        htmlFor={f("description")}
        error={errors.description}
        hint="Descrizione estesa mostrata nei moduli di richiesta, nelle email e nella bolla."
        className="sm:col-span-2"
      >
        <Textarea
          id={f("description")}
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={initial.description}
          aria-invalid={!!errors.description || undefined}
        />
      </Field>

      <Field label="Marchio" htmlFor={f("brand")} error={errors.brand}>
        <Input id={f("brand")} name="brand" list={f("brands")} maxLength={100} defaultValue={initial.brand} autoComplete="off" />
        <datalist id={f("brands")}>
          {brands.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </Field>

      <Field label="Categoria" htmlFor={f("category")} error={errors.category}>
        <Input
          id={f("category")}
          name="category"
          list={f("categories")}
          maxLength={100}
          defaultValue={initial.category}
          autoComplete="off"
        />
        <datalist id={f("categories")}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      <Field label="Formato" htmlFor={f("format")} error={errors.format} hint="Es. 14x190x1900 mm">
        <Input id={f("format")} name="format" maxLength={200} defaultValue={initial.format} autoComplete="off" />
      </Field>

      <Field label="Finitura" htmlFor={f("finish")} error={errors.finish} hint="Es. spazzolato, vernice UV naturale">
        <Input id={f("finish")} name="finish" maxLength={200} defaultValue={initial.finish} autoComplete="off" />
      </Field>

      <div className="sm:col-span-2">
        <Checkbox
          name="active"
          defaultChecked={initial.active}
          label="Prodotto attivo"
          hint="Disattiva per nascondere il prodotto dai moduli di richiesta (anche dal modulo pubblico). Lo storico resta invariato."
        />
      </div>
    </div>
  );
}
