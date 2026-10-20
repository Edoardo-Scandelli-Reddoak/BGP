import { describe, expect, it } from "vitest";
import {
  CRM_COLUMN_HINTS,
  CRM_KEY_COLUMNS,
  crmColumnHint,
  missingCrmKeyColumns,
} from "@/components/impostazioni/config-utils";
import {
  CRM_COLUMNS,
  CRM_COLUMNS_BY_GROUP,
  CRM_GROUP_BY_LABELS,
  CRM_GROUPS,
  CRM_MISSING_LABEL,
  crmCsv,
  crmExportConfigSchema,
  crmFileName,
  DEFAULT_CRM_EXPORT_CONFIG,
  type CrmColumn,
  type CrmExportConfig,
  type CrmGroupBy,
  type CrmRow,
} from "@/lib/config/crm-export";

const BOM = "﻿";
const GROUPS = Object.keys(CRM_COLUMNS_BY_GROUP) as CrmGroupBy[];
const ALL_COLUMNS = Object.keys(CRM_COLUMNS) as CrmColumn[];

const config = (overrides: Partial<CrmExportConfig> = {}): CrmExportConfig => ({ ...DEFAULT_CRM_EXPORT_CONFIG, ...overrides });

/** Righe del CSV senza BOM e senza l'ultima riga vuota (il file termina con CRLF). */
function lines(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.slice(1, -2).split("\r\n");
}

const ROW: CrmRow = {
  mese: "2026-09",
  codice: "10150E1",
  descrizione: "Rovere naturale 14x190",
  marchio: "BGP",
  categoria: "Legno",
  richieste: 2,
  pezzi: 5,
  m2: 1.23456,
};

