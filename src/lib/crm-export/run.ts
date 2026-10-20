import "server-only";
import { createHmac } from "node:crypto";
import ExcelJS from "exceljs";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contacts, emailLog, pieces, products, sampleRequests, scheduledRuns } from "@/db/schema";
import {
  CRM_COLUMNS,
  crmCsv,
  crmFileName,
  type CrmColumn,
  type CrmExportConfig,
  type CrmRow,
} from "@/lib/config/crm-export";
import { sendMail } from "@/lib/email/mailer";
import { formatEmailList, parseEmailList } from "@/lib/email/recipients";
import { textToHtml } from "@/lib/email/templates";
import { formatMonth, todayIso } from "@/lib/format";
import { shippedBetween } from "@/lib/reports/conditions";
import { monthEnd, monthStart } from "@/lib/reports/period";
import { getSettings } from "@/lib/settings";

/**
 * Export mensile dei m² per il CRM secondo la configurazione di BGP:
 * righe raggruppate, file CSV/XLSX, invio via email e/o webhook, esecuzione programmata.
 */

const AGENT_NAME = sql<string>`coalesce(agent.name, 'Direzionale (senza agente)')`;

/** Righe dell'export del mese (m² nel mese della data di spedizione effettiva). */
export async function getCrmExportRows(month: string, config: CrmExportConfig): Promise<CrmRow[]> {
  const inMonth = shippedBetween(monthStart(month), monthEnd(month));
  const measures = {
    richieste: sql<number>`count(distinct ${pieces.requestId})::int`.mapWith(Number),
    pezzi: sql<number>`coalesce(sum(${pieces.quantity}), 0)::int`.mapWith(Number),
    m2: sql<number>`round(coalesce(sum(${pieces.areaM2}), 0)::numeric, 4)::float8`.mapWith(Number),
  };
  const productCols = {
    codice: products.code,
    descrizione: products.description,
    marchio: products.brand,
    categoria: products.category,
  };
  const customerCols = { cliente: contacts.name, paese: contacts.country, agente: AGENT_NAME };
  const from = <T extends Record<string, unknown>>(fields: T) =>
    db
      .select(fields as never)
      .from(pieces)
      .innerJoin(sampleRequests, eq(sampleRequests.id, pieces.requestId))
      .innerJoin(products, eq(products.id, pieces.productId))
      .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
      .leftJoin(sql`${contacts} as agent`, sql`agent.id = ${contacts.agentId}`)
      .where(inMonth)
      .$dynamic();

  let rows: Record<string, unknown>[];
  switch (config.groupBy) {
    case "PRODOTTO":
      rows = await from({ ...productCols, ...measures })
        .groupBy(products.id)
        .orderBy(sql`sum(${pieces.areaM2}) desc`, asc(products.code));
      break;
    case "PRODOTTO_CLIENTE":
      rows = await from({ ...productCols, ...customerCols, ...measures })
        .groupBy(products.id, contacts.id, sql`agent.name`)
        .orderBy(asc(products.code), asc(contacts.name));
      break;
    case "CLIENTE":
      rows = await from({ ...customerCols, ...measures })
        .groupBy(contacts.id, sql`agent.name`)
        .orderBy(sql`sum(${pieces.areaM2}) desc`, asc(contacts.name));
      break;
    case "AGENTE":
      rows = await from({ agente: AGENT_NAME, ...measures })
        .groupBy(sql`agent.name`)
        .orderBy(sql`sum(${pieces.areaM2}) desc`);
      break;
  }
  return rows.map((r) => {
    const out: CrmRow = { mese: month };
    for (const col of Object.keys(CRM_COLUMNS) as CrmColumn[]) {
      if (col !== "mese" && col in r) out[col] = r[col] as string | number | null;
    }
    return out;
  });
}

export type CrmExportFile = { fileName: string; contentType: string; data: Buffer; rows: number };

/** File dell'export (CSV o Excel) secondo la configurazione. */
export async function buildCrmExportFile(month: string, config: CrmExportConfig): Promise<CrmExportFile> {
  const rows = await getCrmExportRows(month, config);
  const fileName = crmFileName(config, month);
  if (config.format === "CSV") {
    return { fileName, contentType: "text/csv; charset=utf-8", data: Buffer.from(crmCsv(rows, config), "utf8"), rows: rows.length };
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`m2 ${month}`);
  ws.columns = config.columns.map((c) => ({
    header: config.header ? CRM_COLUMNS[c] : undefined,
    key: c,
    width: c === "descrizione" ? 60 : c === "cliente" || c === "agente" ? 36 : 14,
    // codici sempre come testo (10150E1 non deve diventare un numero)
    style: c === "codice" ? { numFmt: "@" } : c === "m2" ? { numFmt: "0.00" } : {},
  }));
  if (!config.header) ws.spliceRows(1, 1);
  for (const r of rows) ws.addRow(Object.fromEntries(config.columns.map((c) => [c, r[c] ?? null])));
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    fileName,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data,
    rows: rows.length,
  };
}

