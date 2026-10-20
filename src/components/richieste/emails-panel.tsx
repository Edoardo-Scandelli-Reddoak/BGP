import type { EmailLogEntry } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EMAIL_KIND_LABELS } from "@/lib/email/templates";
import { formatDateTime, LANGUAGE_LABELS } from "@/lib/format";

export function EmailStatusBadge({ status }: { status: EmailLogEntry["status"] }) {
  switch (status) {
    case "INVIATA":
      return <Badge tone="green">Inviata</Badge>;
    case "SIMULATA":
      return <Badge tone="slate">Prova · non inviata</Badge>;
    case "ERRORE":
      return <Badge tone="red">Errore</Badge>;
  }
}

/** Pannello «Email inviate»: avvisi automatici e conferme di spedizione legati alla richiesta. */
export function EmailsPanel({ emails }: { emails: EmailLogEntry[] }) {
  return (
    <Card>
      <CardHeader title="Email inviate" description="Avvisi automatici e conferme di spedizione di questa richiesta." />
      {emails.length === 0 ? (
        <EmptyState
          title="Nessuna email per ora"
          description="Le email partono in automatico: avviso al magazzino, avviso bolla alla logistica, conferma di spedizione al cliente."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {emails.map((e) => (
            <li key={e.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{EMAIL_KIND_LABELS[e.kind]}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(e.createdAt)} · {LANGUAGE_LABELS[e.language]}
                  </p>
                </div>
                <EmailStatusBadge status={e.status} />
              </div>
              <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[5.5rem_1fr]">
                <dt className="text-slate-500">A</dt>
                <dd className="min-w-0 break-words text-slate-900">{e.toAddresses}</dd>
                {e.ccAddresses ? (
                  <>
                    <dt className="text-slate-500">CC</dt>
                    <dd className="min-w-0 break-words text-slate-900">{e.ccAddresses}</dd>
                  </>
                ) : null}
                <dt className="text-slate-500">Oggetto</dt>
                <dd className="min-w-0 break-words text-slate-900">{e.subject}</dd>
                {e.attachmentNames ? (
                  <>
                    <dt className="text-slate-500">Allegati</dt>
                    <dd className="min-w-0 break-words text-slate-900">{e.attachmentNames}</dd>
                  </>
                ) : null}
              </dl>
              {e.status === "ERRORE" && e.error ? (
                <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">
                  {e.error}
                </p>
              ) : null}
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer font-medium text-brand-700 hover:underline">Mostra il testo</summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-slate-50 p-3 font-sans text-sm whitespace-pre-wrap text-slate-800 ring-1 ring-inset ring-slate-200">
                  {e.body}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
