import { cn } from "@/components/ui/cn";
import { isSampleFormat, SAMPLE_FORMAT_LABELS, sampleFormatMissing } from "@/lib/sample-formats";

const SIZES = {
  sm: "px-1.5 py-0.5 text-xs",
  lg: "px-2 py-1 text-sm",
} as const;

/**
 * Formato del campione da preparare («MEZZE DOGHE», «MAZZETTA», «ALTRO: …»): è ciò che il magazzino
 * prende a scaffale, quindi ben visibile. Elemento inline (va a capo nel testo se la nota è lunga).
 * Le richieste inserite prima che il formato fosse obbligatorio possono non averlo: avviso in ambra.
 */
export function SampleFormatLabel({
  format,
  note,
  size = "sm",
  className,
}: {
  format: string | null | undefined;
  note?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const base = cn("rounded-md font-semibold ring-1 ring-inset box-decoration-clone", SIZES[size], className);
  const detail = note?.trim();

  if (sampleFormatMissing(format, detail)) {
    const label = format === "ALTRO" ? "Altro: formato da descrivere" : "Formato da indicare";
    return <span className={cn(base, "bg-amber-50 text-amber-800 ring-amber-600/30")}>{label}</span>;
  }

  const label = isSampleFormat(format) ? SAMPLE_FORMAT_LABELS[format] : "";
  return (
    <span className={cn(base, "bg-brand-100 text-brand-900 ring-brand-600/30")}>
      <span className="uppercase tracking-wide">{label}</span>
      {detail ? (
        <span className="font-medium">{format === "ALTRO" ? `: ${detail}` : ` (${detail})`}</span>
      ) : null}
    </span>
  );
}
