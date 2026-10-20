import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, gte, ilike, inArray, sql, type SQL } from "drizzle-orm";
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
import { ITALY, normalizeCountry } from "@/lib/countries";
import { isValidEmail, parseEmailList } from "@/lib/email/recipients";
import { formatDate, LANGUAGE_LABELS, requestCode } from "@/lib/format";
import { looksLikeCompany, SAMPLE_FORMATS } from "@/lib/sample-formats";
import { likePattern } from "@/lib/search";
import { getSettings } from "@/lib/settings";
import { dbId } from "@/lib/validation";
import { mergeItems, normalizeMultiline, optionalText } from "./input";
import { applyBollaRules } from "./service";

/**
 * Richieste dal modulo pubblico /richiedi-campioni (senza login).
 * Riconosce agente e cliente dall'email, crea i contatti mancanti da verificare (needsReview)
 * e inserisce la richiesta in «Nuova richiesta». Nessuna email automatica in questa fase.
 * Le differenze rispetto all'anagrafica (indirizzo, email del cliente) finiscono nelle note.
 * Il modulo chiede tutti i dati che BGP richiede per prendere in carico una richiesta (destinatario,
 * alla c.a., indirizzo, codice, formato e quantità, preavviso telefonico), così arriva già completa.
 * Le regole della bolla (Impostazioni → Bolla di consegna) valgono anche qui, come per il back office.
 */

export const PUBLIC_MAX_PRODUCTS = 30;
export const PUBLIC_MAX_QUANTITY = 20;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_PER_EMAIL_PER_HOUR = 5;
const MAX_TOTAL_PER_HOUR = 300;
const HOUR_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Gettone firmato del modulo: invii troppo rapidi o senza pagina      */
/* ------------------------------------------------------------------ */

const FORM_TOKEN_MIN_AGE_MS = 3_000;
const FORM_TOKEN_MAX_AGE_MS = 24 * HOUR_MS;

/**
 * Segreto per la firma: APP_SECRET, altrimenti derivato da DATABASE_URL (stabile tra i riavvii
 * e tra più istanze, e non noto all'esterno). Solo in assenza di entrambi: casuale per processo.
 */
function formSecret(): string {
  const configured = process.env.APP_SECRET?.trim();
  if (configured) return configured;
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) return createHash("sha256").update(`bgp-modulo-pubblico:${dbUrl}`).digest("hex");
  const g = globalThis as unknown as { bgpPublicFormSecret?: string };
  if (!g.bgpPublicFormSecret) g.bgpPublicFormSecret = randomBytes(32).toString("hex");
  return g.bgpPublicFormSecret;
}

function signFormTimestamp(ts: string): string {
  return createHmac("sha256", formSecret()).update(`richiedi-campioni:${ts}`).digest("base64url");
}

/** Gettone da inserire nel modulo (campo nascosto «formToken») al momento della visualizzazione. */
export function issuePublicFormToken(now = Date.now()): string {
  const ts = String(now);
  return `${ts}.${signFormTimestamp(ts)}`;
}

type FormTokenCheck = "ok" | "invalid" | "bad-signature" | "too-fast" | "expired";

function checkFormToken(token: unknown, now = Date.now()): FormTokenCheck {
  if (typeof token !== "string") return "invalid";
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return "invalid";
  const expected = Buffer.from(signFormTimestamp(m[1]));
  const given = Buffer.from(m[2]);
  // Firma non valida: può essere un modulo aperto prima di un cambio di APP_SECRET. Mai scartarlo
  // in silenzio: l'utente riceve un errore e la pagina si aggiorna con un gettone nuovo.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "bad-signature";
  const age = now - Number(m[1]);
  if (age < FORM_TOKEN_MIN_AGE_MS) return "too-fast";
  if (age > FORM_TOKEN_MAX_AGE_MS) return "expired";
  return "ok";
}

const email = z
  .string({ error: "Inserisci l'indirizzo email" })
  .trim()
  .min(1, "Inserisci l'indirizzo email")
  .max(200, "Indirizzo troppo lungo")
  .refine(isValidEmail, "Indirizzo email non valido")
  .transform((v) => v.toLowerCase());

