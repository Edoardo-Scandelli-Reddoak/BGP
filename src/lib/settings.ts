import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

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
};

export type SettingKey = keyof AppSettings;

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      (out as Record<string, unknown>)[row.key] = row.value;
    }
  }
  return out;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<AppSettings[K]> {
  const rows = await db.select().from(settings).where(inArray(settings.key, [key]));
  return (rows[0]?.value as AppSettings[K] | undefined) ?? DEFAULT_SETTINGS[key];
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
