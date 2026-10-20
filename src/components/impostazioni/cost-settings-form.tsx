"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { saveCostConfigAction } from "@/app/(app)/impostazioni/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, fieldDescriptionId, Input } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import { computeRequestCost, costConfigSchema, type CostConfig } from "@/lib/config/costs";
import { formatEuro, formatNumber } from "@/lib/format";
import { FieldError, SaveBar, ToggleRow, UnitInput, useUnsavedChangesWarning } from "./config-kit";
import { amountText, parseAmount } from "./config-utils";

type AmountKey = "perRequest" | "perPackage" | "perKg" | "perM2";
type AmountRow = { enabled: boolean; label: string; amount: string };
type ManualRow = { uid: string; key: string; label: string; enabled: boolean };
type Model = {
  courier: { enabled: boolean; label: string };
  perRequest: AmountRow;
  perPackage: AmountRow;
  perKg: AmountRow;
  perM2: AmountRow & { useProductPrice: boolean };
  manual: ManualRow[];
};

const MAX_MANUAL = 10;

function fromConfig(c: CostConfig): Model {
  const row = (r: { enabled: boolean; label: string; amount: number }): AmountRow => ({
    enabled: r.enabled,
    label: r.label,
    amount: amountText(r.amount),
  });
  return {
    courier: { ...c.courier },
    perRequest: row(c.perRequest),
    perPackage: row(c.perPackage),
    perKg: row(c.perKg),
    perM2: { ...row(c.perM2), useProductPrice: c.perM2.useProductPrice },
    manual: c.manual.map((m) => ({ uid: m.key, key: m.key, label: m.label, enabled: m.enabled })),
  };
}

/** Modello del form → configurazione + errori per campo (stessi controlli della server action). */
function toConfig(m: Model): { config: CostConfig; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const amount = (key: AmountKey) => {
    const n = parseAmount(m[key].amount);
    if (Number.isNaN(n)) {
      errors[`${key}.amount`] = "Importo non valido: scrivi solo il numero, es. 2,50";
      return 0;
    }
    return n;
  };
  const config: CostConfig = {
    courier: { enabled: m.courier.enabled, label: m.courier.label },
    perRequest: { enabled: m.perRequest.enabled, label: m.perRequest.label, amount: amount("perRequest") },
    perPackage: { enabled: m.perPackage.enabled, label: m.perPackage.label, amount: amount("perPackage") },
    perKg: { enabled: m.perKg.enabled, label: m.perKg.label, amount: amount("perKg") },
    perM2: {
      enabled: m.perM2.enabled,
      label: m.perM2.label,
      amount: amount("perM2"),
      useProductPrice: m.perM2.useProductPrice,
    },
    manual: m.manual.map((x) => ({ key: x.key, label: x.label, enabled: x.enabled })),
  };
  // le voci nuove non hanno ancora la chiave (la assegna il server): chiave provvisoria per la verifica
  const parsed = costConfigSchema.safeParse({
    ...config,
    manual: config.manual.map((x, i) => (x.key ? x : { ...x, key: `m_nuova_${i}` })),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      if (path && !errors[path]) errors[path] = issue.message;
    }
  }
  const seen = new Set<string>();
  m.manual.forEach((x, i) => {
    const name = x.label.trim().toLowerCase();
    if (!name) return;
    if (seen.has(name) && !errors[`manual.${i}.label`]) errors[`manual.${i}.label`] = "C'è già una voce con questo nome";
    seen.add(name);
  });
  return { config, errors };
}

export type CostSample = { packages: number; kg: number; m2: number; courier: number; basedOn: number };

