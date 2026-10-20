"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  carriers,
  emailLog,
  emailTemplates,
  languageEnum,
  roleEnum,
  sampleRequests,
  users,
} from "@/db/schema";
import { unknownBollaPlaceholders } from "@/components/impostazioni/config-utils";
import { fail, NOT_AUTHORIZED, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { destroyUserSessions, getAuthorizedUser } from "@/lib/auth/session";
import { bollaConfigSchema, type BollaConfig } from "@/lib/config/bolla";
import { activeCostComponents, costConfigSchema, manualCostKey, type CostConfig } from "@/lib/config/costs";
import { crmExportConfigSchema, type CrmExportConfig } from "@/lib/config/crm-export";
import { previousMonthIso, sendCrmExport } from "@/lib/crm-export/run";
import { sendMail } from "@/lib/email/mailer";
import { previewNotification, SIGNATURE_CID, signatureImageAttachment } from "@/lib/email/notifications";
import { invalidEmails, isValidEmail, parseEmailList } from "@/lib/email/recipients";
import { TEMPLATE_LANGUAGES, textToHtml, type TemplateContent } from "@/lib/email/templates";
import { formatDateTime, formatMonth } from "@/lib/format";
import { SAMPLE_FORMATS } from "@/lib/sample-formats";
import { getSetting, getSettings, updateSettings } from "@/lib/settings";
import { dbId, parseDbId } from "@/lib/validation";

type State = ActionResult | null;

const CHECK_FIELDS = "Controlla i campi evidenziati.";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function checked(fd: FormData, key: string): boolean {
  return fd.get(key) === "on";
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function done(message: string): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true, message };
}

/* ------------------------------------------------------------------ */
/* Utenti                                                              */
/* ------------------------------------------------------------------ */

const userFields = z.object({
  name: z.string().trim().min(2, "Inserisci nome e cognome").max(120, "Massimo 120 caratteri"),
  email: z
    .string()
    .trim()
    .max(200, "Indirizzo troppo lungo")
    .refine(isValidEmail, "Indirizzo email non valido")
    .transform((v) => v.toLowerCase()),
  role: z.enum(roleEnum.enumValues, { error: "Seleziona il ruolo" }),
});

async function emailTaken(email: string, exceptId?: number): Promise<boolean> {
  const cond = eq(sql`lower(${users.email})`, email.toLowerCase());
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(exceptId ? and(cond, ne(users.id, exceptId)) : cond);
  return row.n > 0;
}

const EMAIL_TAKEN = "Esiste già un utente con questa email.";

export async function createUserAction(_prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;

  const parsed = userFields.safeParse({ name: str(fd, "name"), email: str(fd, "email"), role: str(fd, "role") });
  const password = str(fd, "password");
  const errors = parsed.success ? {} : zodFieldErrors(parsed.error.issues);
  const pwError = passwordProblem(password);
  if (pwError) errors.password = pwError;
  if (!parsed.success || pwError) return fail(CHECK_FIELDS, errors);

  const input = parsed.data;
  if (await emailTaken(input.email)) return fail(EMAIL_TAKEN, { email: EMAIL_TAKEN });
  try {
    await db.insert(users).values({ ...input, passwordHash: await hashPassword(password), active: true });
  } catch (err) {
    if (isUniqueViolation(err)) return fail(EMAIL_TAKEN, { email: EMAIL_TAKEN });
    throw err;
  }
  return done(`Utente «${input.name}» creato. Comunica all'utente email e password per il primo accesso.`);
}

type UpdateOutcome =
  | { kind: "not_found" }
  | { kind: "error"; message: string; field?: string }
  | { kind: "ok"; endSessions: boolean };

