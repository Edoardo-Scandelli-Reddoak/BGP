import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

export type OutgoingAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
  /** Per le immagini inline (cid:...). */
  cid?: string;
};

export type OutgoingMail = {
  from: string;
  replyTo?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: OutgoingAttachment[];
};

export type SendOutcome =
  | { status: "INVIATA"; messageId: string | null }
  | { status: "SIMULATA"; messageId: null }
  | { status: "ERRORE"; error: string };

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST non configurato");
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" }
      : undefined,
  });
  return transporter;
}

export function isDryRun(): boolean {
  return process.env.EMAIL_DRY_RUN === "true";
}

/** Invia un'email. Non lancia eccezioni: l'esito viene registrato nel registro email dal chiamante. */
export async function sendMail(mail: OutgoingMail): Promise<SendOutcome> {
  if (mail.to.length === 0) return { status: "ERRORE", error: "Nessun destinatario valido" };
  if (isDryRun()) return { status: "SIMULATA", messageId: null };
  try {
    const info = await getTransporter().sendMail({
      from: mail.from,
      replyTo: mail.replyTo || undefined,
      to: mail.to,
      cc: mail.cc?.length ? mail.cc : undefined,
      bcc: mail.bcc?.length ? mail.bcc : undefined,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        cid: a.cid,
      })),
    });
    return { status: "INVIATA", messageId: info.messageId ?? null };
  } catch (err) {
    return { status: "ERRORE", error: err instanceof Error ? err.message : String(err) };
  }
}
