import { describe, expect, it } from "vitest";
import {
  BOLLA_MODE_DESCRIPTIONS,
  BOLLA_MODE_LABELS,
  bollaConfigSchema,
  bollaRuleReasons,
  bollaSatisfiedForMode,
  DEFAULT_BOLLA_CONFIG,
  formatBollaNumber,
  isAbroad,
  type BollaMode,
  type BollaRules,
} from "@/lib/config/bolla";
import { applyBollaRules } from "@/lib/requests/service";
import { bollaSatisfied, bollaTodo } from "@/lib/requests/workflow";

const MODES: BollaMode[] = ["GENERATA", "GESTIONALE", "ENTRAMBE"];
const NO_RULES: BollaRules = { always: false, abroad: false, formats: [], minPackages: null };

describe("formatBollaNumber", () => {
  it("formato predefinito: C + numero a 4 cifre + / anno", () => {
    expect(formatBollaNumber(12, 2026, DEFAULT_BOLLA_CONFIG)).toBe("C0012/2026");
    expect(formatBollaNumber(1, 2027, DEFAULT_BOLLA_CONFIG)).toBe("C0001/2027");
  });

  it("i numeri più lunghi delle cifre indicate non vengono troncati", () => {
    expect(formatBollaNumber(12345, 2026, DEFAULT_BOLLA_CONFIG)).toBe("C12345/2026");
  });

  it("formati personalizzati: segnaposto ripetuti, senza anno, zeri iniziali configurabili", () => {
    expect(formatBollaNumber(7, 2026, { numberFormat: "{anno}-{numero}-{anno}", numberPadding: 6 })).toBe("2026-000007-2026");
    expect(formatBollaNumber(7, 2026, { numberFormat: "{numero}", numberPadding: 1 })).toBe("7");
    expect(formatBollaNumber(42, 2026, { numberFormat: "BGP/{numero}", numberPadding: 3 })).toBe("BGP/042");
  });
});

describe("isAbroad", () => {
  it("Italia in tutte le forme usate in anagrafica: non è estero", () => {
    for (const c of ["Italia", "ITALIA", " italy ", "IT", "ita", "Italie", "Italien", "Italia.", "Repubblica Italiana", "Italia (BG)"]) {
      expect(isAbroad(c), c).toBe(false);
    }
  });

  it("San Marino e Città del Vaticano sono estero; un valore non riconosciuto conta come estero", () => {
    for (const c of ["San Marino", "RSM", "SM", "Vaticano", "Frnce"]) expect(isAbroad(c), c).toBe(true);
  });

  it("paese non indicato: non si può dire che sia estero", () => {
    for (const c of [null, undefined, "", "   ", "-", "?"]) expect(isAbroad(c), String(c)).toBe(false);
  });

  it("altri paesi: estero", () => {
    for (const c of ["Francia", "France", "Svizzera", "DE", "Regno Unito", "San Marino"]) {
      expect(isAbroad(c), c).toBe(true);
    }
  });
});

describe("bollaRuleReasons", () => {
  const base = { destinationCountry: "Italia", itemFormats: ["MEZZE_DOGHE", null], packagesCount: 2 };

  it("nessuna regola (predefinito): nessun motivo", () => {
    expect(bollaRuleReasons(base, DEFAULT_BOLLA_CONFIG.rules)).toEqual([]);
    expect(bollaRuleReasons({ ...base, destinationCountry: "Francia", packagesCount: 99 }, NO_RULES)).toEqual([]);
  });

  it("bolla sempre richiesta", () => {
    expect(bollaRuleReasons(base, { ...NO_RULES, always: true })).toEqual(["bolla sempre richiesta"]);
  });

  it("estero: solo con un paese diverso dall'Italia", () => {
    const rules = { ...NO_RULES, abroad: true };
    expect(bollaRuleReasons(base, rules)).toEqual([]);
    expect(bollaRuleReasons({ ...base, destinationCountry: null }, rules)).toEqual([]);
    expect(bollaRuleReasons({ ...base, destinationCountry: "Svizzera" }, rules)).toEqual(["spedizione all'estero"]);
  });

  it("formati: basta una riga con uno dei formati indicati", () => {
    const rules: BollaRules = { ...NO_RULES, formats: ["ESPOSITORE_COMPLETO", "ESPOSITORE_CULLE"] };
    expect(bollaRuleReasons(base, rules)).toEqual([]);
    expect(bollaRuleReasons({ ...base, itemFormats: [null, "ESPOSITORE_CULLE"] }, rules)).toEqual([
      "formato che richiede la bolla",
    ]);
    // Più righe con formati della regola: un solo motivo.
    expect(bollaRuleReasons({ ...base, itemFormats: ["ESPOSITORE_COMPLETO", "ESPOSITORE_CULLE"] }, rules)).toHaveLength(1);
  });

  it("colli: da minPackages in su; colli non ancora noti non contano", () => {
    const rules = { ...NO_RULES, minPackages: 3 };
    expect(bollaRuleReasons({ ...base, packagesCount: null }, rules)).toEqual([]);
    expect(bollaRuleReasons({ ...base, packagesCount: 2 }, rules)).toEqual([]);
    expect(bollaRuleReasons({ ...base, packagesCount: 3 }, rules)).toEqual(["3 colli (da 3 in su)"]);
    expect(bollaRuleReasons({ ...base, packagesCount: 10 }, rules)).toEqual(["10 colli (da 3 in su)"]);
  });

  it("più regole insieme: tutti i motivi, nell'ordine", () => {
    const rules: BollaRules = { always: true, abroad: true, formats: ["PANNELLO"], minPackages: 1 };
    expect(
      bollaRuleReasons({ destinationCountry: "Germania", itemFormats: ["PANNELLO"], packagesCount: 1 }, rules),
    ).toEqual(["bolla sempre richiesta", "spedizione all'estero", "formato che richiede la bolla", "1 colli (da 1 in su)"]);
  });
});

