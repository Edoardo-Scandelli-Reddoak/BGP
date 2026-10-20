"use client";

import { useId, useState } from "react";
import type { ContactType, Language } from "@/db/schema";
import { saveContact } from "@/app/(app)/anagrafiche/actions";
import { ActionMessage } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { LANGUAGE_LABELS } from "@/lib/format";
import { CONTACT_TYPE_LABELS } from "./constants";
import { PendingButton, useKeepValuesAction } from "./form-helpers";

export type ContactFormValues = {
  id: number | null;
  type: ContactType;
  name: string;
  company: string;
  email: string;
  phone: string;
  country: string;
  defaultAddress: string;
  language: Language;
  agentId: number | null;
  notes: string;
  active: boolean;
};

export type AgentOption = { id: number; name: string; active: boolean };

export function ContactForm({
  initial,
  version,
  agents,
  countries,
  ritorno,
  cancelHref,
}: {
  initial: ContactFormValues;
  /** Cambia quando il contatto viene salvato: i campi si riallineano ai dati normalizzati. */
  version: string;
  agents: AgentOption[];
  countries: string[];
  ritorno?: string | null;
  cancelHref: string;
}) {
  const { state, onSubmit, pending, fieldErrors } = useKeepValuesAction(saveContact);
  const isNew = initial.id === null;
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="id" value={initial.id ?? ""} />
      {ritorno ? <input type="hidden" name="ritorno" value={ritorno} /> : null}
      <ActionMessage state={state} />
      <ContactFields key={version} initial={initial} agents={agents} countries={countries} errors={fieldErrors} />
      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
        <LinkButton href={cancelHref} variant="ghost" className="w-full sm:w-auto">
          {isNew ? "Annulla" : "Torna all'elenco"}
        </LinkButton>
        <PendingButton pending={pending} pendingText="Salvataggio…" className="w-full sm:w-auto">
          {isNew ? (ritorno ? "Crea e torna alla richiesta" : "Crea contatto") : "Salva modifiche"}
        </PendingButton>
      </div>
    </form>
  );
}

function ContactFields({
  initial,
  agents,
  countries,
  errors,
}: {
  initial: ContactFormValues;
  agents: AgentOption[];
  countries: string[];
  errors: Record<string, string>;
}) {
  const [type, setType] = useState<ContactType>(initial.type);
  const uid = useId();
  const f = (name: string) => `${uid}-${name}`;
  const agentOptions = agents.filter((a) => a.id !== initial.id && (a.active || a.id === initial.agentId));

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-slate-700">
          Tipo di contatto<span className="ml-0.5 text-red-600">*</span>
        </legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:max-w-sm">
          {(["CLIENTE", "AGENTE"] as const).map((t) => (
            <label
              key={t}
              className={cn(
                "flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-medium ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-600",
                type === t ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
              )}
            >
              <input
                type="radio"
                name="type"
                value={t}
                checked={type === t}
                onChange={() => setType(t)}
                className="sr-only"
              />
              {CONTACT_TYPE_LABELS[t]}
            </label>
          ))}
        </div>
        {errors.type ? (
          <p className="mt-1.5 text-sm text-red-600" role="alert">
            {errors.type}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-slate-500">
            {type === "AGENTE"
              ? "Gli agenti ricevono in copia (CC) le conferme di spedizione dei loro clienti."
              : "Destinatario dei campioni e della conferma di spedizione."}
          </p>
        )}
      </fieldset>

      <Field label="Nome / ragione sociale" htmlFor={f("name")} required error={errors.name} className="sm:col-span-2">
        <Input
          id={f("name")}
          name="name"
          required
          maxLength={200}
          defaultValue={initial.name}
          aria-invalid={!!errors.name || undefined}
          autoComplete="off"
        />
      </Field>

      <Field label="Azienda / studio" htmlFor={f("company")} error={errors.company} hint="Facoltativo, se diverso dal nome.">
        <Input id={f("company")} name="company" maxLength={200} defaultValue={initial.company} autoComplete="off" />
      </Field>

      <Field label="Telefono" htmlFor={f("phone")} error={errors.phone}>
        <Input id={f("phone")} name="phone" type="tel" maxLength={60} defaultValue={initial.phone} autoComplete="off" />
      </Field>

      <Field
        label="Email"
        htmlFor={f("email")}
        error={errors.email}
        hint="Uno o più indirizzi separati da punto e virgola (;)."
        className="sm:col-span-2"
      >
        <Input
          id={f("email")}
          name="email"
          inputMode="email"
          maxLength={1000}
          placeholder="nome@azienda.it; ufficio@azienda.it"
          defaultValue={initial.email}
          aria-invalid={!!errors.email || undefined}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Lingua"
        htmlFor={f("language")}
        required
        error={errors.language}
        hint="Lingua delle email inviate al contatto."
      >
        <Select
          id={f("language")}
          name="language"
          required
          defaultValue={initial.language}
          aria-invalid={!!errors.language || undefined}
        >
          {(Object.keys(LANGUAGE_LABELS) as Language[]).map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_LABELS[l]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Paese" htmlFor={f("country")} error={errors.country}>
        <Input
          id={f("country")}
          name="country"
          list={f("countries")}
          maxLength={80}
          defaultValue={initial.country}
          autoComplete="off"
        />
        <datalist id={f("countries")}>
          {countries.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      {type === "CLIENTE" ? (
        <Field
          label="Agente di riferimento"
          htmlFor={f("agentId")}
          error={errors.agentId}
          hint="Lascia vuoto per i clienti direzionali, gestiti direttamente da BGP."
          className="sm:col-span-2"
        >
          <Select
            id={f("agentId")}
            name="agentId"
            defaultValue={initial.agentId ? String(initial.agentId) : ""}
            aria-invalid={!!errors.agentId || undefined}
          >
            <option value="">Nessun agente (cliente direzionale)</option>
            {agentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.active ? "" : " (disattivato)"}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field
        label="Indirizzo predefinito"
        htmlFor={f("defaultAddress")}
        error={errors.defaultAddress}
        hint="Precompila l'indirizzo di destinazione delle nuove richieste."
        className="sm:col-span-2"
      >
        <Textarea
          id={f("defaultAddress")}
          name="defaultAddress"
          rows={3}
          maxLength={1000}
          defaultValue={initial.defaultAddress}
          placeholder="Via, numero civico, CAP, città (provincia), paese"
        />
      </Field>

      <Field label="Note" htmlFor={f("notes")} error={errors.notes} className="sm:col-span-2">
        <Textarea id={f("notes")} name="notes" rows={3} maxLength={5000} defaultValue={initial.notes} />
      </Field>

      <div className="sm:col-span-2">
        <Checkbox
          name="active"
          defaultChecked={initial.active}
          label="Contatto attivo"
          hint="I contatti disattivati non compaiono nella ricerca delle nuove richieste. Lo storico resta disponibile."
        />
      </div>
    </div>
  );
}