describe("crmCsv", () => {
  it("predefinito: una riga per prodotto (Codice;Descrizione;Marchio;Categoria;Richieste;Pezzi;m2), BOM e CRLF", () => {
    const csv = crmCsv([ROW], DEFAULT_CRM_EXPORT_CONFIG);
    expect(lines(csv)).toEqual([
      "Codice;Descrizione;Marchio;Categoria;Richieste;Pezzi;m2",
      // codice protetto dalla conversione di Excel (10150E1 = 1,015×10^5), m² a 2 decimali con la virgola
      `"=""10150E1""";Rovere naturale 14x190;BGP;Legno;2;5;1,23`,
    ]);
    // marchio e categoria non indicati in anagrafica: celle vuote
    expect(lines(crmCsv([{ ...ROW, marchio: null, categoria: null }], DEFAULT_CRM_EXPORT_CONFIG))[1]).toBe(
      `"=""10150E1""";Rovere naturale 14x190;;;2;5;1,23`,
    );
  });

  it("nessuna riga: solo l'intestazione; senza intestazione il file è vuoto", () => {
    expect(lines(crmCsv([], DEFAULT_CRM_EXPORT_CONFIG))).toEqual(["Codice;Descrizione;Marchio;Categoria;Richieste;Pezzi;m2"]);
    expect(crmCsv([], config({ header: false }))).toBe(`${BOM}\r\n`);
  });

  it("separatore «,» con il punto decimale; i testi con la virgola vanno tra virgolette", () => {
    const csv = crmCsv([{ ...ROW, descrizione: "Rovere, spazzolato", m2: 0.5 }], config({ separator: ",", decimal: "." }));
    expect(lines(csv)).toEqual([
      "Codice,Descrizione,Marchio,Categoria,Richieste,Pezzi,m2",
      `"=""10150E1""","Rovere, spazzolato",BGP,Legno,2,5,0.50`,
    ]);
  });

  it("separatore «;» con il punto decimale", () => {
    expect(lines(crmCsv([ROW], config({ decimal: "." })))[1]).toBe(`"=""10150E1""";Rovere naturale 14x190;BGP;Legno;2;5;1.23`);
  });

  it("separatore tabulazione: il punto e virgola nei testi non richiede virgolette", () => {
    const csv = crmCsv([{ ...ROW, descrizione: "Rovere; spazzolato" }], config({ separator: "\t", decimal: "," }));
    expect(lines(csv)).toEqual([
      "Codice\tDescrizione\tMarchio\tCategoria\tRichieste\tPezzi\tm2",
      `"=""10150E1"""\tRovere; spazzolato\tBGP\tLegno\t2\t5\t1,23`,
    ]);
  });

  it("senza intestazione: solo le righe", () => {
    expect(lines(crmCsv([ROW, { ...ROW, codice: "AB-12", m2: 2 }], config({ header: false })))).toEqual([
      `"=""10150E1""";Rovere naturale 14x190;BGP;Legno;2;5;1,23`,
      "AB-12;Rovere naturale 14x190;BGP;Legno;2;5;2,00",
    ]);
  });

  it("colonne nell'ordine scelto, anche solo alcune", () => {
    const cfg = config({ groupBy: "PRODOTTO_CLIENTE", columns: ["m2", "cliente", "mese", "codice"] });
    const row: CrmRow = { ...ROW, cliente: "Legnoarte Srl", agente: "Mario Rossi" };
    expect(lines(crmCsv([row], cfg))).toEqual(["m2;Cliente;Mese;Codice", `1,23;Legnoarte Srl;"=""2026-09""";"=""10150E1"""`]);
  });

  it("codici che Excel trasformerebbe in numeri, date o percentuali restano testo", () => {
    const codes: [string, string][] = [
      ["10150E1", `"=""10150E1"""`],
      ["1E-5", `"=""1E-5"""`],
      ["12345", `"=""12345"""`],
      ["0012", `"=""0012"""`],
      ["3,5", `"=""3,5"""`],
      ["3.5", `"=""3.5"""`],
      ["10%", `"=""10%"""`],
      ["1/2", `"=""1/2"""`],
      ["12-03", `"=""12-03"""`],
      ["01.02.2026", `"=""01.02.2026"""`],
      ["12:30", `"=""12:30"""`],
      // codici con lettere non si toccano
      ["AB-123", "AB-123"],
      ["R14190N", "R14190N"],
      ["10150-E1", "10150-E1"],
    ];
    const cfg = config({ columns: ["codice"], header: false });
    for (const [code, expected] of codes) {
      expect(lines(crmCsv([{ codice: code }], cfg))[0], code).toBe(expected);
    }
  });

  it("la protezione dei codici vale solo per la colonna Codice", () => {
    const cfg = config({ groupBy: "PRODOTTO", columns: ["descrizione", "marchio"], header: false });
    expect(lines(crmCsv([{ descrizione: "12345", marchio: "0012" }], cfg))[0]).toBe("12345;0012");
  });

  it("testi che iniziano come una formula vengono neutralizzati con l'apostrofo", () => {
    const cfg = config({ groupBy: "PRODOTTO_CLIENTE", columns: ["descrizione", "cliente", "codice"], header: false });
    const csv = crmCsv([{ descrizione: "=HYPERLINK(\"x\")", cliente: "+39 035 123", codice: "@SUM" }], cfg);
    expect(lines(csv)[0]).toBe(`"'=HYPERLINK(""x"")";'+39 035 123;'@SUM`);
    expect(lines(crmCsv([{ descrizione: "-5 cm", cliente: "\tTab" }], cfg))[0]).toBe("'-5 cm;'\tTab;");
  });

  it("virgolette e a capo nei testi: campo tra virgolette con le virgolette raddoppiate", () => {
    const cfg = config({ columns: ["descrizione"], header: false });
    expect(lines(crmCsv([{ descrizione: 'Noce "canaletto"' }], cfg))[0]).toBe('"Noce ""canaletto"""');
    expect(crmCsv([{ descrizione: "Riga 1\nRiga 2" }], cfg)).toBe(`${BOM}"Riga 1\nRiga 2"\r\n`);
  });

  it("valori mancanti e numeri non finiti: cella vuota; i numeri interi senza decimali", () => {
    const cfg = config({ columns: ["codice", "marchio", "richieste", "pezzi", "m2"], header: false });
    expect(lines(crmCsv([{ codice: "AB", marchio: null, richieste: Number.NaN, pezzi: 3, m2: Number.POSITIVE_INFINITY }], cfg))[0]).toBe(
      "AB;;;3;",
    );
    expect(lines(crmCsv([{ codice: "AB" }], cfg))[0]).toBe("AB;;;;");
    expect(lines(crmCsv([{ codice: "AB", m2: 0, pezzi: 0, richieste: 0 }], cfg))[0]).toBe("AB;;0;0;0,00");
  });

  it("intestazioni per tutte le colonne", () => {
    const cfg = config({ groupBy: "PRODOTTO_CLIENTE", columns: CRM_COLUMNS_BY_GROUP.PRODOTTO_CLIENTE });
    expect(lines(crmCsv([], cfg))[0]).toBe("Mese;Codice;Descrizione;Marchio;Categoria;Cliente;Paese;Agente;Richieste;Pezzi;m2");
  });
});

