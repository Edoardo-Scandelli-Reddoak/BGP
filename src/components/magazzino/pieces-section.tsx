"use client";

import { useId, useRef, useState, type RefObject } from "react";
import { addPiece, deletePiece, updatePiece } from "@/app/(app)/magazzino/actions";
import { ActionMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import { formatM2, parseDecimal, pieceAreaM2 } from "@/lib/format";
import { formatCm } from "./format";
import { PendingButton } from "./pending-button";
import { StepperInput } from "./stepper-input";
import type { PieceGroup, WarehousePiece, WarehouseProduct } from "./types";
import { fieldError, useFormAction, type FormActionState } from "./use-form-action";

/* ------------------------------------------------------------------ */
/* Utilità                                                             */
/* ------------------------------------------------------------------ */

type PieceValues = { productId: string; length: string; width: string; quantity: string; note: string };

// "!" perché le classi base di Input/Select (text-sm) vincerebbero per ordine nel CSS.
const BIG = "h-12 text-base!";

/** Valore per un campo di testo modificabile: "19.5" → "19,5". */
function toInputValue(value: number): string {
  return String(value).replace(".", ",");
}

/** Stesso arrotondamento del database (una cifra decimale) e della server action. */
function previewArea(values: PieceValues): number | null {
  const l = parseDecimal(values.length);
  const w = parseDecimal(values.width);
  const q = values.quantity.trim() ? Number(values.quantity) : 1;
  if (l === null || w === null || Number.isNaN(l) || Number.isNaN(w) || l <= 0 || w <= 0) return null;
  if (!Number.isInteger(q) || q < 1) return null;
  return pieceAreaM2(Math.round(l * 10) / 10, Math.round(w * 10) / 10, q);
}

function productLabel(p: WarehouseProduct): string {
  const desc = p.description.length > 60 ? `${p.description.slice(0, 60).trimEnd()}…` : p.description;
  return desc ? `${p.code} — ${desc}` : p.code;
}

/* ------------------------------------------------------------------ */
/* Campi del pezzo (aggiunta e modifica)                               */
/* ------------------------------------------------------------------ */

function PieceFields({
  products,
  values,
  onChange,
  state,
  lengthRef,
}: {
  products: WarehouseProduct[];
  values: PieceValues;
  onChange: (patch: Partial<PieceValues>) => void;
  state: FormActionState;
  lengthRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const widthRef = useRef<HTMLInputElement>(null);
  const area = previewArea(values);

  return (
    <div className="space-y-4">
      <Field label="Prodotto" htmlFor={`${id}-product`} error={fieldError(state, "productId")} required>
        <Select
          id={`${id}-product`}
          name="productId"
          required
          value={values.productId}
          onChange={(e) => onChange({ productId: e.target.value })}
          aria-invalid={Boolean(fieldError(state, "productId")) || undefined}
          className={BIG}
        >
          {products.length !== 1 ? <option value="">Scegli il prodotto…</option> : null}
          {products.map((p) => (
            <option key={p.productId} value={p.productId}>
              {productLabel(p)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Lunghezza (cm)" htmlFor={`${id}-length`} error={fieldError(state, "lengthCm")} required>
          <Input
            ref={lengthRef}
            id={`${id}-length`}
            name="lengthCm"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="es. 122"
            required
            value={values.length}
            onChange={(e) => onChange({ length: e.target.value })}
            onKeyDown={(e) => {
              // Dal tastierino del telefono: «Avanti» passa alla larghezza invece di inviare.
              if (e.key === "Enter") {
                e.preventDefault();
                widthRef.current?.focus();
              }
            }}
            aria-invalid={Boolean(fieldError(state, "lengthCm")) || undefined}
            className={BIG}
          />
        </Field>
        <Field label="Larghezza (cm)" htmlFor={`${id}-width`} error={fieldError(state, "widthCm")} required>
          <Input
            ref={widthRef}
            id={`${id}-width`}
            name="widthCm"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="es. 19,5"
            required
            value={values.width}
            onChange={(e) => onChange({ width: e.target.value })}
            aria-invalid={Boolean(fieldError(state, "widthCm")) || undefined}
            className={BIG}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 items-end gap-3">
        <Field label="Quantità pezzi uguali" htmlFor={`${id}-qty`} error={fieldError(state, "quantity")}>
          <StepperInput
            id={`${id}-qty`}
            name="quantity"
            label="quantità"
            min={1}
            value={values.quantity}
            onChange={(quantity) => onChange({ quantity })}
            invalid={Boolean(fieldError(state, "quantity"))}
          />
        </Field>
        <div
          className="flex h-12 items-center justify-center rounded-lg bg-brand-50 px-3 text-base font-semibold text-brand-900 ring-1 ring-inset ring-brand-200"
          aria-live="polite"
        >
          <span className="sr-only">Superficie calcolata: </span>
          {area === null ? <span className="text-brand-400">= — m²</span> : <>= {formatM2(area)}</>}
        </div>
      </div>

      <Field label="Note sullo stato del pezzo" htmlFor={`${id}-note`} error={fieldError(state, "conditionNote")}>
        <Input
          id={`${id}-note`}
          name="conditionNote"
          type="text"
          autoComplete="off"
          maxLength={500}
          placeholder="es. leggero graffio su un lato"
          value={values.note}
          onChange={(e) => onChange({ note: e.target.value })}
          className={BIG}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aggiunta                                                            */
/* ------------------------------------------------------------------ */

function AddPieceForm({ requestId, products }: { requestId: number; products: WarehouseProduct[] }) {
  const lengthRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<PieceValues>({
    productId: products.length === 1 ? String(products[0].productId) : "",
    length: "",
    width: "",
    quantity: "1",
    note: "",
  });

  const { state, pending, onSubmit } = useFormAction(addPiece, (result) => {
    if (!result.ok) return;
    // Stesso prodotto selezionato, misure svuotate: si passa subito al pezzo successivo.
    setValues((v) => ({ ...v, length: "", width: "", quantity: "1", note: "" }));
    lengthRef.current?.focus();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200" aria-label="Aggiungi pezzo misurato">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-semibold text-slate-900">Aggiungi pezzo</p>
      <PieceFields
        products={products}
        values={values}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        state={state}
        lengthRef={lengthRef}
      />
      <PendingButton pending={pending} pendingText="Salvataggio…" className="w-full sm:w-auto">
        Aggiungi pezzo
      </PendingButton>
      <ActionMessage state={state} />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Modifica ed eliminazione                                            */
/* ------------------------------------------------------------------ */

function EditPieceForm({
  piece,
  products,
  onCancel,
  onSaved,
}: {
  piece: WarehousePiece;
  products: WarehouseProduct[];
  onCancel: () => void;
  onSaved: (result: ActionResult) => void;
}) {
  const [values, setValues] = useState<PieceValues>({
    productId: String(piece.productId),
    length: toInputValue(piece.lengthCm),
    width: toInputValue(piece.widthCm),
    quantity: String(piece.quantity),
    note: piece.conditionNote ?? "",
  });
  const { state, pending, onSubmit } = useFormAction(updatePiece, (result) => {
    if (result.ok) onSaved(result);
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg bg-white p-4 ring-2 ring-brand-300" aria-label="Modifica pezzo">
      <input type="hidden" name="pieceId" value={piece.id} />
      <PieceFields
        products={products}
        values={values}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        state={state}
      />
      <div className="flex flex-wrap gap-2">
        <PendingButton pending={pending} pendingText="Salvataggio…">
          Salva modifiche
        </PendingButton>
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={pending}>
          Annulla
        </Button>
      </div>
      {state && !state.ok ? <ActionMessage state={state} /> : null}
    </form>
  );
}

function PieceRow({
  piece,
  editable,
  onEdit,
  onResult,
}: {
  piece: WarehousePiece;
  editable: boolean;
  onEdit: () => void;
  onResult: (result: ActionResult) => void;
}) {
  const { pending, onSubmit } = useFormAction(deletePiece, onResult);
  const size = `${formatCm(piece.lengthCm)} × ${formatCm(piece.widthCm)} cm`;

  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3", pending && "opacity-50")}>
      <div className="min-w-0">
        <p className="text-base text-slate-900">
          <span className="font-semibold tabular-nums">{size}</span>
          <span className="text-slate-500"> × {piece.quantity}</span>
          <span className="font-semibold tabular-nums text-brand-800"> = {formatM2(piece.areaM2)}</span>
        </p>
        {piece.conditionNote ? <p className="mt-0.5 text-sm text-amber-800">Stato: {piece.conditionNote}</p> : null}
      </div>
      {editable ? (
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onEdit} aria-label={`Modifica pezzo ${size}`} disabled={pending}>
            Modifica
          </Button>
          <form onSubmit={onSubmit}>
            <input type="hidden" name="pieceId" value={piece.id} />
            <PendingButton
              pending={pending}
              size="md"
              variant="ghost"
              className="text-red-700! hover:bg-red-50!"
              confirmMessage={`Eliminare il pezzo ${size} × ${piece.quantity}?`}
              aria-label={`Elimina pezzo ${size}`}
            >
              Elimina
            </PendingButton>
          </form>
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Sezione completa                                                    */
/* ------------------------------------------------------------------ */

/** Inserimento rapido dei pezzi misurati ed elenco raggruppato per prodotto. */
export function PiecesSection({
  requestId,
  products,
  groups,
  editable,
}: {
  requestId: number;
  products: WarehouseProduct[];
  groups: PieceGroup[];
  editable: boolean;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<ActionResult | null>(null);

  return (
    <div className="space-y-5">
      {editable && products.length > 0 ? <AddPieceForm requestId={requestId} products={products} /> : null}

      {notice ? <ActionMessage state={notice} /> : null}

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Nessun pezzo misurato.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.productId} className="rounded-lg ring-1 ring-slate-200">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-semibold text-slate-900">{g.code}</p>
                  <p className="truncate text-xs text-slate-500" title={g.description}>
                    {g.description}
                  </p>
                </div>
                <p className="text-sm font-medium text-slate-700 tabular-nums">
                  {g.piecesCount} {g.piecesCount === 1 ? "pezzo" : "pezzi"} · {formatM2(g.m2)}
                </p>
              </div>
              <ul className="divide-y divide-slate-100 px-4">
                {g.pieces.map((p) =>
                  editingId === p.id ? (
                    <li key={p.id} className="py-3">
                      <EditPieceForm
                        piece={p}
                        products={products}
                        onCancel={() => setEditingId(null)}
                        onSaved={(result) => {
                          setEditingId(null);
                          setNotice(result);
                        }}
                      />
                    </li>
                  ) : (
                    <PieceRow
                      key={p.id}
                      piece={p}
                      editable={editable}
                      onEdit={() => {
                        setEditingId(p.id);
                        setNotice(null);
                      }}
                      onResult={setNotice}
                    />
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
