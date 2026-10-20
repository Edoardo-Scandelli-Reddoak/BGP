"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { saveBollaConfigAction } from "@/app/(app)/impostazioni/actions";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Checkbox, fieldDescriptionId, Input } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import {
  BOLLA_MODE_DESCRIPTIONS,
  BOLLA_MODE_LABELS,
  bollaConfigSchema,
  formatBollaNumber,
  type BollaConfig,
  type BollaMode,
} from "@/lib/config/bolla";
import { SAMPLE_FORMAT_LABELS, SAMPLE_FORMATS, type SampleFormat } from "@/lib/sample-formats";
import { FieldError, SaveBar, useUnsavedChangesWarning } from "./config-kit";
import { bollaRulesSummary, unknownBollaPlaceholders } from "./config-utils";

const MODES: BollaMode[] = ["GENERATA", "GESTIONALE", "ENTRAMBE"];

type Model = {
  mode: BollaMode;
  numberFormat: string;
  numberPadding: string;
  rules: { always: boolean; abroad: boolean; formats: SampleFormat[]; minPackages: string };
};

function fromConfig(c: BollaConfig): Model {
  return {
    mode: c.mode,
    numberFormat: c.numberFormat,
    numberPadding: String(c.numberPadding),
    rules: {
      always: c.rules.always,
      abroad: c.rules.abroad,
      formats: SAMPLE_FORMATS.filter((f) => c.rules.formats.includes(f)),
      minPackages: c.rules.minPackages ? String(c.rules.minPackages) : "",
    },
  };
}

/** Modello del form → configurazione + errori per campo (stessi controlli della server action). */
function toConfig(m: Model): { config: BollaConfig; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const padding = Number(m.numberPadding.trim());
  if (!Number.isInteger(padding) || padding < 1 || padding > 8) errors.numberPadding = "Scegli da 1 a 8 cifre";
  const minText = m.rules.minPackages.trim();
  const minPackages = minText ? Number(minText) : null;
  if (minPackages !== null && (!Number.isInteger(minPackages) || minPackages < 1 || minPackages > 999)) {
    errors["rules.minPackages"] = "Scrivi un numero intero da 1 a 999, oppure lascia vuoto";
  }
  const config: BollaConfig = {
    mode: m.mode,
    numberFormat: m.numberFormat.trim(),
    numberPadding: errors.numberPadding ? 4 : padding,
    rules: {
      always: m.rules.always,
      abroad: m.rules.abroad,
      formats: m.rules.formats,
      minPackages: errors["rules.minPackages"] ? null : minPackages,
    },
  };
  const parsed = bollaConfigSchema.safeParse(config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      if (path && !errors[path]) errors[path] = issue.message;
    }
  }
  const unknown = unknownBollaPlaceholders(config.numberFormat);
  if (unknown.length && !errors.numberFormat) {
    errors.numberFormat = `Segnaposto non riconosciuto: ${unknown.join(", ")}. Usa solo {numero} e {anno}.`;
  }
  return { config, errors };
}

export type OpenRequestBolla = Record<BollaMode, boolean>;

