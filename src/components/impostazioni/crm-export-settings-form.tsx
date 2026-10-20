"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { saveCrmExportConfigAction, sendCrmExportNowAction } from "@/app/(app)/impostazioni/actions";
import { ActionMessage, Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Checkbox, fieldDescriptionId, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action-result";
import {
  CRM_COLUMNS,
  CRM_COLUMNS_BY_GROUP,
  CRM_GROUP_BY_LABELS,
  crmCsv,
  crmExportConfigSchema,
  crmFileName,
  type CrmColumn,
  type CrmExportConfig,
  type CrmGroupBy,
  type CrmRow,
} from "@/lib/config/crm-export";
import { isValidEmail } from "@/lib/email/recipients";
import { formatDateTime, formatMonth } from "@/lib/format";
import { addMonths } from "@/lib/reports/period";
import { FieldError, randomSecretHex, SaveBar, useUnsavedChangesWarning } from "./config-kit";
import {
  CRM_COLUMN_HINTS,
  CRM_KEY_COLUMNS,
  crmCellText,
  crmColumnLabel,
  missingCrmKeyColumns,
} from "./config-utils";

const GROUPS: CrmGroupBy[] = ["PRODOTTO", "PRODOTTO_CLIENTE", "CLIENTE", "AGENTE"];

const GROUP_HINTS: Record<CrmGroupBy, string> = {
  PRODOTTO: "Una riga per ogni prodotto spedito nel mese (come il file di oggi).",
  PRODOTTO_CLIENTE: "Una riga per ogni prodotto e cliente: utile se il CRM registra i m² sul cliente.",
  CLIENTE: "Una riga per cliente, con i m² di tutti i prodotti.",
  AGENTE: "Una riga per agente; i clienti senza agente sono raccolti in «Direzionale».",
};

// valori delle opzioni come parole: un carattere di tabulazione in value="" non è affidabile
const SEPARATORS: { option: string; value: CrmExportConfig["separator"]; label: string }[] = [
  { option: "semicolon", value: ";", label: "Punto e virgola ( ; ) — Excel in italiano" },
  { option: "comma", value: ",", label: "Virgola ( , )" },
  { option: "tab", value: "\t", label: "Tabulazione" },
];

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

type Model = Omit<CrmExportConfig, "autoSend"> & {
  autoSend: { enabled: boolean; recipientsText: string; day: number };
};

function fromConfig(c: CrmExportConfig): Model {
  return {
    ...c,
    columns: [...c.columns],
    autoSend: { enabled: c.autoSend.enabled, recipientsText: c.autoSend.recipients.join("\n"), day: c.autoSend.day },
    webhook: { ...c.webhook },
  };
}

function recipientTokens(text: string): string[] {
  return text
    .split(/[\s;,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Modello del form → configurazione + errori per campo (stessi controlli della server action). */
function toConfig(m: Model): { config: CrmExportConfig; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const tokens = recipientTokens(m.autoSend.recipientsText);
  const invalid = tokens.filter((t) => !isValidEmail(t));
  if (invalid.length) {
    errors["autoSend.recipients"] = `Indirizzi non validi: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? "…" : ""}`;
  }
  const recipients = [...new Map(tokens.filter(isValidEmail).map((t) => [t.toLowerCase(), t])).values()];
  if (recipients.length > 10) errors["autoSend.recipients"] ??= "Massimo 10 destinatari";
  if (m.fileName.trim().length > 80) errors.fileName = "Massimo 80 caratteri";

  const config: CrmExportConfig = {
    ...m,
    fileName: m.fileName.trim(),
    autoSend: { enabled: m.autoSend.enabled, recipients, day: m.autoSend.day },
    webhook: { enabled: m.webhook.enabled, url: m.webhook.url.trim(), secret: m.webhook.secret.trim() },
  };
  const parsed = crmExportConfigSchema.safeParse(config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      let path = issue.path.map(String).join(".");
      path = /^(autoSend\.recipients|columns)\.\d+$/.exec(path)?.[1] ?? path;
      if (path && !errors[path]) errors[path] = issue.message;
    }
  }
  if (config.webhook.url && !/^https:\/\/\S+$/.test(config.webhook.url)) errors["webhook.url"] ??= "Indica un indirizzo https://";
  if (config.webhook.enabled && config.webhook.secret.length < 16) {
    errors["webhook.secret"] ??= "Genera un segreto: serve al CRM per verificare che i dati arrivino da BGP";
  }
  return { config, errors };
}

export type CrmPreviewData = Record<CrmGroupBy, { rows: CrmRow[]; total: number }>;
export type CrmRunRow = { id: number; period: string; status: string; createdAt: string; summary: string };

export function CrmExportSettingsForm({
  initial,
  previewMonth,
  preview,
  downloadHref,
  previousMonth,
  currentMonth,
  todayDay,
  previousMonthSent,
  schedulerEnabled,
  nextRun,
  runs,
}: {
  initial: CrmExportConfig;
  previewMonth: string;
  preview: CrmPreviewData;
  downloadHref: string;
  previousMonth: string;
  currentMonth: string;
  todayDay: number;
  previousMonthSent: boolean;
  schedulerEnabled: boolean;
  nextRun: string;
  runs: CrmRunRow[];
}) {
  const id = useId();
  const [saved, setSaved] = useState(() => fromConfig(initial));
  const [model, setModel] = useState(saved);
  const [result, setResult] = useState<ActionResult<CrmExportConfig> | null>(null);
  const [pending, startTransition] = useTransition();
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());

  const dirty = JSON.stringify(model) !== JSON.stringify(saved);
  useUnsavedChangesWarning(dirty);
  const { config, errors } = useMemo(() => toConfig(model), [model]);
  const savedConfig = useMemo(() => toConfig(saved).config, [saved]);
  const serverErrors = result && !result.ok ? result.fieldErrors : undefined;
  const errorFor = (path: string) =>
    attempted || touched.has(path) ? (errors[path] ?? serverErrors?.[path]) : serverErrors?.[path];
  const blur = (path: string) => () => setTouched((t) => (t.has(path) ? t : new Set(t).add(path)));

  function update(fn: (m: Model) => Model) {
    setModel((m) => fn(m));
    setResult((r) => (r && !r.ok ? null : r));
  }

  function changeGroup(groupBy: CrmGroupBy) {
    update((m) => {
      const allowed = CRM_COLUMNS_BY_GROUP[groupBy];
      const columns = m.columns.filter((c) => allowed.includes(c));
      // le colonne che identificano le righe del nuovo raggruppamento non devono mancare
      const keys = CRM_KEY_COLUMNS[groupBy]
        .filter((alternatives) => !alternatives.some((c) => columns.includes(c)))
        .map((alternatives) => alternatives[0]);
      const at = columns[0] === "mese" ? 1 : 0;
      columns.splice(at, 0, ...keys);
      return { ...m, groupBy, columns: columns.length ? columns : [...allowed] };
    });
  }

  function setColumn(column: CrmColumn, on: boolean) {
    update((m) => ({ ...m, columns: on ? [...m.columns, column] : m.columns.filter((c) => c !== column) }));
  }

  function moveColumn(index: number, delta: -1 | 1) {
    update((m) => {
      const columns = [...m.columns];
      const target = index + delta;
      if (target < 0 || target >= columns.length) return m;
      [columns[index], columns[target]] = [columns[target], columns[index]];
      return { ...m, columns };
    });
  }

  function generateSecret() {
    if (model.webhook.secret && !window.confirm("Generare un nuovo segreto? Dopo il salvataggio il CRM dovrà usare quello nuovo.")) {
      return;
    }
    update((m) => ({ ...m, webhook: { ...m.webhook, secret: randomSecretHex() } }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(errors).length) {
      setResult({ ok: false, error: "Controlla i campi evidenziati." });
      return;
    }
    startTransition(async () => {
      const res = await saveCrmExportConfigAction(config);
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

  const available = CRM_COLUMNS_BY_GROUP[model.groupBy];
  const excluded = available.filter((c) => !model.columns.includes(c));
  const missingKeys = missingCrmKeyColumns(model.groupBy, model.columns);
  const isCsv = model.format === "CSV";
  const exampleName = crmFileName({ ...config, fileName: config.fileName || "m2-campioni-{mese}" }, previousMonth);

  // invio automatico che partirebbe subito dopo il salvataggio
  const channelsOn = (config.autoSend.enabled && config.autoSend.recipients.length > 0) || config.webhook.enabled;
  const savedChannelsOn =
    (savedConfig.autoSend.enabled && savedConfig.autoSend.recipients.length > 0) || savedConfig.webhook.enabled;
  const startsAfterSave =
    dirty && channelsOn && !previousMonthSent && todayDay >= config.autoSend.day && (!savedChannelsOn || todayDay < savedConfig.autoSend.day);

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <Card>
          <CardHeader
            title="Contenuto del file"
            description="Cosa contiene ogni riga e quali colonne, in che ordine. I m² sono quelli dei campioni spediti nel mese (data di spedizione)."
          />
          <CardBody className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor={`${id}-group`} className="block text-sm font-medium text-slate-700">
                Raggruppamento
              </label>
              <Select
                id={`${id}-group`}
                value={model.groupBy}
                onChange={(e) => changeGroup(e.target.value as CrmGroupBy)}
                className="sm:max-w-sm"
                aria-describedby={fieldDescriptionId(`${id}-group`)}
              >
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {CRM_GROUP_BY_LABELS[g]}
                  </option>
                ))}
              </Select>
              <p id={fieldDescriptionId(`${id}-group`)} className="text-xs text-slate-500">
                {GROUP_HINTS[model.groupBy]}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">Colonne nel file, in ordine</legend>
                {model.columns.length === 0 ? (
                  <p className="rounded-lg p-3 text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
                    Nessuna colonna: aggiungine almeno una dall&apos;elenco.
                  </p>
                ) : (
                  <ol className="space-y-1.5">
                    {model.columns.map((c, i) => (
                      <li key={c} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">{i + 1}.</span>
                        <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => setColumn(c, false)}
                            className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                          />
                          <span className="min-w-0">
                            <span className="font-medium text-slate-800">{crmColumnLabel(c)}</span>
                            <span className="block text-xs text-slate-500">{CRM_COLUMN_HINTS[c]}</span>
                          </span>
                        </label>
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => moveColumn(i, -1)}
                            disabled={i === 0}
                            className={buttonClasses("ghost", "sm", "w-8 px-0")}
                            aria-label={`Sposta ${crmColumnLabel(c)} prima`}
                          >
                            <span aria-hidden>↑</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveColumn(i, 1)}
                            disabled={i === model.columns.length - 1}
                            className={buttonClasses("ghost", "sm", "w-8 px-0")}
                            aria-label={`Sposta ${crmColumnLabel(c)} dopo`}
                          >
                            <span aria-hidden>↓</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {errors.columns || serverErrors?.columns ? (
                  <FieldError>{errors.columns ?? serverErrors?.columns}</FieldError>
                ) : null}
                {missingKeys.length ? (
                  <p className="text-sm text-amber-800">
                    Manca {missingKeys.map((alts) => alts.map((c) => `«${crmColumnLabel(c)}»`).join(" o ")).join(" e ")}:
                    senza, le righe del file non si distinguono tra loro.
                  </p>
                ) : null}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">Altre colonne disponibili</legend>
                {excluded.length === 0 ? (
                  <p className="rounded-lg p-3 text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
                    Tutte le colonne disponibili sono già nel file.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {excluded.map((c) => (
                      <li key={c} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
                        <Checkbox
                          checked={false}
                          onChange={() => setColumn(c, true)}
                          label={crmColumnLabel(c)}
                          hint={CRM_COLUMN_HINTS[c]}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-slate-500">Spuntata, la colonna si aggiunge in fondo: poi spostala con le frecce.</p>
              </fieldset>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Formato del file" description="Come lo vuole ricevere chi lo carica nel CRM." />
          <CardBody className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Tipo di file</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ["CSV", "CSV (testo)", "Si apre con Excel e si importa in quasi tutti i CRM."],
                    ["XLSX", "Excel (.xlsx)", "Foglio Excel con una colonna per voce; codici sempre come testo."],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ring-inset",
                      model.format === value ? "bg-brand-50 ring-2 ring-brand-600" : "ring-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-format`}
                      checked={model.format === value}
                      onChange={() => update((m) => ({ ...m, format: value }))}
                      className="mt-0.5 size-4 shrink-0 border-slate-300 text-brand-700 focus:ring-brand-600"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{label}</span>
                      <span className="block text-sm text-slate-600">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {isCsv ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor={`${id}-sep`} className="block text-sm font-medium text-slate-700">
                    Separatore delle colonne
                  </label>
                  <Select
                    id={`${id}-sep`}
                    value={SEPARATORS.find((x) => x.value === model.separator)?.option ?? "semicolon"}
                    onChange={(e) => {
                      const separator = SEPARATORS.find((x) => x.option === e.target.value)?.value ?? ";";
                      update((m) => ({ ...m, separator }));
                    }}
                  >
                    {SEPARATORS.map((x) => (
                      <option key={x.option} value={x.option}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`${id}-dec`} className="block text-sm font-medium text-slate-700">
                    Separatore dei decimali
                  </label>
                  <Select
                    id={`${id}-dec`}
                    value={model.decimal}
                    onChange={(e) => update((m) => ({ ...m, decimal: e.target.value as CrmExportConfig["decimal"] }))}
                    aria-invalid={!!errors.decimal || undefined}
                    aria-describedby={fieldDescriptionId(`${id}-dec`)}
                  >
                    <option value=",">Virgola: 12,50</option>
                    <option value=".">Punto: 12.50</option>
                  </Select>
                  {errors.decimal ? (
                    <FieldError id={fieldDescriptionId(`${id}-dec`)}>{errors.decimal}</FieldError>
                  ) : (
                    <p id={fieldDescriptionId(`${id}-dec`)} className="text-xs text-slate-500">
                      Excel in italiano usa la virgola; molti CRM vogliono il punto.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            <Checkbox
              checked={model.header}
              onChange={(e) => update((m) => ({ ...m, header: e.target.checked }))}
              label="Prima riga con i nomi delle colonne"
              hint="Toglila solo se il CRM vuole il file senza intestazione."
            />

            <div className="space-y-1.5">
              <label htmlFor={`${id}-name`} className="block text-sm font-medium text-slate-700">
                Nome del file
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-name`}
                  value={model.fileName}
                  maxLength={80}
                  onChange={(e) => update((m) => ({ ...m, fileName: e.target.value }))}
                  onBlur={blur("fileName")}
                  className="font-mono sm:max-w-sm"
                  spellCheck={false}
                  aria-invalid={!!errorFor("fileName") || undefined}
                  aria-describedby={fieldDescriptionId(`${id}-name`)}
                />
                <span className="shrink-0 font-mono text-sm text-slate-500">.{isCsv ? "csv" : "xlsx"}</span>
              </div>
              {errorFor("fileName") ? (
                <FieldError id={fieldDescriptionId(`${id}-name`)}>{errorFor("fileName")}</FieldError>
              ) : (
                <p id={fieldDescriptionId(`${id}-name`)} className="text-xs text-slate-500">
                  <code className="font-mono">{"{mese}"}</code> diventa anno e mese. Esempio:{" "}
                  <span className="font-mono text-slate-700">{exampleName}</span>
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        <CrmPreview
          config={config}
          month={previewMonth}
          maxMonth={currentMonth}
          data={preview[model.groupBy]}
          downloadHref={downloadHref}
          dirty={dirty}
        />

        <Card>
          <CardHeader
            title="Invio automatico ogni mese"
            description="Il sistema manda per email il file del mese precedente, senza che nessuno debba ricordarsene."
          />
          <CardBody className="space-y-4">
            <Checkbox
              checked={model.autoSend.enabled}
              onChange={(e) => update((m) => ({ ...m, autoSend: { ...m.autoSend, enabled: e.target.checked } }))}
              label="Invia automaticamente l'export del mese precedente"
              hint="Una sola volta al mese. Se quel giorno il server è spento, l'invio parte appena torna acceso."
            />
            <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-3", !model.autoSend.enabled && "opacity-70")}>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor={`${id}-to`} className="block text-sm font-medium text-slate-700">
                  Destinatari
                </label>
                <Textarea
                  id={`${id}-to`}
                  rows={3}
                  value={model.autoSend.recipientsText}
                  onChange={(e) => update((m) => ({ ...m, autoSend: { ...m.autoSend, recipientsText: e.target.value } }))}
                  onBlur={blur("autoSend.recipients")}
                  placeholder="crm@bgpgroup.it"
                  spellCheck={false}
                  aria-invalid={!!errorFor("autoSend.recipients") || undefined}
                  aria-describedby={fieldDescriptionId(`${id}-to`)}
                />
                {errorFor("autoSend.recipients") ? (
                  <FieldError id={fieldDescriptionId(`${id}-to`)}>{errorFor("autoSend.recipients")}</FieldError>
                ) : (
                  <p id={fieldDescriptionId(`${id}-to`)} className="text-xs text-slate-500">
                    Un indirizzo per riga, massimo 10. Servono anche per «Invia ora» qui sotto.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-day`} className="block text-sm font-medium text-slate-700">
                  Giorno del mese
                </label>
                <Select
                  id={`${id}-day`}
                  value={model.autoSend.day}
                  onChange={(e) => update((m) => ({ ...m, autoSend: { ...m.autoSend, day: Number(e.target.value) } }))}
                  aria-describedby={fieldDescriptionId(`${id}-day`)}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
                <p id={fieldDescriptionId(`${id}-day`)} className="text-xs text-slate-500">
                  Da 1 a 28, così esiste in tutti i mesi. Vale anche per il webhook.
                </p>
              </div>
            </div>
            {startsAfterSave ? (
              <Alert tone="warning">
                Oggi è il {todayDay}, dopo il giorno scelto: salvando, l&apos;export di {formatMonth(previousMonth)} partirà
                entro un&apos;ora.
              </Alert>
            ) : null}
            {!schedulerEnabled ? (
              <Alert tone="warning" title="Programmazione interna disattivata">
                Sul server è impostato SCHEDULER_ENABLED=false: l&apos;invio automatico parte solo se un servizio esterno
                chiama ogni ora l&apos;indirizzo /api/cron/export-crm. Chiedi conferma a chi gestisce il server.
              </Alert>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Collegamento diretto con il CRM (webhook)"
            description="Facoltativo: se il fornitore del CRM lo prevede, ogni mese i dati arrivano al CRM da soli, senza file."
          />
          <CardBody className="space-y-4">
            <Checkbox
              checked={model.webhook.enabled}
              onChange={(e) => update((m) => ({ ...m, webhook: { ...m.webhook, enabled: e.target.checked } }))}
              label="Invia i dati del mese al CRM"
              hint="Parte lo stesso giorno dell'invio automatico. Indirizzo e segreto li concorda il fornitore del CRM."
            />
            <div className={cn("space-y-4", !model.webhook.enabled && "opacity-70")}>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-url`} className="block text-sm font-medium text-slate-700">
                  Indirizzo del CRM
                </label>
                <Input
                  id={`${id}-url`}
                  type="url"
                  value={model.webhook.url}
                  maxLength={500}
                  placeholder="https://crm.esempio.it/api/campioni"
                  onChange={(e) => update((m) => ({ ...m, webhook: { ...m.webhook, url: e.target.value } }))}
                  onBlur={blur("webhook.url")}
                  className="font-mono"
                  spellCheck={false}
                  aria-invalid={!!errorFor("webhook.url") || undefined}
                  aria-describedby={fieldDescriptionId(`${id}-url`)}
                />
                {errorFor("webhook.url") ? (
                  <FieldError id={fieldDescriptionId(`${id}-url`)}>{errorFor("webhook.url")}</FieldError>
                ) : (
                  <p id={fieldDescriptionId(`${id}-url`)} className="text-xs text-slate-500">
                    Deve iniziare con https:// (collegamento cifrato).
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-secret`} className="block text-sm font-medium text-slate-700">
                  Segreto condiviso
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id={`${id}-secret`}
                    value={model.webhook.secret}
                    maxLength={200}
                    onChange={(e) => update((m) => ({ ...m, webhook: { ...m.webhook, secret: e.target.value } }))}
                    onBlur={blur("webhook.secret")}
                    className="font-mono text-xs sm:flex-1"
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!!errorFor("webhook.secret") || undefined}
                    aria-describedby={fieldDescriptionId(`${id}-secret`)}
                  />
                  <Button variant="secondary" onClick={generateSecret}>
                    Genera segreto
                  </Button>
                  <CopyButton value={model.webhook.secret} />
                </div>
                {errorFor("webhook.secret") ? (
                  <FieldError id={fieldDescriptionId(`${id}-secret`)}>{errorFor("webhook.secret")}</FieldError>
                ) : (
                  <p id={fieldDescriptionId(`${id}-secret`)} className="text-xs text-slate-500">
                    Da comunicare al fornitore del CRM (non via email in chiaro, se possibile): serve a verificare che i
                    dati arrivino davvero da BGP.
                  </p>
                )}
              </div>
              <WebhookTechNote config={config} data={preview[model.groupBy]} month={previewMonth} />
            </div>
          </CardBody>
        </Card>

        <SaveBar
          dirty={dirty}
          pending={pending}
          result={result}
          onReset={reset}
          saveLabel="Salva impostazioni dell'export"
          errorCount={attempted ? Object.keys(errors).length : 0}
        />
      </form>

      <CrmSendCard
        dirty={dirty}
        savedRecipients={savedConfig.autoSend.recipients}
        previousMonth={previousMonth}
        nextRun={nextRun}
        runs={runs}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Anteprima                                                           */
/* ------------------------------------------------------------------ */

const PREVIEW_ROWS = 8;

function CrmPreview({
  config,
  month,
  maxMonth,
  data,
  downloadHref,
  dirty,
}: {
  config: CrmExportConfig;
  month: string;
  maxMonth: string;
  data: { rows: CrmRow[]; total: number };
  downloadHref: string;
  dirty: boolean;
}) {
  const router = useRouter();
  const [loading, startLoading] = useTransition();
  const rows = data.rows.slice(0, PREVIEW_ROWS);
  const rawLines =
    config.format === "CSV" && config.columns.length
      ? crmCsv(rows.slice(0, 5), config).replace(/^﻿/, "").split("\r\n").filter(Boolean)
      : [];

  return (
    <Card>
      <CardHeader
        title={`Anteprima — ${formatMonth(month)}`}
        description={
          data.total
            ? `${data.total} ${data.total === 1 ? "riga" : "righe"} nel file${data.total > PREVIEW_ROWS ? `: qui le prime ${PREVIEW_ROWS}` : ""}.${dirty ? " L'anteprima segue le modifiche non ancora salvate." : ""}`
            : `Nessun campione spedito in ${formatMonth(month)}: il file conterrebbe solo l'intestazione.`
        }
        actions={
          <>
            <label htmlFor="crm-preview-month" className="sr-only">
              Mese dell&apos;anteprima
            </label>
            <Input
              id="crm-preview-month"
              type="month"
              value={month}
              max={maxMonth}
              onChange={(e) => {
                const value = e.target.value;
                if (!/^\d{4}-\d{2}$/.test(value)) return;
                // navigazione senza ricaricare: le modifiche non salvate del form restano
                startLoading(() => router.replace(`/impostazioni/export-crm?mese=${value}`, { scroll: false }));
              }}
              className="h-8 w-40 py-1"
              onKeyDown={(e) => {
                // Invio nel mese dell'anteprima: non deve salvare la configurazione.
                if (e.key === "Enter") e.preventDefault();
              }}
              aria-busy={loading}
            />
            <a href={downloadHref} className={buttonClasses("secondary", "sm")} download>
              Scarica il file di esempio
            </a>
          </>
        }
      />
      {rows.length && config.columns.length ? (
        <Table className={cn(loading && "opacity-60")}>
          <THead>
            <tr>
              {config.columns.map((c) => (
                <TH key={c} className={cn(["richieste", "pezzi", "m2"].includes(c) && "text-right")}>
                  {CRM_COLUMNS[c]}
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                {config.columns.map((c) => (
                  <TD
                    key={c}
                    className={cn(
                      "whitespace-nowrap",
                      ["richieste", "pezzi", "m2"].includes(c) && "text-right tabular-nums",
                      c === "descrizione" && "max-w-xs truncate",
                    )}
                  >
                    {crmCellText(r[c], c, config)}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}
      <CardBody className="space-y-3 border-t border-slate-100">
        {rawLines.length ? (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              Inizio del file, così com&apos;è{config.separator === "\t" ? " (⇥ = tabulazione)" : ""}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
              {rawLines.map((l) => l.replaceAll("\t", " ⇥ ")).join("\n")}
            </pre>
          </div>
        ) : null}
        {!config.header ? <p className="text-xs text-slate-500">Il file non avrà la riga con i nomi delle colonne.</p> : null}
        <p className="text-xs text-slate-500">
          «Scarica il file di esempio» usa le impostazioni salvate{dirty ? ": salva per scaricarlo con le modifiche" : ""}.
        </p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Nota tecnica per il fornitore del CRM                               */
/* ------------------------------------------------------------------ */

function WebhookTechNote({
  config,
  data,
  month,
}: {
  config: CrmExportConfig;
  data: { rows: CrmRow[] };
  month: string;
}) {
  const sample = data.rows.slice(0, 2).map((r) => Object.fromEntries(config.columns.map((c) => [c, r[c] ?? null])));
  const payload = {
    tipo: "export_m2_campioni",
    mese: month,
    raggruppamento: config.groupBy,
    colonne: config.columns,
    righe: sample.length ? sample : [Object.fromEntries(config.columns.map((c) => [c, null]))],
    // l'invio parte nel mese successivo a quello esportato
    generatoIl: `${addMonths(month, 1)}-01T06:00:00.000Z`,
  };
  return (
    <details className="group rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-800">
        Nota tecnica per il fornitore del CRM
      </summary>
      <div className="space-y-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-700">
        <p>
          Una volta al mese il gestionale invia una richiesta <code className="font-mono">POST</code> all&apos;indirizzo
          indicato, con <code className="font-mono">Content-Type: application/json</code> (UTF-8). Le chiavi di ogni riga
          sono quelle di <code className="font-mono">colonne</code>; i numeri sono numeri JSON (punto decimale), qualunque
          sia il formato scelto per il file.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
          {JSON.stringify(payload, null, 2)}
        </pre>
        <p>
          Intestazione <code className="font-mono">X-BGP-Signature: sha256=&lt;firma&gt;</code>: la firma è l&apos;HMAC
          SHA-256 del corpo della richiesta (così come arriva, byte per byte) calcolato con il segreto condiviso, in
          esadecimale minuscolo. Il CRM deve ricalcolarla e scartare le richieste con firma diversa.
        </p>
        <p>
          Una risposta 2xx vale come «consegnato»; altri codici o nessuna risposta entro 15 secondi sono registrati come
          errore nella tabella degli invii. Non ci sono nuovi tentativi automatici per lo stesso mese.
        </p>
      </div>
    </details>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        disabled={!value}
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
        {copied ? "Copiato" : "Copia"}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Segreto copiato negli appunti" : ""}
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Invii                                                               */
/* ------------------------------------------------------------------ */

const RUN_STATUS: Record<string, { label: string; tone: "green" | "red" | "amber" | "slate" }> = {
  OK: { label: "Riuscito", tone: "green" },
  ERRORE: { label: "Errore", tone: "red" },
  IN_CORSO: { label: "In corso", tone: "amber" },
};

function CrmSendCard({
  dirty,
  savedRecipients,
  previousMonth,
  nextRun,
  runs,
}: {
  dirty: boolean;
  savedRecipients: string[];
  previousMonth: string;
  nextRun: string;
  runs: CrmRunRow[];
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const monthLabel = formatMonth(previousMonth);

  function sendNow() {
    if (!window.confirm(`Inviare ora l'export di ${monthLabel} a ${savedRecipients.join(", ")}?`)) return;
    startTransition(async () => {
      setResult(await sendCrmExportNowAction());
    });
  }

  return (
    <Card>
      <CardHeader
        title="Invii"
        description={nextRun}
        actions={
          <Button onClick={sendNow} disabled={pending || savedRecipients.length === 0} aria-busy={pending}>
            {pending ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                Invio in corso…
              </>
            ) : (
              "Invia ora il mese precedente"
            )}
          </Button>
        }
      />
      <CardBody className="space-y-3">
        <p className="text-sm text-slate-600">
          «Invia ora» manda subito per email il file di {monthLabel} ai destinatari salvati (non al webhook), ad esempio
          per una prova. Non sostituisce l&apos;invio automatico del mese.
        </p>
        {savedRecipients.length === 0 ? (
          <p className="text-sm text-amber-800">Per usarlo aggiungi almeno un destinatario in «Invio automatico» e salva.</p>
        ) : dirty ? (
          <p className="text-sm text-amber-800">Hai modifiche non salvate: «Invia ora» usa le impostazioni salvate.</p>
        ) : null}
        <div aria-live="polite">
          <ActionMessage state={result} />
        </div>
      </CardBody>
      {runs.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Mese esportato</TH>
              <TH>Eseguito il</TH>
              <TH>Esito</TH>
              <TH>Dettaglio</TH>
            </tr>
          </THead>
          <TBody>
            {runs.map((r) => {
              const status = RUN_STATUS[r.status] ?? { label: r.status, tone: "slate" as const };
              return (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap font-medium capitalize">{formatMonth(r.period)}</TD>
                  <TD className="whitespace-nowrap">{formatDateTime(r.createdAt)}</TD>
                  <TD>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </TD>
                  <TD className="text-slate-600">{r.summary || "—"}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <CardBody className="border-t border-slate-100">
          <p className="text-sm text-slate-500">Nessun invio automatico finora.</p>
        </CardBody>
      )}
      <CardBody className="border-t border-slate-100">
        <Link href="/impostazioni/registro-email?tipo=EXPORT_CRM" className="text-sm font-medium text-brand-700 hover:underline">
          Tutte le email dell&apos;export nel registro email
        </Link>
      </CardBody>
    </Card>
  );
}
