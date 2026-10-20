import "server-only";
import { and, asc, count, eq, gte, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import {
  contacts,
  languageEnum,
  products,
  requestItems,
  sampleRequests,
  statusEvents,
  type ContactType,
  type Language,
} from "@/db/schema";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { isValidEmail, parseEmailList } from "@/lib/email/recipients";
import { formatDate, LANGUAGE_LABELS, requestCode } from "@/lib/format";
import { likePattern } from "@/lib/search";
import { getSettings } from "@/lib/settings";

/**
 * Richieste dal modulo pubblico /richiedi-campioni (senza login).
 * Riconosce agente e cliente dall'email, crea i contatti mancanti da verificare (needsReview)
 * e inserisce la richiesta in «Nuova richiesta». Nessuna email automatica in questa fase.
 */

export const PUBLIC_MAX_PRODUCTS = 30;
export const PUBLIC_MAX_QUANTITY = 20;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_TOTAL_PER_HOUR = 100;
const HOUR_MS = 60 * 60 * 1000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Massimo ${max} caratteri`)
    .optional()
    .transform((v) => (v ? v : null));

const email = z
  .string()
  .trim()
  .min(1, "Inserisci l'indirizzo email")
  .max(200, "Indirizzo troppo lungo")
  .refine(isValidEmail, "Indirizzo email non valido")
  .transform((v) => v.toLowerCase());

export const publicRequestInput = z.object({
  requesterType: z.enum(["AGENTE", "CLIENTE"], { error: "Indica se sei un agente o un cliente" }),
  requesterName: z.string().trim().min(2, "Inserisci nome e cognome").max(120, "Massimo 120 caratteri"),
  requesterEmail: email,
  requesterPhone: z
    .string()
    .trim()
    .max(40, "Numero troppo lungo")
    .refine((v) => !v || /^[+0-9 ()./-]{5,40}$/.test(v), "Numero di telefono non valido")
    .optional()
    .transform((v) => (v ? v : null)),
  /** Agente: ragione sociale del cliente destinatario. Cliente: la propria ragione sociale. */
  recipientName: z.string().trim().min(2, "Inserisci la ragione sociale").max(200, "Massimo 200 caratteri"),
  /** Solo per l'agente: email del cliente, che riceverà la conferma di spedizione. */
  recipientEmail: z
    .string()
    .trim()
    .max(200, "Indirizzo troppo lungo")
    .refine((v) => !v || isValidEmail(v), "Indirizzo email non valido")
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  address: z
    .string()
    .trim()
    .min(8, "Inserisci l'indirizzo completo: via, CAP, città")
    .max(1000, "Massimo 1000 caratteri"),
  country: optionalText(80),
  language: z.enum(languageEnum.enumValues, { error: "Seleziona la lingua" }),
  notes: optionalText(3000),
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive("Prodotto non valido"),
        quantity: z.coerce
          .number()
          .int("Quantità non valida")
          .min(1, "Quantità minima 1")
          .max(PUBLIC_MAX_QUANTITY, `Massimo ${PUBLIC_MAX_QUANTITY} pezzi per prodotto`),
      }),
    )
    .min(1, "Aggiungi almeno un prodotto")
    .max(PUBLIC_MAX_PRODUCTS, `Massimo ${PUBLIC_MAX_PRODUCTS} prodotti per richiesta`),
  consent: z.literal(true, { error: "Per inviare la richiesta devi acconsentire al trattamento dei dati" }),
  /** Campo trappola per i bot: invisibile alle persone, deve restare vuoto. */
  website: z.string().optional(),
});

export type PublicRequestInput = z.input<typeof publicRequestInput>;

export type PublicRequestResult = {
  /** Codice della richiesta (vuoto quando la richiesta è stata scartata come spam). */
  code: string;
  /** Frase per la pagina di ringraziamento: chi riceverà la conferma di spedizione. */
  confirmation: string;
};

/** Errori dei prodotti (items.3.quantity) mostrati anche sul campo «items». */
function publicFieldErrors(issues: z.core.$ZodIssue[]): Record<string, string> {
  const errors = zodFieldErrors(issues);
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith("items.") && !errors.items) errors.items = message;
  }
  return errors;
}

/** IP del richiedente normalizzato (o null se sconosciuto). */
function normalizeIp(ip: string | null | undefined): string | null {
  const v = ip?.trim().replace(/^::ffff:/i, "").slice(0, 64);
  return v ? v : null;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** L'elenco email del contatto ("a@x.it; b@y.it") contiene esattamente questo indirizzo. */
function emailListContains(address: string): SQL {
  const addr = address.toLowerCase();
  return and(
    ilike(contacts.email, likePattern(addr)),
    sql`${addr} = any(regexp_split_to_array(regexp_replace(lower(${contacts.email}), 'mailto:', '', 'g'), '[;,[:space:]]+'))`,
  )!;
}

type MatchedContact = { id: number; email: string | null; agentId: number | null; language: Language };

const matchColumns = {
  id: contacts.id,
  email: contacts.email,
  agentId: contacts.agentId,
  language: contacts.language,
  needsReview: contacts.needsReview,
};

async function findContactByEmail(
  tx: Tx,
  address: string,
  type: ContactType,
  preferAgentId?: number | null,
): Promise<MatchedContact | null> {
  const rows = await tx
    .select(matchColumns)
    .from(contacts)
    .where(and(eq(contacts.type, type), eq(contacts.active, true), emailListContains(address)))
    .orderBy(asc(contacts.needsReview), asc(contacts.id))
    .limit(20);
  if (rows.length === 0) return null;
  return (preferAgentId ? rows.find((r) => r.agentId === preferAgentId) : undefined) ?? rows[0];
}

async function findClientByName(tx: Tx, name: string, agentId: number): Promise<MatchedContact | null> {
  const [row] = await tx
    .select(matchColumns)
    .from(contacts)
    .where(
      and(
        eq(contacts.type, "CLIENTE"),
        eq(contacts.active, true),
        eq(contacts.agentId, agentId),
        sql`lower(regexp_replace(trim(${contacts.name}), '[[:space:]]+', ' ', 'g')) = ${normalizeName(name)}`,
      ),
    )
    .orderBy(asc(contacts.needsReview), asc(contacts.id))
    .limit(1);
  return row ?? null;
}

/** Unisce le righe dello stesso prodotto sommando le quantità. */
function mergeItems(items: { productId: number; quantity: number }[]) {
  const map = new Map<number, number>();
  for (const i of items) map.set(i.productId, (map.get(i.productId) ?? 0) + i.quantity);
  return [...map.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function withCountry(address: string, country: string | null): string {
  if (!country || address.toLowerCase().includes(country.toLowerCase())) return address;
  return `${address}\n${country}`;
}

const SPAM_RESULT: ActionResult<PublicRequestResult> = {
  ok: true,
  data: { code: "", confirmation: "" },
  message: "Richiesta ricevuta.",
};

/**
 * Crea una richiesta dal modulo pubblico. `ip` serve al limite di invii (5 all'ora per IP,
 * 100 all'ora in totale) e viene salvato sulla richiesta.
 */
export async function createPublicRequest(
  rawInput: unknown,
  ip: string | null,
): Promise<ActionResult<PublicRequestResult>> {
  const settings = await getSettings();
  if (!settings.publicFormEnabled) {
    return fail("Il modulo non è al momento disponibile. Contatta il tuo referente BGP.");
  }

  // Campo trappola compilato: fingiamo di aver ricevuto la richiesta senza salvare nulla.
  const trap = (rawInput as { website?: unknown } | null)?.website;
  if (typeof trap === "string" && trap.trim() !== "") return SPAM_RESULT;

  const parsed = publicRequestInput.safeParse(rawInput);
  if (!parsed.success) return fail("Controlla i campi evidenziati.", publicFieldErrors(parsed.error.issues));
  const input = parsed.data;

  const items = mergeItems(input.items);
  if (items.some((i) => i.quantity > PUBLIC_MAX_QUANTITY)) {
    const msg = `Massimo ${PUBLIC_MAX_QUANTITY} pezzi per prodotto.`;
    return fail(msg, { items: msg });
  }
  const found = await db
    .select({ id: products.id, active: products.active })
    .from(products)
    .where(inArray(products.id, items.map((i) => i.productId)));
  const available = new Set(found.filter((p) => p.active).map((p) => p.id));
  if (items.some((i) => !available.has(i.productId))) {
    const msg = "Alcuni prodotti non sono più disponibili: rimuovili dall'elenco e riprova.";
    return fail(msg, { items: msg });
  }

  const requesterIp = normalizeIp(ip);
  const since = new Date(Date.now() - HOUR_MS);

  return db.transaction(async (tx): Promise<ActionResult<PublicRequestResult>> => {
    // Un invio alla volta: limiti esatti e niente contatti doppi creati in parallelo.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bgp:public-form'))`);

    const [total] = await tx
      .select({ n: count() })
      .from(sampleRequests)
      .where(and(eq(sampleRequests.source, "MODULO_PUBBLICO"), gte(sampleRequests.createdAt, since)));
    if (total.n >= MAX_TOTAL_PER_HOUR) {
      return fail("In questo momento riceviamo molte richieste. Riprova tra un'ora o contatta il tuo referente BGP.");
    }
    const [perIp] = await tx
      .select({ n: count() })
      .from(sampleRequests)
      .where(
        and(
          requesterIp ? eq(sampleRequests.requesterIp, requesterIp) : isNull(sampleRequests.requesterIp),
          eq(sampleRequests.source, "MODULO_PUBBLICO"),
          gte(sampleRequests.createdAt, since),
        ),
      );
    if (perIp.n >= MAX_PER_IP_PER_HOUR) {
      return fail("Hai inviato troppe richieste nell'ultima ora. Riprova più tardi o contatta il tuo referente BGP.");
    }

    const today = formatDate(new Date());
    const meta: string[] = [];
    if (input.requesterPhone) meta.push(`Telefono del richiedente: ${input.requesterPhone}`);

    let contact: MatchedContact | null;
    let confirmation: string;

    if (input.requesterType === "CLIENTE") {
      contact = await findContactByEmail(tx, input.requesterEmail, "CLIENTE");
      if (!contact) {
        const [created] = await tx
          .insert(contacts)
          .values({
            type: "CLIENTE",
            name: input.recipientName,
            email: input.requesterEmail,
            phone: input.requesterPhone,
            defaultAddress: input.address,
            country: input.country,
            language: input.language,
            needsReview: true,
            notes: `Creato dal modulo pubblico il ${today}. Referente: ${input.requesterName}.`,
          })
          .returning(matchColumns);
        contact = created;
      }
      confirmation = `Riceverai un'email all'indirizzo ${input.requesterEmail} quando i campioni saranno spediti.`;
    } else {
      const agent = await findContactByEmail(tx, input.requesterEmail, "AGENTE");
      if (!agent) meta.push(`Agente non riconosciuto: ${input.requesterName} ${input.requesterEmail}`);

      contact = input.recipientEmail
        ? await findContactByEmail(tx, input.recipientEmail, "CLIENTE", agent?.id)
        : null;
      if (!contact && agent) contact = await findClientByName(tx, input.recipientName, agent.id);
      if (!contact) {
        const [created] = await tx
          .insert(contacts)
          .values({
            type: "CLIENTE",
            name: input.recipientName,
            email: input.recipientEmail,
            defaultAddress: input.address,
            country: input.country,
            language: input.language,
            agentId: agent?.id ?? null,
            needsReview: true,
            notes: `Creato dal modulo pubblico il ${today} su richiesta dell'agente ${input.requesterName} (${input.requesterEmail}).`,
          })
          .returning(matchColumns);
        contact = created;
      } else if (agent && contact.agentId !== agent.id) {
        meta.push("Attenzione: in anagrafica il cliente non è associato all'agente che ha inviato la richiesta.");
      }

      if (input.recipientEmail) {
        confirmation = `Il cliente riceverà un'email all'indirizzo ${input.recipientEmail} quando i campioni saranno spediti.`;
      } else if (parseEmailList(contact.email).length > 0) {
        confirmation = "Il cliente riceverà un'email di conferma quando i campioni saranno spediti.";
      } else {
        confirmation =
          "Non hai indicato l'email del cliente: il nostro ufficio la completerà prima della spedizione per inviargli la conferma.";
      }
    }

    if (contact.language !== input.language) {
      meta.push(
        `Lingua indicata nel modulo: ${LANGUAGE_LABELS[input.language]} (in anagrafica: ${LANGUAGE_LABELS[contact.language]}).`,
      );
    }
    const notes = [input.notes, meta.join("\n")].filter(Boolean).join("\n\n") || null;

    const [request] = await tx
      .insert(sampleRequests)
      .values({
        status: "NUOVA",
        source: "MODULO_PUBBLICO",
        contactId: contact.id,
        destinationAddress: `${input.recipientName}\n${withCountry(input.address, input.country)}`,
        notes,
        deliveryFormRequired: false,
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail,
        requesterIp,
      })
      .returning({ id: sampleRequests.id });
    await tx.insert(requestItems).values(items.map((i) => ({ ...i, requestId: request.id })));
    await tx.insert(statusEvents).values({
      requestId: request.id,
      fromStatus: null,
      toStatus: "NUOVA",
      userId: null,
      note: "Ricevuta dal modulo pubblico",
    });

    const code = requestCode(request.id);
    return { ok: true, data: { code, confirmation }, message: `Richiesta ${code} ricevuta.` };
  });
}
