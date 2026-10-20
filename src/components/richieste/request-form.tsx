"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createRequestAction, updateRequestAction } from "@/app/(app)/richieste/actions";
import { COUNTRY_SUGGESTIONS } from "@/components/anagrafiche/constants";
import { ContactPicker } from "@/components/pickers/contact-picker";
import type { ContactOption } from "@/components/pickers/types";
import { ActionMessage, Alert } from "@/components/ui/alert";
import { buttonClasses, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import { bollaRuleReasons, DEFAULT_BOLLA_CONFIG, type BollaRules } from "@/lib/config/bolla";
import { looksLikeCompany } from "@/lib/sample-formats";
import { ContactSummary } from "./contact-summary";
import { ItemsEditor, ItemsReadOnly, itemsToPayload, type ItemRow } from "./items-editor";
import { CONTACT_REVIEW_CONFIRM, contactPrefill, EMPTY_PREFILL, type ContactPrefill } from "./utils";

export type FormContact = ContactOption & { phone?: string | null; company?: string | null; active?: boolean };

export type RequestFormInitial = {
  contact: FormContact | null;
  /** Ragione sociale o cognome e nome del destinatario. */
  recipientName: string;
  /** «Alla c.a. di» (persona presso la ditta destinataria). */
  attentionOf: string;
  /** Solo l'indirizzo (via, CAP, città, provincia), senza il destinatario. */
  destinationAddress: string;
  /** Paese di consegna (precompilato con il paese del contatto). */
  destinationCountry: string;
  /** Preavviso telefonico: null = non ancora indicato (nessuna scelta predefinita). */
  phoneNotice: boolean | null;
  phoneNoticeNumber: string;
  notes: string;
  deliveryFormRequired: boolean;
  /** Colli già indicati dal magazzino (regola «da N colli in su» della bolla); null = non ancora. */
  packagesCount?: number | null;
  /** YYYY-MM-DD */
  receivedDate: string;
  items: ItemRow[];
};

type State = ActionResult | null;
type Errors = Record<string, string>;

const NO_KEYS: ReadonlySet<string> = new Set();
const NO_ERRORS: Errors = {};

/** Una chiave d'errore è nascosta se il campo è stato modificato; "items." copre tutte le righe, "items.2." una sola. */
function isDismissed(key: string, dismissed: Iterable<string>): boolean {
  for (const d of dismissed) if (d === key || (d.endsWith(".") && key.startsWith(d))) return true;
  return false;
}

/** Il valore va (ri)precompilato se è vuoto o è ancora quello precompilato dal contatto precedente. */
function untouched(value: string, previousPrefill: string): boolean {
  return !value.trim() || value === previousPrefill;
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

/** Sì / No senza scelta predefinita: finché non si sceglie la richiesta non può andare al magazzino. */
function PhoneNoticeChoice({
  id,
  value,
  error,
  onChange,
}: {
  id: string;
  value: boolean | null;
  error?: string;
  onChange: (value: boolean) => void;
}) {
  const descId = `${id}-desc`;
  const options: [string, boolean, string][] = [
    ["si", true, "Sì"],
    ["no", false, "No"],
  ];
  return (
    <fieldset className="space-y-1.5" aria-describedby={descId}>
      <legend className="block text-sm font-medium text-slate-700">
        Preavviso telefonico prima della consegna<span className="ml-0.5 text-red-600">*</span>
      </legend>
      <div className="flex gap-2">
        {options.map(([formValue, option, label]) => {
          const checked = value === option;
          return (
            <label
              key={formValue}
              className={cn(
                "inline-flex h-10 min-w-20 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-medium ring-1 ring-inset has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-600",
                checked
                  ? "bg-brand-50 text-brand-900 ring-brand-600"
                  : error
                    ? "bg-white text-slate-700 ring-red-500 hover:bg-slate-50"
                    : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
              )}
            >
              <input
                type="radio"
                name="phoneNotice"
                value={formValue}
                checked={checked}
                onChange={() => onChange(option)}
                data-invalid={error ? true : undefined}
                className="size-4 border-slate-300 text-brand-700 focus:ring-brand-600"
              />
              {label}
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={descId} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : (
        <p id={descId} className="text-xs text-slate-500">
          {value === null
            ? "Nessuna scelta predefinita: chiedilo sempre a chi richiede i campioni."
            : value
              ? "Il corriere telefona al numero indicato prima di consegnare."
              : "Consegna senza preavviso telefonico."}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Form della richiesta (back office): creazione in /richieste/nuova e modifica nel dettaglio.
 * Tutti i campi sono controllati: il form non viene azzerato se il server segnala errori.
 * Destinatario, indirizzo e telefono si precompilano dal contatto finché non vengono modificati a mano.
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
  bollaRules = DEFAULT_BOLLA_CONFIG.rules,
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
  /** Regole della bolla (Impostazioni → Bolla di consegna): il servizio le applica comunque al salvataggio. */
  bollaRules?: BollaRules;
  onCancel?: () => void;
  onSaved?: (message?: string) => void;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [contact, setContact] = useState<FormContact | null>(initial.contact);
  // Ultimi valori precompilati dal contatto: se l'utente non li ha modificati, cambiando contatto si aggiornano.
  const [prefilled, setPrefilled] = useState<ContactPrefill>(
    initial.contact ? contactPrefill(initial.contact) : EMPTY_PREFILL,
  );
  const [recipient, setRecipient] = useState(initial.recipientName);
  const [attentionOf, setAttentionOf] = useState(initial.attentionOf);
  const [destination, setDestination] = useState(initial.destinationAddress);
  const [country, setCountry] = useState(initial.destinationCountry);
  const [phoneNotice, setPhoneNotice] = useState<boolean | null>(initial.phoneNotice);
  const [phoneNumber, setPhoneNumber] = useState(initial.phoneNoticeNumber);
  const [notes, setNotes] = useState(initial.notes);
  const [bolla, setBolla] = useState(initial.deliveryFormRequired);
  const [receivedDate, setReceivedDate] = useState(initial.receivedDate);
  const [items, setItems] = useState<ItemRow[]>(initial.items);
  const [intent, setIntent] = useState<"save" | "send">("save");
  // Dati mancanti per «Salva e invia al magazzino», controllati prima di inviare il form.
  const [sendErrors, setSendErrors] = useState<Errors>(NO_ERRORS);

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
  const errors: Errors = {
    ...Object.fromEntries(Object.entries(serverErrors).filter(([key]) => !isDismissed(key, dismissedKeys))),
    ...sendErrors,
  };
  const allFieldErrorsFixed =
    Boolean(state && !state.ok && state.fieldErrors) &&
    Object.keys(serverErrors).length > 0 &&
    Object.keys(errors).length === 0;
  const showSend = mode === "create" || canSendToWarehouse;
  const sendBlocked = Object.keys(sendErrors).length > 0;
  const attentionHint = looksLikeCompany(recipient) && !attentionOf.trim();
  // Paese lasciato vuoto: il servizio usa quello del contatto (in modifica, a contatto invariato, quello salvato).
  const fallbackCountry =
    mode === "edit" && contact?.id === initial.contact?.id ? initial.destinationCountry : (contact?.country ?? "");
  // Stesse regole del servizio; i colli («da N colli in su») li indica il magazzino più avanti.
  const bollaAutoReasons = bollaRuleReasons(
    {
      destinationCountry: country.trim() || fallbackCountry.trim() || null,
      itemFormats: items.map((i) => i.sampleFormat || null),
      packagesCount: initial.packagesCount ?? null,
    },
    bollaRules,
  );

  function dismiss(...keys: string[]) {
    setSendErrors((prev) => {
      const rest = Object.entries(prev).filter(([key]) => !isDismissed(key, keys));
      return rest.length === Object.keys(prev).length ? prev : rest.length ? Object.fromEntries(rest) : NO_ERRORS;
    });
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
    const prefill = contactPrefill(next);
    const keys = ["contactId"];
    setContact(next);
    if (untouched(recipient, prefilled.recipientName)) {
      setRecipient(prefill.recipientName);
      if (prefill.recipientName) keys.push("recipientName");
    }
    if (untouched(destination, prefilled.destinationAddress)) {
      setDestination(prefill.destinationAddress);
      if (prefill.destinationAddress) keys.push("destinationAddress");
    }
    if (untouched(country, prefilled.country)) {
      setCountry(prefill.country);
      if (prefill.country) keys.push("destinationCountry");
    }
    if (untouched(phoneNumber, prefilled.phone)) {
      setPhoneNumber(prefill.phone);
      if (prefill.phone) keys.push("phoneNoticeNumber");
    }
    setPrefilled(prefill);
    dismiss(...keys);
  }

  function choosePhoneNotice(value: boolean) {
    setPhoneNotice(value);
    dismiss("phoneNotice", ...(value ? [] : ["phoneNoticeNumber"]));
    const contactPhone = contact?.phone?.trim();
    if (value && !phoneNumber.trim() && contactPhone) {
      setPhoneNumber(contactPhone);
      setPrefilled((p) => ({ ...p, phone: contactPhone }));
    }
  }

  /** Stessi controlli del passaggio a «In preparazione» (transitionProblems), riferiti ai campi del form. */
  function missingForSend(): Errors {
    const out: Errors = {};
    if (!contact) out.contactId = "Seleziona il contatto";
    if (!recipient.trim()) out.recipientName = "Indica il destinatario";
    if (!destination.trim()) out.destinationAddress = "Indica l'indirizzo di consegna";
    if (phoneNotice === null) out.phoneNotice = "Indica se serve il preavviso telefonico";
    else if (phoneNotice && !phoneNumber.trim()) out.phoneNoticeNumber = "Indica il numero per il preavviso";
    if (itemsEditable) {
      if (items.length === 0) out.items = "Aggiungi almeno un prodotto";
      items.forEach((row, i) => {
        if (!row.sampleFormat) out[`items.${i}.sampleFormat`] = "Scegli il formato";
        else if (row.sampleFormat === "ALTRO" && !row.formatNote.trim()) {
          out[`items.${i}.formatNote`] = "Descrivi il formato richiesto";
        }
      });
    }
    return out;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const nextIntent = submitter?.value === "send" ? "send" : "save";
    if (nextIntent === "send") {
      const missing = missingForSend();
      if (Object.keys(missing).length > 0) {
        setSendErrors(missing);
        // Dopo il render: porta il focus sul primo campo da completare.
        requestAnimationFrame(() => {
          formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus();
        });
        return;
      }
      if (contact?.needsReview && !window.confirm(CONTACT_REVIEW_CONFIRM)) return;
    }
    setSendErrors(NO_ERRORS);
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
  const contactPhone = contact?.phone?.trim();
  const buttonCls = (variant: ButtonVariant) => buttonClasses(variant, "lg", "w-full sm:w-auto");

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={preventEnterSubmit} noValidate className="space-y-8">
      <input type="hidden" name="contactId" value={contact?.id ?? ""} />
      <input type="hidden" name="items" value={itemsToPayload(items)} />

      <fieldset className="space-y-3">
        <SectionTitle
          title="Contatto"
          description="Chi chiede i campioni e riceve la conferma di spedizione. L'agente di riferimento va in copia."
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
              <p className="text-xs text-slate-500">
                Cerca per nome, azienda, email o città. Destinatario e indirizzo si precompilano dal contatto.
              </p>
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
        <fieldset className="space-y-4">
          <SectionTitle
            title="Destinatario e consegna"
            description="A chi e dove spedire i campioni: servono per inviare la richiesta al magazzino."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Destinatario (ragione sociale o cognome e nome)"
              htmlFor={`${uid}-recipient`}
              required
              error={errors.recipientName}
              hint="Precompilato con il nome del contatto: modificalo se i campioni vanno a un altro destinatario."
            >
              <Input
                id={`${uid}-recipient`}
                name="recipientName"
                maxLength={200}
                autoComplete="off"
                value={recipient}
                aria-invalid={errors.recipientName ? true : undefined}
                onChange={(e) => {
                  dismiss("recipientName");
                  setRecipient(e.target.value);
                }}
              />
            </Field>
            <Field
              label="Alla c.a. di"
              htmlFor={`${uid}-attention`}
              error={errors.attentionOf}
              hint={
                attentionHint ? (
                  <span className="font-medium text-amber-800">
                    Il destinatario sembra una ditta: indica, se possibile, la persona a cui sono destinati i campioni.
                  </span>
                ) : (
                  "Se il destinatario è una ditta: la persona a cui sono destinati i campioni."
                )
              }
            >
              <Input
                id={`${uid}-attention`}
                name="attentionOf"
                maxLength={200}
                autoComplete="off"
                value={attentionOf}
                aria-invalid={errors.attentionOf ? true : undefined}
                onChange={(e) => {
                  dismiss("attentionOf");
                  setAttentionOf(e.target.value);
                }}
              />
            </Field>
          </div>
          <Field
            label="Indirizzo di consegna"
            htmlFor={`${uid}-dest`}
            required
            error={errors.destinationAddress}
            hint="Via e numero civico, CAP, città e provincia. Precompilato dall'indirizzo del contatto."
          >
            <Textarea
              id={`${uid}-dest`}
              name="destinationAddress"
              rows={3}
              required
              maxLength={2000}
              autoComplete="off"
              value={destination}
              aria-invalid={errors.destinationAddress ? true : undefined}
              onChange={(e) => {
                dismiss("destinationAddress");
                setDestination(e.target.value);
              }}
            />
          </Field>
          <Field
            label="Paese di consegna"
            htmlFor={`${uid}-country`}
            error={errors.destinationCountry}
            hint="Precompilato con il paese del contatto: modificalo se i campioni vanno all'estero o in un altro paese."
            className="sm:max-w-sm"
          >
            <Input
              id={`${uid}-country`}
              name="destinationCountry"
              list={`${uid}-countries`}
              maxLength={60}
              autoComplete="off"
              placeholder={fallbackCountry || "Es. Italia"}
              value={country}
              aria-invalid={errors.destinationCountry ? true : undefined}
              onChange={(e) => {
                dismiss("destinationCountry");
                setCountry(e.target.value);
              }}
            />
            <datalist id={`${uid}-countries`}>
              {COUNTRY_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <PhoneNoticeChoice
              id={`${uid}-notice`}
              value={phoneNotice}
              error={errors.phoneNotice}
              onChange={choosePhoneNotice}
            />
            {phoneNotice ? (
              <Field
                label="Numero per il preavviso"
                htmlFor={`${uid}-notice-number`}
                required
                error={errors.phoneNoticeNumber}
                hint={
                  contactPhone && phoneNumber.trim() === contactPhone
                    ? "Telefono del contatto: modificalo se il corriere deve chiamare un altro numero."
                    : "Il numero che il corriere deve chiamare prima della consegna."
                }
              >
                <Input
                  id={`${uid}-notice-number`}
                  name="phoneNoticeNumber"
                  type="tel"
                  inputMode="tel"
                  maxLength={50}
                  autoComplete="off"
                  value={phoneNumber}
                  aria-invalid={errors.phoneNoticeNumber ? true : undefined}
                  onChange={(e) => {
                    dismiss("phoneNoticeNumber");
                    setPhoneNumber(e.target.value);
                  }}
                />
              </Field>
            ) : null}
          </div>
        </fieldset>
      </div>

      <div className="border-t border-slate-100 pt-6">
        <fieldset className="space-y-3">
          <SectionTitle
            title="Prodotti richiesti"
            description="Per ogni prodotto: quantità e formato del campione (doghe intere, mezze doghe, mazzetta, pannello, espositore…)."
          />
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
          <SectionTitle title="Altre informazioni" />
          {bollaAutoReasons.length > 0 ? (
            <>
              {/* La casella disattivata non viene inviata: il valore va comunque al servizio, che applica le regole. */}
              <input type="hidden" name="deliveryFormRequired" value="on" />
              <Checkbox
                checked
                disabled
                readOnly
                label="Bolla di consegna richiesta"
                hint={
                  <span className="font-medium text-amber-800">
                    Richiesta automaticamente: {bollaAutoReasons.join(", ")}.
                  </span>
                }
              />
            </>
          ) : (
            <Checkbox
              name="deliveryFormRequired"
              checked={bolla}
              onChange={(e) => setBolla(e.target.checked)}
              label="Bolla di consegna richiesta"
              hint={
                bollaRules.minPackages
                  ? `La logistica deve preparare una bolla di consegna formale prima del ritiro. Diventa obbligatoria in automatico da ${bollaRules.minPackages} colli in su (li indica il magazzino).`
                  : "La logistica deve preparare una bolla di consegna formale prima del ritiro."
              }
            />
          )}
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
        {sendBlocked ? (
          <Alert tone="warning" title="Per inviare al magazzino mancano dei dati">
            Completa i campi evidenziati. Con «{mode === "edit" ? "Salva modifiche" : "Salva"}» puoi salvare la richiesta
            così com&apos;è e completarla dopo.
          </Alert>
        ) : allFieldErrorsFixed ? null : (
          <ActionMessage state={state} />
        )}
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
