import { describe, expect, it } from "vitest";
import {
  activeCostComponents,
  computeRequestCost,
  costConfigSchema,
  DEFAULT_COST_CONFIG,
  manualCostKey,
  type CostConfig,
  type CostInput,
} from "@/lib/config/costs";

/** Configurazione con tutte le voci attive (manuali: una attiva e una disattivata). */
function fullConfig(overrides: Partial<CostConfig> = {}): CostConfig {
  return {
    courier: { enabled: true, label: "Corriere" },
    perRequest: { enabled: true, label: "Gestione richiesta", amount: 4 },
    perPackage: { enabled: true, label: "Imballo (per collo)", amount: 2.5 },
    perKg: { enabled: true, label: "Peso (per kg)", amount: 1.25 },
    perM2: { enabled: true, label: "Valore campioni (al m²)", amount: 20, useProductPrice: true },
    manual: [
      { key: "m_imballo_speciale", label: "Imballo speciale", enabled: true },
      { key: "m_dogana", label: "Dogana", enabled: false },
    ],
    ...overrides,
  };
}

function input(overrides: Partial<CostInput> = {}): CostInput {
  return {
    shippingCost: 12.4,
    packagesCount: 3,
    weightKg: 2.333,
    pieces: [
      { areaM2: 0.5, productPricePerM2: 40 },
      { areaM2: 0.25, productPricePerM2: null },
    ],
    extraCosts: { m_imballo_speciale: 6, m_dogana: 9, m_sconosciuta: 100 },
    ...overrides,
  };
}

