import Link from "next/link";
import type { ReactNode } from "react";
import type { WarehouseCard } from "@/app/(app)/magazzino/queries";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { daysSince, formatDateTime, formatKg, formatM2, requestCode } from "@/lib/format";
import { sampleFormatText } from "@/lib/sample-formats";
import { destinationCity, waitingLabel } from "./format";
import { SampleFormatLabel } from "./sample-format-label";

function ageTone(days: number): BadgeTone {
  if (days >= 3) return "red";
  if (days === 2) return "amber";
  return "slate";
}

function Chip({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        done ? "bg-emerald-50 text-emerald-800 ring-emerald-600/20" : "bg-slate-50 text-slate-500 ring-slate-300",
      )}
    >
      <span aria-hidden>{done ? "✓" : "—"}</span>
      {children}
    </span>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-slate-400" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/** Riga sotto il destinatario: «alla c.a.» e il contatto che ha chiesto i campioni, se è un altro. */
function recipientDetails(card: WarehouseCard, recipient: string): string {
  const parts: string[] = [];
  if (card.attentionOf) parts.push(`c.a. ${card.attentionOf}`);
  if (!same(recipient, card.contactName) && !same(recipient, card.contactCompany)) {
    const company =
      card.contactCompany && !same(card.contactCompany, card.contactName) ? ` (${card.contactCompany})` : "";
    parts.push(`Contatto: ${card.contactName}${company}`);
  }
  return parts.join(" · ");
}

/** Scheda di una richiesta nella coda magazzino: tutta la scheda apre il dettaglio. */
export function QueueCard({ card }: { card: WarehouseCard }) {
  const ready = card.status === "PRONTA_RITIRO";
  const days = daysSince(card.receivedAt);
  const city = destinationCity(card.destinationAddress);
  const hasPackages = card.packagesCount !== null && card.packagesCount > 0;
  const hasWeight = card.weightKg !== null && card.weightKg > 0;
  const code = requestCode(card.id);
  const recipient = card.recipientName?.trim() || card.contactName;
  const details = recipientDetails(card, recipient);

  return (
    <Link
      href={`/richieste/${card.id}`}
      className="group block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-brand-700 group-hover:underline">{code}</p>
          <p className="mt-0.5 truncate text-base font-semibold text-slate-900">{recipient}</p>
          {details ? <p className="truncate text-sm text-slate-500">{details}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {ready ? (
            <Badge tone="violet">Pronta</Badge>
          ) : (
            <Badge tone={ageTone(days)}>{waitingLabel(days)}</Badge>
          )}
          {card.deliveryFormRequired ? <Badge tone="blue">Bolla richiesta</Badge> : null}
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Ricevuta {formatDateTime(card.receivedAt)}
        {ready && card.readyAt ? <> · pronta {formatDateTime(card.readyAt)}</> : null}
      </p>

      {city ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-700">
          <PinIcon />
          <span className="truncate">{city}</span>
        </p>
      ) : null}

      <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3" aria-label="Prodotti richiesti">
        {card.items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="w-9 shrink-0 text-right text-base font-bold tabular-nums text-slate-900">{item.quantity}×</span>
            {/* «2× MEZZE DOGHE» e sotto «CODICE — descrizione»: il formato prima di tutto, è ciò che si prepara.
                Formato e codice su righe separate: una nota di formato lunga si accorcia senza nascondere il codice. */}
            <span className="min-w-0 flex-1 leading-6">
              <span className="line-clamp-2" title={sampleFormatText(item.sampleFormat, item.formatNote) || undefined}>
                <SampleFormatLabel format={item.sampleFormat} note={item.formatNote} />
              </span>
              <span className="block truncate" title={item.description ? `${item.code} — ${item.description}` : undefined}>
                <span className="font-mono font-semibold text-slate-900">{item.code}</span>
                {item.description ? <span className="text-slate-500"> — {item.description}</span> : null}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {card.notes ? (
        <p className="mt-3 line-clamp-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-inset ring-amber-200">
          <span className="font-semibold">Note: </span>
          {card.notes}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Avanzamento preparazione">
        <Chip done={hasPackages}>
          {hasPackages ? `${card.packagesCount} ${card.packagesCount === 1 ? "collo" : "colli"}` : "Colli"}
        </Chip>
        <Chip done={hasWeight}>{hasWeight ? formatKg(card.weightKg) : "Peso"}</Chip>
        <Chip done={card.piecesCount > 0}>
          {card.piecesCount} {card.piecesCount === 1 ? "pezzo misurato" : "pezzi misurati"}
          {card.piecesCount > 0 ? ` · ${formatM2(card.totalM2)}` : ""}
        </Chip>
      </div>
    </Link>
  );
}
