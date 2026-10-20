"use client";

import { useId, useRef, type ReactNode } from "react";
import { saveLogisticsData } from "@/app/(app)/logistica/actions";
import { ActionMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { RequestStatus } from "@/db/schema";
import { formatNumber, todayIso } from "@/lib/format";
import { ActionButton } from "./action-button";
import { useActionForm } from "./use-action-form";

export type CarrierOption = { id: number; name: string; active: boolean };

export type LogisticsFormValues = {
  carrierId: number | null;
  pickupDate: string | null;
  trackingNumber: string | null;
  shipmentDate: string | null;
  ddtNumber: string | null;
  deliveryFormReady: boolean;
  shippingCost: number | null;
  logisticsNotes: string | null;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold text-slate-900">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Campo data con scorciatoia «Oggi» (comoda da telefono). */
function DateInput({ id, name, defaultValue, invalid }: { id: string; name: string; defaultValue: string | null; invalid?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex gap-2">
      <Input ref={ref} id={id} name={name} type="date" defaultValue={defaultValue ?? ""} aria-invalid={invalid || undefined} />
      <Button
        variant="secondary"
        className="shrink-0"
        onClick={() => {
          if (ref.current) ref.current.value = todayIso();
        }}
      >
        Oggi
      </Button>
    </div>
  );
}

/**
 * Form dei dati di spedizione nel pannello logistica.
 * mode "full": Pronta per il ritiro / Spedita; mode "completed": solo numero DDT, costo e note.
 */
export function LogisticsForm({
  requestId,
  mode,
  version,
  status,
  carriers,
  values,
  deliveryFormRequired,
  autoConfirmation,
  trackingHref,
}: {
  requestId: number;
  mode: "full" | "completed";
  /** Cambia a ogni salvataggio: i campi ripartono dai valori salvati. */
  version: string;
  status: RequestStatus;
  carriers: CarrierOption[];
  values: LogisticsFormValues;
  deliveryFormRequired: boolean;
  /** Salvando tracking e data di spedizione parte la conferma automatica (contatto con email, non ancora inviata). */
  autoConfirmation: boolean;
  trackingHref: string | null;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const canShip = mode === "full" && status === "PRONTA_RITIRO";

  const { state, pending, intent, onSubmit, fieldErrors } = useActionForm(saveLogisticsData.bind(null, requestId), {
    confirm: (fd) => {
      if (mode !== "full" || !autoConfirmation) return null;
      const complete = String(fd.get("trackingNumber") ?? "").trim() !== "" && String(fd.get("shipmentDate") ?? "") !== "";
      const shipping = status === "SPEDITA" || fd.get("intent") === "ship";
      return complete && shipping
        ? "Con numero di tracking e data di spedizione parte subito l'email di conferma al cliente e la richiesta viene completata. Continuare?"
        : null;
    },
  });

  const costField = (
    <Field label="Costo spedizione (€)" htmlFor={id("cost")} error={fieldErrors.shippingCost} hint="Facoltativo: si può inserire anche dopo la chiusura.">
      <Input
        id={id("cost")}
        name="shippingCost"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        defaultValue={values.shippingCost === null ? "" : formatNumber(values.shippingCost, 2)}
        aria-invalid={fieldErrors.shippingCost ? true : undefined}
      />
    </Field>
  );
  const ddtField = (
    <Field label="Numero DDT" htmlFor={id("ddt")} error={fieldErrors.ddtNumber} hint="Numero del documento di trasporto, se emesso dal gestionale.">
      <Input id={id("ddt")} name="ddtNumber" maxLength={50} autoComplete="off" defaultValue={values.ddtNumber ?? ""} />
    </Field>
  );
  const notesField = (
    <Field label="Note logistica" htmlFor={id("notes")} error={fieldErrors.logisticsNotes} className="sm:col-span-2">
      <Textarea id={id("notes")} name="logisticsNotes" rows={2} maxLength={2000} defaultValue={values.logisticsNotes ?? ""} />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-6" aria-label="Dati di spedizione">
      <input type="hidden" name="expectedStatus" value={status} />
      <div key={version} className="space-y-6">
        {mode === "full" ? (
          <>
            <Section title="Ritiro">
              <Field label="Corriere" htmlFor={id("carrier")} error={fieldErrors.carrierId}>
                <Select id={id("carrier")} name="carrierId" defaultValue={values.carrierId ?? ""}>
                  <option value="">— Seleziona il corriere —</option>
                  {carriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active ? "" : " (disattivato)"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Data di ritiro" htmlFor={id("pickup")} error={fieldErrors.pickupDate}>
                <DateInput id={id("pickup")} name="pickupDate" defaultValue={values.pickupDate} invalid={Boolean(fieldErrors.pickupDate)} />
              </Field>
            </Section>

            <Section title="Bolla di consegna e DDT">
              {deliveryFormRequired ? (
                <div className="rounded-lg bg-amber-50/70 p-3 ring-1 ring-inset ring-amber-200 sm:col-span-2">
                  <input type="hidden" name="deliveryFormReadyField" value="1" />
                  <Checkbox
                    name="deliveryFormReady"
                    defaultChecked={values.deliveryFormReady}
                    label="Bolla pronta"
                    hint="La bolla di consegna richiesta è stata preparata (stampata o allegata qui sotto)."
                  />
                </div>
              ) : null}
              {ddtField}
            </Section>

            <Section title="Tracking e spedizione">
              <Field
                label="Numero di tracking"
                htmlFor={id("tracking")}
                error={fieldErrors.trackingNumber}
                hint={
                  trackingHref ? (
                    <a href={trackingHref} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">
                      Traccia la spedizione sul sito del corriere ↗
                    </a>
                  ) : undefined
                }
              >
                <Input id={id("tracking")} name="trackingNumber" maxLength={100} autoComplete="off" defaultValue={values.trackingNumber ?? ""} />
              </Field>
              <Field label="Data di spedizione" htmlFor={id("shipment")} error={fieldErrors.shipmentDate}>
                <DateInput id={id("shipment")} name="shipmentDate" defaultValue={values.shipmentDate} invalid={Boolean(fieldErrors.shipmentDate)} />
              </Field>
            </Section>

            <Section title="Costi e note">
              {costField}
              {notesField}
            </Section>
          </>
        ) : (
          <Section title="Dati amministrativi">
            {ddtField}
            {costField}
            {notesField}
          </Section>
        )}
      </div>

      <ActionMessage state={state} />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {canShip ? (
          <p className="text-xs text-slate-500 sm:mr-auto sm:max-w-sm">
            Se inserisci già tracking e data di spedizione, segnandola come spedita parte subito la conferma al cliente.
          </p>
        ) : null}
        <ActionButton
          name="intent"
          value="save"
          variant={canShip ? "secondary" : "primary"}
          pending={pending}
          active={intent === "save"}
          pendingText="Salvataggio…"
          className="w-full sm:w-auto"
        >
          {mode === "completed" ? "Salva dati amministrativi" : "Salva"}
        </ActionButton>
        {canShip ? (
          <ActionButton
            name="intent"
            value="ship"
            variant="success"
            pending={pending}
            active={intent === "ship"}
            pendingText="Invio in corso…"
            className="w-full sm:w-auto"
          >
            Salva e segna come spedita
          </ActionButton>
        ) : null}
      </div>
    </form>
  );
}