export async function updateUserAction(userId: number, _prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  if (parseDbId(userId) === null) return fail("Utente non valido.");

  const parsed = userFields
    .extend({ active: z.boolean() })
    .safeParse({ name: str(fd, "name"), email: str(fd, "email"), role: str(fd, "role"), active: checked(fd, "active") });
  if (!parsed.success) return fail(CHECK_FIELDS, zodFieldErrors(parsed.error.issues));
  const input = parsed.data;
  if (await emailTaken(input.email, userId)) return fail(EMAIL_TAKEN, { email: EMAIL_TAKEN });

  const isSelf = userId === actor.id;
  let outcome: UpdateOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<UpdateOutcome> => {
      // Serializza le modifiche agli utenti: il controllo "almeno un amministratore attivo" resta valido.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bgp:users'))`);
      const [current] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!current) return { kind: "not_found" };

      if (isSelf && !input.active) {
        return { kind: "error", message: "Non puoi disattivare il tuo utente.", field: "active" };
      }
      if (isSelf && input.role !== current.role) {
        return { kind: "error", message: "Non puoi cambiare il tuo ruolo: chiedi a un altro amministratore.", field: "role" };
      }
      const wasActiveAdmin = current.role === "ADMIN" && current.active;
      const staysActiveAdmin = input.role === "ADMIN" && input.active;
      if (wasActiveAdmin && !staysActiveAdmin) {
        const [others] = await tx
          .select({ n: count() })
          .from(users)
          .where(and(eq(users.role, "ADMIN"), eq(users.active, true), ne(users.id, userId)));
        if (others.n === 0) {
          return {
            kind: "error",
            message: "Deve restare almeno un amministratore attivo: prima nomina un altro amministratore.",
            field: input.active ? "role" : "active",
          };
        }
      }
      await tx
        .update(users)
        .set({
          name: input.name,
          email: input.email,
          role: input.role,
          active: input.active,
          // Riattivando un utente si azzera anche un eventuale blocco per troppi tentativi.
          ...(!current.active && input.active ? { failedLoginCount: 0, failedLoginAt: null, lockedUntil: null } : {}),
        })
        .where(eq(users.id, userId));
      return { kind: "ok", endSessions: current.role !== input.role || (current.active && !input.active) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail(EMAIL_TAKEN, { email: EMAIL_TAKEN });
    throw err;
  }

  if (outcome.kind === "not_found") return fail("Utente non trovato.");
  if (outcome.kind === "error") {
    return fail(outcome.message, outcome.field ? { [outcome.field]: outcome.message } : undefined);
  }
  if (outcome.endSessions) await destroyUserSessions(userId);
  return done(
    outcome.endSessions
      ? "Utente aggiornato. Le sue sessioni sono state chiuse: dovrà accedere di nuovo."
      : "Utente aggiornato.",
  );
}

export async function resetPasswordAction(userId: number, _prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  if (parseDbId(userId) === null) return fail("Utente non valido.");

  const password = str(fd, "password");
  const confirm = str(fd, "confirm");
  const pwError = passwordProblem(password);
  if (pwError) return fail(pwError, { password: pwError });
  if (password !== confirm) return fail("Le due password non coincidono.", { confirm: "Le due password non coincidono." });

  const updated = await db
    .update(users)
    // La nuova password sblocca anche un account bloccato per troppi tentativi.
    .set({ passwordHash: await hashPassword(password), failedLoginCount: 0, failedLoginAt: null, lockedUntil: null })
    .where(eq(users.id, userId))
    .returning({ id: users.id, name: users.name });
  if (updated.length === 0) return fail("Utente non trovato.");
  await destroyUserSessions(userId);
  revalidatePath("/", "layout");
  // La propria sessione è stata chiusa: si torna al login con la nuova password.
  if (userId === actor.id) redirect("/login");
  return {
    ok: true,
    message: `Password di «${updated[0].name}» reimpostata. L'utente è stato disconnesso da tutti i dispositivi.`,
  };
}

/* ------------------------------------------------------------------ */
/* Email e notifiche                                                   */
/* ------------------------------------------------------------------ */

/** "Nome <indirizzo@dominio.it>" oppure solo l'indirizzo. */
function validSender(value: string): boolean {
  if (/[\r\n]/.test(value)) return false;
  const m = value.match(/^(.*)<([^<>]+)>\s*$/);
  return isValidEmail(m ? m[2].trim() : value);
}

const emailSettingsSchema = z.object({
  mailFrom: z
    .string()
    .trim()
    .min(1, "Indica il mittente")
    .max(200, "Massimo 200 caratteri")
    .refine(validSender, "Usa il formato «Nome <indirizzo@dominio.it>» oppure solo l'indirizzo"),
  mailReplyTo: z
    .string()
    .trim()
    .max(200, "Massimo 200 caratteri")
    .refine((v) => !v || isValidEmail(v), "Indirizzo email non valido"),
  mailSignature: z
    .string()
    .max(2000, "Massimo 2000 caratteri")
    .transform((v) => v.replace(/\r\n/g, "\n").trim()),
  mailSignatureImage: z.boolean(),
});

