"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { createRequestAction, updateRequestAction } from "@/app/(app)/richieste/actions";
import { ContactPicker } from "@/components/pickers/contact-picker";
import type { ContactOption } from "@/components/pickers/types";
import { ActionMessage } from "@/components/ui/alert";
import { buttonClasses, type ButtonVariant } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import { ContactSummary } from "./contact-summary";
import { ItemsEditor, ItemsReadOnly, itemsToPayload, type ItemRow } from "./items-editor";

export type FormContact = ContactOption & { phone?: string | null; company?: string | null; active?: boolean };

export type RequestFormInitial = {
  contact: FormContact | null;
  destinationAddress: string;
  notes: string;
  deliveryFormRequired: boolean;
  /** YYYY-MM-DD */
  receivedDate: string;
  items: ItemRow[];
};

type State = ActionResult | null;

function addressFor(c: FormContact): string {
  return [c.name, c.defaultAddress?.trim()].filter(Boolean).join("\n");
}

function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />;
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <>
      <legend className="text-base font-semibold text-slate-900">{title}</legend>
      {description ? <p className="-mt-2 text-sm text-slate-500">{description}</p> : null}
    </>
  );
}

/**
 * Form della richiesta (back office): creazione in /richieste/nuova e modifica nel dettaglio.
 * Tutti i campi sono controllati: il form non viene azzerato se il server segnala errori.
 */
