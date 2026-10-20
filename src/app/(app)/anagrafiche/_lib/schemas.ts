import { z } from "zod";
import { formatEmailList, invalidEmails, parseEmailList } from "@/lib/email/recipients";
import { parseDecimal } from "@/lib/format";

/** Testo opzionale: stringa vuota → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Massimo ${max} caratteri`)
    .transform((v) => (v ? v : null));

const idOrNull = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number({ error: "Valore non valido" }).int("Valore non valido").positive("Valore non valido").nullable(),
);

export const contactInput = z.object({
  id: idOrNull,
  type: z.enum(["CLIENTE", "AGENTE"], { error: "Scegli se è un cliente o un agente" }),
  name: z.string().trim().min(1, "Indica il nome o la ragione sociale").max(200, "Massimo 200 caratteri"),
  company: optionalText(200),
  email: z
    .string()
    .trim()
    .max(1000, "Troppi indirizzi")
    .superRefine((v, ctx) => {
      const bad = invalidEmails(v);
      if (bad.length) {
        ctx.addIssue({
          code: "custom",
          message: `${bad.length === 1 ? "Indirizzo non valido" : "Indirizzi non validi"}: ${bad.join(", ")}`,
        });
      }
    })
    .transform((v) => {
      const list = parseEmailList(v);
      return list.length ? formatEmailList(list) : null;
    }),
  phone: optionalText(60),
  country: optionalText(80),
  defaultAddress: optionalText(1000),
  language: z.enum(["it", "en", "fr", "de"], { error: "Seleziona la lingua delle email" }),
  agentId: idOrNull,
  notes: optionalText(5000),
  active: z.boolean(),
});
export type ContactInput = z.output<typeof contactInput>;

export const productInput = z.object({
  id: idOrNull,
  code: z
    .string()
    .trim()
    .min(1, "Indica il codice articolo")
    .max(60, "Massimo 60 caratteri"),
  description: z
    .string()
    .trim()
    .max(2000, "Massimo 2000 caratteri"),
  brand: optionalText(100),
  category: optionalText(100),
  format: optionalText(200),
  finish: optionalText(200),
  unitWeightKg: z.preprocess(
    (v) => parseDecimal(typeof v === "string" ? v : null),
    z
      .number({ error: "Peso non valido" })
      .refine((n) => !Number.isNaN(n), "Peso non valido")
      .refine((n) => n >= 0, "Il peso non può essere negativo")
      .refine((n) => n <= 99999, "Peso troppo alto")
      .nullable(),
  ),
  active: z.boolean(),
});
export type ProductInput = z.output<typeof productInput>;

/** Legge un campo testuale dal FormData (assente → ""). */
export function formText(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function contactFromForm(fd: FormData) {
  return {
    id: formText(fd, "id"),
    type: formText(fd, "type"),
    name: formText(fd, "name"),
    company: formText(fd, "company"),
    email: formText(fd, "email"),
    phone: formText(fd, "phone"),
    country: formText(fd, "country"),
    defaultAddress: formText(fd, "defaultAddress"),
    language: formText(fd, "language"),
    agentId: formText(fd, "type") === "CLIENTE" ? formText(fd, "agentId") : "",
    notes: formText(fd, "notes"),
    active: fd.get("active") === "on",
  };
}

export function productFromForm(fd: FormData) {
  return {
    id: formText(fd, "id"),
    code: formText(fd, "code"),
    description: formText(fd, "description"),
    brand: formText(fd, "brand"),
    category: formText(fd, "category"),
    format: formText(fd, "format"),
    finish: formText(fd, "finish"),
    unitWeightKg: formText(fd, "unitWeightKg"),
    active: fd.get("active") === "on",
  };
}