describe("crmExportConfigSchema", () => {
  const issues = (value: unknown) => {
    const res = crmExportConfigSchema.safeParse(value);
    return res.success ? [] : res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  };

  it("accetta i valori predefiniti (export di oggi, nessun invio automatico)", () => {
    expect(crmExportConfigSchema.parse(DEFAULT_CRM_EXPORT_CONFIG)).toEqual(DEFAULT_CRM_EXPORT_CONFIG);
    expect(DEFAULT_CRM_EXPORT_CONFIG.autoSend.enabled).toBe(false);
    expect(DEFAULT_CRM_EXPORT_CONFIG.webhook.enabled).toBe(false);
  });

  it("per ogni raggruppamento: valide tutte e sole le sue colonne", () => {
    for (const groupBy of GROUPS) {
      const allowed = CRM_COLUMNS_BY_GROUP[groupBy];
      expect(issues(config({ groupBy, columns: allowed })), groupBy).toEqual([]);
      for (const col of ALL_COLUMNS.filter((c) => !allowed.includes(c))) {
        expect(issues(config({ groupBy, columns: [...allowed, col] })), `${groupBy} + ${col}`).toEqual([
          { path: "columns", message: `Colonne non disponibili con questo raggruppamento: ${CRM_COLUMNS[col]}` },
        ]);
      }
    }
  });

  it("le misure ci sono sempre e ogni raggruppamento ha un'etichetta", () => {
    for (const groupBy of GROUPS) {
      expect(CRM_COLUMNS_BY_GROUP[groupBy]).toEqual(expect.arrayContaining(["mese", "richieste", "pezzi", "m2"]));
      expect(CRM_GROUP_BY_LABELS[groupBy]).toBeTruthy();
    }
  });

  it("più colonne non disponibili: elencate tutte in un solo messaggio", () => {
    expect(issues(config({ groupBy: "AGENTE", columns: ["agente", "codice", "cliente", "m2"] }))).toEqual([
      { path: "columns", message: "Colonne non disponibili con questo raggruppamento: Codice, Cliente" },
    ]);
  });

  it("almeno una colonna, solo colonne conosciute", () => {
    expect(issues(config({ columns: [] }))).toEqual([{ path: "columns", message: "Scegli almeno una colonna" }]);
    expect(issues(config({ columns: ["prezzo" as CrmColumn] }))[0]?.path).toBe("columns.0");
  });

  it("separatore «,» con la virgola decimale: rifiutato (il file non si leggerebbe)", () => {
    expect(issues(config({ separator: ",", decimal: "," }))).toEqual([
      { path: "decimal", message: "Con il separatore «,» usa il punto per i decimali" },
    ]);
    for (const [separator, decimal] of [[",", "."], [";", ","], [";", "."], ["\t", ","], ["\t", "."]] as const) {
      expect(issues(config({ separator, decimal })), `${separator} ${decimal}`).toEqual([]);
    }
    expect(issues(config({ separator: "|" as ";" }))[0]?.path).toBe("separator");
  });

  it("invio automatico: destinatari obbligatori se attivo, email valide, al massimo 10, giorno 1-28", () => {
    const autoSend = (patch: Partial<CrmExportConfig["autoSend"]>) =>
      config({ autoSend: { ...DEFAULT_CRM_EXPORT_CONFIG.autoSend, ...patch } });
    expect(issues(autoSend({ enabled: true, recipients: [] }))).toEqual([
      { path: "autoSend.recipients", message: "Indica almeno un destinatario" },
    ]);
    expect(issues(autoSend({ enabled: false, recipients: [] }))).toEqual([]);
    expect(issues(autoSend({ enabled: true, recipients: ["crm@bgpgroup.it"] }))).toEqual([]);
    expect(issues(autoSend({ enabled: true, recipients: ["non-una-email"] }))).toEqual([
      { path: "autoSend.recipients.0", message: "Email non valida" },
    ]);
    const eleven = Array.from({ length: 11 }, (_, i) => `crm${i}@bgpgroup.it`);
    expect(issues(autoSend({ enabled: true, recipients: eleven }))[0]?.path).toBe("autoSend.recipients");
    for (const day of [0, 29, 1.5]) expect(issues(autoSend({ day }))[0]?.path, String(day)).toBe("autoSend.day");
    expect(crmExportConfigSchema.parse(autoSend({ day: "15" as unknown as number })).autoSend.day).toBe(15);
  });

  it("webhook: se attivo serve un indirizzo https://", () => {
    const webhook = (patch: Partial<CrmExportConfig["webhook"]>) =>
      config({ webhook: { ...DEFAULT_CRM_EXPORT_CONFIG.webhook, ...patch } });
    for (const url of ["", "http://crm.example.com/hook", "https://", "https://crm example.com", "ftp://crm.example.com"]) {
      expect(issues(webhook({ enabled: true, url })), url).toEqual([
        { path: "webhook.url", message: "Indica un indirizzo https://" },
      ]);
    }
    expect(issues(webhook({ enabled: true, url: "https://crm.example.com/hook?x=1", secret: "s3cr3t" }))).toEqual([]);
    expect(issues(webhook({ enabled: true, url: "  https://crm.example.com/hook  " }))).toEqual([]);
    // Disattivato: l'indirizzo non viene controllato (si può salvare una bozza).
    expect(issues(webhook({ enabled: false, url: "http://bozza" }))).toEqual([]);
  });

  it("nome del file: lettere, numeri, spazi, - _ . e {mese}; niente percorsi", () => {
    for (const fileName of ["m2-campioni-{mese}", "Export CRM {mese}", "m2_{mese}.v2"]) {
      expect(issues(config({ fileName })), fileName).toEqual([]);
    }
    for (const fileName of ["../m2", "cartella/m2", "m2\\x", "m2:{mese}", "m2*"]) {
      expect(issues(config({ fileName })), fileName).toEqual([
        { path: "fileName", message: "Usa solo lettere, numeri, spazi, - _ . e {mese}" },
      ]);
    }
    expect(issues(config({ fileName: "   " })).map((i) => i.message)).toContain("Indica il nome del file");
  });
});

