"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, NOT_AUTHORIZED, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { getAuthorizedUser } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format";
import { cleanLabel, PRODUCT_LABEL_MAX, PRODUCT_LABEL_NAMES, type ProductLabelField } from "@/lib/products/labels";
import { assignProductLabels, clearProductLabel, renameProductLabel } from "@/lib/products/labels-db";
import { parseProductFilters, productWhere } from "../_lib/queries";
import { formText } from "../_lib/schemas";

type State = ActionResult | null;

const INVALID_FORM = "Controlla i campi evidenziati.";

const labelText = z.string().trim().max(PRODUCT_LABEL_MAX, `Massimo ${PRODUCT_LABEL_MAX} caratteri`);

/** «1 prodotto aggiornato» / «37 prodotti aggiornati». */
function productsUpdated(n: number): string {
  return n === 1 ? "1 prodotto aggiornato" : `${formatNumber(n, 0)} prodotti aggiornati`;
}

/** Desinenza del participio: «il marchio … rinominato», «la categoria … rinominata». */
const ENDING: Record<ProductLabelField, string> = { brand: "o", category: "a" };

/** «al marchio» / «alla categoria». */
const TO_THE: Record<ProductLabelField, string> = { brand: "al marchio", category: "alla categoria" };

/** «A», «B» */
function quoted(values: string[]): string {
  return values.map((v) => `«${v}»`).join(", ");
}

/* ------------------------------------------------------------------ */
/* Assegnazione in blocco ai prodotti filtrati                         */
/* ------------------------------------------------------------------ */

const assignInput = z.object({
  brand: labelText,
  category: labelText,
  mode: z.enum(["mancanti", "sostituisci"], { error: "Scegli a quali prodotti assegnare i valori" }),
});

/**
 * Assegna marchio e/o categoria a tutti i prodotti dell'elenco filtrato. I filtri arrivano dai campi
 * nascosti del form (stessi parametri dell'elenco) e vengono riapplicati qui con un solo UPDATE.
 */
export async function assignLabelsToFilteredProducts(_prev: State, fd: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("registry.edit");
  if (!user) return NOT_AUTHORIZED;

  const parsed = assignInput.safeParse({
    brand: formText(fd, "brand"),
    category: formText(fd, "category"),
    mode: formText(fd, "mode"),
  });
  if (!parsed.success) return fail(INVALID_FORM, zodFieldErrors(parsed.error.issues));
  const { brand, category, mode } = parsed.data;
  if (!cleanLabel(brand) && !cleanLabel(category)) {
    return fail("Indica il marchio, la categoria o entrambi.", {
      brand: "Indica almeno uno dei due valori",
      category: "Indica almeno uno dei due valori",
    });
  }

  const filters = parseProductFilters({
    q: formText(fd, "q"),
    attivi: formText(fd, "attivi"),
    marchio: formText(fd, "marchio"),
    categoria: formText(fd, "categoria"),
  });
  const overwrite = mode === "sostituisci";
  const result = await assignProductLabels(productWhere(filters), { brand, category, overwrite });
  revalidatePath("/", "layout");

  const what = [
    result.brand ? `marchio «${result.brand}»` : null,
    result.category ? `categoria «${result.category}»` : null,
  ]
    .filter(Boolean)
    .join(" e ");
  // grafia allineata ai valori già in uso o ai suggerimenti del blueprint («gaia parquet» → «Gaia Parquet»)
  const aligned = [
    [cleanLabel(brand), result.brand],
    [cleanLabel(category), result.category],
  ]
    .filter(([typed, saved]) => typed && saved && typed !== saved)
    .map(([typed, saved]) => `«${typed}» → «${saved}»`);
  const alignedNote = aligned.length ? ` Grafia allineata ai valori esistenti: ${aligned.join(", ")}.` : "";

  if (result.updated === 0) {
    const fields = result.brand && result.category ? "marchio e categoria" : result.brand ? "un marchio" : "una categoria";
    return {
      ok: true,
      message: overwrite
        ? `Nessun prodotto modificato: i prodotti filtrati hanno già ${what}.`
        : `Nessun prodotto modificato: i prodotti filtrati hanno già ${fields}. Per cambiarli scegli «Sostituisci anche i valori già presenti».`,
    };
  }
  return { ok: true, message: `${productsUpdated(result.updated)} con ${what}.${alignedNote}` };
}

/* ------------------------------------------------------------------ */
/* Rinomina / unione e rimozione di un valore                          */
/* ------------------------------------------------------------------ */

const labelValueInput = z.object({
  op: z.enum(["rinomina", "togli"]),
  field: z.enum(["brand", "category"]),
  /** Valore attuale, esattamente come salvato. */
  value: z.string().min(1).max(1000),
  to: labelText,
});

/** «Rinomina» (anche unione con un valore esistente) e «Togli dai prodotti» della pagina Marchi e categorie. */
export async function editProductLabelValue(_prev: State, fd: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("registry.edit");
  if (!user) return NOT_AUTHORIZED;

  const parsed = labelValueInput.safeParse({
    op: formText(fd, "op"),
    field: formText(fd, "field"),
    value: formText(fd, "value"),
    to: formText(fd, "to"),
  });
  if (!parsed.success) {
    const errors = zodFieldErrors(parsed.error.issues);
    return errors.to ? fail(INVALID_FORM, { to: errors.to }) : fail("Richiesta non valida: aggiorna la pagina e riprova.");
  }
  const { op, field, value, to } = parsed.data;
  const name = PRODUCT_LABEL_NAMES[field].singular;
  const end = ENDING[field];
  const gone = `${name} «${value}» non è più usat${end} da nessun prodotto: l'elenco è stato aggiornato.`;

  if (op === "togli") {
    const updated = await clearProductLabel(field, value);
    revalidatePath("/", "layout");
    if (updated === 0) return fail(gone);
    return { ok: true, message: `${name} «${value}» tolt${end} dai prodotti: ${productsUpdated(updated)}.` };
  }

  const result = await renameProductLabel(field, value, to);
  switch (result.status) {
    case "empty":
      return fail(INVALID_FORM, { to: "Indica il nuovo nome" });
    case "unchanged":
      return fail(INVALID_FORM, { to: "Il nuovo nome è uguale a quello attuale" });
    case "not-found":
      revalidatePath("/", "layout");
      return fail(gone);
  }
  revalidatePath("/", "layout");
  const updated = productsUpdated(result.updated);
  if (!result.merged) {
    return { ok: true, message: `${name} «${value}» rinominat${end} in «${result.value}»: ${updated}.` };
  }
  // il nome scritto è quello attuale: le altre varianti si uniscono a questo valore
  if (result.value === value) {
    const one = result.replaced.length === 1;
    return {
      ok: true,
      message: `Unit${one ? "a" : "e"} ${TO_THE[field]} «${value}» ${one ? "la variante" : "le varianti"} ${quoted(result.replaced)}: ${updated}.`,
    };
  }
  const others = result.replaced.filter((v) => v !== value);
  const also = others.length ? ` (unit${others.length === 1 ? "a anche la variante" : "e anche le varianti"} ${quoted(others)})` : "";
  return { ok: true, message: `${name} «${value}» unit${end} a «${result.value}» già esistente${also}: ${updated}.` };
}