/** Telefono facoltativo: cifre, spazi e + ( ) . / - */
const optionalPhone = z
  .string()
  .trim()
  .max(40, "Numero troppo lungo")
  .refine((v) => !v || /^[+0-9 ()./-]{5,40}$/.test(v), "Numero di telefono non valido")
  .nullish()
  .transform((v) => (v ? v : null));

const publicItemInput = z
  .object({
    productId: dbId,
    quantity: z.coerce
      .number()
      .int("Quantità non valida")
      .min(1, "Quantità minima 1")
      .max(PUBLIC_MAX_QUANTITY, `Massimo ${PUBLIC_MAX_QUANTITY} pezzi per prodotto`),
    /** Obbligatorio nel modulo pubblico: senza formato BGP non può preparare il campione. */
    sampleFormat: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.enum(SAMPLE_FORMATS, { error: "Scegli il formato del campione" }),
    ),
    formatNote: optionalText(200),
  })
  .refine((i) => i.sampleFormat !== "ALTRO" || Boolean(i.formatNote), {
    path: ["formatNote"],
    message: "Descrivi il formato richiesto",
  });

/** Cifre di un numero di telefono (stessa soglia del servizio interno: almeno 6). */
const phoneDigits = (v: string | null | undefined) => v?.replace(/\D/g, "").length ?? 0;

/** Valore già letto come oggetto (per i controlli tra campi anche quando altri campi sono errati). */
const isObjectPayload = (p: { value: unknown }) => typeof p.value === "object" && p.value !== null;

export const publicRequestInput = z.object({
  requesterType: z.enum(["AGENTE", "CLIENTE"], { error: "Indica se sei un agente o un cliente" }),
  requesterName: z
    .string({ error: "Inserisci nome e cognome" })
    .trim()
    .min(2, "Inserisci nome e cognome")
    .max(120, "Massimo 120 caratteri"),
  requesterEmail: email,
  requesterPhone: optionalPhone,
  /** Destinatario della spedizione: ragione sociale della ditta o cognome e nome. */
  recipientName: z
    .string({ error: "Indica il destinatario" })
    .trim()
    .min(2, "Indica il destinatario: ragione sociale della ditta o cognome e nome")
    .max(200, "Massimo 200 caratteri"),
  /** Spunta «Il destinatario è un privato»: in quel caso «alla c.a.» non serve. */
  recipientIsPrivate: z.boolean().default(false),
  /** Persona della ditta a cui è destinata la spedizione («alla c.a. di»): obbligatoria per le ditte. */
  attentionOf: optionalText(200),
  /** Solo per l'agente: email del cliente, che riceverà la conferma di spedizione. */
  recipientEmail: z
    .string()
    .trim()
    .max(200, "Indirizzo troppo lungo")
    .refine((v) => !v || isValidEmail(v), "Indirizzo email non valido")
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  /** Solo l'indirizzo (via, CAP, città, provincia): il destinatario è in recipientName. */
  address: z
    .string({ error: "Indica l'indirizzo di consegna" })
    .trim()
    .min(1, "Indica l'indirizzo di consegna")
    .min(8, "Indica l'indirizzo completo: via e numero civico, CAP, città e provincia")
    .max(1000, "Massimo 1000 caratteri")
    // Senza CAP né numero civico il corriere non consegna.
    .refine((v) => /\d/.test(v), "Indica l'indirizzo completo: via e numero civico, CAP, città e provincia")
    .transform(normalizeMultiline),
  /** Paese di consegna: se riconosciuto («France», «CH»…) salvato col nome italiano, altrimenti com'è scritto. */
  country: optionalText(80).transform(normalizeCountry),
  language: z.enum(languageEnum.enumValues, { error: "Seleziona la lingua" }),
  /** Preavviso telefonico prima della consegna: nessun valore predefinito, va scelto. */
  phoneNotice: z.boolean({ error: "Indica se serve il preavviso telefonico prima della consegna" }),
  phoneNoticeNumber: optionalPhone,
  notes: optionalText(3000),
  items: z
    .array(publicItemInput, { error: "Aggiungi almeno un prodotto" })
    .min(1, "Aggiungi almeno un prodotto")
    .max(PUBLIC_MAX_PRODUCTS, `Massimo ${PUBLIC_MAX_PRODUCTS} prodotti per richiesta`),
  consent: z.literal(true, { error: "Per inviare la richiesta devi acconsentire al trattamento dei dati" }),
  /** Campo trappola per i bot: invisibile alle persone, deve restare vuoto. */
  website: z.string().optional(),
  /** Gettone firmato del modulo (issuePublicFormToken), controllato prima della validazione. */
  formToken: z.string().optional(),
})
  // Controlli tra campi eseguiti anche se altri campi sono errati: tutti gli errori in un solo invio.
  .refine((v) => v.recipientIsPrivate === true || Boolean(v.attentionOf), {
    path: ["attentionOf"],
    message: "Indica la persona a cui sono destinati i campioni, oppure spunta «Il destinatario è un privato»",
    when: isObjectPayload,
  })
  .refine((v) => v.phoneNotice !== true || Boolean(v.phoneNoticeNumber), {
    path: ["phoneNoticeNumber"],
    message: "Indica il numero di telefono per il preavviso",
    when: isObjectPayload,
  })
  .refine((v) => v.phoneNotice !== true || !v.phoneNoticeNumber || phoneDigits(v.phoneNoticeNumber) >= 6, {
    path: ["phoneNoticeNumber"],
    message: "Numero di telefono non valido: indica il numero completo (almeno 6 cifre)",
    when: isObjectPayload,
  });

