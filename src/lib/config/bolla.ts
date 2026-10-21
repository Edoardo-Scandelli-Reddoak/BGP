import { z } from "zod";
import { isForeignCountry } from "@/lib/countries";
import { SAMPLE_FORMATS, type SampleFormat } from "@/lib/sample-formats";

/**
 * Gestione della bolla di consegna configurabile da BGP (Impostazioni → Bolla di consegna).
 * Modulo puro: regole e numerazione usate da servizio, pannelli e test.
 */

export type BollaMode = "GENERATA" | "GESTIONALE" | "ENTRAMBE";

export const BOLLA_MODE_LABELS: Record<BollaMode, string> = {
  GENERATA: "Generata dal sistema",
  GESTIONALE: "DDT dal gestionale BGP",
  ENTRAMBE: "Entrambe (a scelta della logistica)",
};

export const BOLLA_MODE_DESCRIPTIONS: Record<BollaMode, string> = {
  GENERATA:
    "La logistica genera la bolla in PDF con un numero progressivo proprio del sistema. Il caricamento del DDT è nascosto.",
  GESTIONALE:
    "La bolla è il DDT emesso dal gestionale di BGP: la logistica ne inserisce il numero e/o carica il PDF, che viene allegato alla conferma al cliente.",
  ENTRAMBE: "Sono disponibili sia la bolla generata sia il caricamento del DDT del gestionale.",
};

export type BollaRules = {
  /** Bolla sempre richiesta. */
  always: boolean;
  /** Bolla richiesta per le spedizioni fuori dall'Italia. */
  abroad: boolean;
  /** Bolla richiesta se la richiesta contiene uno di questi formati (es. espositori). */
  formats: SampleFormat[];
  /** Bolla richiesta da questo numero di colli in su (valutata quando il magazzino la segna pronta). */
  minPackages: number | null;
};

export type BollaConfig = {
  mode: BollaMode;
  /** Formato del numero della bolla generata: {numero} (con zeri iniziali) e {anno}. */
  numberFormat: string;
  numberPadding: number;
  rules: BollaRules;
};

export const DEFAULT_BOLLA_CONFIG: BollaConfig = {
  mode: "ENTRAMBE",
  numberFormat: "C{numero}/{anno}",
  numberPadding: 4,
  rules: { always: false, abroad: false, formats: [], minPackages: null },
};

export const bollaConfigSchema = z.object({
  mode: z.enum(["GENERATA", "GESTIONALE", "ENTRAMBE"]),
  numberFormat: z
    .string()
    .trim()
    .min(1, "Indica il formato del numero")
    .max(40, "Massimo 40 caratteri")
    .refine((v) => v.includes("{numero}"), "Il formato deve contenere {numero}"),
  numberPadding: z.coerce
    .number()
    .int("Numero di cifre non valido")
    .min(1, "Almeno 1 cifra")
    .max(8, "Al massimo 8 cifre"),
  rules: z.object({
    always: z.boolean(),
    abroad: z.boolean(),
    formats: z.array(z.enum(SAMPLE_FORMATS)).max(SAMPLE_FORMATS.length),
    minPackages: z.coerce
      .number()
      .int("Numero di colli non valido")
      .min(1, "Minimo 1 collo")
      .max(999, "Massimo 999 colli")
      .nullable(),
  }),
});

/** Numero della bolla generata, es. formato "C{numero}/{anno}" → "C0012/2026". */
export function formatBollaNumber(n: number, year: number, config: Pick<BollaConfig, "numberFormat" | "numberPadding">): string {
  return config.numberFormat
    .replaceAll("{numero}", String(n).padStart(config.numberPadding, "0"))
    .replaceAll("{anno}", String(year));
}

/**
 * Paese di destinazione fuori dall'Italia (paese non indicato, anche «-», = non si può dire).
 * L'Italia è riconosciuta in ogni forma («IT», «Italy», «ITALIA»…); un valore non riconosciuto conta come estero.
 */
export function isAbroad(country: string | null | undefined): boolean {
  return isForeignCountry(country);
}

export type BollaRuleInput = {
  destinationCountry: string | null;
  itemFormats: (string | null)[];
  packagesCount: number | null;
};

/** Motivi per cui le regole rendono obbligatoria la bolla (lista vuota = nessuna regola applicabile). */
export function bollaRuleReasons(input: BollaRuleInput, rules: BollaRules): string[] {
  const reasons: string[] = [];
  if (rules.always) reasons.push("bolla sempre richiesta");
  if (rules.abroad && isAbroad(input.destinationCountry)) reasons.push("spedizione all'estero");
  const matching = rules.formats.filter((f) => input.itemFormats.includes(f));
  if (matching.length) reasons.push("formato che richiede la bolla");
  if (rules.minPackages && input.packagesCount && input.packagesCount >= rules.minPackages) {
    reasons.push(`${input.packagesCount} colli (da ${rules.minPackages} in su)`);
  }
  return reasons;
}

/**
 * La bolla richiesta è pronta? Dipende dalla modalità:
 * - GENERATA: bolla generata dal sistema (numero assegnato) o segnata pronta;
 * - GESTIONALE: numero del DDT o file del DDT caricato;
 * - ENTRAMBE: una qualsiasi delle precedenti.
 */
export function bollaSatisfiedForMode(
  s: {
    deliveryFormRequired: boolean;
    deliveryFormReady: boolean;
    ddtNumber: string | null;
    hasDdtAttachment: boolean;
    bollaNumber: string | null;
  },
  mode: BollaMode,
): boolean {
  if (!s.deliveryFormRequired) return true;
  const generated = Boolean(s.bollaNumber?.trim());
  const fromErp = Boolean(s.ddtNumber?.trim()) || s.hasDdtAttachment;
  switch (mode) {
    case "GENERATA":
      return generated || s.deliveryFormReady;
    case "GESTIONALE":
      return fromErp;
    default:
      return generated || fromErp || s.deliveryFormReady;
  }
}