/** Mese precedente a quello di oggi (fuso di Roma), formato AAAA-MM. */
export function previousMonthIso(today = todayIso()): string {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export type CrmSendResult = {
  month: string;
  rows: number;
  email: { status: "INVIATA" | "SIMULATA" | "ERRORE" | "DISATTIVATO"; detail?: string };
  webhook: { status: "OK" | "ERRORE" | "DISATTIVATO"; detail?: string };
};

/**
 * Invia l'export del mese: email con il file ai destinatari configurati e/o POST al webhook
 * (JSON firmato: intestazione X-BGP-Signature = "sha256=" + HMAC SHA-256 del corpo con il segreto).
 * `force` invia anche se i canali automatici sono disattivati (pulsante «Invia ora» → solo email).
 */
export async function sendCrmExport(
  month: string,
  options: { triggeredById?: number | null; recipients?: string[] } = {},
): Promise<CrmSendResult> {
  const settings = await getSettings();
  const config = settings.crmExport;
  const file = await buildCrmExportFile(month, config);
  const result: CrmSendResult = {
    month,
    rows: file.rows,
    email: { status: "DISATTIVATO" },
    webhook: { status: "DISATTIVATO" },
  };

  const to = parseEmailList(options.recipients ?? (config.autoSend.enabled ? config.autoSend.recipients : []));
  if (to.length) {
    const subject = `Export m² campioni — ${formatMonth(month)}`;
    const body = [
      "Buongiorno,",
      "",
      `in allegato l'export dei m² dei campioni spediti in ${formatMonth(month)} (${file.rows} righe), da registrare nel CRM.`,
      "",
      "Messaggio automatico del gestionale Campionature BGP.",
    ].join("\n");
    const outcome = await sendMail({
      from: settings.mailFrom,
      replyTo: settings.mailReplyTo,
      to,
      subject,
      text: body,
      html: textToHtml(body),
      attachments: [{ filename: file.fileName, content: file.data, contentType: file.contentType }],
    });
    await db.insert(emailLog).values({
      requestId: null,
      kind: "EXPORT_CRM",
      language: "it",
      toAddresses: formatEmailList(to),
      subject,
      body,
      attachmentNames: file.fileName,
      status: outcome.status,
      error: outcome.status === "ERRORE" ? outcome.error : null,
      messageId: outcome.status === "INVIATA" ? outcome.messageId : null,
      triggeredById: options.triggeredById ?? null,
    });
    result.email = outcome.status === "ERRORE" ? { status: "ERRORE", detail: outcome.error } : { status: outcome.status };
  }

  if (config.webhook.enabled && config.webhook.url && !options.recipients) {
    result.webhook = await postWebhook(month, config);
  }
  return result;
}

async function postWebhook(month: string, config: CrmExportConfig): Promise<CrmSendResult["webhook"]> {
  try {
    const rows = await getCrmExportRows(month, config);
    const payload = JSON.stringify({
      tipo: "export_m2_campioni",
      mese: month,
      raggruppamento: config.groupBy,
      colonne: config.columns,
      righe: rows.map((r) => Object.fromEntries(config.columns.map((c) => [c, r[c] ?? null]))),
      generatoIl: new Date().toISOString(),
    });
    const signature = createHmac("sha256", config.webhook.secret || "").update(payload).digest("hex");
    const res = await fetch(config.webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BGP-Signature": `sha256=${signature}` },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? { status: "OK", detail: `HTTP ${res.status}` } : { status: "ERRORE", detail: `HTTP ${res.status}` };
  } catch (err) {
    return { status: "ERRORE", detail: err instanceof Error ? err.message : String(err) };
  }
}

const JOB = "crm-export";

/**
 * Attività programmata: dal giorno configurato del mese invia l'export del mese precedente,
 * una sola volta per mese (anche con più istanze: la riga in scheduled_runs fa da lucchetto).
 * Restituisce null se non c'era nulla da fare.
 */
export async function runDueCrmExport(today = todayIso()): Promise<CrmSendResult | null> {
  const { crmExport: config } = await getSettings();
  const channelsOn = (config.autoSend.enabled && config.autoSend.recipients.length > 0) || config.webhook.enabled;
  if (!channelsOn) return null;
  if (Number(today.slice(8, 10)) < config.autoSend.day) return null;
  const month = previousMonthIso(today);
  const claimed = await db
    .insert(scheduledRuns)
    .values({ job: JOB, period: month, status: "IN_CORSO" })
    .onConflictDoNothing()
    .returning({ id: scheduledRuns.id });
  if (claimed.length === 0) return null;
  try {
    const result = await sendCrmExport(month);
    const failed = result.email.status === "ERRORE" || result.webhook.status === "ERRORE";
    await db
      .update(scheduledRuns)
      .set({ status: failed ? "ERRORE" : "OK", detail: JSON.stringify(result) })
      .where(eq(scheduledRuns.id, claimed[0].id));
    return result;
  } catch (err) {
    await db
      .update(scheduledRuns)
      .set({ status: "ERRORE", detail: err instanceof Error ? err.message : String(err) })
      .where(and(eq(scheduledRuns.id, claimed[0].id)));
    throw err;
  }
}

/** Ultime esecuzioni dell'export automatico (per la pagina delle impostazioni). */
export async function recentCrmExportRuns(limit = 6) {
  return db
    .select()
    .from(scheduledRuns)
    .where(eq(scheduledRuns.job, JOB))
    .orderBy(sql`${scheduledRuns.createdAt} desc`)
    .limit(limit);
}
