"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contacts, products } from "@/db/schema";
import { fail, NOT_AUTHORIZED, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { getAuthorizedUser } from "@/lib/auth/session";
import { importContacts, importProducts, type ImportSummary } from "@/lib/import/import-db";
import { readTabularFile } from "@/lib/import/read-file";
import { safeReturnPath } from "@/lib/safe-path";
import { parseDbId } from "@/lib/validation";
import { IMPORT_EXTENSIONS, IMPORT_MAX_BYTES } from "@/components/anagrafiche/constants";
import { contactUsage, productUsage } from "./_lib/queries";
import { contactFromForm, contactInput, formText, productFromForm, productInput } from "./_lib/schemas";

type State<T = undefined> = ActionResult<T> | null;

const INVALID_FORM = "Controlla i campi evidenziati.";

/** Codice errore Postgres (drizzle può incapsulare l'errore del driver in `cause`). */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

function parseId(fd: FormData): number | null {
  return parseDbId(formText(fd, "id"));
}

/* ------------------------------------------------------------------ */
/* Contatti                                                            */
/* ------------------------------------------------------------------ */

/** Crea o aggiorna un contatto (campo nascosto `id` vuoto = nuovo). */
export async function saveContact(_prev: State, fd: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("registry.edit");
  if (!user) return NOT_AUTHORIZED;

  const parsed = contactInput.safeParse(contactFromForm(fd));
  if (!parsed.success) return fail(INVALID_FORM, zodFieldErrors(parsed.error.issues));
  const input = parsed.data;
  const agentId = input.type === "CLIENTE" ? input.agentId : null;

  if (agentId) {
    if (agentId === input.id) return fail(INVALID_FORM, { agentId: "Un contatto non può essere agente di sé stesso." });
    const agent = await db.query.contacts.findFirst({
      where: eq(contacts.id, agentId),
      columns: { id: true, type: true },
    });
    if (!agent || agent.type !== "AGENTE") return fail(INVALID_FORM, { agentId: "Seleziona un agente valido." });
  }

  const values = {
    type: input.type,
    name: input.name,
    company: input.company,
    email: input.email,
    phone: input.phone,
    country: input.country,
    defaultAddress: input.defaultAddress,
    language: input.language,
    agentId,
    notes: input.notes,
    active: input.active,
  };

  if (input.id) {
    const current = await db.query.contacts.findFirst({
      where: eq(contacts.id, input.id),
      columns: { id: true, type: true },
    });
    if (!current) return fail("Contatto non trovato: potrebbe essere stato eliminato.");
    if (current.type === "AGENTE" && input.type === "CLIENTE") {
      const { clients } = await contactUsage(input.id);
      if (clients > 0) {
        return fail(INVALID_FORM, {
          type: `È l'agente di riferimento di ${clients} client${clients === 1 ? "e" : "i"}: assegnali a un altro agente prima di cambiarne il tipo.`,
        });
      }
    }
    await db.update(contacts).set(values).where(eq(contacts.id, input.id));
    revalidatePath("/", "layout");
    return { ok: true, message: "Modifiche salvate." };
  }

  const [row] = await db.insert(contacts).values(values).returning({ id: contacts.id });
  revalidatePath("/", "layout");
  const ritorno = safeReturnPath(fd.get("ritorno"));
  if (ritorno) redirect(`${ritorno}${ritorno.includes("?") ? "&" : "?"}contatto=${row.id}`);
  redirect(`/anagrafiche/contatti/${row.id}?creato=1`);
}

/** Toglie il segnale "Da verificare" (contatti dal modulo pubblico o importati con dati mancanti). */
export async function markContactVerified(_prev: State, fd: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("registry.edit");
  if (!user) return NOT_AUTHORIZED;
  const id = parseId(fd);
  if (!id) return fail("Contatto non valido.");
  const updated = await db
    .update(contacts)
    .set({ needsReview: false })
    .where(eq(contacts.id, id))
    .returning({ id: contacts.id });
  if (!updated.length) return fail("Contatto non trovato.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Contatto segnato come verificato." };
}

export async function deleteContact(_prev: State, fd: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("registry.edit");
  if (!user) return NOT_AUTHORIZED;
  const id = parseId(fd);
  if (!id) return fail("Contatto non valido.");

  const { requests, clients } = await contactUsage(id);
  if (requests > 0) {
    return fail(
      `Il contatto ha ${requests} richiest${requests === 1 ? "a" : "e"} collegat${requests === 1 ? "a" : "e"} e non può essere eliminato: disattivalo per nasconderlo dai moduli.`,
    );
  }
  if (clients > 0) {
    return fail(
      `L'agente ha ${clients} client${clients === 1 ? "e" : "i"} assegnat${clients === 1 ? "o" : "i"}: riassegnali o disattiva l'agente.`,
    );
  }
  try {
    const deleted = await db.delete(contacts).where(eq(contacts.id, id)).returning({ id: contacts.id });
    if (!deleted.length) return fail("Contatto non trovato.");
  } catch (err) {
    if (pgCode(err) === "23503") {
      return fail("Il contatto è collegato ad altri dati e non può essere eliminato: disattivalo.");
    }
    throw err;
  }
  revalidatePath("/", "layout");
  redirect("/anagrafiche/contatti?eliminato=1");
}

/* ------------------------------------------------------------------ */
/* Prodotti                                                            */
/* ------------------------------------------------------------------ */

const DUPLICATE_CODE = (code: string) => `Esiste già un prodotto con il codice ${code}.`;

export async function saveProduct(_prev: State, fd: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("registry.edit");
  if (!user) return NOT_AUTHORIZED;

  const parsed = productInput.safeParse(productFromForm(fd));
  if (!parsed.success) return fail(INVALID_FORM, zodFieldErrors(parsed.error.issues));
  const { id, ...values } = parsed.data;

  // il codice è unico senza distinzione tra maiuscole e minuscole (indice su upper(code))
  const dup = await db
    .select({ id: products.id, code: products.code })
    .from(products)
    .where(
      and(
        eq(sql`upper(${products.code})`, values.code.toUpperCase()),
        id ? ne(products.id, id) : undefined,
      ),
    )
    .limit(1);
  if (dup.length) return fail(INVALID_FORM, { code: DUPLICATE_CODE(dup[0].code) });

  let createdId: number | null = null;
  try {
    if (id) {
      const updated = await db.update(products).set(values).where(eq(products.id, id)).returning({ id: products.id });
      if (!updated.length) return fail("Prodotto non trovato: potrebbe essere stato eliminato.");
    } else {
      const [row] = await db.insert(products).values(values).returning({ id: products.id });
      createdId = row.id;
    }
  } catch (err) {
    // corsa con un altro salvataggio dello stesso codice: lo segnala l'indice unico
    if (pgCode(err) === "23505") return fail(INVALID_FORM, { code: DUPLICATE_CODE(values.code) });
    throw err;
  }
  revalidatePath("/", "layout");
  if (createdId) redirect(`/anagrafiche/prodotti/${createdId}?creato=1`);
  return { ok: true, message: "Modifiche salvate." };
}

export async function deleteProduct(_prev: State, fd: FormData): Promise<ActionResult> {
  const user = await getAuthorizedUser("registry.edit");
  if (!user) return NOT_AUTHORIZED;
  const id = parseId(fd);
  if (!id) return fail("Prodotto non valido.");

  const usage = await productUsage(id);
  if (usage.items > 0 || usage.pieces > 0) {
    return fail("Il prodotto compare in richieste già registrate e non può essere eliminato: disattivalo per nasconderlo dai moduli.");
  }
  try {
    const deleted = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
    if (!deleted.length) return fail("Prodotto non trovato.");
  } catch (err) {
    if (pgCode(err) === "23503") return fail("Il prodotto è usato in alcune richieste: disattivalo invece di eliminarlo.");
    throw err;
  }
  revalidatePath("/", "layout");
  redirect("/anagrafiche/prodotti?eliminato=1");
}

/* ------------------------------------------------------------------ */
/* Import da file                                                      */
/* ------------------------------------------------------------------ */

export type ImportResultData = ImportSummary & { kind: "contatti" | "prodotti"; fileName: string; rows: number };

const importKind = z.enum(["contatti", "prodotti"]);

/** Colonne indispensabili (stesse varianti riconosciute da src/lib/import/parse.ts). */
const REQUIRED_COLUMNS: Record<"contatti" | "prodotti", { names: string[]; label: string }> = {
  contatti: { names: ["name", "nome", "ragionesociale", "cliente"], label: "Name (nome o ragione sociale)" },
  prodotti: { names: ["codicearticolo", "codice", "sku", "skucode", "code"], label: "Codice_articolo" },
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function importRegistryFile(_prev: State<ImportResultData>, fd: FormData): Promise<ActionResult<ImportResultData>> {
  const user = await getAuthorizedUser("registry.edit");
  if (!user) return NOT_AUTHORIZED;

  const kind = importKind.safeParse(formText(fd, "kind"));
  if (!kind.success) return fail("Tipo di import non valido.");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Seleziona un file .xlsx o .csv.", { file: "Seleziona un file" });
  const name = file.name || "file";
  if (!IMPORT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
    return fail("Formato non supportato: carica un file .xlsx o .csv.", { file: "Formato non supportato" });
  }
  if (file.size > IMPORT_MAX_BYTES) return fail("Il file supera i 15 MB.", { file: "File troppo grande" });

  let rows;
  try {
    rows = await readTabularFile(name, await file.arrayBuffer());
  } catch (err) {
    console.error("Import anagrafiche: lettura file non riuscita", err);
    return fail("Impossibile leggere il file: verifica che sia un .xlsx valido (primo foglio) o un .csv con intestazioni.");
  }
  if (rows.length === 0) return fail("Il file non contiene righe da importare (la prima riga deve contenere le intestazioni).");

  const headers = new Set(rows.slice(0, 20).flatMap((r) => Object.keys(r).map(normalizeHeader)));
  const required = REQUIRED_COLUMNS[kind.data];
  if (!required.names.some((n) => headers.has(n))) {
    return fail(
      `Colonna "${required.label}" non trovata. Controlla di aver scelto il file giusto (${kind.data === "contatti" ? "contatti" : "prodotti"}) e che la prima riga contenga le intestazioni.`,
    );
  }

  let summary: ImportSummary;
  try {
    summary = kind.data === "contatti" ? await importContacts(rows) : await importProducts(rows);
  } catch (err) {
    console.error("Import anagrafiche: errore durante il salvataggio", err);
    return fail("Errore durante il salvataggio dei dati: l'import potrebbe essere stato applicato solo in parte. Riprova o contatta l'amministratore.");
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Import completato: ${summary.created} nuov${summary.created === 1 ? "o" : "i"}, ${summary.updated} aggiornat${summary.updated === 1 ? "o" : "i"}.`,
    data: { ...summary, kind: kind.data, fileName: name, rows: rows.length },
  };
}
