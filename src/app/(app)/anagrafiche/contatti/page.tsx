import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { FilterSelect } from "@/components/anagrafiche/form-helpers";
import { FilterField, listHref } from "@/components/anagrafiche/list-ui";
import { CONTACT_TYPE_LABELS, PAGE_SIZE } from "@/components/anagrafiche/constants";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Language } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { parseEmailList } from "@/lib/email/recipients";
import { formatNumber, LANGUAGE_LABELS } from "@/lib/format";
import { can } from "@/lib/roles";
import {
  countContactsToReview,
  listAgents,
  listContacts,
  listCountries,
  param,
  parseContactFilters,
} from "../_lib/queries";

export const metadata: Metadata = { title: "Contatti" };

const BASE = "/anagrafiche/contatti";

export default async function ContactsPage({ searchParams }: PageProps<"/anagrafiche/contatti">) {
  const user = await requireUser("registry.view");
  const sp = await searchParams;
  const filters = parseContactFilters(sp);
  const page = parsePage(sp.pagina);
  const canEdit = can(user.role, "registry.edit");

  const [{ rows, total }, agents, countries, toReview] = await Promise.all([
    listContacts(filters, page),
    listAgents(),
    listCountries(),
    countContactsToReview(),
  ]);

  // parametri da conservare nella paginazione (valori normalizzati)
  const params: Record<string, string | undefined> = {
    q: filters.q || undefined,
    tipo: filters.type ?? undefined,
    agente: filters.agent ? String(filters.agent) : undefined,
    lingua: filters.language ?? undefined,
    paese: filters.country ?? undefined,
    verifica: filters.review ? "1" : undefined,
    attivi: filters.active === "1" ? undefined : filters.active,
  };
  const hasFilters = Object.values(params).some(Boolean);
  const countryOptions =
    filters.country && filters.country !== "-" && !countries.includes(filters.country)
      ? [filters.country, ...countries]
      : countries;

  return (
    <>
      <PageHeader
        eyebrow="Anagrafiche"
        title="Contatti"
        description="Clienti e agenti: destinatari dei campioni e delle conferme di spedizione."
        actions={
          canEdit ? (
            <>
              <LinkButton href="/anagrafiche/import">Importa da file</LinkButton>
              <LinkButton href={`${BASE}/nuovo`} variant="primary">
                Nuovo contatto
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="space-y-4">
        {param(sp, "eliminato") === "1" ? <Alert tone="success">Contatto eliminato.</Alert> : null}
        {toReview > 0 && !filters.review ? (
          <Alert tone="warning">
            {toReview === 1
              ? "1 contatto arrivato dal modulo pubblico è da verificare."
              : `${toReview} contatti arrivati dal modulo pubblico sono da verificare.`}{" "}
            <Link href={`${BASE}?verifica=1`} className="font-semibold underline underline-offset-2">
              Mostra
            </Link>
          </Alert>
        ) : null}

        <Card>
          <Form
            key={JSON.stringify(params)}
            action={BASE}
            className="space-y-3 border-b border-slate-100 px-4 py-4 sm:px-5"
            role="search"
            aria-label="Filtra contatti"
          >
            <div className="flex gap-2">
              <Label htmlFor="q" className="sr-only">
                Cerca
              </Label>
              <Input
                id="q"
                name="q"
                type="search"
                defaultValue={filters.q}
                placeholder="Cerca per nome, azienda, email, indirizzo o telefono…"
                className="flex-1"
              />
              <Button type="submit" variant="primary">
                Cerca
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <FilterField label="Tipo" id="f-tipo">
                <FilterSelect id="f-tipo" name="tipo" defaultValue={filters.type ?? ""}>
                  <option value="">Tutti</option>
                  <option value="CLIENTE">Clienti</option>
                  <option value="AGENTE">Agenti</option>
                </FilterSelect>
              </FilterField>
              <FilterField label="Agente" id="f-agente">
                <FilterSelect id="f-agente" name="agente" defaultValue={filters.agent ? String(filters.agent) : ""}>
                  <option value="">Tutti</option>
                  <option value="nessuno">Nessun agente (direzionali)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.active ? "" : " (disattivato)"}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>
              <FilterField label="Lingua" id="f-lingua">
                <FilterSelect id="f-lingua" name="lingua" defaultValue={filters.language ?? ""}>
                  <option value="">Tutte</option>
                  {(Object.keys(LANGUAGE_LABELS) as Language[]).map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>
              <FilterField label="Paese" id="f-paese">
                <FilterSelect id="f-paese" name="paese" defaultValue={filters.country ?? ""}>
                  <option value="">Tutti</option>
                  <option value="-">Non indicato</option>
                  {countryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>
              <FilterField label="Verifica" id="f-verifica">
                <FilterSelect id="f-verifica" name="verifica" defaultValue={filters.review ? "1" : ""}>
                  <option value="">Tutti</option>
                  <option value="1">Da verificare</option>
                </FilterSelect>
              </FilterField>
              <FilterField label="Stato" id="f-attivi">
                <FilterSelect id="f-attivi" name="attivi" defaultValue={filters.active}>
                  <option value="1">Solo attivi</option>
                  <option value="0">Solo disattivati</option>
                  <option value="tutti">Tutti</option>
                </FilterSelect>
              </FilterField>
            </div>
            {hasFilters ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">
                  {formatNumber(total, 0)} contatt{total === 1 ? "o" : "i"} trovat{total === 1 ? "o" : "i"}
                </span>
                <Link href={BASE} className="font-medium text-brand-700 hover:underline">
                  Azzera filtri
                </Link>
              </div>
            ) : null}
          </Form>

          {rows.length === 0 && total > 0 ? (
            <EmptyState
              title="Pagina non disponibile"
              description={`I risultati sono ${total}: questa pagina è oltre la fine dell'elenco.`}
              action={<LinkButton href={listHref(BASE, params)}>Vai alla prima pagina</LinkButton>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={hasFilters ? "Nessun contatto corrisponde ai filtri" : "Nessun contatto in anagrafica"}
              description={
                hasFilters
                  ? "Prova a modificare la ricerca o ad azzerare i filtri."
                  : "Importa l'elenco clienti da file oppure crea il primo contatto."
              }
              action={
                hasFilters ? (
                  <LinkButton href={BASE}>Azzera filtri</LinkButton>
                ) : canEdit ? (
                  <LinkButton href={`${BASE}/nuovo`} variant="primary">
                    Nuovo contatto
                  </LinkButton>
                ) : null
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Nome</TH>
                  <TH>Tipo</TH>
                  <TH>Email</TH>
                  <TH>Agente</TH>
                  <TH>Lingua</TH>
                  <TH>Paese</TH>
                  <TH className="text-right">Richieste</TH>
                  <TH>
                    <span className="sr-only">Segnalazioni</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((c) => {
                  const emails = parseEmailList(c.email);
                  return (
                    <TR key={c.id} className={c.active ? undefined : "bg-slate-50/70 text-slate-500"}>
                      <TD className="min-w-56">
                        <Link href={`${BASE}/${c.id}`} className="font-medium text-brand-800 hover:underline">
                          {c.name}
                        </Link>
                        {c.company ? <div className="text-xs text-slate-500">{c.company}</div> : null}
                      </TD>
                      <TD>
                        <Badge tone={c.type === "AGENTE" ? "violet" : "blue"}>{CONTACT_TYPE_LABELS[c.type]}</Badge>
                      </TD>
                      <TD className="max-w-64">
                        {emails.length ? (
                          <span className="flex items-center gap-1.5" title={emails.join("\n")}>
                            <span className="truncate">{emails[0]}</span>
                            {emails.length > 1 ? (
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 text-xs font-medium text-slate-600">
                                +{emails.length - 1}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {c.type === "AGENTE" ? (
                          c.clientsCount > 0 ? (
                            <Link href={`${BASE}?agente=${c.id}`} className="text-brand-700 hover:underline">
                              {c.clientsCount} client{c.clientsCount === 1 ? "e" : "i"}
                            </Link>
                          ) : (
                            <span className="text-slate-400">Nessun cliente</span>
                          )
                        ) : c.agentId && c.agentName ? (
                          <Link href={`${BASE}/${c.agentId}`} className="hover:underline">
                            {c.agentName}
                          </Link>
                        ) : (
                          <span className="text-slate-400">Direzionale</span>
                        )}
                      </TD>
                      <TD>
                        <abbr title={LANGUAGE_LABELS[c.language]} className="font-medium uppercase no-underline">
                          {c.language}
                        </abbr>
                      </TD>
                      <TD className="whitespace-nowrap">{c.country || <span className="text-slate-400">—</span>}</TD>
                      <TD className="text-right tabular-nums">{c.requestsCount || <span className="text-slate-400">0</span>}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {c.needsReview ? <Badge tone="amber">Da verificare</Badge> : null}
                          {c.active ? null : <Badge tone="slate">Disattivato</Badge>}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
          {rows.length > 0 ? (
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath={BASE} params={params} />
          ) : null}
        </Card>
      </div>
    </>
  );
}