const LIST_FIELDS = ["warehouseEmails", "logisticsEmails", "shipmentBcc"] as const;
const MAX_LIST = 30;

export async function saveEmailSettingsAction(_prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;

  const parsed = emailSettingsSchema.safeParse({
    mailFrom: str(fd, "mailFrom"),
    mailReplyTo: str(fd, "mailReplyTo"),
    mailSignature: str(fd, "mailSignature"),
    mailSignatureImage: checked(fd, "mailSignatureImage"),
  });
  const errors: Record<string, string> = parsed.success ? {} : zodFieldErrors(parsed.error.issues);

  const lists = {} as Record<(typeof LIST_FIELDS)[number], string[]>;
  for (const key of LIST_FIELDS) {
    const raw = str(fd, key);
    const invalid = invalidEmails(raw);
    if (invalid.length) {
      errors[key] = `Indirizzi non validi: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? "…" : ""}`;
      continue;
    }
    lists[key] = parseEmailList(raw);
    if (lists[key].length > MAX_LIST) errors[key] = `Massimo ${MAX_LIST} indirizzi.`;
  }
  if (!parsed.success || Object.keys(errors).length) return fail(CHECK_FIELDS, errors);

  await updateSettings({ ...parsed.data, ...lists });

  const warnings: string[] = [];
  if (lists.warehouseEmails.length === 0) warnings.push("nessun destinatario per l'avviso al magazzino");
  if (lists.logisticsEmails.length === 0) warnings.push("nessun destinatario per l'avviso bolla alla logistica");
  return done(
    warnings.length
      ? `Impostazioni email salvate. Attenzione: ${warnings.join(" e ")} — quelle email non partiranno.`
      : "Impostazioni email salvate.",
  );
}


export async function sendTestEmailAction(_prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;

  const to = str(fd, "to").trim();
  if (!isValidEmail(to)) return fail("Indirizzo non valido.", { to: "Inserisci un indirizzo email valido." });

  const settings = await getSettings();
  const subject = "Email di prova — Campionature BGP";
  const body = [
    "Questa è un'email di prova inviata dalle impostazioni di Campionature BGP.",
    "",
    `Inviata da: ${actor.name}`,
    `Data: ${formatDateTime(new Date())}`,
    "",
    "Se la ricevi, l'invio delle email automatiche funziona. Qui sotto la firma usata nelle conferme di spedizione.",
    "",
    settings.mailSignature,
  ].join("\n");
  const image = settings.mailSignatureImage ? await signatureImageAttachment() : null;

  const outcome = await sendMail({
    from: settings.mailFrom,
    replyTo: settings.mailReplyTo,
    to: [to],
    subject,
    text: body,
    html: textToHtml(body, image ? SIGNATURE_CID : undefined),
    attachments: image ? [image] : [],
  });

  await db.insert(emailLog).values({
    requestId: null,
    kind: "TEST",
    language: "it",
    toAddresses: to,
    subject,
    body,
    status: outcome.status,
    error: outcome.status === "ERRORE" ? outcome.error : null,
    messageId: outcome.status === "INVIATA" ? outcome.messageId : null,
    triggeredById: actor.id,
  });
  revalidatePath("/", "layout");

  if (outcome.status === "ERRORE") return fail(`Invio non riuscito: ${outcome.error}`);
  if (outcome.status === "SIMULATA") {
    return { ok: true, message: "Modalità prova attiva (EMAIL_DRY_RUN): email registrata ma non inviata." };
  }
  return { ok: true, message: `Email di prova inviata a ${to}. Controlla la casella (anche lo spam).` };
}

/* ------------------------------------------------------------------ */
/* Template email                                                      */
/* ------------------------------------------------------------------ */

const templateKey = z
  .object({
    kind: z.enum(["AVVISO_MAGAZZINO", "CONFERMA_SPEDIZIONE", "AVVISO_BOLLA"], { error: "Template non valido" }),
    language: z.enum(languageEnum.enumValues, { error: "Lingua non valida" }),
  })
  .refine((v) => TEMPLATE_LANGUAGES[v.kind].includes(v.language), "Lingua non prevista per questo template");

