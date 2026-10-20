import Link from "next/link";
import type { OpenListRow } from "@/app/(app)/richieste/list-query";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { BollaMode } from "@/lib/config/bolla";
import { daysSince, formatDate, requestCode } from "@/lib/format";
import { bollaSatisfied } from "@/lib/requests/workflow";
import { ageLabel, shortAddress } from "./utils";

/** Oltre questa soglia una richiesta ancora «Nuova» viene evidenziata. */
const STALE_DAYS = 3;

function isStale(row: OpenListRow, days: number) {
  return row.status === "NUOVA" && days > STALE_DAYS;
}

function productsLabel(n: number): string {
  return `${n} prodott${n === 1 ? "o" : "i"}`;
}

/** Prodotti distinti (lo stesso prodotto in più formati conta una volta) e primi codici. */
function ProductsSummary({ row }: { row: OpenListRow }) {
  if (row.productsCount === 0) return <span className="text-slate-400">Nessun prodotto</span>;
  const others = row.productsCount - row.firstCodes.length;
  return (
    <span className="text-sm">
      <span className="font-medium text-slate-900">{productsLabel(row.productsCount)}</span>
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

/**
 * Preavviso telefonico richiesto. In tabella il numero compare passando sopra il badge; sulle schede
 * (telefono, dove il passaggio del mouse non c'è) è scritto nel badge.
 */
function PhoneNoticeBadge({ row, showNumber = false }: { row: OpenListRow; showNumber?: boolean }) {
  if (!row.phoneNotice) return null;
  const number = row.phoneNoticeNumber?.trim();
  if (showNumber) {
    return (
      <Badge tone="blue">
        Preavviso tel.{number ? <span className="ml-1 tabular-nums">{number}</span> : null}
      </Badge>
    );
  }
  return (
    <span title={number ? `Preavviso telefonico: ${number}` : "Preavviso telefonico prima della consegna"}>
      <Badge tone="blue">Preavviso tel.</Badge>
    </span>
  );
}

/** Destinatario + indirizzo breve (l'indirizzo non contiene più la riga del destinatario). */
function Destination({ row }: { row: OpenListRow }) {
  const recipient = row.recipientName?.trim();
  const address = shortAddress(row.destinationAddress);
  if (!recipient && !address) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      {recipient ? <span className="font-medium text-slate-900">{recipient}</span> : null}
      {address ? (
        <span className="text-xs text-slate-500" title={shortAddress(row.destinationAddress, 500)}>
          {address}
        </span>
      ) : null}
      <PhoneNoticeBadge row={row} />
    </span>
  );
}

/** Stessa regola della logistica, secondo la modalità della bolla (generata, DDT del gestionale o entrambe). */
function BollaBadge({ row, mode }: { row: OpenListRow; mode: BollaMode }) {
  if (!row.deliveryFormRequired) return null;
  const ready = bollaSatisfied({ ...row, hasDdtAttachment: row.hasDdt, bollaMode: mode });
  return <Badge tone={ready ? "green" : "amber"}>{ready ? "Bolla pronta" : "Bolla da preparare"}</Badge>;
}

function Received({ row, days }: { row: OpenListRow; days: number }) {
  const stale = isStale(row, days);
  return (
    <span>
      <span className="block whitespace-nowrap text-slate-900">{formatDate(row.receivedAt)}</span>
      <span className={cn("block text-xs", stale ? "font-semibold text-red-700" : "text-slate-500")}>
        {ageLabel(days)}
        {stale ? " · in attesa" : ""}
      </span>
    </span>
  );
}

/**
 * Elenco richieste aperte: tabella su schermi larghi, schede su telefono.
 * La bolla sta sotto lo stato (una colonna in meno): con la barra laterale la tabella entra in 960px.
 */
export function RequestList({ rows, bollaMode }: { rows: OpenListRow[]; bollaMode: BollaMode }) {
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
              <TH>Origine</TH>
            </tr>
          </THead>
          <TBody>
            {withAge.map(({ row, days }) => (
              <TR key={row.id} className={cn(isStale(row, days) && "bg-red-50/40")}>
                <TD className="whitespace-nowrap">
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
                <TD className="max-w-60 text-sm">
                  <Destination row={row} />
                </TD>
                <TD>
                  <span className="flex flex-col items-start gap-1">
                    <StatusBadge status={row.status} />
                    <BollaBadge row={row} mode={bollaMode} />
                  </span>
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
                  {productsLabel(row.productsCount)}
                  {row.firstCodes.length ? ` · ${row.firstCodes.join(", ")}` : ""}
                  {row.productsCount > row.firstCodes.length ? ` +${row.productsCount - row.firstCodes.length}` : ""}
                </span>
              </div>
              {row.recipientName?.trim() || row.destinationAddress ? (
                <p className="mt-1 truncate text-xs text-slate-500">
                  {[row.recipientName?.trim(), shortAddress(row.destinationAddress)].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1 empty:hidden">
                <BollaBadge row={row} mode={bollaMode} />
                <PhoneNoticeBadge row={row} showNumber />
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
