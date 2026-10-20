import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/anagrafiche/contact-form";
import { COUNTRY_SUGGESTIONS, CONTACT_TYPE_LABELS, mergeSuggestions } from "@/components/anagrafiche/constants";
import { RecordActionForm } from "@/components/anagrafiche/form-helpers";
import { StatTile } from "@/components/anagrafiche/list-ui";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getAuthorizedUser, requireUser } from "@/lib/auth/session";
import { parseEmailList } from "@/lib/email/recipients";
import { formatDate, formatDateTime, formatM2, formatNumber, LANGUAGE_LABELS, requestCode } from "@/lib/format";
import { can } from "@/lib/roles";
import { deleteContact, markContactVerified } from "../../actions";
import { getContactDetail, listAgents, listCountries, param, type ContactDetail } from "../../_lib/queries";

function parseIdParam(value: string): number | null {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}

export async function generateMetadata({ params }: PageProps<"/anagrafiche/contatti/[id]">): Promise<Metadata> {
  const id = parseIdParam((await params).id);
  const user = await getAuthorizedUser("registry.view");
  const data = id && user ? await getContactDetail(id) : null;
  return { title: data ? data.contact.name : "Contatto" };
}

export default async function ContactDetailPage({ params, searchParams }: PageProps<"/anagrafiche/contatti/[id]">) {
  const user = await requireUser("registry.view");
  const id = parseIdParam((await params).id);
  if (!id) notFound();
  const data = await getContactDetail(id);
  if (!data) notFound();
  const sp = await searchParams;

  const { contact, stats, clients, requests } = data;
  const canEdit = can(user.role, "registry.edit");
  const canCreateRequest = can(user.role, "requests.manage");
  const [agents, countries] = canEdit ? await Promise.all([listAgents(), listCountries()]) : [[], []];
  const isAgent = contact.type === "AGENTE";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/anagrafiche/contatti" className="hover:underline">
            ← Contatti
          </Link>
        }
        title={contact.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={isAgent ? "violet" : "blue"}>{CONTACT_TYPE_LABELS[contact.type]}</Badge>
            {contact.needsReview ? <Badge tone="amber">Da verificare</Badge> : null}
            {contact.active ? null : <Badge tone="slate">Disattivato</Badge>}
            {contact.company ? <span className="text-slate-600">{contact.company}</span> : null}
          </span>
        }
        actions={
          canCreateRequest && contact.active ? (
            <LinkButton href={`/richieste/nuova?contatto=${contact.id}`} variant="primary">
              Nuova richiesta
            </LinkButton>
          ) : null
        }
      />

      <div className="space-y-6">
        {param(sp, "creato") === "1" ? <Alert tone="success">Contatto creato.</Alert> : null}
        {contact.needsReview ? (
          <Alert tone="warning" title="Contatto da verificare">
            <p>
              Creato dal modulo pubblico di richiesta campioni. Controlla nome, email, indirizzo e lingua
              {canEdit ? ", poi segnalo come verificato." : "."}
            </p>
            {canEdit ? (
              <RecordActionForm
                action={markContactVerified}
                id={contact.id}
                label="Segna come verificato"
                pendingText="Salvataggio…"
                size="sm"
                className="mt-3"
              />
            ) : null}
          </Alert>
        ) : null}
        {!contact.active ? (
          <Alert tone="info">
            Contatto disattivato: non compare nella ricerca delle nuove richieste. Lo storico resta consultabile.
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Dati del contatto"
              description={canEdit ? "I campi con * sono obbligatori." : "Sola lettura."}
            />
            <CardBody>
              {canEdit ? (
                <ContactForm
                  version={contact.updatedAt.toISOString()}
                  initial={{
                    id: contact.id,
                    type: contact.type,
                    name: contact.name,
                    company: contact.company ?? "",
                    email: contact.email ?? "",
                    phone: contact.phone ?? "",
                    country: contact.country ?? "",
                    defaultAddress: contact.defaultAddress ?? "",
                    language: contact.language,
                    agentId: contact.agentId,
                    notes: contact.notes ?? "",
                    active: contact.active,
                  }}
                  agents={agents}
                  countries={mergeSuggestions(COUNTRY_SUGGESTIONS, countries)}
                  cancelHref="/anagrafiche/contatti"
                />
              ) : (
                <ContactReadOnly data={data} />
              )}
            </CardBody>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Attività" />
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-3">
                  <StatTile label="Richieste" value={formatNumber(stats.requests, 0)} />
                  <StatTile label="Spedizioni" value={formatNumber(stats.shipped, 0)} />
                  <StatTile label="In corso" value={formatNumber(stats.open, 0)} />
                  <StatTile label="m² inviati" value={formatM2(stats.m2Shipped)} />
                </dl>
                {isAgent ? (
                  <div className="rounded-lg bg-violet-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-violet-200">
                    <p className="font-medium text-violet-900">
                      {clients.total === 0
                        ? "Nessun cliente assegnato"
                        : `${clients.total} client${clients.total === 1 ? "e" : "i"} assegnat${clients.total === 1 ? "o" : "i"}`}
                    </p>
                    {clients.total > 0 ? (
                      <>
                        {clients.active !== clients.total ? (
                          <p className="text-xs text-violet-800">{clients.active} attivi</p>
                        ) : null}
                        <Link
                          href={`/anagrafiche/contatti?agente=${contact.id}&attivi=tutti`}
                          className="mt-1 inline-block font-medium text-violet-800 underline underline-offset-2"
                        >
                          Vedi i clienti
                        </Link>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    Agente di riferimento:{" "}
                    {contact.agent ? (
                      <Link href={`/anagrafiche/contatti/${contact.agent.id}`} className="font-medium text-brand-700 hover:underline">
                        {contact.agent.name}
                      </Link>
                    ) : (
                      <span className="font-medium">nessuno (cliente direzionale)</span>
                    )}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  Creato il {formatDateTime(contact.createdAt)} · aggiornato il {formatDateTime(contact.updatedAt)}
                </p>
              </CardBody>
            </Card>

            {canEdit ? <DeleteContactCard data={data} /> : null}
          </div>
        </div>

        <Card>
          <CardHeader
            title="Richieste"
            description={
              stats.requests === 0
                ? "Nessuna richiesta registrata."
                : `${stats.requests} richiest${stats.requests === 1 ? "a" : "e"} · ${stats.shipped} spedizion${stats.shipped === 1 ? "e" : "i"}`
            }
          />
          {requests.length === 0 ? (
            <EmptyState
              title="Nessuna richiesta per questo contatto"
              action={
                canCreateRequest && contact.active ? (
                  <LinkButton href={`/richieste/nuova?contatto=${contact.id}`} variant="primary">
                    Nuova richiesta
                  </LinkButton>
                ) : null
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Codice</TH>
                    <TH>Ricevuta il</TH>
                    <TH>Stato</TH>
                    <TH className="text-right">Prodotti</TH>
                    <TH>Spedita il</TH>
                    <TH className="text-right">m²</TH>
                  </tr>
                </THead>
                <TBody>
                  {requests.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link href={`/richieste/${r.id}`} className="font-mono font-medium text-brand-800 hover:underline">
                          {requestCode(r.id)}
                        </Link>
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(r.receivedAt)}</TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD className="text-right tabular-nums">{r.itemsCount}</TD>
                      <TD className="whitespace-nowrap">{formatDate(r.shipmentDate) || <span className="text-slate-400">—</span>}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">
                        {r.m2 > 0 ? formatM2(r.m2) : <span className="text-slate-400">—</span>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {stats.requests > requests.length ? (
                <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                  Mostrate le {requests.length} richieste più recenti su {stats.requests}.
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

function ContactReadOnly({ data }: { data: ContactDetail }) {
  const c = data.contact;
  const emails = parseEmailList(c.email);
  return (
    <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <DetailItem label="Tipo">{CONTACT_TYPE_LABELS[c.type]}</DetailItem>
      <DetailItem label="Azienda / studio">{c.company}</DetailItem>
      <DetailItem label="Email" className="sm:col-span-2">
        {emails.length ? (
          <ul className="space-y-0.5">
            {emails.map((e) => (
              <li key={e}>
                <a href={`mailto:${e}`} className="text-brand-700 hover:underline">
                  {e}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </DetailItem>
      <DetailItem label="Telefono">{c.phone}</DetailItem>
      <DetailItem label="Paese">{c.country}</DetailItem>
      <DetailItem label="Lingua delle email">{LANGUAGE_LABELS[c.language]}</DetailItem>
      {c.type === "CLIENTE" ? (
        <DetailItem label="Agente di riferimento">
          {c.agent ? (
            <Link href={`/anagrafiche/contatti/${c.agent.id}`} className="text-brand-700 hover:underline">
              {c.agent.name}
            </Link>
          ) : (
            "Nessuno (cliente direzionale)"
          )}
        </DetailItem>
      ) : null}
      <DetailItem label="Indirizzo predefinito" className="sm:col-span-2">
        {c.defaultAddress ? <span className="whitespace-pre-line">{c.defaultAddress}</span> : null}
      </DetailItem>
      <DetailItem label="Note" className="sm:col-span-2">
        {c.notes ? <span className="whitespace-pre-line">{c.notes}</span> : null}
      </DetailItem>
    </dl>
  );
}

function DeleteContactCard({ data }: { data: ContactDetail }) {
  const { contact, stats, clients } = data;
  const reasons: string[] = [];
  if (stats.requests > 0) reasons.push(`ha ${stats.requests} richiest${stats.requests === 1 ? "a" : "e"} collegat${stats.requests === 1 ? "a" : "e"}`);
  if (clients.total > 0) reasons.push(`è l'agente di ${clients.total} client${clients.total === 1 ? "e" : "i"}`);
  return (
    <Card>
      <CardHeader title="Elimina contatto" />
      <CardBody className="space-y-3 text-sm text-slate-600">
        {reasons.length ? (
          <p>
            Non eliminabile: {reasons.join(" e ")}. Per nasconderlo dai moduli togli la spunta «Contatto attivo» e
            salva.
          </p>
        ) : (
          <>
            <p>Il contatto non ha richieste né clienti collegati e può essere eliminato definitivamente.</p>
            <RecordActionForm
              action={deleteContact}
              id={contact.id}
              label="Elimina contatto"
              pendingText="Eliminazione…"
              variant="danger"
              confirmMessage={`Eliminare definitivamente «${contact.name}»? L'operazione non si può annullare.`}
            />
          </>
        )}
      </CardBody>
    </Card>
  );
}
