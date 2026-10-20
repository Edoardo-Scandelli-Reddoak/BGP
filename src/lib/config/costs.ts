import { z } from "zod";

/**
 * Modello dei «costi per cliente» configurabile da BGP (Impostazioni → Costi).
 * Ogni richiesta spedita ha un costo = somma delle voci attive. Modulo puro (usato da form,
 * pannelli, report e test); il calcolo aggregato in SQL è in src/lib/reports.
 */

export type CostConfig = {
  /** Costo del corriere inserito dalla logistica (campo «Costo spedizione»). */
  courier: { enabled: boolean; label: string };
  /** Importo fisso per ogni richiesta spedita (gestione, tempo del personale…). */
  perRequest: { enabled: boolean; label: string; amount: number };
  /** Importo per collo (imballo). */
  perPackage: { enabled: boolean; label: string; amount: number };
  /** Importo per kg spedito. */
  perKg: { enabled: boolean; label: string; amount: number };
  /** Valore dei campioni: m² spediti × prezzo al m² (del prodotto se indicato, altrimenti questo). */
  perM2: { enabled: boolean; label: string; amount: number; useProductPrice: boolean };
  /** Voci inserite a mano dalla logistica su ogni richiesta (es. «Imballo speciale»). */
  manual: ManualCostItem[];
};

export type ManualCostItem = { key: string; label: string; enabled: boolean };

export const DEFAULT_COST_CONFIG: CostConfig = {
  courier: { enabled: true, label: "Corriere" },
  perRequest: { enabled: false, label: "Gestione richiesta", amount: 0 },
  perPackage: { enabled: false, label: "Imballo (per collo)", amount: 0 },
  perKg: { enabled: false, label: "Peso (per kg)", amount: 0 },
  perM2: { enabled: false, label: "Valore campioni (al m²)", amount: 0, useProductPrice: true },
  manual: [],
};

const money = z.coerce.number().min(0, "Importo non valido").max(100_000, "Importo troppo alto");
const label = z.string().trim().min(1, "Indica il nome della voce").max(60, "Massimo 60 caratteri");

export const costConfigSchema = z.object({
  courier: z.object({ enabled: z.boolean(), label }),
  perRequest: z.object({ enabled: z.boolean(), label, amount: money }),
  perPackage: z.object({ enabled: z.boolean(), label, amount: money }),
  perKg: z.object({ enabled: z.boolean(), label, amount: money }),
  perM2: z.object({ enabled: z.boolean(), label, amount: money, useProductPrice: z.boolean() }),
  manual: z
    .array(
      z.object({
        key: z.string().regex(/^m_[a-z0-9_]{1,40}$/, "Chiave non valida"),
        label,
        enabled: z.boolean(),
      }),
    )
    .max(10, "Massimo 10 voci manuali")
    .refine((items) => new Set(items.map((i) => i.key)).size === items.length, "Voci duplicate"),
});

/** Chiave stabile per una nuova voce manuale ("Imballo speciale" → "m_imballo_speciale"). */
export function manualCostKey(label: string, existing: string[] = []): string {
  const base =
    "m_" +
    (label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "voce");
  let key = base;
  for (let i = 2; existing.includes(key); i++) key = `${base}_${i}`;
  return key;
}

/** Dati di una richiesta necessari al calcolo. */
export type CostInput = {
  shippingCost: number | null;
  packagesCount: number | null;
  weightKg: number | null;
  /** m² misurati per riga di pezzi, con il prezzo al m² del prodotto (se presente in anagrafica). */
  pieces: { areaM2: number; productPricePerM2: number | null }[];
  /** Importi delle voci manuali, per chiave. */
  extraCosts: Record<string, number> | null;
};

export type CostLine = { key: string; label: string; amount: number; detail?: string };

/** Arrotonda ai centesimi come Postgres (4,815 → 4,82, senza gli errori dei numeri in virgola mobile). */
const round2 = (n: number) => {
  const s = n.toPrecision(12);
  return s.includes("e") ? Math.round(n * 100) / 100 : Number(`${Math.round(Number(`${s}e2`))}e-2`);
};

/** Costo di una richiesta secondo la configurazione: righe delle voci attive e totale. */
export function computeRequestCost(input: CostInput, config: CostConfig): { total: number; lines: CostLine[] } {
  const lines: CostLine[] = [];
  if (config.courier.enabled && input.shippingCost !== null) {
    lines.push({ key: "courier", label: config.courier.label, amount: round2(input.shippingCost) });
  }
  if (config.perRequest.enabled && config.perRequest.amount > 0) {
    lines.push({ key: "perRequest", label: config.perRequest.label, amount: round2(config.perRequest.amount) });
  }
  if (config.perPackage.enabled && config.perPackage.amount > 0 && input.packagesCount) {
    lines.push({
      key: "perPackage",
      label: config.perPackage.label,
      amount: round2(config.perPackage.amount * input.packagesCount),
      detail: `${input.packagesCount} × ${config.perPackage.amount}`,
    });
  }
  if (config.perKg.enabled && config.perKg.amount > 0 && input.weightKg) {
    lines.push({
      key: "perKg",
      label: config.perKg.label,
      amount: round2(config.perKg.amount * input.weightKg),
      detail: `${input.weightKg} kg × ${config.perKg.amount}`,
    });
  }
  if (config.perM2.enabled) {
    const value = input.pieces.reduce((sum, p) => {
      const price =
        config.perM2.useProductPrice && p.productPricePerM2 !== null ? p.productPricePerM2 : config.perM2.amount;
      return sum + p.areaM2 * price;
    }, 0);
    if (value > 0) lines.push({ key: "perM2", label: config.perM2.label, amount: round2(value) });
  }
  for (const item of config.manual) {
    const amount = input.extraCosts?.[item.key];
    if (item.enabled && typeof amount === "number" && amount > 0) {
      lines.push({ key: item.key, label: item.label, amount: round2(amount) });
    }
  }
  return { total: round2(lines.reduce((s, l) => s + l.amount, 0)), lines };
}

/** Voci attive, nell'ordine di visualizzazione (intestazioni delle colonne nei report). */
export function activeCostComponents(config: CostConfig): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (config.courier.enabled) out.push({ key: "courier", label: config.courier.label });
  if (config.perRequest.enabled) out.push({ key: "perRequest", label: config.perRequest.label });
  if (config.perPackage.enabled) out.push({ key: "perPackage", label: config.perPackage.label });
  if (config.perKg.enabled) out.push({ key: "perKg", label: config.perKg.label });
  if (config.perM2.enabled) out.push({ key: "perM2", label: config.perM2.label });
  for (const m of config.manual) if (m.enabled) out.push({ key: m.key, label: m.label });
  return out;
}
