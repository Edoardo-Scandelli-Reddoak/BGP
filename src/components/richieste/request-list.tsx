import Link from "next/link";
import type { OpenListRow } from "@/app/(app)/richieste/list-query";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, requestCode } from "@/lib/format";
import { ageLabel, daysSince, shortAddress } from "./utils";

/** Oltre questa soglia una richiesta ancora «Nuova» viene evidenziata. */
const STALE_DAYS = 3;

function isStale(row: OpenListRow, days: number) {
  return row.status === "NUOVA" && days > STALE_DAYS;
}

function ProductsSummary({ row }: { row: OpenListRow }) {
  if (row.itemsCount === 0) return <span className="text-slate-400">Nessun prodotto</span>;
  const others = row.itemsCount - row.firstCodes.length;
  return (
    <span className="text-sm">
      <span className="font-medium text-slate-900">
        {row.itemsCount} prodott{row.itemsCount === 1 ? "o" : "i"}
      </span>
      <span className="block font-mono text-xs text-slate-500">
        {row.firstCodes.join(", ")}
        {others > 0 ? ` +${others}` : ""}
      </span>
    </span>
  );
}

function SourceBadges({ row }: { row: OpenListRow }) {
  if (row.source !== "MODULO_PUBBLICO" && !row.contactNeedsReview) {
    return <span className="text-xs text-slate-400">Interna</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {row.source === "MODULO_PUBBLICO" ? <Badge tone="violet">Modulo pubblico</Badge> : null}
      {row.contactNeedsReview ? <Badge tone="amber">Contatto da verificare</Badge> : null}
    </span>
  );
}

function BollaBadge({ row }: { row: OpenListRow }) {
  if (!row.deliveryFormRequired) return null;
  return <Badge tone={row.deliveryFormReady ? "green" : "amber"}>{row.deliveryFormReady ? "Bolla pronta" : "Bolla"}</Badge>;
}

function Received({ row, days }: { row: OpenListRow; days: number }) {
  const stale = isStale(row, days);
  return (
    <span className="whitespace-nowrap">
      <span className="block text-slate-900">{formatDate(row.receivedAt)}</span>
      <span className={cn("block text-xs", stale ? "font-semibold text-red-700" : "text-slate-500")}>
        {ageLabel(days)}
        {stale ? " · in attesa" : ""}
      </span>
    </span>
  );
}

/** Elenco richieste aperte: tabella su schermi larghi, schede su telefono. */
export function RequestList({ rows }: { rows: OpenListRow[] }) {
  const withAge = rows.map((row) => ({ row, days: daysSince(row.receivedAt) }));
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <THead>
            <tr>
              <TH>Codice</TH>
              <TH>Ricevuta</TH>
              <TH>Contatto</TH>
              <TH>Prodotti</TH>
              <TH>Destinazione</TH>
              <TH>Stato</TH>
              <TH>Bolla</TH>
              <TH>Origine</TH>
            </tr>
          </THead>
          <TBody>
            {withAge.map(({ row, days }) => (
              <TR key={row.id} className={cn(isStale(row, days) && "bg-red-50/40")}>
                <TD>
                  <Link
                    href={`/richieste/${row.id}`}
                    className="font-mono text-sm font-semibold text-brand-700 hover:text-brand-900 hover:underline"
                  >
                    {requestCode(row.id)}
                  </Link>
                </TD>
                <TD>
                  <Received row={row} days={days} />
                </TD>
                <TD className="max-w-56">
                  <span className="block font-medium text-slate-900">{row.contactName}</span>
                  {row.agentName ? <span className="block text-xs text-slate-500">Agente: {row.agentName}</span> : null}
                </TD>
                <TD>
                  <ProductsSummary row={row} />
                </TD>
                <TD className="max-w-60 text-sm text-slate-600">
                  <span title={row.destinationAddress}>{shortAddress(row.destinationAddress) || "—"}</span>
                </TD>
                <TD>
                  <StatusBadge status={row.status} />
                </TD>
                <TD>
                  <BollaBadge row={row} />
                </TD>
                <TD>
                  <SourceBadges row={row} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="divide-y divide-slate-100 md:hidden">
        {withAge.map(({ row, days }) => (
          <li key={row.id}>
            <Link
              href={`/richieste/${row.id}`}
              className={cn("block px-4 py-4 active:bg-slate-100", isStale(row, days) && "bg-red-50/40")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-brand-700">{requestCode(row.id)}</p>
                  <p className="mt-0.5 truncate font-medium text-slate-900">{row.contactName}</p>
                  {row.agentName ? <p className="truncate text-xs text-slate-500">Agente: {row.agentName}</p> : null}
                </div>
                <StatusBadge status={row.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                <span className={cn(isStale(row, days) && "font-semibold text-red-700")}>
                  {formatDate(row.receivedAt)} · {ageLabel(days)}
                </span>
                <span>
                  {row.itemsCount} prodott{row.itemsCount === 1 ? "o" : "i"}
                  {row.firstCodes.length ? ` · ${row.firstCodes.join(", ")}` : ""}
                </span>
              </div>
              {row.destinationAddress ? (
                <p className="mt-1 truncate text-xs text-slate-500">{shortAddress(row.destinationAddress)}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1 empty:hidden">
                <BollaBadge row={row} />
                {row.source === "MODULO_PUBBLICO" ? <Badge tone="violet">Modulo pubblico</Badge> : null}
                {row.contactNeedsReview ? <Badge tone="amber">Contatto da verificare</Badge> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