describe("computeRequestCost", () => {
  it("con i valori predefiniti conta solo il corriere (come oggi)", () => {
    const res = computeRequestCost(input(), DEFAULT_COST_CONFIG);
    expect(res).toEqual({ total: 12.4, lines: [{ key: "courier", label: "Corriere", amount: 12.4 }] });
  });

  it("senza costo del corriere il totale è zero e non c'è nessuna riga", () => {
    expect(computeRequestCost(input({ shippingCost: null }), DEFAULT_COST_CONFIG)).toEqual({ total: 0, lines: [] });
    // Costo 0 inserito: la riga c'è (la logistica l'ha indicato), il totale resta 0.
    expect(computeRequestCost(input({ shippingCost: 0 }), DEFAULT_COST_CONFIG)).toEqual({
      total: 0,
      lines: [{ key: "courier", label: "Corriere", amount: 0 }],
    });
  });

  it("tutte le voci attive: righe nell'ordine di visualizzazione, dettagli e totale", () => {
    const res = computeRequestCost(input(), fullConfig());
    expect(res.lines).toEqual([
      { key: "courier", label: "Corriere", amount: 12.4 },
      { key: "perRequest", label: "Gestione richiesta", amount: 4 },
      { key: "perPackage", label: "Imballo (per collo)", amount: 7.5, detail: "3 × 2.5" },
      // 2,333 kg × 1,25 = 2,91625 → arrotondato al centesimo
      { key: "perKg", label: "Peso (per kg)", amount: 2.92, detail: "2.333 kg × 1.25" },
      // 0,5 m² al prezzo del prodotto (40) + 0,25 m² al prezzo predefinito (20)
      { key: "perM2", label: "Valore campioni (al m²)", amount: 25 },
      // solo le voci manuali attive; le chiavi sconosciute sono ignorate
      { key: "m_imballo_speciale", label: "Imballo speciale", amount: 6 },
    ]);
    expect(res.total).toBe(57.82);
  });

  it("valore al m²: senza il prezzo del prodotto vale sempre l'importo configurato", () => {
    const config = fullConfig({
      perM2: { enabled: true, label: "Valore", amount: 20, useProductPrice: false },
    });
    const line = computeRequestCost(input(), config).lines.find((l) => l.key === "perM2");
    expect(line?.amount).toBe(15); // 0,75 m² × 20
  });

  it("valore al m²: prezzo del prodotto 0 è un prezzo valido (non si usa quello predefinito)", () => {
    const res = computeRequestCost(
      input({ pieces: [{ areaM2: 1, productPricePerM2: 0 }] }),
      fullConfig({ perM2: { enabled: true, label: "Valore", amount: 20, useProductPrice: true } }),
    );
    expect(res.lines.find((l) => l.key === "perM2")).toBeUndefined();
  });

  it("valore al m²: nessun pezzo misurato o importo 0 senza prezzi → nessuna riga", () => {
    expect(computeRequestCost(input({ pieces: [] }), fullConfig()).lines.some((l) => l.key === "perM2")).toBe(false);
    const zero = fullConfig({ perM2: { enabled: true, label: "Valore", amount: 0, useProductPrice: true } });
    const res = computeRequestCost(input({ pieces: [{ areaM2: 2, productPricePerM2: null }] }), zero);
    expect(res.lines.some((l) => l.key === "perM2")).toBe(false);
  });

  it("voci attive con importo 0 o dati mancanti non producono righe", () => {
    const config = fullConfig({
      perRequest: { enabled: true, label: "Gestione", amount: 0 },
    });
    const res = computeRequestCost(
      input({ packagesCount: null, weightKg: 0, pieces: [], extraCosts: null, shippingCost: null }),
      config,
    );
    expect(res).toEqual({ total: 0, lines: [] });
  });

  it("voci disattivate: nessuna riga anche con importi e dati presenti", () => {
    const off: CostConfig = {
      courier: { enabled: false, label: "Corriere" },
      perRequest: { enabled: false, label: "Gestione", amount: 4 },
      perPackage: { enabled: false, label: "Collo", amount: 2 },
      perKg: { enabled: false, label: "Kg", amount: 1 },
      perM2: { enabled: false, label: "m²", amount: 20, useProductPrice: false },
      manual: [{ key: "m_imballo_speciale", label: "Imballo speciale", enabled: false }],
    };
    expect(computeRequestCost(input(), off)).toEqual({ total: 0, lines: [] });
  });

  it("voci manuali: importi non numerici, zero o negativi sono ignorati", () => {
    const config = fullConfig({
      courier: { enabled: false, label: "Corriere" },
      perRequest: { enabled: false, label: "Gestione", amount: 0 },
      perPackage: { enabled: false, label: "Collo", amount: 0 },
      perKg: { enabled: false, label: "Kg", amount: 0 },
      perM2: { enabled: false, label: "m²", amount: 0, useProductPrice: true },
      manual: [
        { key: "m_a", label: "A", enabled: true },
        { key: "m_b", label: "B", enabled: true },
        { key: "m_c", label: "C", enabled: true },
        { key: "m_d", label: "D", enabled: true },
      ],
    });
    const extraCosts = { m_a: "5", m_b: 0, m_c: -3, m_d: 1.005 } as unknown as Record<string, number>;
    const res = computeRequestCost(input({ extraCosts }), config);
    expect(res.lines.map((l) => l.key)).toEqual(["m_d"]);
    expect(res.total).toBeCloseTo(1, 2);
  });

  it("arrotonda ogni riga e il totale al centesimo", () => {
    const config = fullConfig({
      courier: { enabled: true, label: "Corriere" },
      perRequest: { enabled: false, label: "Gestione", amount: 0 },
      perPackage: { enabled: true, label: "Collo", amount: 0.333 },
      perKg: { enabled: true, label: "Kg", amount: 0.1 },
      perM2: { enabled: true, label: "m²", amount: 3.333, useProductPrice: false },
      manual: [],
    });
    const res = computeRequestCost(
      input({ shippingCost: 0.1 + 0.2, packagesCount: 3, weightKg: 0.3, pieces: [{ areaM2: 0.3333, productPricePerM2: null }] }),
      config,
    );
    expect(res.lines.map((l) => l.amount)).toEqual([0.3, 1, 0.03, 1.11]);
    expect(res.total).toBe(2.44);
    for (const l of res.lines) expect(Math.round(l.amount * 100)).toBeCloseTo(l.amount * 100, 9);
  });
});

describe("activeCostComponents", () => {
  it("predefinito: solo il corriere", () => {
    expect(activeCostComponents(DEFAULT_COST_CONFIG)).toEqual([{ key: "courier", label: "Corriere" }]);
  });

  it("tutte le voci attive nell'ordine (anche con importo 0), senza le manuali disattivate", () => {
    expect(activeCostComponents(fullConfig({ perRequest: { enabled: true, label: "Gestione", amount: 0 } }))).toEqual([
      { key: "courier", label: "Corriere" },
      { key: "perRequest", label: "Gestione" },
      { key: "perPackage", label: "Imballo (per collo)" },
      { key: "perKg", label: "Peso (per kg)" },
      { key: "perM2", label: "Valore campioni (al m²)" },
      { key: "m_imballo_speciale", label: "Imballo speciale" },
    ]);
  });
});

