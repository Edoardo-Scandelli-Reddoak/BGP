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
import { CONTACT_REVIEW_CONFIRM } from "./utils";

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

const NO_KEYS: ReadonlySet<string> = new Set();

/** Una chiave d'errore è nascosta se il campo è stato modificato; "items." copre tutte le righe, "items.2." una sola. */
function isDismissed(key: string, dismissed: ReadonlySet<string>): boolean {
  if (dismissed.has(key)) return true;
  for (const d of dismissed) if (d.endsWith(".") && key.startsWith(d)) return true;
  return false;
}

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
  canSendToWarehouse = false,
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
  /** Solo in modifica: offre «Salva e invia al magazzino» (richiesta ancora nuova). */
  canSendToWarehouse?: boolean;
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
  // Gli errori del server restano finché il campo non viene corretto: modificandolo il messaggio sparisce.
  const [dismissed, setDismissed] = useState<{ state: State; keys: ReadonlySet<string> }>({ state: null, keys: NO_KEYS });
  const dismissedKeys = dismissed.state === state ? dismissed.keys : NO_KEYS;
  const serverErrors = (state && !state.ok ? state.fieldErrors : undefined) ?? {};
  const errors = Object.fromEntries(Object.entries(serverErrors).filter(([key]) => !isDismissed(key, dismissedKeys)));
  const allFieldErrorsFixed =
    Boolean(state && !state.ok && state.fieldErrors) && Object.keys(serverErrors).length > 0 && Object.keys(errors).length === 0;
  const showSend = mode === "create" || canSendToWarehouse;

  function dismiss(...keys: string[]) {
    if (!state || state.ok) return;
    setDismissed((d) => ({ state, keys: new Set([...(d.state === state ? d.keys : []), ...keys]) }));
  }

  function changeItems(next: ItemRow[]) {
    const keys = ["items"];
    // Righe aggiunte o tolte: gli indici cambiano, quindi si nascondono gli errori di tutte le righe.
    if (next.length !== items.length) keys.push("items.");
    else
      next.forEach((row, i) => {
        if (row !== items[i]) keys.push(`items.${i}.`);
      });
    dismiss(...keys);
    setItems(next);
  }

  function selectContact(c: ContactOption) {
    const next: FormContact = { ...c };
    dismiss("contactId");
    setContact(next);
    const prefill = addressFor(next);
    if (!destination.trim() || destination === autoAddress) {
      setDestination(prefill);
      if (prefill.trim()) dismiss("destinationAddress");
    }
    setAutoAddress(prefill);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const nextIntent = submitter?.value === "send" ? "send" : "save";
    if (nextIntent === "send" && contact?.needsReview && !window.confirm(CONTACT_REVIEW_CONFIRM)) return;
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
            <ItemsEditor items={items} onChange={changeItems} errors={errors} />
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
              onChange={(e) => {
                dismiss("destinationAddress");
                setDestination(e.target.value);
              }}
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
              aria-invalid={errors.notes ? true : undefined}
              onChange={(e) => {
                dismiss("notes");
                setNotes(e.target.value);
              }}
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
              onChange={(e) => {
                dismiss("receivedAt");
                setReceivedDate(e.target.value);
              }}
            />
          </Field>
        </fieldset>
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-6">
        {allFieldErrorsFixed ? null : <ActionMessage state={state} />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {mode === "edit" && onCancel ? (
            <button type="button" className={buttonCls("ghost")} onClick={onCancel} disabled={pending}>
              Annulla
            </button>
          ) : null}
          <button
            type="submit"
            name="intent"
            value="save"
            className={buttonCls(showSend ? "secondary" : "primary")}
            disabled={pending}
            aria-busy={pending && intent === "save"}
          >
            {pending && intent === "save" ? <Spinner /> : null}
            {mode === "edit" ? (pending && intent === "save" ? "Salvataggio…" : "Salva modifiche") : "Salva"}
          </button>
          {showSend ? (
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
          ) : null}
        </div>
        {showSend ? (
          <p className="text-right text-xs text-slate-500">
            «Salva e invia al magazzino» passa la richiesta a «In preparazione» e avvisa il magazzino via email.
          </p>
        ) : null}
      </div>
    </form>
  );
}