export function RequestForm({
  mode,
  requestId,
  initial,
  today,
  itemsEditable = true,
  itemsLockedReason,
  newContactHref,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  requestId?: number;
  initial: RequestFormInitial;
  /** Data odierna (fuso di Roma) calcolata dal server. */
  today: string;
  itemsEditable?: boolean;
  itemsLockedReason?: string;
  newContactHref?: string;
  onCancel?: () => void;
  onSaved?: (message?: string) => void;
}) {
  const uid = useId();
  const [contact, setContact] = useState<FormContact | null>(initial.contact);
  const [destination, setDestination] = useState(initial.destinationAddress);
  // Ultimo indirizzo precompilato: se l'utente non l'ha modificato, cambiando contatto lo aggiorniamo.
  const [autoAddress, setAutoAddress] = useState(initial.contact ? addressFor(initial.contact) : "");
  const [notes, setNotes] = useState(initial.notes);
  const [bolla, setBolla] = useState(initial.deliveryFormRequired);
  const [receivedDate, setReceivedDate] = useState(initial.receivedDate);
  const [items, setItems] = useState<ItemRow[]>(initial.items);
  const [intent, setIntent] = useState<"save" | "send">("save");

  const [state, dispatch, pending] = useActionState<State, FormData>(async (prev, formData) => {
    if (mode === "create") return createRequestAction(prev, formData);
    const res = await updateRequestAction(requestId ?? 0, prev, formData);
    if (res?.ok) onSaved?.(res.message);
    return res;
  }, null);
  const errors = (state && !state.ok ? state.fieldErrors : undefined) ?? {};

  function selectContact(c: ContactOption) {
    const next: FormContact = { ...c };
    setContact(next);
    const prefill = addressFor(next);
    if (!destination.trim() || destination === autoAddress) setDestination(prefill);
    setAutoAddress(prefill);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const nextIntent = submitter?.value === "send" ? "send" : "save";
    const formData = new FormData(e.currentTarget);
    formData.set("intent", nextIntent);
    // In modifica la data di ricezione si invia solo se cambiata (altrimenti l'ora originale resta).
    if (mode === "edit" && receivedDate === initial.receivedDate) formData.delete("receivedAt");
    setIntent(nextIntent);
    startTransition(() => dispatch(formData));
  }

  // Invio con Enter nei campi di ricerca: non deve salvare il form.
  function preventEnterSubmit(e: KeyboardEvent<HTMLFormElement>) {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && t instanceof HTMLInputElement && t.type !== "submit" && t.type !== "checkbox") {
      e.preventDefault();
    }
  }

  const contactPickerId = `${uid}-contact`;
  const buttonCls = (variant: ButtonVariant) => buttonClasses(variant, "lg", "w-full sm:w-auto");

  return (
    <form onSubmit={handleSubmit} onKeyDown={preventEnterSubmit} noValidate className="space-y-8">
      <input type="hidden" name="contactId" value={contact?.id ?? ""} />
      <input type="hidden" name="items" value={itemsToPayload(items)} />

      <fieldset className="space-y-3">
        <SectionTitle
          title="Contatto"
          description="Chi riceve i campioni e la conferma di spedizione. L'agente di riferimento va in copia."
        />
        {contact ? (
          <div className="space-y-2">
            <ContactSummary contact={contact} />
            {errors.contactId ? (
              <p className="text-sm text-red-600" role="alert">
                {errors.contactId}
              </p>
            ) : null}
            <button
              type="button"
              className="text-sm font-medium text-brand-700 hover:underline"
              onClick={() => setContact(null)}
            >
              Cambia contatto
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={contactPickerId} className="block text-sm font-medium text-slate-700">
              Cerca contatto<span className="ml-0.5 text-red-600">*</span>
            </label>
            <ContactPicker id={contactPickerId} onSelect={selectContact} invalid={Boolean(errors.contactId)} />
            {errors.contactId ? (
              <p className="text-sm text-red-600" role="alert">
                {errors.contactId}
              </p>
            ) : (
              <p className="text-xs text-slate-500">Cerca per nome, azienda, email o città.</p>
            )}
            {initial.contact ? (
              <button
                type="button"
                className="text-sm font-medium text-slate-600 hover:underline"
                onClick={() => setContact(initial.contact)}
              >
                Annulla cambio contatto
              </button>
            ) : null}
          </div>
        )}
        {newContactHref ? (
          <p className="text-sm text-slate-600">
            Il contatto non c&apos;è?{" "}
            <Link href={newContactHref} className="font-medium text-brand-700 hover:underline">
              + Nuovo contatto
            </Link>{" "}
            <span className="text-slate-500">(dopo il salvataggio torni qui con il contatto già selezionato)</span>
          </p>
        ) : null}
      </fieldset>

      <div className="border-t border-slate-100 pt-6">
        <fieldset className="space-y-3">
          <SectionTitle title="Prodotti richiesti" description="Uno o più prodotti, con la quantità di campioni per ciascuno." />
          {itemsEditable ? (
            <ItemsEditor items={items} onChange={setItems} errors={errors} />
          ) : (
            <ItemsReadOnly
              items={items}
              reason={itemsLockedReason ?? "I prodotti non sono più modificabili in questo stato."}
            />
          )}
        </fieldset>
      </div>

      <div className="border-t border-slate-100 pt-6">
        <fieldset className="space-y-4">
          <SectionTitle title="Spedizione" />
          <Field
            label="Indirizzo di destinazione"
            htmlFor={`${uid}-dest`}
            required
            error={errors.destinationAddress}
            hint="Precompilato dall'indirizzo del contatto: modificalo se i campioni vanno altrove."
          >
            <Textarea
              id={`${uid}-dest`}
              name="destinationAddress"
              rows={4}
              required
              maxLength={2000}
              value={destination}
              aria-invalid={errors.destinationAddress ? true : undefined}
              onChange={(e) => setDestination(e.target.value)}
            />
          </Field>
          <Checkbox
            name="deliveryFormRequired"
            checked={bolla}
            onChange={(e) => setBolla(e.target.checked)}
            label="Bolla di consegna richiesta"
            hint="La logistica deve preparare una bolla di consegna formale prima del ritiro."
          />
          <Field label="Note" htmlFor={`${uid}-notes`} error={errors.notes} hint="Visibili a magazzino e logistica.">
            <Textarea
              id={`${uid}-notes`}
              name="notes"
              rows={3}
              maxLength={5000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Field
            label="Data di ricezione"
            htmlFor={`${uid}-received`}
            error={errors.receivedAt}
            hint="Cambiala se la richiesta è arrivata (per telefono o email) in un giorno precedente."
            className="max-w-xs"
          >
            <Input
              id={`${uid}-received`}
              name="receivedAt"
              type="date"
              max={today}
              value={receivedDate}
              aria-invalid={errors.receivedAt ? true : undefined}
              onChange={(e) => setReceivedDate(e.target.value)}
            />
          </Field>
        </fieldset>
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-6">
        <ActionMessage state={state} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {mode === "edit" ? (
            <>
              {onCancel ? (
                <button type="button" className={buttonCls("ghost")} onClick={onCancel} disabled={pending}>
                  Annulla
                </button>
              ) : null}
              <button type="submit" name="intent" value="save" className={buttonCls("primary")} disabled={pending} aria-busy={pending}>
                {pending ? <Spinner /> : null}
                {pending ? "Salvataggio…" : "Salva modifiche"}
              </button>
            </>
          ) : (
            <>
              <button
                type="submit"
                name="intent"
                value="save"
                className={buttonCls("secondary")}
                disabled={pending}
                aria-busy={pending && intent === "save"}
              >
                {pending && intent === "save" ? <Spinner /> : null}
                Salva
              </button>
              <button
                type="submit"
                name="intent"
                value="send"
                className={buttonCls("primary")}
                disabled={pending}
                aria-busy={pending && intent === "send"}
              >
                {pending && intent === "send" ? <Spinner /> : null}
                Salva e invia al magazzino
              </button>
            </>
          )}
        </div>
        {mode === "create" ? (
          <p className="text-right text-xs text-slate-500">
            «Salva e invia al magazzino» passa la richiesta a «In preparazione» e avvisa il magazzino via email.
          </p>
        ) : null}
      </div>
    </form>
  );
}