describe("raggruppamenti per marchio e per categoria", () => {
  it("etichette, colonne disponibili e valori del raggruppamento", () => {
    expect(CRM_GROUPS).toEqual(["PRODOTTO", "PRODOTTO_CLIENTE", "CLIENTE", "AGENTE", "MARCHIO", "CATEGORIA"]);
    expect(GROUPS.toSorted()).toEqual([...CRM_GROUPS].sort());
    expect(CRM_GROUP_BY_LABELS.MARCHIO).toBe("Per marchio");
    expect(CRM_GROUP_BY_LABELS.CATEGORIA).toBe("Per categoria");
    expect(CRM_COLUMNS_BY_GROUP.MARCHIO).toEqual(["mese", "marchio", "richieste", "pezzi", "m2"]);
    expect(CRM_COLUMNS_BY_GROUP.CATEGORIA).toEqual(["mese", "categoria", "richieste", "pezzi", "m2"]);
    expect(CRM_MISSING_LABEL).toBe("Non indicato");
  });

  it("lo schema accetta i nuovi raggruppamenti e rifiuta le colonne di prodotto e cliente", () => {
    for (const groupBy of ["MARCHIO", "CATEGORIA"] as const) {
      const columns = CRM_COLUMNS_BY_GROUP[groupBy];
      expect(crmExportConfigSchema.parse(config({ groupBy, columns })).groupBy).toBe(groupBy);
      const res = crmExportConfigSchema.safeParse(config({ groupBy, columns: [...columns, "codice", "cliente"] }));
      expect(res.success).toBe(false);
      expect(res.error?.issues.map((i) => i.message)).toEqual(["Colonne non disponibili con questo raggruppamento: Codice, Cliente"]);
    }
    // marchio e categoria insieme: ciascun raggruppamento ha solo il proprio campo
    expect(crmExportConfigSchema.safeParse(config({ groupBy: "MARCHIO", columns: ["marchio", "categoria", "m2"] })).success).toBe(false);
    expect(crmExportConfigSchema.safeParse(config({ groupBy: "VALORE" as CrmGroupBy })).success).toBe(false);
  });

  it("configurazioni salvate prima dei nuovi raggruppamenti restano valide", () => {
    const saved = {
      ...DEFAULT_CRM_EXPORT_CONFIG,
      groupBy: "PRODOTTO",
      columns: ["codice", "descrizione", "marchio", "richieste", "pezzi", "m2"],
    };
    expect(crmExportConfigSchema.parse(saved)).toEqual(saved);
    expect(crmExportConfigSchema.parse({ ...saved, groupBy: "AGENTE", columns: ["mese", "agente", "m2"] }).groupBy).toBe("AGENTE");
  });

  it("CSV per marchio: una riga per marchio, «Non indicato» per i prodotti senza marchio", () => {
    const cfg = config({ groupBy: "MARCHIO", columns: CRM_COLUMNS_BY_GROUP.MARCHIO });
    const rows: CrmRow[] = [
      { mese: "2026-09", marchio: "Gaia Parquet", richieste: 3, pezzi: 7, m2: 2.5 },
      { mese: "2026-09", marchio: CRM_MISSING_LABEL, richieste: 1, pezzi: 1, m2: 0.125 },
    ];
    expect(lines(crmCsv(rows, cfg))).toEqual([
      "Mese;Marchio;Richieste;Pezzi;m2",
      `"=""2026-09""";Gaia Parquet;3;7;2,50`,
      `"=""2026-09""";Non indicato;1;1;0,13`,
    ]);
  });

  it("CSV per categoria con separatore «,» e punto decimale", () => {
    const cfg = config({ groupBy: "CATEGORIA", columns: ["categoria", "m2", "richieste"], separator: ",", decimal: "." });
    expect(lines(crmCsv([{ categoria: "Rivestimento, parete", m2: 1, richieste: 2 }], cfg))).toEqual([
      "Categoria,m2,Richieste",
      `"Rivestimento, parete",1.00,2`,
    ]);
  });

  it("colonne identificative e spiegazioni delle colonne nei nuovi raggruppamenti", () => {
    expect(CRM_KEY_COLUMNS.MARCHIO).toEqual([["marchio"]]);
    expect(CRM_KEY_COLUMNS.CATEGORIA).toEqual([["categoria"]]);
    expect(missingCrmKeyColumns("MARCHIO", ["mese", "m2"])).toEqual([["marchio"]]);
    expect(missingCrmKeyColumns("CATEGORIA", ["categoria", "m2"])).toEqual([]);
    for (const groupBy of CRM_GROUPS) expect(CRM_KEY_COLUMNS[groupBy].length, groupBy).toBeGreaterThan(0);

    expect(crmColumnHint("marchio", "MARCHIO")).toBe("Dall'anagrafica prodotti; «Non indicato» per i prodotti senza marchio");
    expect(crmColumnHint("categoria", "CATEGORIA")).toBe("Dall'anagrafica prodotti; «Non indicato» per i prodotti senza categoria");
    // per prodotto la cella resta vuota se il valore manca
    expect(crmColumnHint("marchio", "PRODOTTO")).toBe(CRM_COLUMN_HINTS.marchio);
    expect(crmColumnHint("m2", "MARCHIO")).toBe(CRM_COLUMN_HINTS.m2);
  });
});

describe("crmFileName", () => {
  it("{mese} sostituito ed estensione secondo il formato", () => {
    expect(crmFileName(DEFAULT_CRM_EXPORT_CONFIG, "2026-09")).toBe("m2-campioni-2026-09.csv");
    expect(crmFileName(config({ format: "XLSX" }), "2026-09")).toBe("m2-campioni-2026-09.xlsx");
    expect(crmFileName(config({ fileName: "CRM {mese} ({mese})" }), "2026-01")).toBe("CRM 2026-01 (2026-01).csv");
    expect(crmFileName(config({ fileName: "export-crm" }), "2026-01")).toBe("export-crm.csv");
  });

  it("nome vuoto: nome predefinito con il mese", () => {
    expect(crmFileName(config({ fileName: "  " }), "2026-09")).toBe("m2-campioni-2026-09.csv");
    expect(crmFileName(config({ fileName: "", format: "XLSX" }), "2026-09")).toBe("m2-campioni-2026-09.xlsx");
  });
});
