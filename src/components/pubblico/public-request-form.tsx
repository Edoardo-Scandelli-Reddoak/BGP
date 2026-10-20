"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { submitPublicRequest } from "@/app/richiedi-campioni/actions";
import { COUNTRY_SUGGESTIONS } from "@/components/anagrafiche/constants";
import { PendingButton, useFormAction } from "@/components/impostazioni/form-kit";
import { ProductPicker } from "@/components/pickers/product-picker";
import type { ProductOption } from "@/components/pickers/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { PublicRequestResult } from "@/lib/requests/public";
import {
  looksLikeCompany,
  SAMPLE_FORMAT_LABELS,
  SAMPLE_FORMATS,
  suggestSampleFormat,
  type SampleFormat,
} from "@/lib/sample-formats";

type RequesterType = "AGENTE" | "CLIENTE";
type YesNo = "SI" | "NO";
/** Riga dell'elenco prodotti: lo stesso prodotto può comparire in più formati. */
type Item = { key: number; product: ProductOption; quantity: number; sampleFormat: SampleFormat | ""; formatNote: string };

const LANGUAGES: { value: string; label: string }[] = [
  { value: "it", label: "Italiano" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

const TEXT_FIELD = "h-12 text-base sm:h-10 sm:text-sm";

/** Contenitore: dopo l'invio permette di compilare una nuova richiesta da zero. */
export function PublicRequestSection({
  maxProducts,
  maxQuantity,
  formToken,
}: {
  maxProducts: number;
  maxQuantity: number;
  formToken: string;
}) {
  const [round, setRound] = useState(0);
  return (
    <PublicRequestForm
      key={round}
      maxProducts={maxProducts}
      maxQuantity={maxQuantity}
      formToken={formToken}
      onNewRequest={() => setRound((r) => r + 1)}
    />
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Required() {
  return <span className="ml-0.5 text-red-600">*</span>;
}

/** Scelta a schede (radio) usata per «Chi sei?» e per il preavviso telefonico. */
function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  label,
  hint,
  invalid,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
  invalid?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl p-4 ring-2 ring-inset transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600",
        checked
          ? "bg-brand-50 ring-brand-600"
          : invalid
            ? "bg-white ring-red-300 hover:ring-red-400"
            : "bg-white ring-slate-200 hover:ring-slate-300",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        required
        className="mt-0.5 size-5 text-brand-700 focus:ring-brand-600"
      />
      <span>
        <span className="block font-semibold text-slate-900">{label}</span>
        {hint ? <span className="block text-sm text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

function PublicRequestForm({
  maxProducts,
  maxQuantity,
  formToken,
  onNewRequest,
}: {
  maxProducts: number;
  maxQuantity: number;
  formToken: string;
  onNewRequest: () => void;
}) {
  const router = useRouter();
  const { state, pending, onSubmit, fieldError } = useFormAction<PublicRequestResult>(submitPublicRequest);
  const [type, setType] = useState<RequesterType | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [requesterPhone, setRequesterPhone] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  // Conservato anche se si spunta «privato» e poi si toglie la spunta.
  const [attentionOf, setAttentionOf] = useState("");
  const [phoneNotice, setPhoneNotice] = useState<YesNo | null>(null);
  /** null = non modificato: per il cliente propone il telefono indicato nei suoi dati. */
  const [noticeNumber, setNoticeNumber] = useState<string | null>(null);
  const nextKey = useRef(1);
  const errorRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Dopo l'invio porta in vista l'esito (su telefono il pulsante è in fondo alla pagina).
  useEffect(() => {
    if (!state) return;
    if (state.ok) topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else errorRef.current?.focus();
    // Gettone scaduto (pagina aperta da più di un giorno): nuovo gettone senza perdere i dati inseriti.
    if (!state.ok && state.fieldErrors?.formToken) router.refresh();
  }, [state, router]);

  if (state?.ok) {
    return (
      <div ref={topRef} className="scroll-mt-4">
        <ThankYou result={state.data} onNewRequest={onNewRequest} />
      </div>
    );
  }

  function addProduct(product: ProductOption) {
    const suggested = suggestSampleFormat(product.code, product.description);
    const rows = items.filter((i) => i.product.id === product.id);
    // Già in elenco nel formato proposto (o ancora senza formato): un pezzo in più su quella riga.
    // Altrimenti una nuova riga, per richiedere lo stesso prodotto in un altro formato.
    const same = rows.find((i) => i.sampleFormat === (suggested ?? ""));
    if (same) {
      const quantity = Math.min(maxQuantity, same.quantity + 1);
      setItems(items.map((i) => (i.key === same.key ? { ...i, quantity } : i)));
      setNotice(`${product.code} era già nell'elenco: quantità portata a ${quantity}.`);
      return;
    }
    if (items.length >= maxProducts) {
      setNotice(`Puoi richiedere al massimo ${maxProducts} prodotti in una richiesta.`);
      return;
    }
    const key = nextKey.current++;
    setItems([...items, { key, product, quantity: 1, sampleFormat: suggested ?? "", formatNote: "" }]);
    setNotice(
      rows.length > 0
        ? `${product.code} è già nell'elenco: abbiamo aggiunto una riga per richiederlo in un altro formato. Per più pezzi nello stesso formato usa la quantità.`
        : null,
    );
  }

  function updateItem(key: number, patch: Partial<Omit<Item, "key" | "product">>) {
    setItems(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function setQuantity(key: number, quantity: number) {
    updateItem(key, { quantity: Math.max(1, Math.min(maxQuantity, Math.round(quantity) || 1)) });
  }

  const isAgent = type === "AGENTE";
  const totalPieces = items.reduce((sum, i) => sum + i.quantity, 0);
  const err = (name: string) => fieldError(name);
  const invalid = (name: string) => (fieldError(name) ? true : undefined);
  const companyButPrivate = isPrivate && looksLikeCompany(recipientName);
  // Il cliente riceve i campioni: proponiamo il suo telefono. Per l'agente serve quello del cliente.
  const noticeNumberValue = noticeNumber ?? (type === "CLIENTE" ? requesterPhone : "");

  return (
    <form onSubmit={onSubmit} className="relative space-y-5">
      {state && !state.ok ? (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <Alert tone="error" title="Non è stato possibile inviare la richiesta">
            {state.error}
          </Alert>
        </div>
      ) : null}

      <Section title="Chi sei?">
        <fieldset>
          <legend className="sr-only">Chi sei?</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ChoiceCard
              name="requesterType"
              value="AGENTE"
              checked={type === "AGENTE"}
              onChange={() => setType("AGENTE")}
              label="Agente BGP"
              hint="Richiedo i campioni per un mio cliente."
              invalid={!!err("requesterType")}
            />
            <ChoiceCard
              name="requesterType"
              value="CLIENTE"
              checked={type === "CLIENTE"}
              onChange={() => setType("CLIENTE")}
              label="Cliente"
              hint="Richiedo i campioni per la mia azienda o per me."
              invalid={!!err("requesterType")}
            />
          </div>
          {err("requesterType") ? (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {err("requesterType")}
            </p>
          ) : null}
        </fieldset>
      </Section>

      <Section title="I tuoi dati" description="Ti contatteremo solo per questa richiesta.">
        <Field label="Nome e cognome" htmlFor="requesterName" required error={err("requesterName")}>
          <Input
            id="requesterName"
            name="requesterName"
            required
            maxLength={120}
            autoComplete="name"
            className={TEXT_FIELD}
            aria-invalid={invalid("requesterName")}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Email"
            htmlFor="requesterEmail"
            required
            error={err("requesterEmail")}
            hint={isAgent ? "Usa l'email con cui sei registrato come agente BGP." : undefined}
          >
            <Input
              id="requesterEmail"
              name="requesterEmail"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              inputMode="email"
              className={TEXT_FIELD}
              aria-invalid={invalid("requesterEmail")}
            />
          </Field>
          <Field label="Telefono" htmlFor="requesterPhone" error={err("requesterPhone")} hint="Facoltativo.">
            <Input
              id="requesterPhone"
              name="requesterPhone"
              type="tel"
              maxLength={40}
              autoComplete="tel"
              inputMode="tel"
              value={requesterPhone}
              onChange={(e) => setRequesterPhone(e.target.value)}
              className={TEXT_FIELD}
              aria-invalid={invalid("requesterPhone")}
            />
          </Field>
        </div>
      </Section>

      {type ? (
        <Section
          title="Destinatario e indirizzo di consegna"
          description={
            isAgent
              ? "Il cliente a cui spediremo i campioni: questi dati compaiono sulla bolla e sul pacco."
              : "A chi e dove spediremo i campioni: questi dati compaiono sulla bolla e sul pacco."
          }
        >
          <Field
            label="Destinatario: ragione sociale della ditta o cognome e nome"
            htmlFor="recipientName"
            required
            error={err("recipientName")}
          >
            <Input
              id="recipientName"
              name="recipientName"
              required
              maxLength={200}
              autoComplete={isAgent ? "off" : "organization"}
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Es. Rossi Arredamenti S.r.l. oppure Bianchi Mario"
              className={TEXT_FIELD}
              aria-invalid={invalid("recipientName")}
            />
          </Field>
          <div className="space-y-2">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="recipientIsPrivate"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              />
              <span>
                <span className="font-medium text-slate-800">Il destinatario è un privato</span>
                <span className="block text-slate-500">Spunta se spediamo a una persona e non a una ditta.</span>
              </span>
            </label>
            {companyButPrivate ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200" role="status">
                «{recipientName.trim()}» sembra una ditta: se è così, togli la spunta e indica la persona a cui sono
                destinati i campioni.
              </p>
            ) : null}
          </div>
          {!isPrivate ? (
            <Field
              label="Alla c.a. di"
              htmlFor="attentionOf"
              required
              error={err("attentionOf")}
              hint="Nome e cognome della persona a cui sono destinati i campioni."
            >
              <Input
                id="attentionOf"
                name="attentionOf"
                required
                maxLength={200}
                autoComplete={isAgent ? "off" : "name"}
                value={attentionOf}
                onChange={(e) => setAttentionOf(e.target.value)}
                className={TEXT_FIELD}
                aria-invalid={invalid("attentionOf")}
              />
            </Field>
          ) : null}
          {isAgent ? (
            <Field
              label="Email del cliente"
              htmlFor="recipientEmail"
              error={err("recipientEmail")}
              hint="Facoltativa: il cliente riceverà la conferma di spedizione con il numero di tracking."
            >
              <Input
                id="recipientEmail"
                name="recipientEmail"
                type="email"
                maxLength={200}
                autoComplete="off"
                inputMode="email"
                className={TEXT_FIELD}
                aria-invalid={invalid("recipientEmail")}
              />
            </Field>
          ) : null}
          <Field
            label="Indirizzo di consegna"
            htmlFor="address"
            required
            error={err("address")}
            hint="Via e numero civico, CAP, città e provincia. Per l'estero indica anche il paese qui sotto."
          >
            <Textarea
              id="address"
              name="address"
              required
              rows={3}
              maxLength={1000}
              autoComplete={isAgent ? "off" : "street-address"}
              placeholder={"Via Roma 12\n24023 Clusone (BG)"}
              className="text-base sm:text-sm"
              aria-invalid={invalid("address")}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Paese di consegna"
              htmlFor="country"
              error={err("country")}
              required
              hint="Cambialo se la consegna è all'estero."
            >
              <Input
                id="country"
                name="country"
                maxLength={80}
                defaultValue="Italia"
                required
                list="country-suggestions"
                autoComplete={isAgent ? "off" : "country-name"}
                className={TEXT_FIELD}
                aria-invalid={invalid("country")}
              />
              <datalist id="country-suggestions">
                {COUNTRY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field
              label={isAgent ? "Lingua del cliente" : "Lingua preferita"}
              htmlFor="language"
              required
              error={err("language")}
              hint="Lingua dell'email di conferma della spedizione."
            >
              <Select id="language" name="language" defaultValue="it" className={TEXT_FIELD} aria-invalid={invalid("language")}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 px-5 py-6 text-center text-sm text-slate-500">
          Scegli «Agente BGP» o «Cliente» per indicare a chi spedire i campioni.
        </p>
      )}

      <Section
        title="Prodotti"
        description={`Cerca per codice o descrizione e indica per ciascuno formato e quantità. Fino a ${maxProducts} prodotti, massimo ${maxQuantity} pezzi ciascuno.`}
      >
        <input
          type="hidden"
          name="items"
          value={JSON.stringify(
            items.map((i) => ({
              productId: i.product.id,
              quantity: i.quantity,
              sampleFormat: i.sampleFormat,
              formatNote: i.sampleFormat === "ALTRO" ? i.formatNote : "",
            })),
          )}
        />
        {/* Invio nella ricerca prodotti: sceglie un risultato, non invia il modulo. */}
        <div
          className="space-y-1.5"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).id === "product-search") e.preventDefault();
          }}
        >
          <label htmlFor="product-search" className="block text-sm font-medium text-slate-700">
            Aggiungi un prodotto (codice)
            <Required />
          </label>
          <ProductPicker
            id="product-search"
            publicMode
            onSelect={addProduct}
            invalid={!!err("items") && items.length === 0}
            placeholder="Es. rovere spazzolato, oppure il codice articolo"
          />
          {notice ? (
            <p className="text-sm text-amber-700" aria-live="polite">
              {notice}
            </p>
          ) : null}
          {err("items") ? (
            <p className="text-sm text-red-600" role="alert">
              {err("items")}
            </p>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Nessun prodotto aggiunto. Scrivi almeno due lettere per cercare.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {items.map((item, index) => {
              const formatId = `item-${item.key}-format`;
              const noteId = `item-${item.key}-note`;
              const qtyId = `item-${item.key}-qty`;
              const formatError = err(`items.${index}.sampleFormat`);
              const noteError = err(`items.${index}.formatNote`);
              const rowError = err(`items.${index}.quantity`) ?? err(`items.${index}.productId`);
              return (
                <li key={item.key} className="space-y-3 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-brand-800">{item.product.code}</p>
                      <p className="text-sm text-slate-700">{item.product.description}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-mr-2 h-11 shrink-0 text-red-700 hover:bg-red-50 sm:h-8"
                      aria-label={`Rimuovi ${item.product.code}`}
                      onClick={() => {
                        setItems(items.filter((i) => i.key !== item.key));
                        setNotice(null);
                      }}
                    >
                      Rimuovi
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="space-y-1">
                      <label htmlFor={formatId} className="block text-xs font-medium text-slate-600">
                        Formato del campione
                        <Required />
                      </label>
                      <Select
                        id={formatId}
                        required
                        value={item.sampleFormat}
                        onChange={(e) => updateItem(item.key, { sampleFormat: e.target.value as SampleFormat | "" })}
                        className={TEXT_FIELD}
                        aria-invalid={formatError ? true : undefined}
                        aria-describedby={formatError ? `${formatId}-err` : undefined}
                      >
                        <option value="">Scegli il formato…</option>
                        {SAMPLE_FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {SAMPLE_FORMAT_LABELS[f]}
                          </option>
                        ))}
                      </Select>
                      {formatError ? (
                        <p id={`${formatId}-err`} className="text-sm text-red-600">
                          {formatError}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={qtyId} className="block text-xs font-medium text-slate-600">
                        Quantità
                        <Required />
                      </label>
                      <div className="flex items-center">
                        <button
                          type="button"
                          onClick={() => setQuantity(item.key, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          className="flex size-12 items-center justify-center rounded-l-lg bg-white text-lg font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-300 sm:size-10"
                          aria-label={`Diminuisci quantità di ${item.product.code}`}
                        >
                          −
                        </button>
                        <input
                          id={qtyId}
                          type="number"
                          inputMode="numeric"
                          required
                          min={1}
                          max={maxQuantity}
                          value={item.quantity}
                          onChange={(e) => setQuantity(item.key, Number(e.target.value))}
                          aria-invalid={rowError ? true : undefined}
                          className="h-12 w-16 border-0 text-center text-base font-semibold ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600 sm:h-10 sm:text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setQuantity(item.key, item.quantity + 1)}
                          disabled={item.quantity >= maxQuantity}
                          className="flex size-12 items-center justify-center rounded-r-lg bg-white text-lg font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-300 sm:size-10"
                          aria-label={`Aumenta quantità di ${item.product.code}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                  {item.sampleFormat === "ALTRO" ? (
                    <div className="space-y-1">
                      <label htmlFor={noteId} className="block text-xs font-medium text-slate-600">
                        Dettaglio formato
                        <Required />
                      </label>
                      <Input
                        id={noteId}
                        required
                        maxLength={200}
                        value={item.formatNote}
                        onChange={(e) => updateItem(item.key, { formatNote: e.target.value })}
                        placeholder="Es. campione tagliato 30 × 20 cm"
                        className={TEXT_FIELD}
                        aria-invalid={noteError ? true : undefined}
                        aria-describedby={noteError ? `${noteId}-err` : undefined}
                      />
                      {noteError ? (
                        <p id={`${noteId}-err`} className="text-sm text-red-600">
                          {noteError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {rowError ? <p className="text-sm text-red-600">{rowError}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
        {items.length > 0 ? (
          <p className="text-xs text-slate-500">
            {items.length} prodott{items.length === 1 ? "o" : "i"} su {maxProducts} ·{" "}
            {totalPieces} {totalPieces === 1 ? "pezzo" : "pezzi"} in totale
          </p>
        ) : null}
      </Section>

      <Section title="Preavviso telefonico" description="Il corriere può telefonare prima della consegna per concordarla.">
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">
            Serve il preavviso telefonico prima della consegna?
            <Required />
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ChoiceCard
              name="phoneNotice"
              value="SI"
              checked={phoneNotice === "SI"}
              onChange={() => setPhoneNotice("SI")}
              label="Sì"
              hint="Il corriere telefona prima di consegnare."
              invalid={!!err("phoneNotice")}
            />
            <ChoiceCard
              name="phoneNotice"
              value="NO"
              checked={phoneNotice === "NO"}
              onChange={() => setPhoneNotice("NO")}
              label="No"
              hint="Consegna senza preavviso."
              invalid={!!err("phoneNotice")}
            />
          </div>
          {err("phoneNotice") ? (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {err("phoneNotice")}
            </p>
          ) : null}
        </fieldset>
        {phoneNotice === "SI" ? (
          <Field
            label="Numero di telefono per il preavviso"
            htmlFor="phoneNoticeNumber"
            required
            error={err("phoneNoticeNumber")}
            hint={
              isAgent
                ? "Il numero del cliente o della persona che riceverà i campioni: il corriere chiamerà questo numero."
                : "Il numero che il corriere chiamerà prima della consegna."
            }
          >
            <Input
              id="phoneNoticeNumber"
              name="phoneNoticeNumber"
              type="tel"
              required
              maxLength={40}
              autoComplete={isAgent ? "off" : "tel"}
              inputMode="tel"
              value={noticeNumberValue}
              onChange={(e) => setNoticeNumber(e.target.value)}
              className={TEXT_FIELD}
              aria-invalid={invalid("phoneNoticeNumber")}
            />
          </Field>
        ) : null}
      </Section>

      <Section title="Note">
        <Field
          label="Note per il nostro ufficio"
          htmlFor="notes"
          error={err("notes")}
          hint="Facoltative: progetto, finiture preferite, orari di consegna…"
        >
          <Textarea id="notes" name="notes" rows={3} maxLength={3000} className="text-base sm:text-sm" aria-invalid={invalid("notes")} />
        </Field>
      </Section>

      <input type="hidden" name="formToken" value={formToken} />
      {/* Campo trappola per i bot: nascosto alle persone e alle tecnologie assistive. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-0 h-px w-px overflow-hidden">
        <label htmlFor="website">Sito web (lascia vuoto)</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="consent"
            required
            aria-invalid={invalid("consent")}
            className="mt-0.5 size-5 shrink-0 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
          />
          <span className="text-slate-700">
            Acconsento al trattamento dei dati inseriti da parte di BGP Group S.r.l. per gestire questa richiesta e la
            spedizione dei campioni, nel rispetto del Regolamento UE 2016/679 (GDPR).
            <Required />
          </span>
        </label>
        {err("consent") ? (
          <p className="text-sm text-red-600" role="alert">
            {err("consent")}
          </p>
        ) : null}
        <PendingButton pending={pending} size="lg" className="w-full" pendingText="Invio in corso…">
          Invia la richiesta
        </PendingButton>
        <p className="text-center text-xs text-slate-500">I campi con * sono obbligatori.</p>
      </div>
    </form>
  );
}

function ThankYou({ result, onNewRequest }: { result?: PublicRequestResult; onNewRequest: () => void }) {
  return (
    <section
      className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200 sm:p-10"
      aria-live="polite"
    >
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="mt-4 text-xl font-semibold text-slate-900">
        {result?.code ? `Richiesta ${result.code} ricevuta` : "Richiesta ricevuta"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        {result?.confirmation || "Riceverai un'email quando i campioni saranno spediti."}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        {result?.recipient ? (
          <>
            Il nostro ufficio verificherà la richiesta e preparerà al più presto i campioni per{" "}
            <span className="font-medium text-slate-800">{result.recipient}</span>
            {/* «Rossi S.r.l.» finisce già con il punto: niente punto doppio. */}
            {result.recipient.trimEnd().endsWith(".") ? "" : "."}
          </>
        ) : (
          "Il nostro ufficio verificherà la richiesta e preparerà i campioni al più presto."
        )}
        {result?.code ? " Conserva il codice per eventuali comunicazioni." : ""}
      </p>
      <div className="mt-6 flex justify-center">
        <Button variant="secondary" size="lg" onClick={onNewRequest}>
          Invia un&apos;altra richiesta
        </Button>
      </div>
    </section>
  );
}