describe("applyBollaRules (servizio)", () => {
  const config = { ...DEFAULT_BOLLA_CONFIG, rules: { ...NO_RULES, abroad: true } };

  it("regola applicabile: bolla obbligatoria con il motivo, anche se la scelta manuale era «no»", () => {
    expect(applyBollaRules(false, { destinationCountry: "Francia", itemFormats: [], packagesCount: null }, config)).toEqual({
      deliveryFormRequired: true,
      deliveryFormAutoReason: "spedizione all'estero",
    });
  });

  it("nessuna regola applicabile: vale la scelta manuale, senza motivo automatico", () => {
    const input = { destinationCountry: "Italia", itemFormats: [], packagesCount: null };
    expect(applyBollaRules(false, input, config)).toEqual({ deliveryFormRequired: false, deliveryFormAutoReason: null });
    expect(applyBollaRules(true, input, config)).toEqual({ deliveryFormRequired: true, deliveryFormAutoReason: null });
    expect(applyBollaRules(false, { ...input, destinationCountry: "Francia" }, DEFAULT_BOLLA_CONFIG)).toEqual({
      deliveryFormRequired: false,
      deliveryFormAutoReason: null,
    });
  });

  it("più motivi: separati da virgola", () => {
    const rules: BollaRules = { always: false, abroad: true, formats: ["ESPOSITORE_COMPLETO"], minPackages: null };
    expect(
      applyBollaRules(false, { destinationCountry: "Spagna", itemFormats: ["ESPOSITORE_COMPLETO"], packagesCount: null }, {
        ...DEFAULT_BOLLA_CONFIG,
        rules,
      }).deliveryFormAutoReason,
    ).toBe("spedizione all'estero, formato che richiede la bolla");
  });
});

describe("bollaSatisfiedForMode", () => {
  const required = {
    deliveryFormRequired: true,
    deliveryFormReady: false,
    ddtNumber: null as string | null,
    hasDdtAttachment: false,
    bollaNumber: null as string | null,
  };

  it("bolla non richiesta: sempre a posto, in ogni modalità", () => {
    for (const mode of MODES) {
      expect(bollaSatisfiedForMode({ ...required, deliveryFormRequired: false }, mode), mode).toBe(true);
    }
  });

  it("bolla richiesta e nulla di pronto: mai a posto", () => {
    for (const mode of MODES) expect(bollaSatisfiedForMode(required, mode), mode).toBe(false);
  });

  it("GENERATA: numero del sistema o «bolla pronta»; il DDT del gestionale non basta", () => {
    expect(bollaSatisfiedForMode({ ...required, bollaNumber: "C0001/2026" }, "GENERATA")).toBe(true);
    expect(bollaSatisfiedForMode({ ...required, deliveryFormReady: true }, "GENERATA")).toBe(true);
    expect(bollaSatisfiedForMode({ ...required, ddtNumber: "13807" }, "GENERATA")).toBe(false);
    expect(bollaSatisfiedForMode({ ...required, hasDdtAttachment: true }, "GENERATA")).toBe(false);
    expect(bollaSatisfiedForMode({ ...required, bollaNumber: "   " }, "GENERATA")).toBe(false);
  });

  it("GESTIONALE: numero o file del DDT; la bolla del sistema e la casella «pronta» non bastano", () => {
    expect(bollaSatisfiedForMode({ ...required, ddtNumber: "13807" }, "GESTIONALE")).toBe(true);
    expect(bollaSatisfiedForMode({ ...required, hasDdtAttachment: true }, "GESTIONALE")).toBe(true);
    expect(bollaSatisfiedForMode({ ...required, ddtNumber: "  " }, "GESTIONALE")).toBe(false);
    expect(bollaSatisfiedForMode({ ...required, bollaNumber: "C0001/2026" }, "GESTIONALE")).toBe(false);
    expect(bollaSatisfiedForMode({ ...required, deliveryFormReady: true }, "GESTIONALE")).toBe(false);
  });

  it("ENTRAMBE: basta una qualsiasi delle due (come prima delle impostazioni)", () => {
    for (const patch of [
      { bollaNumber: "C0001/2026" },
      { deliveryFormReady: true },
      { ddtNumber: "13807" },
      { hasDdtAttachment: true },
    ]) {
      expect(bollaSatisfiedForMode({ ...required, ...patch }, "ENTRAMBE"), JSON.stringify(patch)).toBe(true);
    }
  });

  it("bollaSatisfied del flusso: senza modalità vale ENTRAMBE; con la modalità segue le stesse regole", () => {
    const s = { deliveryFormRequired: true, deliveryFormReady: false, ddtNumber: "13807", hasDdtAttachment: false };
    expect(bollaSatisfied(s)).toBe(true);
    expect(bollaSatisfied({ ...s, bollaMode: "GENERATA" })).toBe(false);
    expect(bollaSatisfied({ ...s, bollaMode: "GESTIONALE" })).toBe(true);
    expect(bollaSatisfied({ ...s, ddtNumber: null, bollaNumber: "C0001/2026", bollaMode: "GENERATA" })).toBe(true);
  });

  it("cosa fare per la bolla: un messaggio diverso per ogni modalità", () => {
    expect(bollaTodo("GENERATA")).toMatch(/generala dal pannello Spedizione/);
    expect(bollaTodo("GESTIONALE")).toMatch(/DDT del gestionale/);
    expect(bollaTodo("GESTIONALE")).not.toMatch(/genera/i);
    expect(bollaTodo()).toBe(bollaTodo("ENTRAMBE"));
    expect(new Set(MODES.map(bollaTodo)).size).toBe(3);
  });

  it("etichette e descrizioni per tutte le modalità", () => {
    for (const mode of MODES) {
      expect(BOLLA_MODE_LABELS[mode]).toBeTruthy();
      expect(BOLLA_MODE_DESCRIPTIONS[mode]).toBeTruthy();
    }
  });
});

