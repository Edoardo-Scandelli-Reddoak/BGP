"use client";

import { useState } from "react";
import { createCarrierAction, deleteCarrierAction, updateCarrierAction } from "@/app/(app)/impostazioni/actions";
import { ActionMessage } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { PendingButton, useFormAction, type FormAction } from "./form-kit";

export type CarrierValues = {
  id: number;
  name: string;
  trackingUrlTemplate: string | null;
  active: boolean;
  sortOrder: number;
};

const URL_HINT =
  "Scrivi {tracking} dove va il numero di spedizione, es. https://www.ups.com/track?tracknum={tracking}. Senza {tracking} il link porta alla pagina generica del corriere.";

function CarrierFields({
  idPrefix,
  values,
  fieldError,
}: {
  idPrefix: string;
  values: Omit<CarrierValues, "id">;
  fieldError: (name: string) => string | undefined;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
      <Field label="Nome" htmlFor={`${idPrefix}-name`} required error={fieldError("name")}>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={80}
          defaultValue={values.name}
          aria-invalid={!!fieldError("name") || undefined}
        />
      </Field>
      <Field label="Ordine" htmlFor={`${idPrefix}-sort`} error={fieldError("sortOrder")} hint="Posizione nell'elenco.">
        <Input
          id={`${idPrefix}-sort`}
          name="sortOrder"
          type="number"
          inputMode="numeric"
          min={0}
          max={9999}
          step={1}
          defaultValue={values.sortOrder}
          aria-invalid={!!fieldError("sortOrder") || undefined}
        />
      </Field>
      <Field
        label="Link di tracking"
        htmlFor={`${idPrefix}-url`}
        error={fieldError("trackingUrlTemplate")}
        hint={URL_HINT}
        className="sm:col-span-2"
      >
        <Input
          id={`${idPrefix}-url`}
          name="trackingUrlTemplate"
          type="url"
          maxLength={500}
          placeholder="https://…{tracking}"
          defaultValue={values.trackingUrlTemplate ?? ""}
          className="font-mono text-xs"
          aria-invalid={!!fieldError("trackingUrlTemplate") || undefined}
        />
      </Field>
      <Checkbox
        name="active"
        defaultChecked={values.active}
        label="Attivo"
        hint="I corrieri disattivati non compaiono più nella scelta della logistica."
        className="sm:col-span-2"
      />
    </div>
  );
}

export function CreateCarrierForm({ nextSortOrder }: { nextSortOrder: number }) {
  const { state, pending, formRef, onSubmit, fieldError } = useFormAction(createCarrierAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <ActionMessage state={state} />
      <CarrierFields
        idPrefix="new-carrier"
        values={{ name: "", trackingUrlTemplate: null, active: true, sortOrder: nextSortOrder }}
        fieldError={fieldError}
      />
      <div className="flex justify-end">
        <PendingButton pending={pending} pendingText="Salvataggio…">
          Aggiungi corriere
        </PendingButton>
      </div>
    </form>
  );
}

function EditCarrierForm({ carrier, onCancel }: { carrier: CarrierValues; onCancel: () => void }) {
  const { state, pending, onSubmit, fieldError } = useFormAction(updateCarrierAction.bind(null, carrier.id));
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ActionMessage state={state} />
      {/* Dopo il salvataggio i campi si rigenerano con i valori aggiornati. */}
      <div key={`${carrier.name}|${carrier.trackingUrlTemplate}|${carrier.active}|${carrier.sortOrder}`}>
        <CarrierFields idPrefix={`carrier-${carrier.id}`} values={carrier} fieldError={fieldError} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Chiudi
        </Button>
        <PendingButton pending={pending} pendingText="Salvataggio…">
          Salva corriere
        </PendingButton>
      </div>
    </form>
  );
}

function DeleteCarrierButton({ carrier }: { carrier: CarrierValues }) {
  const action: FormAction = deleteCarrierAction.bind(null, carrier.id);
  const { state, pending, onSubmit } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <PendingButton
        pending={pending}
        variant="ghost"
        size="sm"
        className="text-red-700 hover:bg-red-50"
        pendingText="Eliminazione…"
        confirmMessage={`Eliminare il corriere «${carrier.name}»?`}
      >
        Elimina
      </PendingButton>
      {state && !state.ok ? <ActionMessage state={state} /> : null}
    </form>
  );
}

export function CarrierItem({ carrier, usedBy }: { carrier: CarrierValues; usedBy: number }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{carrier.name}</span>
            {carrier.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="slate">Disattivato</Badge>}
            <span className="text-xs text-slate-500">
              Ordine {carrier.sortOrder} · {usedBy === 0 ? "mai usato" : `usato in ${usedBy} richiest${usedBy === 1 ? "a" : "e"}`}
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-slate-500" title={carrier.trackingUrlTemplate ?? undefined}>
            {carrier.trackingUrlTemplate || "Nessun link di tracking"}
          </p>
        </div>
        {!editing ? (
          <div className="flex items-start gap-1">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Modifica
            </Button>
            {usedBy === 0 ? <DeleteCarrierButton carrier={carrier} /> : null}
          </div>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-4 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
          <EditCarrierForm carrier={carrier} onCancel={() => setEditing(false)} />
        </div>
      ) : null}
    </li>
  );
}