const templateContent = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "L'oggetto è obbligatorio")
    .max(300, "Massimo 300 caratteri")
    .refine((v) => !/[\r\n]/.test(v), "L'oggetto deve stare su una riga"),
  body: z
    .string()
    .max(20000, "Testo troppo lungo")
    .transform((v) => v.replace(/\r\n/g, "\n").replace(/\s+$/, ""))
    .refine((v) => v.trim().length > 0, "Il testo è obbligatorio"),
});

export type TemplateKeyInput = { kind: string; language: string };
export type TemplateSaveInput = TemplateKeyInput & { subject: string; body: string };
export type TemplatePreviewInput = TemplateSaveInput & { requestId: number };

export async function saveTemplateAction(input: TemplateSaveInput): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const key = templateKey.safeParse(input);
  if (!key.success) return fail(key.error.issues[0]?.message ?? "Template non valido.");
  const content = templateContent.safeParse(input);
  if (!content.success) return fail(CHECK_FIELDS, zodFieldErrors(content.error.issues));

  const { kind, language } = key.data;
  const { subject, body } = content.data;
  await db
    .insert(emailTemplates)
    .values({ kind, language, subject, body, updatedById: actor.id })
    .onConflictDoUpdate({
      target: [emailTemplates.kind, emailTemplates.language],
      set: { subject, body, updatedById: actor.id, updatedAt: new Date() },
    });
  return done("Template salvato: da ora le email useranno questo testo.");
}

export async function resetTemplateAction(input: TemplateKeyInput): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const key = templateKey.safeParse(input);
  if (!key.success) return fail(key.error.issues[0]?.message ?? "Template non valido.");
  await db
    .delete(emailTemplates)
    .where(and(eq(emailTemplates.kind, key.data.kind), eq(emailTemplates.language, key.data.language)));
  return done("Template ripristinato al testo predefinito.");
}

export async function previewTemplateAction(input: TemplatePreviewInput): Promise<ActionResult<TemplateContent>> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const key = templateKey.safeParse(input);
  if (!key.success) return fail(key.error.issues[0]?.message ?? "Template non valido.");
  const content = templateContent.safeParse(input);
  if (!content.success) return fail(CHECK_FIELDS, zodFieldErrors(content.error.issues));
  const requestId = dbId.safeParse(input.requestId);
  if (!requestId.success) return fail("Seleziona una richiesta per l'anteprima.");

  const rendered = await previewNotification(key.data.kind, requestId.data, key.data.language, content.data);
  if (!rendered) return fail("Richiesta non trovata.");
  return { ok: true, data: rendered };
}

/* ------------------------------------------------------------------ */
/* Corrieri                                                            */
/* ------------------------------------------------------------------ */

