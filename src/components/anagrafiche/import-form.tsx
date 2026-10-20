"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { importRegistryFile, type ImportResultData } from "@/app/(app)/anagrafiche/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatNumber } from "@/lib/format";
import { IMPORT_MAX_BYTES } from "./constants";

const SKIPPED_SHOWN = 30;

export function ImportForm({ kind }: { kind: "contatti" | "prodotti" }) {
  const [state, formAction] = useActionState(importRegistryFile, null);
  const [clientError, setClientError] = useState<string | null>(null);
  const uid = useId();
  const fileError = clientError ?? (state && !state.ok ? state.fieldErrors?.file : undefined);

  return (
    <div className="space-y-4">
      <form
        action={formAction}
        className="space-y-4"
        onSubmit={(e) => {
          const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
          const file = input?.files?.[0];
          if (file && file.size > IMPORT_MAX_BYTES) {
            e.preventDefault();
            setClientError("Il file supera i 15 MB.");
          }
        }}
      >
        <input type="hidden" name="kind" value={kind} />
        <Field label="File da importare" htmlFor={`${uid}-file`} required error={fileError} hint="Formato .xlsx (primo foglio) o .csv, massimo 15 MB.">
          <input
            id={`${uid}-file`}
            name="file"
            type="file"
            required
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            aria-invalid={!!fileError || undefined}
            onChange={() => setClientError(null)}
            className="block w-full rounded-lg text-sm text-slate-700 ring-1 ring-inset ring-slate-300 file:mr-3 file:h-10 file:cursor-pointer file:border-0 file:bg-brand-50 file:px-4 file:text-sm file:font-medium file:text-brand-800 hover:file:bg-brand-100 aria-[invalid=true]:ring-red-500"
          />
        </Field>
        <SubmitButton
          variant="primary"
          className="w-full sm:w-auto"
          pendingText="Importazione in corso…"
          confirmMessage={
            kind === "contatti"
              ? "Importare i contatti dal file? I contatti esistenti vengono aggiornati, nessuno viene eliminato."
              : "Importare i prodotti dal file? I prodotti esistenti vengono aggiornati, nessuno viene eliminato."
          }
        >
          {kind === "contatti" ? "Importa contatti" : "Importa prodotti"}
        </SubmitButton>
      </form>

      {state && !state.ok && !state.fieldErrors?.file ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.ok && state.data && state.data.kind === kind ? <ImportSummaryView data={state.data} /> : null}
    </div>
  );
}

function ImportSummaryView({ data }: { data: ImportResultData }) {
  const isContacts = data.kind === "contatti";
  const stats: { label: string; value: number; tone?: string }[] = [
    { label: isContacts ? "Clienti creati" : "Prodotti creati", value: data.created, tone: "text-emerald-700" },
    { label: "Aggiornati", value: data.updated, tone: "text-brand-700" },
    { label: "Invariati", value: data.unchanged },
    { label: "Righe scartate", value: data.skipped.length, tone: data.skipped.length ? "text-amber-700" : undefined },
  ];
  if (isContacts) {
    stats.push(
      { label: "Agenti creati", value: data.agentsCreated ?? 0, tone: "text-emerald-700" },
      { label: "Agenti aggiornati", value: data.agentsUpdated ?? 0 },
    );
  }
  return (
    <div className="space-y-4 rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-200" role="status">
      <div>
        <p className="text-sm font-semibold text-slate-900">Import completato</p>
        <p className="text-xs text-slate-500">
          {data.fileName} · {formatNumber(data.rows, 0)} righe lette
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200">
            <dt className="text-xs text-slate-500">{s.label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${s.tone ?? "text-slate-900"}`}>{formatNumber(s.value, 0)}</dd>
          </div>
        ))}
      </dl>
      {data.skipped.length > 0 ? (
        <div>
          <p className="text-sm font-medium text-slate-800">Righe scartate</p>
          <ul className="mt-1.5 max-h-60 space-y-1 overflow-y-auto text-sm text-slate-600">
            {data.skipped.slice(0, SKIPPED_SHOWN).map((s, i) => (
              <li key={`${s.row}-${i}`}>
                <span className="font-medium tabular-nums text-slate-800">Riga {s.row}:</span> {s.reason}
              </li>
            ))}
          </ul>
          {data.skipped.length > SKIPPED_SHOWN ? (
            <p className="mt-1 text-xs text-slate-500">…e altre {data.skipped.length - SKIPPED_SHOWN} righe.</p>
          ) : null}
        </div>
      ) : null}
      <Link
        href={isContacts ? "/anagrafiche/contatti" : "/anagrafiche/prodotti"}
        className="inline-block text-sm font-medium text-brand-700 hover:underline"
      >
        {isContacts ? "Vai ai contatti →" : "Vai ai prodotti →"}
      </Link>
    </div>
  );
}
