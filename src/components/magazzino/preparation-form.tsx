"use client";

import { useId, useState } from "react";
import { markReady, updateWarehouse } from "@/app/(app)/magazzino/actions";
import { ActionMessage } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import type { RequestStatus } from "@/db/schema";
import { formatKg, parseDecimal } from "@/lib/format";
import { transitionProblems, type WorkflowSnapshot } from "@/lib/requests/workflow";
import { PendingButton } from "./pending-button";
import { StepperInput } from "./stepper-input";
import { fieldError, useFormAction } from "./use-form-action";

type Notice = { tone: "success" | "warning" | "error"; text: string };

const NOTICE_CLASSES: Record<Notice["tone"], string> = {
  success: "text-emerald-800",
  warning: "text-amber-800",
  error: "text-red-700",
};

function toInputValue(value: number | null): string {
  return value === null ? "" : String(value).replace(".", ",");
}

function CheckIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <svg viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-emerald-600" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
        clipRule="evenodd"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="10" cy="10" r="7" />
    </svg>
  );
}

/**
 * Colli, peso e note di magazzino + passaggio a «Pronta per il ritiro».
 * Il pulsante «Pronta per il ritiro» salva anche i valori digitati, poi fa avanzare la richiesta.
 * Resta montato anche dopo il passaggio di stato, così il messaggio dell'esito (es. avviso bolla) rimane visibile.
 */
