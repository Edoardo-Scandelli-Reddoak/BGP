import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import type { BollaMode } from "@/lib/config/bolla";

/**
 * Stato e riferimenti della bolla di consegna nelle viste della logistica, coerenti con la modalità
 * configurata (Impostazioni → Bolla di consegna): bolla generata dal sistema, DDT del gestionale o entrambe.
 */

/** «Bolla pronta» / «Bolla da preparare» (con `showNotRequired` anche «Bolla non richiesta»). */
export function BollaStatusBadge({
  required,
  ready,
  showNotRequired = false,
  className,
}: {
  required: boolean;
  ready: boolean;
  showNotRequired?: boolean;
  className?: string;
}) {
  if (!required) {
    return showNotRequired ? (
      <Badge tone="slate" className={className}>
        Bolla non richiesta
      </Badge>
    ) : null;
  }
  return ready ? (
    <Badge tone="green" className={className}>
      Bolla pronta
    </Badge>
  ) : (
    <Badge tone="amber" className={className}>
      Bolla da preparare
    </Badge>
  );
}

/**
 * Numeri della bolla: «Bolla N° …» se generata dal sistema, «DDT n. …» del gestionale (non con la
 * sola bolla generata, dove il numero DDT non si usa). Nulla se non ci sono numeri.
 */
export function BollaRefs({
  bollaNumber,
  ddtNumber,
  mode,
  className,
}: {
  bollaNumber: string | null;
  ddtNumber: string | null;
  mode: BollaMode;
  className?: string;
}) {
  const bolla = bollaNumber?.trim();
  const ddt = mode === "GENERATA" ? null : ddtNumber?.trim();
  if (!bolla && !ddt) return null;
  return (
    <span className={cn("flex flex-col text-xs text-slate-600", className)}>
      {bolla ? <span className="font-medium break-all text-slate-800">Bolla N° {bolla}</span> : null}
      {ddt ? <span className="break-all">DDT n. {ddt}</span> : null}
    </span>
  );
}

/** Motivo per cui le regole della bolla l'hanno resa obbligatoria (es. «spedizione all'estero»). */
export function BollaAutoReason({ reason, className }: { reason: string | null | undefined; className?: string }) {
  const text = reason?.trim();
  if (!text) return null;
  // span a blocco: può stare anche dentro un paragrafo (es. descrizione di CardHeader).
  return (
    <span className={cn("block text-sm text-amber-900", className)}>
      <span className="font-medium">Bolla richiesta automaticamente:</span> {text}
    </span>
  );
}

/** Cosa fare per una bolla richiesta e non ancora pronta, secondo la modalità. */
export function bollaInstructions(mode: BollaMode, automatic: boolean): string {
  const todo =
    mode === "GENERATA"
      ? "generala con «Genera bolla» (riceve il numero progressivo e risulta pronta), poi scaricala in PDF."
      : mode === "GESTIONALE"
        ? "inserisci il numero del DDT emesso dal gestionale nei dati di spedizione oppure caricane il file qui sotto."
        : "generala con «Genera bolla», oppure inserisci il numero o carica il file del DDT del gestionale, oppure spunta «Bolla pronta».";
  return automatic
    ? todo.charAt(0).toUpperCase() + todo.slice(1)
    : `Il back office ha chiesto la bolla di consegna: ${todo}`;
}
