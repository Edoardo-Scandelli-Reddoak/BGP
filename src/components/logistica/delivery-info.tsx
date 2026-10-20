import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { looksLikeCompany, sampleFormatText } from "@/lib/sample-formats";
import { oneLine } from "./utils";

/**
 * Dati di consegna nelle viste della logistica: destinatario, «alla c.a.», indirizzo, preavviso
 * telefonico (il corriere deve chiamare prima di consegnare) e formato dei campioni.
 */

export type DeliveryFields = {
  recipientName: string | null;
  attentionOf: string | null;
  destinationAddress: string | null;
  phoneNotice: boolean | null;
  phoneNoticeNumber: string | null;
};

/** Destinatario della spedizione; per le richieste senza, il nome del contatto. */
export function recipientOf(r: Pick<DeliveryFields, "recipientName">, contactName: string): string {
  return r.recipientName?.trim() || contactName;
}

/** Ditta senza «alla c.a.»: lo segnaliamo senza bloccare (non sempre si sa se è una ditta). */
export function attentionMissing(r: Pick<DeliveryFields, "recipientName" | "attentionOf">): boolean {
  return looksLikeCompany(r.recipientName) && !r.attentionOf?.trim();
}

/** Link "tel:" con le sole cifre (e il +) del numero. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, "")}`;
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5 shrink-0" aria-hidden>
      <path
        fillRule="evenodd"
        d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.513 2.31a1.5 1.5 0 01-1.02 1.745l-.97.323a.75.75 0 00-.45.98 11.04 11.04 0 006.28 6.28.75.75 0 00.98-.45l.323-.97a1.5 1.5 0 011.745-1.02l2.31.513A1.5 1.5 0 0118 14.352V15.5a1.5 1.5 0 01-1.5 1.5H15C7.82 17 2 11.18 2 4V3.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Badge ben visibile del preavviso telefonico. Testo semplice (può stare dentro un link di riga);
 * con `showUnknown` segnala anche le richieste in cui non è stato indicato.
 */
export function PhoneNoticeBadge({
  phoneNotice,
  number,
  showUnknown = false,
  className,
}: {
  phoneNotice: boolean | null;
  number: string | null;
  showUnknown?: boolean;
  className?: string;
}) {
  if (phoneNotice === true) {
    // Su schermi stretti un numero lungo (o più numeri) va a capo invece di uscire dalla scheda.
    return (
      <span
        className={cn(
          "inline-flex max-w-full min-w-0 items-start gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-500/60 ring-inset",
          className,
        )}
      >
        <span className="mt-px flex shrink-0">
          <PhoneIcon />
        </span>
        <span className="min-w-0 wrap-anywhere">
          <span className="whitespace-nowrap">Preavviso tel.</span> {number?.trim() || "(numero mancante)"}
        </span>
      </span>
    );
  }
  if (phoneNotice === null && showUnknown) {
    return (
      <Badge tone="slate" className={className}>
        Preavviso da indicare
      </Badge>
    );
  }
  return null;
}

/** Valore del preavviso per le schede di dettaglio: «Sì» + numero chiamabile, «No», «Da indicare». */
export function PhoneNoticeValue({ phoneNotice, number }: { phoneNotice: boolean | null; number: string | null }) {
  if (phoneNotice === null) return <span className="font-medium text-amber-700">Da indicare</span>;
  if (!phoneNotice) return <span>No</span>;
  const n = number?.trim();
  return (
    <span className="font-semibold text-amber-900">
      Sì, tassativo prima della consegna
      {n ? (
        <>
          {" — tel. "}
          <a href={telHref(n)} className="wrap-anywhere text-brand-700 hover:underline">
            {n}
          </a>
        </>
      ) : (
        <span className="text-red-700"> — numero mancante</span>
      )}
    </span>
  );
}

/**
 * Destinatario compatto per le tabelle: nome, «alla c.a.», indirizzo su una riga e, se diverso,
 * il contatto che ha chiesto i campioni.
 */
export function RecipientSummary({
  r,
  contactName,
  showContact = true,
}: {
  r: Omit<DeliveryFields, "phoneNotice" | "phoneNoticeNumber">;
  contactName: string;
  showContact?: boolean;
}) {
  const recipient = recipientOf(r, contactName);
  const address = oneLine(r.destinationAddress);
  const differentContact = recipient.trim().toLowerCase() !== contactName.trim().toLowerCase();
  return (
    <>
      <p className="font-medium text-slate-900">{recipient}</p>
      {r.attentionOf?.trim() ? <p className="text-xs text-slate-700">Alla c.a. {r.attentionOf.trim()}</p> : null}
      <p className="line-clamp-2 text-xs text-slate-600" title={address || undefined}>
        {address || "Indirizzo non indicato"}
      </p>
      {showContact && differentContact ? <p className="text-xs text-slate-500">Contatto: {contactName}</p> : null}
    </>
  );
}

/** Formato del campione di una riga ("Mezze doghe", "Altro: …"), "" se manca. */
export function itemFormat(item: { sampleFormat: string | null; formatNote: string | null }): string {
  return sampleFormatText(item.sampleFormat, item.formatNote);
}

/** Formato della riga o avviso «da indicare» (richieste inserite prima del campo). */
export function ItemFormat({ item, className }: { item: { sampleFormat: string | null; formatNote: string | null }; className?: string }) {
  const format = itemFormat(item);
  return format ? (
    <span className={className}>{format}</span>
  ) : (
    <span className={cn("text-amber-700", className)}>Formato da indicare</span>
  );
}
