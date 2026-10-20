import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailLog, emailTemplates, type ContactType, type EmailKind, type Language } from "@/db/schema";
import { formatDate, formatNumber, requestCode } from "@/lib/format";
import { sampleFormatText } from "@/lib/sample-formats";
import { generateBollaPdf } from "@/lib/pdf/bolla";
import { getAttachmentFile, getRequestDetail, type RequestDetail } from "@/lib/requests/queries";
import { getSettings, type AppSettings } from "@/lib/settings";
import { sendMail, type OutgoingAttachment, type SendOutcome } from "./mailer";
import { formatEmailList, parseEmailList } from "./recipients";
import {
  DEFAULT_TEMPLATES,
  renderTemplate,
  textToHtml,
  type TemplateContent,
  type TemplateVars,
} from "./templates";

/** Content-ID dell'immagine della firma nelle email HTML. */
export const SIGNATURE_CID = "firma-bgp";

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** URL di tracking del corriere: sostituisce {tracking} se presente nel modello. */
export function trackingUrl(template: string | null | undefined, tracking: string | null | undefined): string {
  if (!template) return "";
  if (!template.includes("{tracking}")) return template;
  if (!tracking?.trim()) return "";
  return template.replaceAll("{tracking}", encodeURIComponent(tracking.replace(/\s+/g, "")));
}

/** "- 2 × Mezze doghe — Pavimento in legno … (CODICE)": formato nella lingua del destinatario. */
function productLines(detail: RequestDetail, lang: Language): string {
  return detail.items
    .map((i) => {
      const format = sampleFormatText(i.sampleFormat, i.formatNote, lang);
      const name = `${i.product.description || i.product.code} (${i.product.code})`;
      return `- ${i.quantity} × ${format ? `${format} — ` : ""}${name}`;
    })
    .join("\n");
}

const PHONE_NOTICE_TEXT: Record<Language, { yes: string; no: string }> = {
  it: { yes: "Sì, tel.", no: "No" },
  en: { yes: "Yes, phone", no: "No" },
  fr: { yes: "Oui, tél.", no: "Non" },
  de: { yes: "Ja, Tel.", no: "Nein" },
};

/** "Sì, tel. 328 3556565" / "No" / "" se non indicato. */
export function phoneNoticeText(phoneNotice: boolean | null, number: string | null, lang: Language = "it"): string {
  if (phoneNotice === null) return "";
  const t = PHONE_NOTICE_TEXT[lang];
  return phoneNotice ? `${t.yes} ${number?.trim() ?? ""}`.trim() : t.no;
}

const YES_NO: Record<Language, [string, string]> = {
  it: ["Sì", "No"],
  en: ["Yes", "No"],
  fr: ["Oui", "Non"],
  de: ["Ja", "Nein"],
};

/** Valori dei segnaposto per una richiesta, nella lingua indicata. */
export function buildTemplateVars(
  detail: RequestDetail,
  lang: Language,
  settings: Pick<AppSettings, "mailSignature">,
): TemplateVars {
  return {
    codice_richiesta: requestCode(detail.id),
    data_richiesta: formatDate(detail.receivedAt, lang),
    cliente: detail.contact.name,
    email_cliente: formatEmailList(parseEmailList(detail.contact.email)),
    agente: detail.contact.agent?.name ?? "",
    prodotti: productLines(detail, lang),
    destinatario: detail.recipientName?.trim() || detail.contact.name,
    alla_ca: detail.attentionOf?.trim() ?? "",
    destinazione: detail.destinationAddress.replace(/\s*\n\s*/g, ", "),
    preavviso: phoneNoticeText(detail.phoneNotice, detail.phoneNoticeNumber, lang),
    note: detail.notes?.trim() ?? "",
    bolla_richiesta: YES_NO[lang][detail.deliveryFormRequired ? 0 : 1],
    colli: detail.packagesCount ? String(detail.packagesCount) : "",
    peso_kg: detail.weightKg ? formatNumber(detail.weightKg, 2, lang) : "",
    mq_totali: detail.totalM2 ? formatNumber(detail.totalM2, 2, lang) : "",
    corriere: detail.carrier?.name ?? "",
    data_ritiro: formatDate(detail.pickupDate, lang),
    tracking: detail.trackingNumber?.trim() ?? "",
    link_tracking: trackingUrl(detail.carrier?.trackingUrlTemplate, detail.trackingNumber),
    data_spedizione: formatDate(detail.shipmentDate, lang),
    numero_ddt: detail.ddtNumber?.trim() ?? "",
    link_richiesta: `${appUrl()}/richieste/${detail.id}`,
    firma: settings.mailSignature,
  };
}

/** Template salvato nel DB, altrimenti quello predefinito; se manca la lingua si usa l'italiano. */
export async function loadTemplate(kind: Exclude<EmailKind, "TEST">, lang: Language): Promise<TemplateContent> {
  for (const l of lang === "it" ? (["it"] as Language[]) : [lang, "it" as Language]) {
    const rows = await db
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.kind, kind), eq(emailTemplates.language, l)))
      .limit(1);
    if (rows[0]) return { subject: rows[0].subject, body: rows[0].body };
    const def = DEFAULT_TEMPLATES[kind][l];
    if (def) return def;
  }
  return DEFAULT_TEMPLATES[kind].it!;
}