export function CostSettingsForm({
  initial,
  manualUsage,
  productsWithPrice,
  productsTotal,
  sample,
}: {
  initial: CostConfig;
  /** Richieste con un importo salvato, per chiave di voce manuale. */
  manualUsage: Record<string, number>;
  productsWithPrice: number;
  productsTotal: number;
  sample: CostSample;
}) {
  const formId = useId();
  const [saved, setSaved] = useState(() => fromConfig(initial));
  const [model, setModel] = useState(saved);
  const [result, setResult] = useState<ActionResult<CostConfig> | null>(null);
  const [pending, startTransition] = useTransition();
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const newCounter = useRef(0);
  const manualInputs = useRef(new Map<string, HTMLInputElement>());

  const dirty = JSON.stringify(model) !== JSON.stringify(saved);
  useUnsavedChangesWarning(dirty);
  const { config, errors } = useMemo(() => toConfig(model), [model]);
  const serverErrors = result && !result.ok ? result.fieldErrors : undefined;
  const errorFor = (path: string) =>
    attempted || touched.has(path) ? (errors[path] ?? serverErrors?.[path]) : serverErrors?.[path];
  const blur = (path: string) => () => setTouched((t) => (t.has(path) ? t : new Set(t).add(path)));

  function update(fn: (m: Model) => Model) {
    setModel((m) => fn(m));
    setResult((r) => (r && !r.ok ? null : r));
  }
  function setRow<K extends keyof Model>(key: K, patch: Partial<Model[K]>) {
    update((m) => ({ ...m, [key]: { ...(m[key] as object), ...patch } }));
  }

  function addManual() {
    const uid = `nuova-${++newCounter.current}`;
    update((m) => ({ ...m, manual: [...m.manual, { uid, key: "", label: "", enabled: true }] }));
    requestAnimationFrame(() => manualInputs.current.get(uid)?.focus());
  }

  function removeManual(row: ManualRow) {
    if (row.key) {
      const used = manualUsage[row.key] ?? 0;
      const name = row.label || "senza nome";
      const message = used
        ? `La voce «${name}» ha importi salvati in ${used} richiest${used === 1 ? "a" : "e"}.\n\n` +
          "Eliminandola spariscono da cruscotto e report, ma restano nel database: tornano se ricrei una voce con lo stesso nome.\n\n" +
          "Per smettere di usarla è meglio togliere la spunta «Attiva». Eliminare comunque?"
        : `Eliminare la voce «${name}»? Se vuoi solo smettere di usarla, togli la spunta «Attiva».`;
      if (!window.confirm(message)) return;
    }
    update((m) => ({ ...m, manual: m.manual.filter((x) => x.uid !== row.uid) }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(errors).length) {
      setResult({ ok: false, error: "Controlla i campi evidenziati." });
      return;
    }
    startTransition(async () => {
      const res = await saveCostConfigAction(config);
      setResult(res);
      if (res.ok && res.data) {
        const next = fromConfig(res.data);
        setSaved(next);
        setModel(next);
        setAttempted(false);
        setTouched(new Set());
      }
    });
  }

  function reset() {
    setModel(saved);
    setResult(null);
    setAttempted(false);
    setTouched(new Set());
  }

  const amountField = (key: AmountKey, unit: string, hint: string) => {
    const id = `${formId}-${key}`;
    const labelId = `${id}-label`;
    const amountId = `${id}-amount`;
    const row = model[key];
    const amountError = errorFor(`${key}.amount`);
    const zero = row.enabled && !amountError && parseAmount(row.amount) === 0;
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome nei report" htmlFor={labelId} error={errorFor(`${key}.label`)}>
          <Input
            id={labelId}
            value={row.label}
            maxLength={60}
            onChange={(e) => setRow(key, { label: e.target.value })}
            onBlur={blur(`${key}.label`)}
            aria-invalid={!!errorFor(`${key}.label`) || undefined}
          />
        </Field>
        <div className="space-y-1.5">
          <label htmlFor={amountId} className="block text-sm font-medium text-slate-700">
            Importo
          </label>
          <UnitInput
            id={amountId}
            unit={unit}
            value={row.amount}
            placeholder="0,00"
            onChange={(e) => setRow(key, { amount: e.target.value })}
            onBlur={blur(`${key}.amount`)}
            aria-invalid={!!amountError || undefined}
            aria-describedby={fieldDescriptionId(amountId)}
          />
          {amountError ? (
            <FieldError id={fieldDescriptionId(amountId)}>{amountError}</FieldError>
          ) : (
            <p id={fieldDescriptionId(amountId)} className={zero ? "text-xs text-amber-700" : "text-xs text-slate-500"}>
              {zero ? "Con importo 0 la voce non aggiunge nulla." : hint}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Voci calcolate per ogni richiesta spedita"
              description="Attiva le voci che BGP vuole contare. Il nome è quello che compare nelle colonne di cruscotto e report."
            />
            <CardBody className="space-y-4">
              <ToggleRow
                id={`${formId}-courier`}
                checked={model.courier.enabled}
                onChange={(v) => setRow("courier", { enabled: v })}
                label="Corriere"
                description="Importo inserito dalla logistica per ogni spedizione (campo «Costo spedizione»)."
              >
                <Field label="Nome nei report" htmlFor={`${formId}-courier-label`} error={errorFor("courier.label")}>
                  <Input
                    id={`${formId}-courier-label`}
                    value={model.courier.label}
                    maxLength={60}
                    onChange={(e) => setRow("courier", { label: e.target.value })}
                    onBlur={blur("courier.label")}
                    className="sm:max-w-xs"
                    aria-invalid={!!errorFor("courier.label") || undefined}
                  />
                </Field>
              </ToggleRow>

              <ToggleRow
                id={`${formId}-perRequest`}
                checked={model.perRequest.enabled}
                onChange={(v) => setRow("perRequest", { enabled: v })}
                label="Gestione richiesta"
                description="Un importo fisso per ogni richiesta spedita: tempo del personale, materiali di consumo…"
              >
                {amountField("perRequest", "€ per richiesta", "Uguale per tutte le richieste.")}
              </ToggleRow>

              <ToggleRow
                id={`${formId}-perPackage`}
                checked={model.perPackage.enabled}
                onChange={(v) => setRow("perPackage", { enabled: v })}
                label="Imballo"
                description="Un importo per ogni collo, moltiplicato per i colli indicati dal magazzino."
              >
                {amountField("perPackage", "€ per collo", "Es. 2 colli × 1,50 € = 3,00 €.")}
              </ToggleRow>

              <ToggleRow
                id={`${formId}-perKg`}
                checked={model.perKg.enabled}
                onChange={(v) => setRow("perKg", { enabled: v })}
                label="Peso"
                description="Un importo per ogni kg, moltiplicato per il peso indicato dal magazzino."
              >
                {amountField("perKg", "€ per kg", "Es. 12 kg × 0,20 € = 2,40 €.")}
              </ToggleRow>

              <ToggleRow
                id={`${formId}-perM2`}
                checked={model.perM2.enabled}
                onChange={(v) => setRow("perM2", { enabled: v })}
                label="Valore dei campioni"
                description="I m² spediti (misurati dal magazzino) moltiplicati per un prezzo al m²."
              >
                <div className="space-y-4">
                  {amountField("perM2", "€ al m²", "Prezzo usato per tutti i prodotti (o per quelli senza prezzo, vedi sotto).")}
                  <Checkbox
                    checked={model.perM2.useProductPrice}
                    onChange={(e) => setRow("perM2", { useProductPrice: e.target.checked })}
                    label="Usa il prezzo al m² del prodotto quando è indicato in anagrafica"
                    hint={
                      <>
                        Oggi il prezzo al m² è indicato per {formatNumber(productsWithPrice, 0)} prodott
                        {productsWithPrice === 1 ? "o" : "i"} su {formatNumber(productsTotal, 0)}; per gli altri vale
                        l&apos;importo qui sopra.{" "}
                        <Link href="/anagrafiche/prodotti" className="font-medium text-brand-700 hover:underline">
                          Anagrafica prodotti
                        </Link>
                      </>
                    }
                  />
                </div>
              </ToggleRow>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Voci manuali"
              description="Voci che la logistica compila a mano su ogni richiesta, quando servono (es. «Imballo speciale», «Assicurazione»)."
              actions={
                <Button variant="secondary" size="sm" onClick={addManual} disabled={model.manual.length >= MAX_MANUAL}>
                  Aggiungi voce
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {model.manual.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nessuna voce manuale. Con «Aggiungi voce» la logistica troverà un campo in più, con questo nome, nel
                  pannello di spedizione.
                </p>
              ) : (
                <ul className="space-y-3">
                  {model.manual.map((row, i) => {
                    const inputId = `${formId}-manual-${row.uid}`;
                    const error = errorFor(`manual.${i}.label`);
                    const used = row.key ? (manualUsage[row.key] ?? 0) : 0;
                    return (
                      <li
                        key={row.uid}
                        className="flex flex-col gap-3 rounded-lg p-3 ring-1 ring-inset ring-slate-200 sm:flex-row sm:items-start"
                      >
                        <div className="min-w-0 flex-1">
                          <label htmlFor={inputId} className="sr-only">
                            Nome della voce {i + 1}
                          </label>
                          <Input
                            id={inputId}
                            ref={(el) => {
                              if (el) manualInputs.current.set(row.uid, el);
                              else manualInputs.current.delete(row.uid);
                            }}
                            value={row.label}
                            maxLength={60}
                            placeholder="Es. Imballo speciale"
                            onChange={(e) =>
                              update((m) => ({
                                ...m,
                                manual: m.manual.map((x) => (x.uid === row.uid ? { ...x, label: e.target.value } : x)),
                              }))
                            }
                            onBlur={blur(`manual.${i}.label`)}
                            aria-invalid={!!error || undefined}
                            aria-describedby={fieldDescriptionId(inputId)}
                          />
                          {error ? (
                            <FieldError id={fieldDescriptionId(inputId)}>{error}</FieldError>
                          ) : (
                            <p id={fieldDescriptionId(inputId)} className="mt-1.5 text-xs text-slate-500">
                              {!row.key
                                ? "Nuova voce: sarà disponibile dopo il salvataggio."
                                : used
                                  ? `Importi inseriti in ${used} richiest${used === 1 ? "a" : "e"}. Rinominarla li mantiene.`
                                  : "Nessun importo inserito finora."}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-4 sm:h-10">
                          <Checkbox
                            checked={row.enabled}
                            onChange={(e) =>
                              update((m) => ({
                                ...m,
                                manual: m.manual.map((x) => (x.uid === row.uid ? { ...x, enabled: e.target.checked } : x)),
                              }))
                            }
                            label="Attiva"
                          />
                          <Button
                            variant="dangerGhost"
                            size="sm"
                            onClick={() => removeManual(row)}
                            aria-label={`Elimina la voce ${row.label || i + 1}`}
                          >
                            Elimina
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {errorFor("manual") ? <FieldError>{errorFor("manual")}</FieldError> : null}
              <p className="text-xs text-slate-500">
                Una voce disattivata non compare più alla logistica né nei totali, ma gli importi già inseriti restano
                salvati e tornano se la riattivi. Massimo {MAX_MANUAL} voci.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          {/* Invio in un campo dell'esempio: non deve salvare la configurazione. */}
          <div
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
            }}
          >
            <CostCalculator model={model} config={config} sample={sample} />
          </div>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        pending={pending}
        result={result}
        onReset={reset}
        saveLabel="Salva voci di costo"
        errorCount={attempted ? Object.keys(errors).length : 0}
      />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Esempio di calcolo                                                  */
/* ------------------------------------------------------------------ */

function CostCalculator({ model, config, sample }: { model: Model; config: CostConfig; sample: CostSample }) {
  const id = useId();
  const [values, setValues] = useState({
    packages: String(sample.packages),
    kg: amountText(sample.kg),
    m2: amountText(sample.m2),
    courier: amountText(sample.courier),
    productPrice: "",
  });
  const [extras, setExtras] = useState<Record<string, string>>({});

  const num = (s: string) => {
    const n = parseAmount(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const packages = Math.round(num(values.packages));
  const kg = num(values.kg);
  const m2 = num(values.m2);
  const productPrice = values.productPrice.trim() ? num(values.productPrice) : null;
  const useProduct = config.perM2.useProductPrice && productPrice !== null;
  const m2Price = useProduct ? productPrice : config.perM2.amount;

  // nel calcolo d'esempio le voci manuali si riconoscono per uid (le nuove non hanno ancora una chiave)
  const enabledManual = model.manual.filter((m) => m.enabled);
  const { total, lines } = computeRequestCost(
    {
      shippingCost: values.courier.trim() ? num(values.courier) : null,
      packagesCount: packages || null,
      weightKg: kg || null,
      pieces: m2 ? [{ areaM2: m2, productPricePerM2: productPrice }] : [],
      extraCosts: Object.fromEntries(enabledManual.map((m) => [m.uid, num(extras[m.uid] ?? "")])),
    },
    { ...config, manual: model.manual.map((m) => ({ key: m.uid, label: m.label || "Voce senza nome", enabled: m.enabled })) },
  );

  const detail: Record<string, string> = {
    courier: "inserito dalla logistica",
    perRequest: "importo fisso",
    perPackage: `${packages} ${packages === 1 ? "collo" : "colli"} × ${formatEuro(config.perPackage.amount)}`,
    perKg: `${formatNumber(kg)} kg × ${formatEuro(config.perKg.amount)}`,
    perM2: `${formatNumber(m2)} m² × ${formatEuro(m2Price)}${useProduct ? " (prezzo del prodotto)" : ""}`,
  };

  const input = (key: keyof typeof values, label: string, unit: string, hint?: string) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <UnitInput
        id={`${id}-${key}`}
        unit={unit}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        className="pr-14"
        placeholder={hint}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Esempio di calcolo"
        description={
          sample.basedOn
            ? `Valori medi delle ${sample.basedOn} spedizioni degli ultimi 6 mesi: cambiali per provare. Il calcolo usa le voci come sono ora nel form, anche se non ancora salvate.`
            : "Valori di esempio: cambiali per provare. Il calcolo usa le voci come sono ora nel form, anche se non ancora salvate."
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {input("packages", "Colli", "n.")}
          {input("kg", "Peso", "kg")}
          {input("m2", "Campioni", "m²")}
          {input("courier", "Costo corriere", "€")}
          {config.perM2.enabled && config.perM2.useProductPrice ? (
            <div className="col-span-2">{input("productPrice", "Prezzo al m² del prodotto (se in anagrafica)", "€/m²", "vuoto = non indicato")}</div>
          ) : null}
          {enabledManual.map((m) => (
            <div key={m.uid} className="col-span-2 space-y-1">
              <label htmlFor={`${id}-x-${m.uid}`} className="block text-xs font-medium text-slate-600">
                {m.label || "Voce senza nome"} (inserita dalla logistica)
              </label>
              <UnitInput
                id={`${id}-x-${m.uid}`}
                unit="€"
                className="pr-14"
                value={extras[m.uid] ?? ""}
                placeholder="0,00"
                onChange={(e) => setExtras((x) => ({ ...x, [m.uid]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200" aria-live="polite">
          {lines.length === 0 ? (
            <p className="text-sm text-slate-600">Con questi valori nessuna voce attiva aggiunge un costo.</p>
          ) : (
            <dl className="divide-y divide-slate-200 text-sm">
              {lines.map((l) => (
                <div key={l.key} className="flex items-baseline justify-between gap-3 py-1.5">
                  <dt className="min-w-0">
                    <span className="font-medium text-slate-800">{l.label}</span>
                    <span className="block text-xs text-slate-500">{detail[l.key] ?? "inserito dalla logistica"}</span>
                  </dt>
                  <dd className="shrink-0 tabular-nums text-slate-900">{formatEuro(l.amount)}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-300 pt-2">
            <span className="text-sm font-semibold text-slate-900">Costo della richiesta</span>
            <span className="text-lg font-semibold tabular-nums text-slate-900">{formatEuro(total)}</span>
          </div>
        </div>
        {!activeAny(config, model) ? (
          <Alert tone="warning">Nessuna voce è attiva: i costi per cliente risulteranno sempre 0.</Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}

function activeAny(config: CostConfig, model: Model): boolean {
  return (
    config.courier.enabled ||
    config.perRequest.enabled ||
    config.perPackage.enabled ||
    config.perKg.enabled ||
    config.perM2.enabled ||
    model.manual.some((m) => m.enabled)
  );
}
