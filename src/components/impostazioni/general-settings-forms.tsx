"use client";

import { useState } from "react";
import { saveCompanySettingsAction, savePublicFormSettingsAction } from "@/app/(app)/impostazioni/actions";
import { ActionMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { PendingButton, useFormAction } from "./form-kit";

export type CompanySettingsValues = {
  companyName: string;
  companyAddress: string;
  companyTaxInfo: string;
  companyContacts: string;
  bollaCausale: string;
  bollaPorto: string;
  bollaAspetto: string;
};

const COMPANY_FIELDS: { name: keyof CompanySettingsValues; label: string; hint?: string; required?: boolean; max: number }[] = [
  { name: "companyName", label: "Ragione sociale", required: true, max: 120 },
  { name: "companyAddress", label: "Indirizzo", hint: "Sede legale e operativa, su una riga.", max: 300 },
  { name: "companyTaxInfo", label: "Dati fiscali", hint: "Partita IVA, codice fiscale, REA…", max: 300 },
  { name: "companyContacts", label: "Contatti", hint: "Telefono, email, sito.", max: 300 },
];

const BOLLA_FIELDS: { name: keyof CompanySettingsValues; label: string; hint?: string; required?: boolean; max: number }[] = [
  { name: "bollaCausale", label: "Causale del trasporto", required: true, hint: "Es. CUG Comodato d'uso gratuito.", max: 120 },
  { name: "bollaPorto", label: "Porto", hint: "Es. Franco vs magazzino.", max: 120 },
  { name: "bollaAspetto", label: "Aspetto esteriore dei beni", hint: "Es. Pacco.", max: 120 },
];

export function CompanySettingsForm({ values }: { values: CompanySettingsValues }) {
  const { state, pending, onSubmit, fieldError } = useFormAction(saveCompanySettingsAction);
  const renderField = (f: (typeof COMPANY_FIELDS)[number]) => (
    <Field key={f.name} label={f.label} htmlFor={f.name} required={f.required} hint={f.hint} error={fieldError(f.name)}>
      <Input
        id={f.name}
        name={f.name}
        required={f.required}
        maxLength={f.max}
        defaultValue={values[f.name]}
        aria-invalid={!!fieldError(f.name) || undefined}
      />
    </Field>
  );
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div key={JSON.stringify(values)} className="space-y-6">
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-slate-900">Intestazione della bolla</legend>
          <div className="grid gap-4 md:grid-cols-2">{COMPANY_FIELDS.map(renderField)}</div>
        </fieldset>
        <fieldset className="space-y-4 border-t border-slate-100 pt-6">
          <legend className="sr-only">Valori predefiniti della bolla</legend>
          <p className="text-sm font-semibold text-slate-900">Valori predefiniti della bolla</p>
          <div className="grid gap-4 md:grid-cols-3">{BOLLA_FIELDS.map(renderField)}</div>
        </fieldset>
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <ActionMessage state={state} className="sm:flex-1" />
        <PendingButton pending={pending} pendingText="Salvataggio…" className="sm:ml-auto">
          Salva dati
        </PendingButton>
      </div>
    </form>
  );
}

export function PublicFormSettingsForm({ values }: { values: { publicFormEnabled: boolean; publicFormIntro: string } }) {
  const { state, pending, onSubmit, fieldError } = useFormAction(savePublicFormSettingsAction);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div key={JSON.stringify(values)} className="space-y-5">
        <Checkbox
          name="publicFormEnabled"
          defaultChecked={values.publicFormEnabled}
          label="Modulo pubblico attivo"
          hint="Se disattivato, chi apre il link vede un messaggio «modulo non disponibile» e non può inviare richieste."
        />
        <Field
          label="Testo introduttivo"
          htmlFor="publicFormIntro"
          error={fieldError("publicFormIntro")}
          hint="Mostrato in cima al modulo. Vai a capo per separare i paragrafi."
        >
          <Textarea
            id="publicFormIntro"
            name="publicFormIntro"
            rows={4}
            maxLength={2000}
            defaultValue={values.publicFormIntro}
            aria-invalid={!!fieldError("publicFormIntro") || undefined}
          />
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <ActionMessage state={state} className="sm:flex-1" />
        <PendingButton pending={pending} pendingText="Salvataggio…" className="sm:ml-auto">
          Salva
        </PendingButton>
      </div>
    </form>
  );
}

/** Campo in sola lettura con pulsante «Copia» (link del modulo da inviare agli agenti). */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs sm:flex-1"
      />
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copiato" : "Copia link"}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copiato negli appunti" : ""}
      </span>
    </div>
  );
}