describe("manualCostKey", () => {
  it("chiave dal nome: minuscole, senza accenti e simboli", () => {
    expect(manualCostKey("Imballo speciale")).toBe("m_imballo_speciale");
    expect(manualCostKey("Spedizione città è più cara")).toBe("m_spedizione_citta_e_piu_cara");
    expect(manualCostKey("  --Pallet (EUR)!! ")).toBe("m_pallet_eur");
    expect(manualCostKey("Dogana/Accise 2026")).toBe("m_dogana_accise_2026");
  });

  it("nome senza lettere né cifre → «voce»", () => {
    expect(manualCostKey("€€€")).toBe("m_voce");
    expect(manualCostKey("")).toBe("m_voce");
  });

  it("chiavi già usate: suffisso progressivo", () => {
    expect(manualCostKey("Imballo", ["m_imballo"])).toBe("m_imballo_2");
    expect(manualCostKey("Imballo", ["m_imballo", "m_imballo_2"])).toBe("m_imballo_3");
    expect(manualCostKey("Imballo", ["m_altro"])).toBe("m_imballo");
  });

  it("le chiavi generate sono sempre valide per lo schema (anche da nomi lunghi)", () => {
    const labels = ["Imballo speciale", "x".repeat(60), "Voce con un nome davvero molto lungo per la logistica", "€€€", "À è ì ò ù"];
    for (const label of labels) {
      const key = manualCostKey(label, ["m_voce"]);
      const parsed = costConfigSchema.safeParse({ ...DEFAULT_COST_CONFIG, manual: [{ key, label: label.slice(0, 60) || "Voce", enabled: true }] });
      expect(parsed.success, `${label} → ${key}`).toBe(true);
      expect(key.length).toBeLessThanOrEqual(42);
    }
  });
});

describe("costConfigSchema", () => {
  const issues = (value: unknown) => {
    const res = costConfigSchema.safeParse(value);
    return res.success ? [] : res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  };

  it("accetta i valori predefiniti e una configurazione completa", () => {
    expect(costConfigSchema.parse(DEFAULT_COST_CONFIG)).toEqual(DEFAULT_COST_CONFIG);
    expect(costConfigSchema.parse(fullConfig())).toEqual(fullConfig());
  });

  it("importi dal form (testo) convertiti in numero; etichette senza spazi ai bordi", () => {
    const parsed = costConfigSchema.parse({
      ...DEFAULT_COST_CONFIG,
      perKg: { enabled: true, label: "  Peso  ", amount: "0.75" },
    });
    expect(parsed.perKg).toEqual({ enabled: true, label: "Peso", amount: 0.75 });
  });

  it("rifiuta importi negativi o troppo alti", () => {
    expect(issues({ ...DEFAULT_COST_CONFIG, perRequest: { enabled: true, label: "G", amount: -1 } })).toEqual([
      { path: "perRequest.amount", message: "Importo non valido" },
    ]);
    expect(issues({ ...DEFAULT_COST_CONFIG, perPackage: { enabled: true, label: "C", amount: 100_001 } })).toEqual([
      { path: "perPackage.amount", message: "Importo troppo alto" },
    ]);
    expect(issues({ ...DEFAULT_COST_CONFIG, perKg: { enabled: true, label: "K", amount: "abc" } })[0]?.path).toBe("perKg.amount");
  });

  it("rifiuta etichette vuote o troppo lunghe", () => {
    expect(issues({ ...DEFAULT_COST_CONFIG, courier: { enabled: true, label: "   " } })).toEqual([
      { path: "courier.label", message: "Indica il nome della voce" },
    ]);
    expect(issues({ ...DEFAULT_COST_CONFIG, courier: { enabled: true, label: "x".repeat(61) } })).toEqual([
      { path: "courier.label", message: "Massimo 60 caratteri" },
    ]);
  });

  it("voci manuali: chiave valida, niente doppioni, al massimo 10", () => {
    const item = (key: string) => ({ key, label: "Voce", enabled: true });
    for (const key of ["imballo", "m_", "m_Imballo", "m_imballo-speciale", `m_${"a".repeat(41)}`]) {
      expect(issues({ ...DEFAULT_COST_CONFIG, manual: [item(key)] }), key).toEqual([
        { path: "manual.0.key", message: "Chiave non valida" },
      ]);
    }
    expect(issues({ ...DEFAULT_COST_CONFIG, manual: [item("m_a"), item("m_a")] })).toEqual([
      { path: "manual", message: "Voci duplicate" },
    ]);
    const eleven = Array.from({ length: 11 }, (_, i) => item(`m_v${i}`));
    expect(issues({ ...DEFAULT_COST_CONFIG, manual: eleven })).toEqual([
      { path: "manual", message: "Massimo 10 voci manuali" },
    ]);
    expect(issues({ ...DEFAULT_COST_CONFIG, manual: eleven.slice(0, 10) })).toEqual([]);
  });
});