/** Immagine della firma BGP (banner dei marchi) come allegato inline, o null se il file manca. */
export async function signatureImageAttachment(): Promise<OutgoingAttachment | null> {
  try {
    const content = await readFile(path.join(process.cwd(), "public", "email", "firma-bgp.png"));
    return { filename: "firma-bgp.png", content, contentType: "image/png", cid: SIGNATURE_CID };
  } catch {
    return null;
  }
}

async function signatureAttachment(settings: AppSettings): Promise<OutgoingAttachment | null> {
  return settings.mailSignatureImage ? signatureImageAttachment() : null;
}

type ConfirmationContact = {
  email: string | null;
  type: ContactType;
  agent: { email: string | null } | null;
};

/**
 * Destinatari della conferma di spedizione: gli indirizzi del contatto; l'agente in copia solo
 * se il contatto è un cliente, senza ripetere gli indirizzi già tra i destinatari.
 */
export function confirmationRecipients(contact: ConfirmationContact): { to: string[]; cc: string[] } {
  const to = parseEmailList(contact.email);
  const toKeys = new Set(to.map((e) => e.toLowerCase()));
  const cc =
    contact.type === "CLIENTE" && contact.agent
      ? parseEmailList(contact.agent.email).filter((e) => !toKeys.has(e.toLowerCase()))
      : [];
  return { to, cc };
}

/** File da allegare alla conferma di spedizione: DDT caricato, altrimenti la bolla generata se richiesta. */
async function shipmentAttachments(detail: RequestDetail, settings: AppSettings): Promise<OutgoingAttachment[]> {
  if (detail.ddtAttachment) {
    const file = await getAttachmentFile(detail.ddtAttachment.id);
    if (file) return [{ filename: file.fileName, content: Buffer.from(file.data), contentType: file.mimeType }];
  }
  if (detail.deliveryFormRequired) {
    const pdf = await generateBollaPdf(detail, settings);
    return [
      {
        filename: `Bolla-${requestCode(detail.id)}.pdf`,
        content: Buffer.from(pdf),
        contentType: "application/pdf",
      },
    ];
  }
  return [];
}

export type NotificationResult = {
  kind: EmailKind;
  status: SendOutcome["status"];
  to: string[];
  error?: string;
  logId: number;
};

/**
 * Compone, invia e registra nel registro email una delle tre email automatiche.
 * Non lancia eccezioni per errori SMTP: l'esito è nel risultato e nel registro.
 */
export async function sendRequestNotification(
  kind: Exclude<EmailKind, "TEST">,
  requestId: number,
  triggeredById: number | null,
): Promise<NotificationResult> {
  const detail = await getRequestDetail(requestId);
  if (!detail) throw new Error(`Richiesta ${requestId} non trovata`);
  const settings = await getSettings();

  let to: string[];
  let cc: string[] = [];
  let bcc: string[] = [];
  let lang: Language = "it";
  let attachments: OutgoingAttachment[] = [];

  if (kind === "CONFERMA_SPEDIZIONE") {
    lang = detail.contact.language;
    ({ to, cc } = confirmationRecipients(detail.contact));
    bcc = parseEmailList(settings.shipmentBcc);
    attachments = await shipmentAttachments(detail, settings);
  } else if (kind === "AVVISO_MAGAZZINO") {
    to = parseEmailList(settings.warehouseEmails);
  } else {
    to = parseEmailList(settings.logisticsEmails);
  }

  const template = await loadTemplate(kind, lang);
  const rendered = renderTemplate(template, buildTemplateVars(detail, lang, settings));
  const signature = kind === "CONFERMA_SPEDIZIONE" ? await signatureAttachment(settings) : null;

  const outcome: SendOutcome =
    to.length === 0
      ? {
          status: "ERRORE",
          error:
            kind === "CONFERMA_SPEDIZIONE"
              ? "Il contatto non ha un indirizzo email valido"
              : "Nessun destinatario configurato nelle impostazioni",
        }
      : await sendMail({
          from: settings.mailFrom,
          replyTo: settings.mailReplyTo,
          to,
          cc,
          bcc,
          subject: rendered.subject,
          text: rendered.body,
          html: textToHtml(rendered.body, signature ? SIGNATURE_CID : undefined),
          attachments: signature ? [...attachments, signature] : attachments,
        });

  const [log] = await db
    .insert(emailLog)
    .values({
      requestId,
      kind,
      language: lang,
      toAddresses: formatEmailList(to) || "—",
      ccAddresses: cc.length ? formatEmailList(cc) : null,
      subject: rendered.subject,
      body: rendered.body,
      attachmentNames: attachments.length ? attachments.map((a) => a.filename).join(", ") : null,
      status: outcome.status,
      error: outcome.status === "ERRORE" ? outcome.error : null,
      messageId: outcome.status === "INVIATA" ? outcome.messageId : null,
      triggeredById,
    })
    .returning({ id: emailLog.id });

  return {
    kind,
    status: outcome.status,
    to,
    error: outcome.status === "ERRORE" ? outcome.error : undefined,
    logId: log.id,
  };
}

/** Anteprima (senza invio) di un template per una richiesta: usata dall'editor dei template. */
export async function previewNotification(
  kind: Exclude<EmailKind, "TEST">,
  requestId: number,
  lang: Language,
  template?: TemplateContent,
): Promise<TemplateContent | null> {
  const detail = await getRequestDetail(requestId);
  if (!detail) return null;
  const settings = await getSettings();
  const tpl = template ?? (await loadTemplate(kind, lang));
  return renderTemplate(tpl, buildTemplateVars(detail, lang, settings));
}
