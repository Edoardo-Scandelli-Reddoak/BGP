"use client";

import { useId, useRef, type ReactNode } from "react";
import { saveLogisticsData } from "@/app/(app)/logistica/actions";
import { ActionMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { RequestStatus } from "@/db/schema";
import type { BollaMode } from "@/lib/config/bolla";
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

/** Voce di costo manuale attiva (Impostazioni → Costi) con l'importo salvato sulla richiesta. */
export type ManualCostField = { key: string; label: string; amount: number | null };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold text-slate-900">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
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

/** Importo in euro per un campo del form ("" se non indicato o zero). */
function amountValue(n: number | null): string {
  return n === null || n === 0 ? "" : formatNumber(n, 2);
}

/**
 * Form dei dati di spedizione nel pannello logistica.
 * mode "full": Pronta per il ritiro / Spedita; mode "completed": solo data di spedizione, numero DDT,
 * costi e note. I campi della bolla seguono la modalità configurata (Impostazioni → Bolla di consegna):
 * numero DDT nascosto con la bolla generata dal sistema, «Bolla pronta» solo con «Entrambe».
 */
export function LogisticsForm({
  requestId,
  mode,
  version,
  status,
  carriers,
  values,
  deliveryFormRequired,
  bollaMode,
  courierCost,
  manualCosts,
  autoConfirmation,
  ddtUploaded,
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
  bollaMode: BollaMode;
  /** Voce «corriere» dei costi per cliente: il costo di spedizione conta nei costi solo se attiva. */
  courierCost: { enabled: boolean; label: string };
  /** Voci di costo manuali attive, inserite dalla logistica su ogni richiesta. */
  manualCosts: ManualCostField[];
  /** Salvando tracking e data di spedizione parte la conferma automatica (contatto con email, non ancora inviata). */
  autoConfirmation: boolean;
  /** DDT già caricato: viene allegato alla conferma automatica. */
  ddtUploaded: boolean;
  trackingHref: string | null;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const canShip = mode === "full" && status === "PRONTA_RITIRO";
  // Con la bolla generata dal sistema il numero DDT non si usa; con il DDT del gestionale la casella
  // «Bolla pronta» non conta (serve numero o file del DDT).
  const showDdtNumber = bollaMode !== "GENERATA";
  const showReadyCheckbox = bollaMode === "ENTRAMBE" && deliveryFormRequired;

  const { state, pending, intent, onSubmit, fieldErrors } = useActionForm(saveLogisticsData.bind(null, requestId), {
    confirm: (fd) => {
      if (mode !== "full" || !autoConfirmation) return null;
      const complete = String(fd.get("trackingNumber") ?? "").trim() !== "" && String(fd.get("shipmentDate") ?? "") !== "";
      const shipping = status === "SPEDITA" || fd.get("intent") === "ship";
      if (!complete || !shipping) return null;
      // Il DDT caricato dopo l'invio non arriva al cliente: meglio saperlo prima.
      const attachment = ddtUploaded
        ? ""
        : deliveryFormRequired
          ? " Nessun DDT caricato: verrà allegata la bolla generata dal sistema."
          : " Nessun DDT caricato: l'email partirà senza DDT.";
      return `Con numero di tracking e data di spedizione parte subito l'email di conferma al cliente e la richiesta viene completata.${attachment} Continuare?`;
    },
  });

  const costField = (
    <Field
      label="Costo spedizione (€)"
      htmlFor={id("cost")}
      error={fieldErrors.shippingCost}
      hint={
        courierCost.enabled
          ? `Voce «${courierCost.label}» dei costi della richiesta. Facoltativo: si può inserire anche dopo la chiusura.`
          : "Facoltativo. Non conteggiato nei costi della richiesta: la voce del corriere è disattivata in Impostazioni → Costi."
      }
    >
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
  const manualCostFields = manualCosts.map((c) => {
    const name = `extraCost.${c.key}`;
    return (
      <Field key={c.key} label={`${c.label} (€)`} htmlFor={id(name)} error={fieldErrors[name]}>
        <Input
          id={id(name)}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          defaultValue={amountValue(c.amount)}
          aria-invalid={fieldErrors[name] ? true : undefined}
        />
      </Field>
    );
  });
  // Campo nascosto: il valore salvato resta (il servizio aggiorna sempre il numero DDT).
  const ddtField = showDdtNumber ? (
    <Field
      label="Numero DDT"
      htmlFor={id("ddt")}
      error={fieldErrors.ddtNumber}
      hint={
        bollaMode === "GESTIONALE"
          ? "Numero del DDT emesso dal gestionale: con il numero (o il file caricato qui sotto) la bolla è pronta."
          : "Numero del documento di trasporto, se emesso dal gestionale."
      }
    >
      <Input id={id("ddt")} name="ddtNumber" maxLength={50} autoComplete="off" defaultValue={values.ddtNumber ?? ""} />
    </Field>
  ) : (
    <input type="hidden" name="ddtNumber" value={values.ddtNumber ?? ""} />
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

            {showDdtNumber ? (
              <Section title={bollaMode === "GESTIONALE" ? "DDT del gestionale" : "Bolla di consegna e DDT"}>
                {showReadyCheckbox ? (
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
            ) : (
              ddtField
            )}

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
              {manualCostFields}
              {notesField}
            </Section>
          </>
        ) : (
          <Section title="Dati amministrativi">
            <Field
              label="Data di spedizione"
              htmlFor={id("shipment")}
              error={fieldErrors.shipmentDate}
              hint="Data in cui i campioni sono partiti: decide il mese del report m²."
            >
              <DateInput id={id("shipment")} name="shipmentDate" defaultValue={values.shipmentDate} invalid={Boolean(fieldErrors.shipmentDate)} />
            </Field>
            {ddtField}
            {costField}
            {manualCostFields}
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