export function PreparationForm({
  requestId,
  code,
  status,
  initial,
  snapshot,
  readyInfo,
  bollaNotice,
}: {
  requestId: number;
  code: string;
  status: RequestStatus;
  initial: { packagesCount: number | null; weightKg: number | null; warehouseNotes: string | null };
  snapshot: WorkflowSnapshot;
  /** Es. "Segnata pronta il 20/10/2026 alle 09:15 da Mario Rossi". */
  readyInfo: string | null;
  /** Esito dell'avviso bolla alla logistica, se previsto. */
  bollaNotice: Notice | null;
}) {
  const id = useId();
  const [packages, setPackages] = useState(initial.packagesCount === null ? "" : String(initial.packagesCount));
  const [weight, setWeight] = useState(toInputValue(initial.weightKg));
  const [notes, setNotes] = useState(initial.warehouseNotes ?? "");
  const [acknowledgeNoPieces, setAcknowledgeNoPieces] = useState(false);

  const { state, pending, onSubmit } = useFormAction((prev, formData) => {
    if (formData.get("intent") === "ready") {
      formData.set("saveData", "1");
      return markReady(prev, formData);
    }
    return updateWarehouse(prev, formData);
  });

  const inPreparation = status === "IN_PREPARAZIONE";
  const isReady = status === "PRONTA_RITIRO";

  // Controlli del flusso sui valori digitati (vengono salvati insieme al passaggio di stato).
  const liveWeight = parseDecimal(weight);
  const live = {
    packagesCount: packages.trim() && Number.isInteger(Number(packages)) ? Number(packages) : null,
    weightKg: liveWeight === null || Number.isNaN(liveWeight) ? null : liveWeight,
  };
  const problems = inPreparation
    ? transitionProblems({ ...snapshot, ...live }, "PRONTA_RITIRO", { acknowledgeNoPieces })
    : [];
  const done: string[] = [];
  if (live.packagesCount && live.packagesCount >= 1) done.push(`${live.packagesCount} ${live.packagesCount === 1 ? "collo" : "colli"}`);
  if (live.weightKg && live.weightKg > 0) done.push(`Peso ${formatKg(live.weightKg)}`);
  if (snapshot.piecesCount > 0) done.push("Misure dei pezzi registrate");
  else if (acknowledgeNoPieces) done.push("Nessun pezzo da misurare");

  const confirmMessage = `Segnare ${code} come pronta per il ritiro?${
    snapshot.deliveryFormRequired ? " La logistica riceverà l'avviso per preparare la bolla di consegna." : ""
  }`;

  return (
    <form onSubmit={onSubmit} className="space-y-5" aria-label="Colli e peso">
      <input type="hidden" name="requestId" value={requestId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="N° colli" htmlFor={`${id}-packages`} error={fieldError(state, "packagesCount")}>
          <StepperInput
            id={`${id}-packages`}
            name="packagesCount"
            label="numero colli"
            min={1}
            max={999}
            placeholder="es. 1"
            value={packages}
            onChange={setPackages}
            invalid={Boolean(fieldError(state, "packagesCount"))}
          />
        </Field>
        <Field
          label="Peso totale (kg)"
          htmlFor={`${id}-weight`}
          error={fieldError(state, "weightKg")}
          hint="Con la virgola, es. 4,8"
        >
          <Input
            id={`${id}-weight`}
            name="weightKg"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="es. 4,8"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            aria-invalid={Boolean(fieldError(state, "weightKg")) || undefined}
            className="h-12 text-base! tabular-nums"
          />
        </Field>
      </div>

      <Field label="Note magazzino" htmlFor={`${id}-notes`} error={fieldError(state, "warehouseNotes")}>
        <Textarea
          id={`${id}-notes`}
          name="warehouseNotes"
          rows={2}
          maxLength={2000}
          placeholder="es. imballo in cassa di legno, pezzo sostitutivo…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="text-base!"
        />
      </Field>

      {inPreparation ? (
        <div className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200" id={`${id}-checklist`}>
          <p className="text-sm font-semibold text-slate-900">Prima di segnarla pronta per il ritiro</p>
          <ul className="space-y-1.5 text-sm">
            {done.map((d) => (
              <li key={d} className="flex gap-2 text-slate-700">
                <CheckIcon ok />
                <span>{d}</span>
              </li>
            ))}
            {problems.map((p) => (
              <li key={p} className="flex gap-2 font-medium text-amber-900">
                <CheckIcon ok={false} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {snapshot.piecesCount === 0 ? (
            <Checkbox
              name="acknowledgeNoPieces"
              checked={acknowledgeNoPieces}
              onChange={(e) => setAcknowledgeNoPieces(e.target.checked)}
              label="Nessun pezzo da misurare (es. mazzetta colori)"
              hint="Spunta solo se il campionario non contiene pezzi da misurare."
              className="rounded-lg bg-white p-3 ring-1 ring-slate-200"
            />
          ) : null}
        </div>
      ) : null}

      {isReady ? (
        <div className="space-y-1 rounded-xl bg-emerald-50 p-4 text-sm ring-1 ring-emerald-200">
          <p className="flex gap-2 font-semibold text-emerald-900">
            <CheckIcon ok />
            Pronta per il ritiro
          </p>
          {readyInfo ? <p className="pl-7 text-emerald-900">{readyInfo}</p> : null}
          {bollaNotice ? <p className={`pl-7 ${NOTICE_CLASSES[bollaNotice.tone]}`}>{bollaNotice.text}</p> : null}
        </div>
      ) : null}

      {/* «Salva» è il primo pulsante: è quello usato se si preme Invio in un campo. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <PendingButton pending={pending} name="intent" value="save" variant="secondary" pendingText="Salvataggio…">
          {isReady ? "Salva correzioni" : "Salva"}
        </PendingButton>
        {inPreparation ? (
          <PendingButton
            pending={pending}
            name="intent"
            value="ready"
            variant="success"
            disabled={problems.length > 0}
            aria-describedby={`${id}-checklist`}
            confirmMessage={confirmMessage}
            pendingText="Invio in corso…"
            className="sm:min-w-56"
          >
            Pronta per il ritiro
          </PendingButton>
        ) : null}
        {isReady ? (
          <LinkButton href="/magazzino" size="lg" variant="ghost">
            ← Torna alla coda magazzino
          </LinkButton>
        ) : null}
      </div>

      <ActionMessage state={state} />
    </form>
  );
}
