"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { submitPublicRequest } from "@/app/richiedi-campioni/actions";
import { PendingButton, useFormAction } from "@/components/impostazioni/form-kit";
import { ProductPicker } from "@/components/pickers/product-picker";
import type { ProductOption } from "@/components/pickers/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { PublicRequestResult } from "@/lib/requests/public";

type RequesterType = "AGENTE" | "CLIENTE";
type Item = { product: ProductOption; quantity: number };

const LANGUAGES: { value: string; label: string }[] = [
  { value: "it", label: "Italiano" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

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
    const existing = items.find((i) => i.product.id === product.id);
    if (existing) {
      const quantity = Math.min(maxQuantity, existing.quantity + 1);
      setItems(items.map((i) => (i.product.id === product.id ? { ...i, quantity } : i)));
      setNotice(`${product.code} era già nell'elenco: quantità portata a ${quantity}.`);
      return;
    }
    if (items.length >= maxProducts) {
      setNotice(`Puoi richiedere al massimo ${maxProducts} prodotti diversi in una richiesta.`);
      return;
    }
    setItems([...items, { product, quantity: 1 }]);
    setNotice(null);
  }

  function setQuantity(productId: number, quantity: number) {
    const q = Math.max(1, Math.min(maxQuantity, Math.round(quantity) || 1));
    setItems(items.map((i) => (i.product.id === productId ? { ...i, quantity: q } : i)));
  }

  const isAgent = type === "AGENTE";
  const totalPieces = items.reduce((sum, i) => sum + i.quantity, 0);
  const err = (name: string) => fieldError(name);
  const invalid = (name: string) => (fieldError(name) ? true : undefined);

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
            {(
              [
                ["AGENTE", "Agente BGP", "Richiedo i campioni per un mio cliente."],
                ["CLIENTE", "Cliente", "Richiedo i campioni per la mia azienda."],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl p-4 ring-2 ring-inset transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600",
                  type === value ? "bg-brand-50 ring-brand-600" : "bg-white ring-slate-200 hover:ring-slate-300",
                )}
              >
                <input
                  type="radio"
                  name="requesterType"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  required
                  className="mt-0.5 size-5 text-brand-700 focus:ring-brand-600"
                />
                <span>
                  <span className="block font-semibold text-slate-900">{label}</span>
                  <span className="block text-sm text-slate-500">{hint}</span>
                </span>
              </label>
            ))}
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
            className="h-12 text-base sm:h-10 sm:text-sm"
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
              className="h-12 text-base sm:h-10 sm:text-sm"
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
              className="h-12 text-base sm:h-10 sm:text-sm"
              aria-invalid={invalid("requesterPhone")}
            />
          </Field>
        </div>
      </Section>

      {type ? (
        <Section
          title={isAgent ? "Cliente destinatario" : "Dati per la spedizione"}
          description={isAgent ? "Il cliente a cui spediremo i campioni." : "Dove spediremo i campioni."}
        >
          <Field
            label={isAgent ? "Ragione sociale del cliente" : "Ragione sociale / azienda"}
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
              className="h-12 text-base sm:h-10 sm:text-sm"
              aria-invalid={invalid("recipientName")}
            />
          </Field>
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
                className="h-12 text-base sm:h-10 sm:text-sm"
                aria-invalid={invalid("recipientEmail")}
              />
            </Field>
          ) : null}
          <Field
            label={isAgent ? "Indirizzo di spedizione completo" : "Indirizzo di spedizione"}
            htmlFor="address"
            required
            error={err("address")}
            hint="Via e numero, CAP, città e provincia. Aggiungi eventuali indicazioni per il corriere."
          >
            <Textarea
              id="address"
              name="address"
              required
              rows={3}
              maxLength={1000}
              autoComplete={isAgent ? "off" : "street-address"}
              className="text-base sm:text-sm"
              aria-invalid={invalid("address")}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Paese" htmlFor="country" error={err("country")}>
              <Input
                id="country"
                name="country"
                maxLength={80}
                placeholder="Italia"
                autoComplete={isAgent ? "off" : "country-name"}
                className="h-12 text-base sm:h-10 sm:text-sm"
                aria-invalid={invalid("country")}
              />
            </Field>
            <Field
              label={isAgent ? "Lingua del cliente" : "Lingua preferita"}
              htmlFor="language"
              required
              error={err("language")}
              hint="Lingua dell'email di conferma della spedizione."
            >
              <Select
                id="language"
                name="language"
                defaultValue="it"
                className="h-12 text-base sm:h-10 sm:text-sm"
                aria-invalid={invalid("language")}
              >
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
        description={`Cerca per codice o descrizione. Fino a ${maxProducts} prodotti, massimo ${maxQuantity} pezzi ciascuno.`}
      >
        <input
          type="hidden"
          name="items"
          value={JSON.stringify(items.map((i) => ({ productId: i.product.id, quantity: i.quantity })))}
        />
        {/* Invio nella ricerca prodotti: sceglie un risultato, non invia il modulo. */}
        <div
          className="space-y-1.5"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).id === "product-search") e.preventDefault();
          }}
        >
          <label htmlFor="product-search" className="block text-sm font-medium text-slate-700">
            Aggiungi un prodotto<span className="ml-0.5 text-red-600">*</span>
          </label>
          <ProductPicker
            id="product-search"
            publicMode
            onSelect={addProduct}
            invalid={!!err("items")}
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
            {items.map((item) => (
              <li key={item.product.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold text-brand-800">{item.product.code}</p>
                  <p className="text-sm text-slate-700">{item.product.description}</p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <div className="flex items-center" role="group" aria-label={`Quantità di ${item.product.code}`}>
                    <button
                      type="button"
                      onClick={() => setQuantity(item.product.id, item.quantity - 1)}
                      disabled={item.quantity <= 1}
                      className="flex size-11 items-center justify-center rounded-l-lg bg-white text-lg font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-300 sm:size-9"
                      aria-label="Diminuisci quantità"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={maxQuantity}
                      value={item.quantity}
                      onChange={(e) => setQuantity(item.product.id, Number(e.target.value))}
                      aria-label="Quantità"
                      className="h-11 w-14 border-0 text-center text-base font-semibold ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600 sm:h-9 sm:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(item.product.id, item.quantity + 1)}
                      disabled={item.quantity >= maxQuantity}
                      className="flex size-11 items-center justify-center rounded-r-lg bg-white text-lg font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-300 sm:size-9"
                      aria-label="Aumenta quantità"
                    >
                      +
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 text-red-700 hover:bg-red-50 sm:h-8"
                    onClick={() => {
                      setItems(items.filter((i) => i.product.id !== item.product.id));
                      setNotice(null);
                    }}
                  >
                    Rimuovi
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 ? (
          <p className="text-xs text-slate-500">
            {items.length} prodott{items.length === 1 ? "o" : "i"} su {maxProducts} ·{" "}
            {totalPieces} {totalPieces === 1 ? "pezzo" : "pezzi"} in totale
          </p>
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
            <span className="ml-0.5 text-red-600">*</span>
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
        Il nostro ufficio verificherà la richiesta e preparerà i campioni al più presto.
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
