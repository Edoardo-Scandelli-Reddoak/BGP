import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import type { RequestStatus } from "@/db/schema";
import { RequestList } from "@/components/richieste/request-list";
import { Alert } from "@/components/ui/alert";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { requireUser } from "@/lib/auth/session";
import { requestCode } from "@/lib/format";
import { can } from "@/lib/roles";
import { OPEN_STATUSES, STATUS_LABELS } from "@/lib/status";
import { parseDbId } from "@/lib/validation";
import { getOpenRequests, OPEN_LIST_PAGE_SIZE } from "./list-query";

export const metadata: Metadata = { title: "Richieste aperte" };

const BASE_PATH = "/richieste";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function listHref(params: { stato?: string | null; q?: string; origine?: string | null }) {
  const sp = new URLSearchParams();
  if (params.stato) sp.set("stato", params.stato);
  if (params.q) sp.set("q", params.q);
  if (params.origine) sp.set("origine", params.origine);
  const qs = sp.toString();
  return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
}

export default async function RichiestePage({ searchParams }: PageProps<"/richieste">) {
  const user = await requireUser("requests.manage");
  const sp = await searchParams;

  const statoParam = first(sp.stato);
  const status = (OPEN_STATUSES as string[]).includes(statoParam) ? (statoParam as RequestStatus) : null;
  const q = first(sp.q).trim().slice(0, 100);
  const publicOnly = first(sp.origine) === "MODULO_PUBBLICO";
  const origine = publicOnly ? "MODULO_PUBBLICO" : null;
  const page = parsePage(sp.pagina);
  const deletedId = parseDbId(first(sp.eliminata));

  const { rows, counts, totalOpen, total } = await getOpenRequests({ status, q, publicOnly, page });
  const filtered = Boolean(q || publicOnly || status);

  const tabs: { key: RequestStatus | null; label: string; count: number }[] = [
    { key: null, label: "Tutte aperte", count: totalOpen },
    ...OPEN_STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s], count: counts[s] })),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Back office"
        title="Richieste aperte"
        description="Tutte le richieste non ancora completate, dalla più vecchia. Le richieste «Nuova» ferme da più di 3 giorni sono evidenziate."
        actions={
          <>
            {can(user.role, "management.view") ? (
              <Link href="/direzione/storico" className="text-sm font-medium text-brand-700 hover:underline">
                Storico completo →
              </Link>
            ) : null}
            <LinkButton href="/richieste/nuova" variant="primary">
              + Nuova richiesta
            </LinkButton>
          </>
        }
      />

      {deletedId ? (
        <Alert tone="success" className="mb-4">
          Richiesta {requestCode(deletedId)} eliminata.
        </Alert>
      ) : null}

      <Card>
        <div className="border-b border-slate-100 px-3 pt-3 sm:px-5">
          <nav aria-label="Filtra per stato" className="-mb-px flex gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.key === status;
              return (
                <Link
                  key={tab.key ?? "all"}
                  href={listHref({ stato: tab.key, q, origine })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap",
                    active
                      ? "border-brand-700 text-brand-800"
                      : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900",
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      active ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {tab.count}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <Form action={BASE_PATH} className="flex w-full gap-2 sm:max-w-md" role="search">
            {status ? <input type="hidden" name="stato" value={status} /> : null}
            {origine ? <input type="hidden" name="origine" value={origine} /> : null}
            <label htmlFor="q" className="sr-only">
              Cerca
            </label>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Codice, contatto, destinatario o prodotto"
            />
            <button type="submit" className={buttonClasses("secondary", "md")}>
              Cerca
            </button>
          </Form>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={listHref({ stato: status, q, origine: publicOnly ? null : "MODULO_PUBBLICO" })}
              aria-pressed={publicOnly}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium ring-1 ring-inset",
                publicOnly
                  ? "bg-violet-50 text-violet-800 ring-violet-600/30"
                  : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
              )}
            >
              <span
                aria-hidden
                className={cn("size-2 rounded-full", publicOnly ? "bg-violet-600" : "bg-slate-300")}
              />
              Solo dal modulo pubblico
            </Link>
            {filtered ? (
              <Link href={BASE_PATH} className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
                Azzera filtri
              </Link>
            ) : null}
          </div>
        </div>

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title="Nessuna richiesta corrisponde ai filtri"
              description={q ? `Nessun risultato per «${q}» tra le richieste aperte.` : "Prova a cambiare stato o a togliere i filtri."}
              action={
                <LinkButton href={BASE_PATH} variant="secondary">
                  Mostra tutte le aperte
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              title="Nessuna richiesta aperta"
              description="Tutte le richieste sono state completate. Le nuove richieste dal modulo pubblico compariranno qui."
              action={
                <LinkButton href="/richieste/nuova" variant="primary">
                  + Nuova richiesta
                </LinkButton>
              }
            />
          )
        ) : (
          <>
            <RequestList rows={rows} />
            <Pagination
              page={page}
              pageSize={OPEN_LIST_PAGE_SIZE}
              total={total}
              basePath={BASE_PATH}
              params={{ stato: status ?? undefined, q: q || undefined, origine: origine ?? undefined }}
            />
          </>
        )}
      </Card>
    </>
  );
}
