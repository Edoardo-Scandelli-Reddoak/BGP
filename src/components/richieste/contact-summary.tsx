import Link from "next/link";
import type { ReactNode } from "react";
import type { Language } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { parseEmailList } from "@/lib/email/recipients";
import { LANGUAGE_LABELS } from "@/lib/format";

export type ContactSummaryData = {
  id: number;
  type: "AGENTE" | "CLIENTE";
  name: string;
  company?: string | null;
  email: string | null;
  phone?: string | null;
  country: string | null;
  language: Language;
  agentName: string | null;
  agentEmail: string | null;
  needsReview: boolean;
  active?: boolean;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">{children}</dd>
    </div>
  );
}

/** Scheda del contatto (cliente o agente) che riceve i campioni e la conferma di spedizione. */
export function ContactSummary({
  contact,
  href,
  className,
}: {
  contact: ContactSummaryData;
  /** Link alla scheda anagrafica (se l'utente può consultarla). */
  href?: string | null;
  className?: string;
}) {
  const emails = parseEmailList(contact.email);
  const agentEmails = parseEmailList(contact.agentEmail);
  return (
    <div className={cn("rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-200", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {href ? (
          <Link href={href} className="font-semibold text-brand-700 hover:text-brand-900 hover:underline">
            {contact.name}
          </Link>
        ) : (
          <span className="font-semibold text-slate-900">{contact.name}</span>
        )}
        <Badge tone={contact.type === "AGENTE" ? "blue" : "slate"}>{contact.type === "AGENTE" ? "Agente" : "Cliente"}</Badge>
        {contact.needsReview ? <Badge tone="amber">Da verificare</Badge> : null}
        {contact.active === false ? <Badge tone="red">Disattivato</Badge> : null}
      </div>
      {contact.company && contact.company !== contact.name ? (
        <p className="mt-0.5 text-sm text-slate-600">{contact.company}</p>
      ) : null}
      <dl className="mt-3 space-y-1.5">
        <Row label="Email">
          {emails.length ? (
            emails.join(", ")
          ) : (
            <span className="font-medium text-red-700">Nessuna email valida: la conferma di spedizione non potrà partire</span>
          )}
        </Row>
        {contact.phone ? <Row label="Telefono">{contact.phone}</Row> : null}
        <Row label="Lingua">{LANGUAGE_LABELS[contact.language]}</Row>
        <Row label="Paese">{contact.country || <span className="text-slate-400">—</span>}</Row>
        <Row label="Agente (CC)">
          {contact.agentName ? (
            <>
              {contact.agentName}
              {agentEmails.length ? (
                <span className="block text-xs text-slate-500">{agentEmails.join(", ")} · in copia nelle email</span>
              ) : (
                <span className="block text-xs text-amber-700">Agente senza email: nessuna copia</span>
              )}
            </>
          ) : (
            <span className="text-slate-400">{contact.type === "AGENTE" ? "—" : "Nessun agente (cliente diretto)"}</span>
          )}
        </Row>
      </dl>
    </div>
  );
}