function validTrackingUrl(value: string): boolean {
  try {
    const url = new URL(value.replaceAll("{tracking}", "ABC123"));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const carrierSchema = z.object({
  name: z.string().trim().min(1, "Inserisci il nome del corriere").max(80, "Massimo 80 caratteri"),
  trackingUrlTemplate: z
    .string()
    .trim()
    .max(500, "Massimo 500 caratteri")
    .refine((v) => !v || validTrackingUrl(v), "Indirizzo non valido: deve iniziare con https://")
    .transform((v) => (v ? v : null)),
  active: z.boolean(),
  sortOrder: z.coerce
    .number({ error: "Inserisci un numero" })
    .int("Inserisci un numero intero")
    .min(0, "Minimo 0")
    .max(9999, "Massimo 9999"),
});

function readCarrier(fd: FormData) {
  return carrierSchema.safeParse({
    name: str(fd, "name"),
    trackingUrlTemplate: str(fd, "trackingUrlTemplate"),
    active: checked(fd, "active"),
    sortOrder: str(fd, "sortOrder").trim() || "0",
  });
}

async function carrierNameTaken(name: string, exceptId?: number): Promise<boolean> {
  const cond = eq(sql`lower(${carriers.name})`, name.toLowerCase());
  const [row] = await db
    .select({ n: count() })
    .from(carriers)
    .where(exceptId ? and(cond, ne(carriers.id, exceptId)) : cond);
  return row.n > 0;
}

const CARRIER_TAKEN = "Esiste già un corriere con questo nome.";

export async function createCarrierAction(_prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const parsed = readCarrier(fd);
  if (!parsed.success) return fail(CHECK_FIELDS, zodFieldErrors(parsed.error.issues));
  if (await carrierNameTaken(parsed.data.name)) return fail(CARRIER_TAKEN, { name: CARRIER_TAKEN });
  await db.insert(carriers).values(parsed.data);
  return done(`Corriere «${parsed.data.name}» aggiunto.`);
}

export async function updateCarrierAction(carrierId: number, _prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  if (parseDbId(carrierId) === null) return fail("Corriere non valido.");
  const parsed = readCarrier(fd);
  if (!parsed.success) return fail(CHECK_FIELDS, zodFieldErrors(parsed.error.issues));
  if (await carrierNameTaken(parsed.data.name, carrierId)) return fail(CARRIER_TAKEN, { name: CARRIER_TAKEN });
  const updated = await db
    .update(carriers)
    .set(parsed.data)
    .where(eq(carriers.id, carrierId))
    .returning({ id: carriers.id });
  if (updated.length === 0) return fail("Corriere non trovato.");
  return done("Corriere aggiornato.");
}

export async function deleteCarrierAction(carrierId: number, _prev: State, _fd: FormData): Promise<ActionResult> {
  void _fd;
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  if (parseDbId(carrierId) === null) return fail("Corriere non valido.");
  const [used] = await db.select({ n: count() }).from(sampleRequests).where(eq(sampleRequests.carrierId, carrierId));
  if (used.n > 0) {
    return fail(
      `Il corriere è usato da ${used.n} richiest${used.n === 1 ? "a" : "e"} e non può essere eliminato: disattivalo invece.`,
    );
  }
  const deleted = await db.delete(carriers).where(eq(carriers.id, carrierId)).returning({ name: carriers.name });
  if (deleted.length === 0) return fail("Corriere non trovato.");
  return done(`Corriere «${deleted[0].name}» eliminato.`);
}

/* ------------------------------------------------------------------ */
/* Bolla e azienda                                                     */
/* ------------------------------------------------------------------ */

const line = (max: number) => z.string().trim().max(max, `Massimo ${max} caratteri`);

const companySchema = z.object({
  companyName: line(120).min(1, "Indica la ragione sociale"),
  companyAddress: line(300),
  companyTaxInfo: line(300),
  companyContacts: line(300),
  bollaCausale: line(120).min(1, "Indica la causale del trasporto"),
  bollaPorto: line(120),
  bollaAspetto: line(120),
});

export async function saveCompanySettingsAction(_prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const parsed = companySchema.safeParse(Object.fromEntries(Object.keys(companySchema.shape).map((k) => [k, str(fd, k)])));
  if (!parsed.success) return fail(CHECK_FIELDS, zodFieldErrors(parsed.error.issues));
  await updateSettings(parsed.data);
  return done("Dati aziendali e della bolla salvati.");
}

/* ------------------------------------------------------------------ */
/* Modulo pubblico                                                     */
/* ------------------------------------------------------------------ */

const publicFormSchema = z.object({
  publicFormEnabled: z.boolean(),
  publicFormIntro: z
    .string()
    .max(2000, "Massimo 2000 caratteri")
    .transform((v) => v.replace(/\r\n/g, "\n").trim()),
});

export async function savePublicFormSettingsAction(_prev: State, fd: FormData): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const parsed = publicFormSchema.safeParse({
    publicFormEnabled: checked(fd, "publicFormEnabled"),
    publicFormIntro: str(fd, "publicFormIntro"),
  });
  if (!parsed.success) return fail(CHECK_FIELDS, zodFieldErrors(parsed.error.issues));
  await updateSettings(parsed.data);
  return done(
    parsed.data.publicFormEnabled
      ? "Impostazioni del modulo pubblico salvate: il modulo è attivo."
      : "Impostazioni salvate. Attenzione: il modulo pubblico è disattivato e non accetta richieste.",
  );
}

/* ------------------------------------------------------------------ */
/* Costi per cliente                                                   */
/* ------------------------------------------------------------------ */

/**
 * Salva le voci dei «costi per cliente». Le voci manuali nuove arrivano con chiave vuota: la chiave
 * stabile si ricava dal nome (manualCostKey); quelle esistenti la mantengono anche se rinominate.
 */
export async function saveCostConfigAction(input: CostConfig): Promise<ActionResult<CostConfig>> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const raw = (input && typeof input === "object" ? input : {}) as Partial<CostConfig>;
  const manualIn = Array.isArray(raw.manual) ? raw.manual : [];
  const keys = manualIn.map((m) => (typeof m?.key === "string" ? m.key : "")).filter(Boolean);
  const manual = manualIn.map((m) => {
    if (typeof m?.key === "string" && m.key) return m;
    const key = manualCostKey(typeof m?.label === "string" ? m.label : "", keys);
    keys.push(key);
    return { ...m, key };
  });

  const parsed = costConfigSchema.safeParse({ ...raw, manual });
  if (!parsed.success) return fail(CHECK_FIELDS, zodFieldErrors(parsed.error.issues));
  const config = parsed.data;

  const seen = new Map<string, number>();
  for (const [i, item] of config.manual.entries()) {
    const name = item.label.toLowerCase();
    if (seen.has(name)) {
      return fail(CHECK_FIELDS, { [`manual.${i}.label`]: "C'è già una voce con questo nome" });
    }
    seen.set(name, i);
  }

  await updateSettings({ costConfig: config });
  revalidatePath("/", "layout");
  const active = activeCostComponents(config).length;
  return {
    ok: true,
    data: config,
    message: active
      ? "Voci di costo salvate: cruscotto e report usano da subito le nuove impostazioni."
      : "Voci di costo salvate. Attenzione: nessuna voce è attiva, i costi per cliente risulteranno sempre 0.",
  };
}