export function BollaSettingsForm({
  initial,
  year,
  generatedThisYear,
  openRequests,
}: {
  initial: BollaConfig;
  year: number;
  /** Bolle già generate quest'anno (ultimo numero assegnato). */
  generatedThisYear: number;
  /** Richieste non ancora spedite con bolla richiesta: bolla pronta o no, per ciascuna modalità. */
  openRequests: OpenRequestBolla[];
}) {
  const id = useId();
  const [saved, setSaved] = useState(() => fromConfig(initial));
  const [model, setModel] = useState(saved);
  const [result, setResult] = useState<ActionResult<BollaConfig> | null>(null);
  const [pending, startTransition] = useTransition();
  const [attempted, setAttempted] = useState(false);

  const dirty = JSON.stringify(model) !== JSON.stringify(saved);
  useUnsavedChangesWarning(dirty);
  const { config, errors } = useMemo(() => toConfig(model), [model]);
  const serverErrors = result && !result.ok ? result.fieldErrors : undefined;
  // errori di formato visibili subito (si vede l'anteprima), gli altri dopo il primo tentativo
  const errorFor = (path: string) => errors[path] ?? serverErrors?.[path];

  function update(fn: (m: Model) => Model) {
    setModel((m) => fn(m));
    setResult((r) => (r && !r.ok ? null : r));
  }
  const setRules = (patch: Partial<Model["rules"]>) => update((m) => ({ ...m, rules: { ...m.rules, ...patch } }));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(errors).length) {
      setResult({ ok: false, error: "Controlla i campi evidenziati." });
      return;
    }
    startTransition(async () => {
      const res = await saveBollaConfigAction(config);
      setResult(res);
      if (res.ok && res.data) {
        const next = fromConfig(res.data);
        setSaved(next);
        setModel(next);
        setAttempted(false);
      }
    });
  }

  function reset() {
    setModel(saved);
    setResult(null);
    setAttempted(false);
  }

  const generates = model.mode !== "GESTIONALE";
  const nextNumber = generatedThisYear + 1;
  const previewOk = !errors.numberFormat && !errors.numberPadding;
  const preview = (n: number) => formatBollaNumber(n, year, config);
  const noYear = previewOk && !config.numberFormat.includes("{anno}");
  const lostReady =
    model.mode !== saved.mode ? openRequests.filter((r) => r[saved.mode] && !r[model.mode]).length : 0;
  const summary = bollaRulesSummary(config.rules);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Card>
        <CardHeader
          title="Chi prepara la bolla"
          description="Decide quale documento accompagna i campioni e cosa vede la logistica nel pannello di spedizione."
        />
        <CardBody className="space-y-4">
          <fieldset>
            <legend className="sr-only">Modalità della bolla di consegna</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {MODES.map((mode) => (
                <label
                  key={mode}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg p-4 ring-1 ring-inset transition-colors",
                    model.mode === mode ? "bg-brand-50 ring-2 ring-brand-600" : "bg-white ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    value={mode}
                    checked={model.mode === mode}
                    onChange={() => update((m) => ({ ...m, mode }))}
                    className="mt-0.5 size-4 shrink-0 border-slate-300 text-brand-700 focus:ring-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {BOLLA_MODE_LABELS[mode]}
                      {saved.mode === mode ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                          in uso
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-sm text-slate-600">{BOLLA_MODE_DESCRIPTIONS[mode]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {generates ? (
            <Alert tone="warning" title="Numerazione della bolla generata">
              Il DDT è un documento fiscale con numerazione progressiva: se la bolla la genera il sistema, usa una serie
              dedicata concordata con il commercialista.
            </Alert>
          ) : null}

          {lostReady > 0 ? (
            <Alert tone="warning" title="Effetto sulle richieste in corso">
              La modalità vale anche per le richieste non ancora spedite: {lostReady}{" "}
              {lostReady === 1 ? "richiesta ha" : "richieste hanno"} la bolla pronta con la modalità attuale, ma con questa
              andrebbe di nuovo preparata (ad esempio bolla generata dal sistema ma senza DDT del gestionale): la
              logistica la ritroverà tra le «bolle da preparare» quando la richiesta sarà pronta per il ritiro.
            </Alert>
          ) : null}

          <p className="text-sm text-slate-600">
            Intestazione, causale, porto e aspetto stampati sulla bolla generata si impostano in{" "}
            <Link href="/impostazioni/azienda" className="font-medium text-brand-700 hover:underline">
              Bolla e azienda
            </Link>
            .
          </p>
        </CardBody>
      </Card>

      <Card className={cn(!generates && "opacity-80")}>
        <CardHeader
          title="Numero della bolla generata"
          description={
            generates
              ? "Ogni bolla generata dal sistema riceve il numero successivo. La numerazione riparte da 1 ogni anno."
              : "Con il DDT del gestionale il numero lo assegna il gestionale: queste impostazioni non si usano finché non scegli una modalità con la bolla generata."
          }
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor={`${id}-format`} className="block text-sm font-medium text-slate-700">
                Formato del numero
              </label>
              <Input
                id={`${id}-format`}
                value={model.numberFormat}
                maxLength={40}
                onChange={(e) => update((m) => ({ ...m, numberFormat: e.target.value }))}
                className="font-mono"
                spellCheck={false}
                aria-invalid={!!errorFor("numberFormat") || undefined}
                aria-describedby={fieldDescriptionId(`${id}-format`)}
              />
              {errorFor("numberFormat") ? (
                <FieldError id={fieldDescriptionId(`${id}-format`)}>{errorFor("numberFormat")}</FieldError>
              ) : (
                <p id={fieldDescriptionId(`${id}-format`)} className="text-xs text-slate-500">
                  <code className="font-mono">{"{numero}"}</code> = numero progressivo (obbligatorio),{" "}
                  <code className="font-mono">{"{anno}"}</code> = anno. Il resto si stampa così com&apos;è, es.{" "}
                  <code className="font-mono">{"C{numero}/{anno}"}</code> o <code className="font-mono">{"CAMP-{anno}-{numero}"}</code>.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-padding`} className="block text-sm font-medium text-slate-700">
                Cifre del numero
              </label>
              <Input
                id={`${id}-padding`}
                type="number"
                inputMode="numeric"
                min={1}
                max={8}
                value={model.numberPadding}
                onChange={(e) => update((m) => ({ ...m, numberPadding: e.target.value }))}
                aria-invalid={!!errorFor("numberPadding") || undefined}
                aria-describedby={fieldDescriptionId(`${id}-padding`)}
              />
              {errorFor("numberPadding") ? (
                <FieldError id={fieldDescriptionId(`${id}-padding`)}>{errorFor("numberPadding")}</FieldError>
              ) : (
                <p id={fieldDescriptionId(`${id}-padding`)} className="text-xs text-slate-500">
                  Con zeri iniziali: 4 → 0001.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-200" aria-live="polite">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Prossima bolla generata</p>
            {previewOk ? (
              <>
                <p className="mt-1 font-mono text-xl font-semibold text-slate-900">{preview(nextNumber)}</p>
                <p className="mt-1 text-sm text-slate-600">
                  poi {preview(nextNumber + 1)}, {preview(nextNumber + 2)}… ·{" "}
                  {generatedThisYear
                    ? `${generatedThisYear} bolle generate nel ${year}`
                    : `nessuna bolla generata nel ${year}`}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-500">Correggi il formato per vedere l&apos;anteprima.</p>
            )}
          </div>
          {noYear ? (
            <p className="text-sm text-amber-800">
              Senza <code className="font-mono">{"{anno}"}</code> lo stesso numero si ripete ogni anno, perché la numerazione
              riparte da 1 a gennaio.
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            Cambiare il formato non modifica le bolle già generate e non azzera la numerazione dell&apos;anno.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Quando la bolla è obbligatoria"
          description="Le regole spuntano in automatico «bolla di consegna richiesta». Il back office può sempre spuntarla a mano: le regole la aggiungono, non la tolgono."
        />
        <CardBody className="space-y-5">
          <div className="space-y-3">
            <Checkbox
              checked={model.rules.always}
              onChange={(e) => setRules({ always: e.target.checked })}
              label="Sempre"
              hint="Ogni richiesta ha la bolla di consegna."
            />
            <div className={cn("space-y-3", model.rules.always && "opacity-60")}>
              <Checkbox
                checked={model.rules.abroad}
                onChange={(e) => setRules({ abroad: e.target.checked })}
                label="Spedizioni all'estero"
                hint="Paese di consegna diverso dall'Italia. Se il paese non è indicato la regola non scatta."
              />
              <fieldset className="rounded-lg p-4 ring-1 ring-inset ring-slate-200">
                <legend className="px-1 text-sm font-medium text-slate-800">Formati del campione</legend>
                <p className="mb-3 text-sm text-slate-500">
                  La bolla serve se la richiesta contiene almeno uno dei formati spuntati (es. gli espositori).
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SAMPLE_FORMATS.map((f) => (
                    <Checkbox
                      key={f}
                      checked={model.rules.formats.includes(f)}
                      onChange={(e) =>
                        setRules({
                          formats: e.target.checked
                            ? SAMPLE_FORMATS.filter((x) => x === f || model.rules.formats.includes(x))
                            : model.rules.formats.filter((x) => x !== f),
                        })
                      }
                      label={SAMPLE_FORMAT_LABELS[f]}
                    />
                  ))}
                </div>
              </fieldset>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-min`} className="block text-sm font-medium text-slate-700">
                  Da quanti colli in su
                </label>
                <Input
                  id={`${id}-min`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={999}
                  value={model.rules.minPackages}
                  placeholder="non usata"
                  onChange={(e) => setRules({ minPackages: e.target.value })}
                  className="sm:max-w-40"
                  aria-invalid={!!errorFor("rules.minPackages") || undefined}
                  aria-describedby={fieldDescriptionId(`${id}-min`)}
                />
                {errorFor("rules.minPackages") ? (
                  <FieldError id={fieldDescriptionId(`${id}-min`)}>{errorFor("rules.minPackages")}</FieldError>
                ) : (
                  <p id={fieldDescriptionId(`${id}-min`)} className="text-xs text-slate-500">
                    Vuoto = regola non usata. Si controlla quando il magazzino segna la richiesta pronta per il ritiro,
                    perché prima i colli non si conoscono.
                  </p>
                )}
              </div>
            </div>
            {model.rules.always ? (
              <p className="text-sm text-slate-600">Con «Sempre» le altre regole non servono.</p>
            ) : null}
          </div>

          <div className="rounded-lg bg-slate-50 p-4 text-sm ring-1 ring-inset ring-slate-200" aria-live="polite">
            {summary.length ? (
              <>
                <p className="font-medium text-slate-900">La bolla sarà richiesta in automatico per:</p>
                <ul className="mt-1 list-disc pl-5 text-slate-700">
                  {summary.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-slate-700">
                Nessuna regola: la bolla è richiesta solo quando il back office spunta «bolla di consegna richiesta».
              </p>
            )}
          </div>

          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              Le regole si applicano quando una richiesta viene creata o modificata e quando il magazzino la segna pronta
              per il ritiro.
            </li>
            <li>Le richieste già registrate non cambiano finché nessuno le modifica.</li>
            <li>
              Sulla richiesta compare il motivo (es. «spedizione all&apos;estero») e la logistica riceve l&apos;avviso «bolla
              di consegna richiesta» come per quelle spuntate a mano.
            </li>
          </ul>
        </CardBody>
      </Card>

      <SaveBar
        dirty={dirty}
        pending={pending}
        result={result}
        onReset={reset}
        saveLabel="Salva impostazioni della bolla"
        errorCount={attempted ? Object.keys(errors).length : 0}
      />
    </form>
  );
}
