import type { Metadata } from "next";
import { QueueCard } from "@/components/magazzino/queue-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { countReady, getRecentlyReady, getWarehouseQueue } from "./queries";

export const metadata: Metadata = { title: "Coda magazzino" };

const READY_LIMIT = 20;

export default async function WarehouseQueuePage() {
  await requireUser("warehouse.work");
  const [queue, ready, readyTotal] = await Promise.all([
    getWarehouseQueue(),
    getRecentlyReady(READY_LIMIT),
    countReady(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Magazzino"
        title="Coda magazzino"
        description="Campionari da preparare, dal più vecchio. Apri una richiesta per registrare misure dei pezzi, colli e peso."
        actions={
          queue.length > 0 ? (
            <Badge tone="amber">{queue.length} da preparare</Badge>
          ) : null
        }
      />

      <section aria-label="Da preparare">
        {queue.length === 0 ? (
          <Card>
            <EmptyState
              title="Nessun campionario da preparare"
              description="Le nuove richieste inviate dal back office compariranno qui."
            />
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {queue.map((card) => (
              <li key={card.id}>
                <QueueCard card={card} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="group mt-10 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-5 py-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-base font-semibold text-slate-900">
              Pronte per il ritiro{" "}
              <span className="font-normal text-slate-500">({readyTotal})</span>
            </span>
            <span className="block text-sm text-slate-500">
              Già preparate, in attesa della logistica: aprile solo per correggere colli, peso o misure.
            </span>
          </span>
          <svg
            viewBox="0 0 20 20"
            className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </summary>
        <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
          {ready.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Nessuna richiesta pronta per il ritiro.</p>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {ready.map((card) => (
                  <li key={card.id}>
                    <QueueCard card={card} />
                  </li>
                ))}
              </ul>
              {readyTotal > ready.length ? (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Mostrate le {ready.length} più recenti su {readyTotal}.
                </p>
              ) : null}
            </>
          )}
        </div>
      </details>
    </>
  );
}