/* ------------------------------------------------------------------ */
/* Bolla di consegna: modalità, numerazione, regole                    */
/* ------------------------------------------------------------------ */

export async function saveBollaConfigAction(input: BollaConfig): Promise<ActionResult<BollaConfig>> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const raw = (input && typeof input === "object" ? input : {}) as Partial<BollaConfig>;
  // messaggi in italiano per i limiti numerici (lo schema usa quelli predefiniti di zod)
  const errors: Record<string, string> = {};
  const padding = Number(raw.numberPadding);
  if (!Number.isInteger(padding) || padding < 1 || padding > 8) errors.numberPadding = "Scegli da 1 a 8 cifre";
  const minPackages = raw.rules?.minPackages;
  if (minPackages !== null && minPackages !== undefined) {
    const n = Number(minPackages);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      errors["rules.minPackages"] = "Scrivi un numero intero da 1 a 999, oppure lascia vuoto";
    }
  }
  const parsed = bollaConfigSchema.safeParse(raw);
  if (!parsed.success || Object.keys(errors).length) {
    return fail(CHECK_FIELDS, { ...(parsed.success ? {} : zodFieldErrors(parsed.error.issues)), ...errors });
  }
  const config = parsed.data;

  const unknown = unknownBollaPlaceholders(config.numberFormat);
  if (unknown.length) {
    return fail(CHECK_FIELDS, {
      numberFormat: `Segnaposto non riconosciuto: ${unknown.join(", ")}. Usa solo {numero} e {anno}.`,
    });
  }
  if (/[\r\n\t]/.test(config.numberFormat)) {
    return fail(CHECK_FIELDS, { numberFormat: "Il formato deve stare su una riga" });
  }
  // formati senza doppioni, nell'ordine dell'elenco
  config.rules.formats = SAMPLE_FORMATS.filter((f) => config.rules.formats.includes(f));

  await updateSettings({ bollaConfig: config });
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: config,
    message:
      "Impostazioni della bolla salvate. Le regole valgono per le richieste nuove o modificate da ora in poi e quando il magazzino segna una richiesta pronta.",
  };
}

/* ------------------------------------------------------------------ */
/* Export m² per il CRM                                                */
/* ------------------------------------------------------------------ */