describe("bollaConfigSchema", () => {
  const issues = (value: unknown) => {
    const res = bollaConfigSchema.safeParse(value);
    return res.success ? [] : res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  };

  it("accetta i valori predefiniti (modalità ENTRAMBE, nessuna regola)", () => {
    expect(bollaConfigSchema.parse(DEFAULT_BOLLA_CONFIG)).toEqual(DEFAULT_BOLLA_CONFIG);
    expect(DEFAULT_BOLLA_CONFIG.mode).toBe("ENTRAMBE");
  });

  it("valori dal form: cifre e colli come testo, formato senza spazi ai bordi", () => {
    const parsed = bollaConfigSchema.parse({
      mode: "GENERATA",
      numberFormat: "  BGP-{numero}/{anno} ",
      numberPadding: "5",
      rules: { always: false, abroad: true, formats: ["ESPOSITORE_COMPLETO"], minPackages: "4" },
    });
    expect(parsed).toEqual({
      mode: "GENERATA",
      numberFormat: "BGP-{numero}/{anno}",
      numberPadding: 5,
      rules: { always: false, abroad: true, formats: ["ESPOSITORE_COMPLETO"], minPackages: 4 },
    });
  });

  it("il formato del numero deve contenere {numero}", () => {
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, numberFormat: "C/{anno}" })).toEqual([
      { path: "numberFormat", message: "Il formato deve contenere {numero}" },
    ]);
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, numberFormat: "  " }).map((i) => i.message)).toContain("Indica il formato del numero");
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, numberFormat: `{numero}${"x".repeat(40)}` }).map((i) => i.message)).toContain(
      "Massimo 40 caratteri",
    );
  });

  it("cifre del numero tra 1 e 8", () => {
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, numberPadding: 0 })[0]?.path).toBe("numberPadding");
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, numberPadding: 9 })[0]?.path).toBe("numberPadding");
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, numberPadding: 2.5 })[0]?.path).toBe("numberPadding");
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, numberPadding: 8 })).toEqual([]);
  });

  it("modalità e formati solo tra quelli previsti", () => {
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, mode: "MANUALE" })[0]?.path).toBe("mode");
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, rules: { ...NO_RULES, formats: ["BANCALE"] } })[0]?.path).toBe("rules.formats.0");
  });

  it("colli minimi: vuoto (nessuna regola) oppure almeno 1", () => {
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, rules: { ...NO_RULES, minPackages: null } })).toEqual([]);
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, rules: { ...NO_RULES, minPackages: 0 } })).toEqual([
      { path: "rules.minPackages", message: "Minimo 1 collo" },
    ]);
    expect(issues({ ...DEFAULT_BOLLA_CONFIG, rules: { ...NO_RULES, minPackages: 1000 } })[0]?.path).toBe("rules.minPackages");
  });
});