export type PublicRequestInput = z.input<typeof publicRequestInput>;

export type PublicRequestResult = {
  /** Codice della richiesta (vuoto quando la richiesta è stata scartata come spam). */
  code: string;
  /** Frase per la pagina di ringraziamento: chi riceverà la conferma di spedizione. */
  confirmation: string;
  /** Destinatario dei campioni («Rossi S.r.l., alla c.a. di Mario Bianchi»), per la pagina di ringraziamento. */
  recipient: string;
};

/**
 * Errori dei prodotti: quelli di riga (items.3.sampleFormat) restano sulla riga, e il campo «items»
 * riceve un richiamo generale (visibile accanto alla ricerca prodotti).
 */
function publicFieldErrors(issues: z.core.$ZodIssue[]): Record<string, string> {
  const errors = zodFieldErrors(issues);
  if (!errors.items && Object.keys(errors).some((key) => key.startsWith("items."))) {
    errors.items = "Completa i dati dei prodotti evidenziati (formato e quantità).";
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

type MatchedContact = {
  id: number;
  email: string | null;
  agentId: number | null;
  language: Language;
  needsReview: boolean;
  defaultAddress: string | null;
  country: string | null;
};

const matchColumns = {
  id: contacts.id,
  email: contacts.email,
  agentId: contacts.agentId,
  language: contacts.language,
  needsReview: contacts.needsReview,
  defaultAddress: contacts.defaultAddress,
  country: contacts.country,
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

/** Indirizzo ridotto a lettere e cifre senza accenti, per confronti tolleranti sulla forma. */
function addressKey(address: string): string {
  return address
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Stesso indirizzo, anche se uno dei due ha in più ragione sociale, paese o indicazioni. */
function sameAddress(a: string, b: string): boolean {
  const x = addressKey(a);
  const y = addressKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 10 && long.includes(short);
}

const SPAM_RESULT: ActionResult<PublicRequestResult> = {
  ok: true,
  data: { code: "", confirmation: "", recipient: "" },
  message: "Richiesta ricevuta.",
};

/**
 * Crea una richiesta dal modulo pubblico. Limiti: 5 all'ora per email del richiedente, 5 all'ora
 * per IP (solo se `ip` è noto e affidabile, vedi getClientIp; viene salvato sulla richiesta),
 * 300 all'ora in totale.
 */
export async function createPublicRequest(
  rawInput: unknown,
  ip: string | null,
): Promise<ActionResult<PublicRequestResult>> {
  const settings = await getSettings();
  if (!settings.publicFormEnabled) {
    return fail("Il modulo non è al momento disponibile. Contatta il tuo referente BGP.");
  }

  // Campo trappola compilato o gettone mancante/falso: fingiamo di aver ricevuto la richiesta
  // senza salvare nulla.
  const raw = rawInput as { website?: unknown; formToken?: unknown } | null;
  if (typeof raw?.website === "string" && raw.website.trim() !== "") return SPAM_RESULT;
  const token = checkFormToken(raw?.formToken);
  if (token === "invalid") return SPAM_RESULT;
  if (token === "too-fast") return fail("Attendi qualche secondo e invia di nuovo la richiesta.");
  if (token === "expired" || token === "bad-signature") {
    // Il modulo aggiorna la pagina (nuovo gettone) quando riceve l'errore sul campo formToken.
    const msg =
      token === "expired"
        ? "La pagina era aperta da più di un giorno: l'abbiamo aggiornata, premi di nuovo «Invia la richiesta»."
        : "Il modulo non era più valido: l'abbiamo aggiornato, premi di nuovo «Invia la richiesta».";
    return fail(msg, { formToken: msg });
  }

  const parsed = publicRequestInput.safeParse(rawInput);
  if (!parsed.success) return fail("Controlla i campi evidenziati.", publicFieldErrors(parsed.error.issues));
  const input = parsed.data;

  // Stesso prodotto nello stesso formato: una sola riga; in formati diversi resta su righe separate.
  const items = mergeItems(input.items);
  if (items.some((i) => i.quantity > PUBLIC_MAX_QUANTITY)) {
    const msg = `Massimo ${PUBLIC_MAX_QUANTITY} pezzi per prodotto nello stesso formato.`;
    return fail(msg, { items: msg });
  }
  const recipientName = input.recipientName.replace(/\s+/g, " ");
  const attentionOf = input.recipientIsPrivate ? null : input.attentionOf;
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

    const recent = (condition?: SQL) =>
      tx
        .select({ n: count() })
        .from(sampleRequests)
        .where(and(eq(sampleRequests.source, "MODULO_PUBBLICO"), gte(sampleRequests.createdAt, since), condition))
        .then(([row]) => row.n);

    if ((await recent()) >= MAX_TOTAL_PER_HOUR) {
      return fail("In questo momento riceviamo molte richieste. Riprova tra un'ora o contatta il tuo referente BGP.");
    }
    const tooMany = "Hai inviato troppe richieste nell'ultima ora. Riprova più tardi o contatta il tuo referente BGP.";
    if ((await recent(eq(sampleRequests.requesterEmail, input.requesterEmail))) >= MAX_PER_EMAIL_PER_HOUR) {
      return fail(tooMany);
    }
    if (requesterIp && (await recent(eq(sampleRequests.requesterIp, requesterIp))) >= MAX_PER_IP_PER_HOUR) {
      return fail(tooMany);
    }

    const today = formatDate(new Date());
    const meta: string[] = [];
    if (input.requesterPhone) meta.push(`Telefono del richiedente: ${input.requesterPhone}`);
    if (input.recipientIsPrivate && looksLikeCompany(recipientName)) {
      meta.push("Il richiedente ha indicato che il destinatario è un privato (nessuna persona «alla c.a.»).");
    }

    let contact: MatchedContact | null;
    let createdNow = false;
    let confirmation: string;

    if (input.requesterType === "CLIENTE") {
      contact = await findContactByEmail(tx, input.requesterEmail, "CLIENTE");
      if (!contact) {
        const [created] = await tx
          .insert(contacts)
          .values({
            type: "CLIENTE",
            name: recipientName,
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
        createdNow = true;
      }
      confirmation = `Riceverai un'email all'indirizzo ${input.requesterEmail} quando i campioni saranno spediti.`;
    } else {
      const agent = await findContactByEmail(tx, input.requesterEmail, "AGENTE");
      if (!agent) meta.push(`Agente non riconosciuto: ${input.requesterName} ${input.requesterEmail}`);

      contact = input.recipientEmail
        ? await findContactByEmail(tx, input.recipientEmail, "CLIENTE", agent?.id)
        : null;
      if (!contact && agent) contact = await findClientByName(tx, recipientName, agent.id);
      if (!contact) {
        const [created] = await tx
          .insert(contacts)
          .values({
            type: "CLIENTE",
            name: recipientName,
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
        createdNow = true;
      } else if (agent && contact.agentId !== agent.id) {
        meta.push("Attenzione: in anagrafica il cliente non è associato all'agente che ha inviato la richiesta.");
      }

      // Cliente riconosciuto per nome: l'email indicata dall'agente può mancare in anagrafica.
      // Non la sostituiamo (il modulo non ha login): resta nelle note e il contatto va verificato.
      const contactEmails = parseEmailList(contact.email).map((e) => e.toLowerCase());
      const emailOnFile = !!input.recipientEmail && contactEmails.includes(input.recipientEmail);
      if (input.recipientEmail && !emailOnFile) {
        meta.push(`Email cliente indicata dall'agente: ${input.recipientEmail} (non presente in anagrafica, da verificare).`);
        if (!contact.needsReview) {
          await tx.update(contacts).set({ needsReview: true }).where(eq(contacts.id, contact.id));
        }
      }

      if (input.recipientEmail && emailOnFile) {
        confirmation = `Il cliente riceverà un'email all'indirizzo ${input.recipientEmail} quando i campioni saranno spediti.`;
      } else if (input.recipientEmail) {
        confirmation = `Il nostro ufficio verificherà l'email del cliente che hai indicato (${input.recipientEmail}) prima di inviargli la conferma di spedizione.`;
      } else if (contactEmails.length > 0) {
        confirmation = "Il cliente riceverà un'email di conferma quando i campioni saranno spediti.";
      } else {
        confirmation =
          "Non hai indicato l'email del cliente: il nostro ufficio la completerà prima della spedizione per inviargli la conferma.";
      }
    }

    // Contatto già in anagrafica: segnala se la destinazione non è l'indirizzo registrato.
    if (!createdNow && contact.defaultAddress && !sameAddress(input.address, contact.defaultAddress)) {
      meta.push(
        `Attenzione: indirizzo di destinazione diverso da quello in anagrafica (${contact.defaultAddress.replace(/\s+/g, " ").trim()}).`,
      );
    }
    if (contact.language !== input.language) {
      meta.push(
        `Lingua indicata nel modulo: ${LANGUAGE_LABELS[input.language]} (in anagrafica: ${LANGUAGE_LABELS[contact.language]}).`,
      );
    }
    const notes = [input.notes, meta.join("\n")].filter(Boolean).join("\n\n") || null;

    // Paese di consegna in un campo a parte (l'indirizzo resta com'è stato scritto); se non indicato
    // vale quello del contatto, come nel back office. Le regole della bolla si applicano subito.
    // Il modulo propone «Italia»: un campo svuotato vale come paese del contatto, se noto.
    const destinationCountry = input.country ?? normalizeCountry(contact.country) ?? ITALY;
    const bolla = applyBollaRules(
      false,
      { destinationCountry, itemFormats: items.map((i) => i.sampleFormat), packagesCount: null },
      settings.bollaConfig,
    );

    const [request] = await tx
      .insert(sampleRequests)
      .values({
        status: "NUOVA",
        source: "MODULO_PUBBLICO",
        contactId: contact.id,
        recipientName,
        attentionOf,
        destinationAddress: input.address,
        destinationCountry,
        phoneNotice: input.phoneNotice,
        phoneNoticeNumber: input.phoneNotice ? input.phoneNoticeNumber : null,
        notes,
        ...bolla,
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail,
        requesterIp,
      })
      .returning({ id: sampleRequests.id });
    await tx.insert(requestItems).values(
      items.map((i) => ({
        requestId: request.id,
        productId: i.productId,
        quantity: i.quantity,
        sampleFormat: i.sampleFormat,
        formatNote: i.formatNote,
      })),
    );
    await tx.insert(statusEvents).values({
      requestId: request.id,
      fromStatus: null,
      toStatus: "NUOVA",
      userId: null,
      note: "Ricevuta dal modulo pubblico",
    });

    const code = requestCode(request.id);
    const recipient = attentionOf ? `${recipientName}, alla c.a. di ${attentionOf}` : recipientName;
    return { ok: true, data: { code, confirmation, recipient }, message: `Richiesta ${code} ricevuta.` };
  });
}