export async function saveCrmExportConfigAction(input: CrmExportConfig): Promise<ActionResult<CrmExportConfig>> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const raw = (input && typeof input === "object" ? input : {}) as Partial<CrmExportConfig>;
  const errors: Record<string, string> = {};

  // destinatari: stessi controlli delle altre liste di indirizzi
  const tokens = (Array.isArray(raw.autoSend?.recipients) ? raw.autoSend.recipients : [])
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter(Boolean);
  const invalid = tokens.filter((t) => !isValidEmail(t));
  if (invalid.length) {
    errors["autoSend.recipients"] = `Indirizzi non validi: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? "…" : ""}`;
  }
  const recipients = parseEmailList(tokens);
  if (recipients.length > 10) errors["autoSend.recipients"] ??= "Massimo 10 destinatari";
  const day = Number(raw.autoSend?.day);
  if (!Number.isInteger(day) || day < 1 || day > 28) errors["autoSend.day"] = "Scegli un giorno tra 1 e 28";
  if (typeof raw.fileName === "string" && raw.fileName.trim().length > 80) errors.fileName = "Massimo 80 caratteri";
  const columns = Array.isArray(raw.columns) ? [...new Set(raw.columns)] : raw.columns;
  const webhook = {
    enabled: raw.webhook?.enabled,
    url: typeof raw.webhook?.url === "string" ? raw.webhook.url.trim() : raw.webhook?.url,
    secret: typeof raw.webhook?.secret === "string" ? raw.webhook.secret.trim() : raw.webhook?.secret,
  };

  const parsed = crmExportConfigSchema.safeParse({
    ...raw,
    columns,
    autoSend: { ...raw.autoSend, recipients },
    webhook,
  });
  if (typeof webhook.url === "string" && webhook.url && !/^https:\/\/\S+$/.test(webhook.url)) {
    errors["webhook.url"] = "Indica un indirizzo https://";
  }
  if (webhook.enabled === true && (typeof webhook.secret !== "string" || webhook.secret.length < 16)) {
    errors["webhook.secret"] = "Genera un segreto: serve al CRM per verificare che i dati arrivino da BGP";
  }
  if (!parsed.success) Object.assign(errors, { ...zodFieldErrors(parsed.error.issues), ...errors });
  // errori sui singoli elementi delle liste (es. "columns.2") → sul campo della lista
  for (const key of Object.keys(errors)) {
    const list = /^(autoSend\.recipients|columns)\.\d+$/.exec(key)?.[1];
    if (list) {
      errors[list] ??= errors[key];
      delete errors[key];
    }
  }
  if (!parsed.success || Object.keys(errors).length) return fail(CHECK_FIELDS, errors);

  const config = parsed.data;
  await updateSettings({ crmExport: config });
  revalidatePath("/", "layout");
  const auto = config.autoSend.enabled || config.webhook.enabled;
  return {
    ok: true,
    data: config,
    message: auto
      ? `Impostazioni dell'export salvate. Invio automatico attivo: il giorno ${config.autoSend.day} di ogni mese parte l'export del mese precedente.`
      : "Impostazioni dell'export salvate.",
  };
}

/** «Invia ora il mese precedente»: email con il file ai destinatari salvati (il webhook resta al solo invio automatico). */
export async function sendCrmExportNowAction(): Promise<ActionResult> {
  const actor = await getAuthorizedUser("settings.manage");
  if (!actor) return NOT_AUTHORIZED;
  const config = await getSetting("crmExport");
  const recipients = config.autoSend.recipients;
  if (recipients.length === 0) {
    return fail("Nessun destinatario salvato: aggiungi almeno un indirizzo in «Invio automatico», salva e riprova.");
  }
  const month = previousMonthIso();
  const result = await sendCrmExport(month, { triggeredById: actor.id, recipients });
  revalidatePath("/", "layout");

  const label = formatMonth(month);
  const empty =
    result.rows === 0 ? " Attenzione: nel mese non risultano campioni spediti, il file contiene solo l'intestazione." : "";
  switch (result.email.status) {
    case "ERRORE":
      return fail(`Invio non riuscito: ${result.email.detail ?? "errore del server di posta"}.`);
    case "SIMULATA":
      return {
        ok: true,
        message: `Modalità prova attiva (EMAIL_DRY_RUN): l'export di ${label} è stato registrato nel registro email ma non inviato.${empty}`,
      };
    case "INVIATA":
      return {
        ok: true,
        message: `Export di ${label} inviato a ${recipients.join(", ")} (${result.rows} righe).${empty}`,
      };
    default:
      return fail("Nessuna email inviata: controlla i destinatari salvati.");
  }
}
