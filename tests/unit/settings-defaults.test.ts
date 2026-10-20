import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOLLA_CONFIG } from "@/lib/config/bolla";
import { DEFAULT_COST_CONFIG } from "@/lib/config/costs";
import { DEFAULT_CRM_EXPORT_CONFIG } from "@/lib/config/crm-export";

/**
 * Lettura delle impostazioni salvate: le configurazioni salvate in passato (o parziali) si completano
 * con i valori predefiniti. Database simulato: righe della tabella settings decise dal test.
 */

const store = vi.hoisted(() => ({ rows: [] as { key: string; value: unknown }[] }));

// getSetting filtra con inArray(settings.key, [chiave]): qui la condizione porta solo le chiavi.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  inArray: (_column: unknown, keys: string[]) => ({ keys }),
}));

vi.mock("@/db", () => {
  const from = () =>
    Object.assign(Promise.resolve(store.rows), {
      where: (cond: { keys: string[] }) => Promise.resolve(store.rows.filter((r) => cond.keys.includes(r.key))),
    });
  return { db: { select: () => ({ from }) } };
});

const { DEFAULT_SETTINGS, getSetting, getSettings } = await import("@/lib/settings");

const snapshot = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const DEFAULTS_BEFORE = snapshot({ DEFAULT_SETTINGS, DEFAULT_COST_CONFIG, DEFAULT_BOLLA_CONFIG, DEFAULT_CRM_EXPORT_CONFIG });

describe("impostazioni: valori predefiniti e configurazioni salvate in parte", () => {
  beforeEach(() => {
    store.rows = [];
  });

  it("nessuna impostazione salvata: tutti i valori predefiniti (comportamento attuale)", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await getSetting("costConfig")).toEqual(DEFAULT_COST_CONFIG);
    expect(await getSetting("bollaConfig")).toEqual(DEFAULT_BOLLA_CONFIG);
    expect(await getSetting("crmExport")).toEqual(DEFAULT_CRM_EXPORT_CONFIG);
  });

  it("costi: una voce salvata in parte si completa con i valori predefiniti della voce", async () => {
    store.rows = [{ key: "costConfig", value: { perKg: { enabled: true, amount: 0.5 } } }];
    const cost = (await getSettings()).costConfig;
    expect(cost.perKg).toEqual({ enabled: true, label: "Peso (per kg)", amount: 0.5 });
    expect(cost.courier).toEqual(DEFAULT_COST_CONFIG.courier);
    expect(cost.perM2).toEqual(DEFAULT_COST_CONFIG.perM2);
    expect(cost.manual).toEqual([]);
    expect(await getSetting("costConfig")).toEqual(cost);
  });

  it("gli elenchi salvati sostituiscono quelli predefiniti (non si uniscono)", async () => {
    const manual = [{ key: "m_dogana", label: "Dogana", enabled: true }];
    store.rows = [
      { key: "costConfig", value: { manual } },
      { key: "crmExport", value: { groupBy: "AGENTE", columns: ["agente", "m2"] } },
    ];
    const s = await getSettings();
    expect(s.costConfig.manual).toEqual(manual);
    expect(s.crmExport.columns).toEqual(["agente", "m2"]);
    expect(s.crmExport.groupBy).toBe("AGENTE");
    expect(s.crmExport.separator).toBe(";");
  });

  it("bolla: regole salvate in parte (configurazione di una versione precedente)", async () => {
    store.rows = [{ key: "bollaConfig", value: { mode: "GENERATA", rules: { abroad: true } } }];
    expect(await getSetting("bollaConfig")).toEqual({
      ...DEFAULT_BOLLA_CONFIG,
      mode: "GENERATA",
      rules: { always: false, abroad: true, formats: [], minPackages: null },
    });
  });

  it("export CRM: invio automatico salvato senza il giorno e senza webhook", async () => {
    store.rows = [{ key: "crmExport", value: { autoSend: { enabled: true, recipients: ["crm@bgpgroup.it"] } } }];
    const crm = await getSetting("crmExport");
    expect(crm.autoSend).toEqual({ enabled: true, recipients: ["crm@bgpgroup.it"], day: 1 });
    expect(crm.webhook).toEqual(DEFAULT_CRM_EXPORT_CONFIG.webhook);
    expect(crm.columns).toEqual(DEFAULT_CRM_EXPORT_CONFIG.columns);
    expect(crm.format).toBe("CSV");
  });

  it("valori semplici: false e liste vuote salvati restano tali; null torna al predefinito", async () => {
    store.rows = [
      { key: "publicFormEnabled", value: false },
      { key: "logisticsEmails", value: [] },
      { key: "mailFrom", value: null },
      { key: "mailSignature", value: "Firma" },
    ];
    const s = await getSettings();
    expect(s.publicFormEnabled).toBe(false);
    expect(s.logisticsEmails).toEqual([]);
    expect(s.mailFrom).toBe(DEFAULT_SETTINGS.mailFrom);
    expect(s.mailSignature).toBe("Firma");
  });

  it("chiavi sconosciute nel database: ignorate", async () => {
    store.rows = [{ key: "vecchiaImpostazione", value: { x: 1 } }];
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect("vecchiaImpostazione" in s).toBe(false);
  });

  it("getSetting senza riga salvata: valore predefinito", async () => {
    expect(await getSetting("bollaConfig")).toEqual(DEFAULT_BOLLA_CONFIG);
    expect(await getSetting("publicFormEnabled")).toBe(true);
  });

  it("i valori predefiniti non vengono modificati dalle letture", async () => {
    store.rows = [
      { key: "costConfig", value: { perKg: { enabled: true, amount: 9 }, manual: [{ key: "m_x", label: "X", enabled: true }] } },
      { key: "bollaConfig", value: { rules: { minPackages: 3 } } },
      { key: "crmExport", value: { autoSend: { enabled: true } } },
    ];
    await getSettings();
    await getSetting("costConfig");
    await getSetting("bollaConfig");
    await getSetting("crmExport");
    expect(snapshot({ DEFAULT_SETTINGS, DEFAULT_COST_CONFIG, DEFAULT_BOLLA_CONFIG, DEFAULT_CRM_EXPORT_CONFIG })).toEqual(
      DEFAULTS_BEFORE,
    );
  });
});
