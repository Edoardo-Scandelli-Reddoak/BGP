import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailTemplates, sampleRequests, users, type Language, type RequestStatus } from "@/db/schema";
import { TemplateEditor, type PreviewRequestOption } from "@/components/impostazioni/template-editor";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { requireUser } from "@/lib/auth/session";
import {
  DEFAULT_TEMPLATES,
  EMAIL_KIND_DESCRIPTIONS,
  EMAIL_KIND_LABELS,
  TEMPLATE_LANGUAGES, type RequestEmailKind } from "@/lib/email/templates";
import { formatDateTime, LANGUAGE_LABELS, requestCode } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/status";

export const metadata: Metadata = { title: "Template email — Impostazioni" };

type TemplateKind = RequestEmailKind;

const KINDS = Object.keys(TEMPLATE_LANGUAGES) as TemplateKind[];

/** Stati in cui una richiesta ha i dati che il template usa (per scegliere la richiesta d'anteprima). */
const PREVIEW_STATUSES: Record<TemplateKind, RequestStatus[]> = {
  AVVISO_MAGAZZINO: ["IN_PREPARAZIONE", "PRONTA_RITIRO", "SPEDITA", "COMPLETATA"],
  AVVISO_BOLLA: ["PRONTA_RITIRO", "SPEDITA", "COMPLETATA"],
  CONFERMA_SPEDIZIONE: ["COMPLETATA", "SPEDITA"],
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TemplatesSettingsPage({ searchParams }: PageProps<"/impostazioni/template">) {
  await requireUser("settings.manage");
  const sp = await searchParams;
  const tipo = first(sp.tipo);
  const kind: TemplateKind = KINDS.includes(tipo as TemplateKind) ? (tipo as TemplateKind) : "AVVISO_MAGAZZINO";
  const lingua = first(sp.lingua);
  const language: Language = TEMPLATE_LANGUAGES[kind].includes(lingua as Language) ? (lingua as Language) : "it";

  const [saved, recent] = await Promise.all([
    db
      .select({
        kind: emailTemplates.kind,
        language: emailTemplates.language,
        subject: emailTemplates.subject,
        body: emailTemplates.body,
        updatedAt: emailTemplates.updatedAt,
        updatedBy: users.name,
      })
      .from(emailTemplates)
      .leftJoin(users, eq(users.id, emailTemplates.updatedById)),
    db.query.sampleRequests.findMany({
      columns: { id: true, status: true },
      with: { contact: { columns: { name: true } } },
      orderBy: [desc(sampleRequests.id)],
      limit: 20,
    }),
  ]);

  const custom = new Map(saved.map((t) => [`${t.kind}:${t.language}`, t]));
  const row = custom.get(`${kind}:${language}`);
  const defaults = DEFAULT_TEMPLATES[kind][language] ?? DEFAULT_TEMPLATES[kind].it!;
  const initial = row ? { subject: row.subject, body: row.body } : defaults;

  const requests: PreviewRequestOption[] = recent.map((r) => ({
    id: r.id,
    label: `${requestCode(r.id)} — ${r.contact?.name ?? "?"} (${STATUS_LABELS[r.status]})`,
  }));
  const defaultRequest = recent.find((r) => PREVIEW_STATUSES[kind].includes(r.status)) ?? recent[0];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <nav aria-label="Template disponibili" className="space-y-4">
        {KINDS.map((k) => (
          <div key={k}>
            <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{EMAIL_KIND_LABELS[k]}</p>
            <ul className="mt-1.5 space-y-1">
              {TEMPLATE_LANGUAGES[k].map((lang) => {
                const active = k === kind && lang === language;
                return (
                  <li key={lang}>
                    <Link
                      href={`/impostazioni/template?tipo=${k}&lingua=${lang}`}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm",
                        active
                          ? "bg-brand-700 font-medium text-white"
                          : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <span>{LANGUAGE_LABELS[lang]}</span>
                      {custom.has(`${k}:${lang}`) ? (
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                            active ? "bg-white/20 text-white" : "bg-violet-50 text-violet-700",
                          )}
                        >
                          Personalizzato
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <Card className="min-w-0">
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {EMAIL_KIND_LABELS[kind]} — {LANGUAGE_LABELS[language]}
              {row ? <Badge tone="violet">Personalizzato</Badge> : <Badge tone="slate">Testo predefinito</Badge>}
            </span>
          }
          description={
            <>
              {EMAIL_KIND_DESCRIPTIONS[kind]}
              {row ? (
                <span className="mt-1 block text-xs text-slate-400">
                  Ultima modifica {formatDateTime(row.updatedAt)}
                  {row.updatedBy ? ` — ${row.updatedBy}` : ""}
                </span>
              ) : null}
            </>
          }
        />
        <CardBody>
          <TemplateEditor
            key={`${kind}-${language}`}
            kind={kind}
            language={language}
            initial={initial}
            defaults={defaults}
            isCustom={Boolean(row)}
            requests={requests}
            defaultRequestId={defaultRequest?.id ?? null}
            isShipmentConfirmation={kind === "CONFERMA_SPEDIZIONE"}
          />
        </CardBody>
      </Card>
    </div>
  );
}
