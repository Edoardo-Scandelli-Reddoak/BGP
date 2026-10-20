import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_BOLLA_CONFIG, type BollaConfig } from "@/lib/config/bolla";
import { DEFAULT_COST_CONFIG, type CostConfig } from "@/lib/config/costs";
import { DEFAULT_CRM_EXPORT_CONFIG, type CrmExportConfig } from "@/lib/config/crm-export";

/** Tutte le impostazioni modificabili dall'amministratore, con i valori predefiniti. */
export type AppSettings = {
  /** Mittente delle email, es. "BGP Group <info@bgpgroup.it>" (come le email inviate oggi). */
  mailFrom: string;
  mailReplyTo: string;
  /** Firma in fondo alle email ai clienti (testo, più righe). */
  mailSignature: string;
  /** Inserisce il banner BGP (loghi dei marchi) sotto la firma delle email HTML. */
  mailSignatureImage: boolean;
  /** Copia nascosta delle conferme di spedizione (archivio), opzionale. */
  shipmentBcc: string[];
  /** Destinatari dell'avviso "nuovo campionario da preparare" (Automazione 1). */
  warehouseEmails: string[];
  /** Destinatari dell'avviso "bolla di consegna richiesta" (Automazione 3). */
  logisticsEmails: string[];
  /** Dati aziendali stampati sulla bolla di consegna. */
  companyName: string;
  companyAddress: string;
  companyTaxInfo: string;
  companyContacts: string;
  /** Valori predefiniti della bolla (dal DDT di esempio di BGP). */
  bollaCausale: string;
  bollaPorto: string;
  bollaAspetto: string;
  /** Modulo pubblico per agenti e clienti, senza login. */
  publicFormEnabled: boolean;
  /** Testo introduttivo del modulo pubblico. */
  publicFormIntro: string;
  /** Voci dei «costi per cliente» (Impostazioni → Costi). */
  costConfig: CostConfig;
  /** Modalità, numerazione e regole della bolla di consegna (Impostazioni → Bolla di consegna). */
  bollaConfig: BollaConfig;
  /** Export dei m² verso il CRM (Impostazioni → Export CRM). */
  crmExport: CrmExportConfig;
};

export const DEFAULT_SETTINGS: AppSettings = {
  mailFrom: "BGP Group <info@bgpgroup.it>",
  mailReplyTo: "",
  mailSignature:
    "Ufficio Commerciale\nBGP Group S.r.l.\nVia S. Vincenzo de Paoli, 8 - 24023 Clusone (BG)\nTel. +39 0346 25200 · info@bgpgroup.it · www.bgpgroup.it",
  mailSignatureImage: true,
  shipmentBcc: [],
  warehouseEmails: [],
  logisticsEmails: [],
  companyName: "BGP GROUP SRL",
  companyAddress: "Sede Legale e Operativa: Via S. Vincenzo De Paoli, 8 - 24023 Clusone (BG)",
  companyTaxInfo: "P.Iva/C.F. 02707310161 - R.I. BG-02707310161 - REA 316795",
  companyContacts: "Tel. 0346 25200 - info@bgpgroup.it - www.bgpgroup.it",
  bollaCausale: "CUG Comodato d'uso gratuito",
  bollaPorto: "Franco vs magazzino",
  bollaAspetto: "Pacco",
  publicFormEnabled: true,
  publicFormIntro:
    "Compila il modulo per richiedere i campioni BGP. Il nostro ufficio verificherà la richiesta e riceverai un'email quando i campioni saranno spediti.",
  costConfig: DEFAULT_COST_CONFIG,
  bollaConfig: DEFAULT_BOLLA_CONFIG,
  crmExport: DEFAULT_CRM_EXPORT_CONFIG,
};

/**
 * Le configurazioni strutturate salvate in passato possono non avere le chiavi aggiunte dopo:
 * si completano con i valori predefiniti (un livello di profondità basta per le strutture attuali).
 */
function withDefaults<T>(stored: unknown, defaults: T): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored) || typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
    return (stored as T) ?? defaults;
  }
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    const d = (defaults as Record<string, unknown>)[k];
    out[k] =
      d && typeof d === "object" && !Array.isArray(d) && v && typeof v === "object" && !Array.isArray(v)
        ? { ...(d as object), ...(v as object) }
        : v;
  }
  return out as T;
}

export type SettingKey = keyof AppSettings;

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      const key = row.key as SettingKey;
      (out as Record<string, unknown>)[key] = withDefaults(row.value, DEFAULT_SETTINGS[key]);
    }
  }
  return out;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<AppSettings[K]> {
  const rows = await db.select().from(settings).where(inArray(settings.key, [key]));
  return rows[0] ? withDefaults(rows[0].value, DEFAULT_SETTINGS[key]) : DEFAULT_SETTINGS[key];
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => k in DEFAULT_SETTINGS);
  if (entries.length === 0) return;
  await db.transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx
        .insert(settings)
        .values({ key, value: value as object })
        .onConflictDoUpdate({ target: settings.key, set: { value: value as object, updatedAt: new Date() } });
    }
  });
}
