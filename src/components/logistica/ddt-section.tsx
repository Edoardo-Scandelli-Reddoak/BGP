"use client";

import { useId, useState } from "react";
import { removeDdtFile, uploadDdtFile } from "@/app/(app)/logistica/actions";
import { ActionMessage } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { ActionButton } from "./action-button";
import { useActionForm } from "./use-action-form";

/** Stesso limite del servizio (DDT_MAX_BYTES), controllato anche qui per evitare upload inutili. */
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

export type DdtFileInfo = {
  id: number;
  fileName: string;
  sizeLabel: string;
  uploadedAtLabel: string;
};

/** Upload, download e rimozione del DDT firmato o scansionato (PDF, JPG o PNG). */
export function DdtSection({ requestId, ddt, editable }: { requestId: number; ddt: DdtFileInfo | null; editable: boolean }) {
  const inputId = useId();
  const [localError, setLocalError] = useState<string | null>(null);
  const upload = useActionForm(uploadDdtFile.bind(null, requestId));
  const remove = useActionForm(removeDdtFile.bind(null, requestId));
  const href = `/api/richieste/${requestId}/ddt`;

  return (
    <div className="space-y-3">
      {ddt ? (
        <div className="flex flex-col gap-3 rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <a href={href} target="_blank" rel="noopener" className="font-medium break-all text-brand-700 hover:underline">
              {ddt.fileName}
            </a>
            <p className="text-xs text-slate-500">
              {ddt.sizeLabel} · caricato il {ddt.uploadedAtLabel}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`${href}?download=1`} className={buttonClasses("secondary", "sm")}>
              Scarica
            </a>
            {editable ? (
              <form onSubmit={remove.onSubmit}>
                <ActionButton
                  variant="ghost"
                  size="sm"
                  pending={remove.pending}
                  pendingText="Rimozione…"
                  className="text-red-700 hover:bg-red-50"
                  data-confirm="Rimuovere il DDT caricato?"
                >
                  Rimuovi
                </ActionButton>
              </form>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Nessun DDT caricato.</p>
      )}
      {/* Dopo un nuovo caricamento il vecchio «DDT rimosso» non serve più. */}
      {remove.state && (!remove.state.ok || !ddt) ? <ActionMessage state={remove.state} /> : null}

      {editable ? (
        <form onSubmit={upload.onSubmit} className="space-y-2" key={ddt?.id ?? "nessuno"}>
          <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
            {ddt ? "Sostituisci il DDT" : "Carica il DDT"}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id={inputId}
              name="file"
              type="file"
              accept={ACCEPT}
              required
              aria-invalid={localError || upload.fieldErrors.file ? true : undefined}
              aria-describedby={`${inputId}-hint`}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                setLocalError(file && file.size > MAX_BYTES ? "Il file supera i 10 MB: riducilo o scansionalo a risoluzione più bassa." : null);
              }}
              className="block w-full text-sm text-slate-700 file:mr-3 file:h-10 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:text-sm file:font-medium file:text-brand-800 hover:file:bg-brand-100"
            />
            <ActionButton
              variant="secondary"
              pending={upload.pending}
              disabled={Boolean(localError)}
              pendingText="Caricamento…"
              className="w-full sm:w-auto"
            >
              {ddt ? "Sostituisci" : "Carica DDT"}
            </ActionButton>
          </div>
          <p id={`${inputId}-hint`} className="text-xs text-slate-500">
            PDF, JPG o PNG fino a 10 MB. Il DDT caricato viene allegato alla conferma di spedizione al cliente.
          </p>
          {localError ? (
            <p className="text-sm text-red-600" role="alert">
              {localError}
            </p>
          ) : null}
          <ActionMessage state={upload.state} />
        </form>
      ) : null}
    </div>
  );
}
