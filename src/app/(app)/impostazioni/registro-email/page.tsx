import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { emailKindEnum, emailLog, emailStatusEnum, users, type EmailKind } from "@/db/schema";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/form";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { EMAIL_KIND_LABELS } from "@/lib/email/templates";
import { formatDateTime, LANGUAGE_LABELS, requestCode } from "@/lib/format";
import { likePattern } from "@/lib/search";

export const metadata: Metadata = { title: "Registro email — Impostazioni" };

const PAGE_SIZE = 50;

type EmailStatus = (typeof emailStatusEnum.enumValues)[number];

const STATUS_INFO: Record<EmailStatus, { label: string; tone: BadgeTone }> = {
  INVIATA: { label: "Inviata", tone: "green" },
  SIMULATA: { label: "Simulata", tone: "amber" },
  ERRORE: { label: "Errore", tone: "red" },
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function EmailLogPage({ searchParams }: PageProps<"/impostazioni/registro-email">) {
  await requireUser("settings.manage");
  const sp = await searchParams;
  const kindParam = first(sp.tipo);
  const statusParam = first(sp.stato);
  const q = first(sp.q).trim().slice(0, 100);
  const kind = (emailKindEnum.enumValues as string[]).includes(kindParam) ? (kindParam as EmailKind) : undefined;
  const status = (emailStatusEnum.enumValues as string[]).includes(statusParam) ? (statusParam as EmailStatus) : undefined;
  const page = parsePage(sp.pagina);

  const conds: SQL[] = [];
  if (kind) conds.push(eq(emailLog.kind, kind));
  if (status) conds.push(eq(emailLog.status, status));
  if (q) {
    const pattern = likePattern(q);
    conds.push(
      or(ilike(emailLog.toAddresses, pattern), ilike(emailLog.ccAddresses, pattern), ilike(emailLog.subject, pattern))!,
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: emailLog.id,
        createdAt: emailLog.createdAt,
        kind: emailLog.kind,
        language: emailLog.language,
        requestId: emailLog.requestId,
        toAddresses: emailLog.toAddresses,
        ccAddresses: emailLog.ccAddresses,
        subject: emailLog.subject,
        body: emailLog.body,
        attachmentNames: emailLog.attachmentNames,
        status: emailLog.status,
        error: emailLog.error,
        triggeredBy: users.name,
      })
      .from(emailLog)
      .leftJoin(users, eq(users.id, emailLog.triggeredById))
      .where(where)
      .orderBy(desc(emailLog.createdAt), desc(emailLog.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(emailLog).where(where),
  ]);
  const filtered = Boolean(kind || status || q);

  return (
    <Card>
      <form
        method="get"
        action="/impostazioni/registro-email"
        className="grid gap-3 border-b border-slate-100 px-5 py-4 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end"
      >
        <div className="space-y-1.5">
          <Label htmlFor="log-kind">Tipo</Label>
          <Select id="log-kind" name="tipo" defaultValue={kind ?? ""}>
            <option value="">Tutti i tipi</option>
            {emailKindEnum.enumValues.map((k) => (
              <option key={k} value={k}>
                {EMAIL_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-status">Esito</Label>
          <Select id="log-status" name="stato" defaultValue={status ?? ""}>
            <option value="">Tutti gli esiti</option>
            {emailStatusEnum.enumValues.map((s) => (
              <option key={s} value={s}>
                {STATUS_INFO[s].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-q">Destinatario o oggetto</Label>
          <Input id="log-q" name="q" type="search" defaultValue={q} placeholder="es. cliente@azienda.it" />
        </div>
        <div className="flex gap-2">
          <button type="submit" className={buttonClasses("primary", "md")}>
            Filtra
          </button>
          {filtered ? (
            <LinkButton href="/impostazioni/registro-email" variant="ghost">
              Azzera
            </LinkButton>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "Nessuna email con questi filtri" : "Nessuna email registrata"}
          description={
            filtered
              ? "Prova a cambiare o azzerare i filtri."
              : "Qui compaiono tutte le email automatiche e di prova, con l'esito dell'invio."
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Data</TH>
              <TH>Tipo</TH>
              <TH>Richiesta</TH>
              <TH>Destinatari</TH>
              <TH>Oggetto</TH>
              <TH>Esito</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap">
                  {formatDateTime(r.createdAt)}
                  {r.triggeredBy ? <div className="text-xs text-slate-500">{r.triggeredBy}</div> : null}
                </TD>
                <TD className="min-w-40">
                  {EMAIL_KIND_LABELS[r.kind]}
                  {r.language !== "it" ? <div className="text-xs text-slate-500">{LANGUAGE_LABELS[r.language]}</div> : null}
                </TD>
                <TD className="whitespace-nowrap">
                  {r.requestId ? (
                    <Link href={`/richieste/${r.requestId}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                      {requestCode(r.requestId)}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TD>
                <TD className="min-w-48 max-w-72 break-words text-xs">
                  <div>{r.toAddresses}</div>
                  {r.ccAddresses ? <div className="mt-0.5 text-slate-500">Cc: {r.ccAddresses}</div> : null}
                </TD>
                <TD className="min-w-64 max-w-md">
                  <details className="group">
                    <summary className="cursor-pointer text-slate-900 hover:text-brand-700">
                      <span className="underline decoration-slate-300 underline-offset-2 group-open:no-underline">
                        {r.subject}
                      </span>
                      {r.attachmentNames ? (
                        <span className="mt-0.5 block text-xs text-slate-500">Allegati: {r.attachmentNames}</span>
                      ) : null}
                    </summary>
                    <div className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-700 ring-1 ring-slate-200">
                      {r.body}
                    </div>
                  </details>
                </TD>
                <TD className="min-w-28">
                  <Badge tone={STATUS_INFO[r.status].tone}>{STATUS_INFO[r.status].label}</Badge>
                  {r.error ? <div className="mt-1 max-w-56 text-xs break-words text-red-700">{r.error}</div> : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/impostazioni/registro-email"
        params={{ tipo: kind, stato: status, q: q || undefined }}
      />
    </Card>
  );
}
