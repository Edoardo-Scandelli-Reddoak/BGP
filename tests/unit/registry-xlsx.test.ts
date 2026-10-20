import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { collectionFromDescription, productTypeFromDescription } from "@/lib/exports/product-hints";
import {
  bgpEmailList,
  xlsxText,
  buildContactsWorkbook,
  buildProductsWorkbook,
  CONTACT_EXPORT_COLUMNS,
  PRODUCT_EXPORT_COLUMNS,
  type ContactExportRow,
  type ProductExportRow,
} from "@/lib/exports/registry-xlsx";
import { agentKey, parseContactRows, parseProductRows } from "@/lib/import/parse";
import { readTabularFile } from "@/lib/import/read-file";

const CONTACTS: ContactExportRow[] = [
  {
    name: "CORVINO SRL",
    email: "info@corvino.example; fatture.fornitori@corvino.example",
    defaultAddress: "VIA F. MERCANTI, 46/R, 16143 GENOVA (GE)",
    agentName: "LOMBARDI S.N.C. DI P. E F. LOMBARDI",
    agentEmail: "info@lombardiagenzie.example",
    language: "it",
    country: "Italia",
    phone: "0354567890",
  },
  {
    name: "Holzbau Müller & Co. AG",
    email: "info@holzbau-mueller.example",
    defaultAddress: "Bahnhofstrasse 12, 8001 Zürich (ZH)",
    agentName: "Mike Bergamini",
    agentEmail: "m.bergamini@posta.example",
    language: "de",
    country: "Svizzera",
    phone: "+41 44 123 45 67",
  },
  {
    name: "Parquet Côte d'Azur",
    email: null,
    defaultAddress: "12 Rue de France, 06000 Nice",
    agentName: null,
    agentEmail: null,
    language: "fr",
    country: null,
    phone: null,
  },
  {
    // sequenza letterale «_x001F_» come nel file Airtable di BGP: deve restare testo
    name: "GALLI SILVIA",
    email: "manu_x001F__x001F__galli@posta.example",
    defaultAddress: "VIA ROMA 1, 24100 BERGAMO (BG)",
    agentName: null,
    agentEmail: null,
    language: "it",
    country: "Italia",
    phone: null,
  },
  {
    name: "Timber Works Ltd",
    email: "sales@timberworks.example",
    defaultAddress: "1 High Street, London",
    agentName: "Mike Bergamini",
    agentEmail: "m.bergamini@posta.example",
    language: "en",
    country: "Regno Unito",
    phone: null,
  },
];

const PRODUCTS: ProductExportRow[] = [
  {
    code: "10120D001",
    description: "Pavimento in legno 2 strati in essenza Doussié, collezione WOOD 10mm, scelta AB",
    brand: "Gaia Parquet",
    category: "Legno",
    pricePerM2: 45.5,
    active: true,
  },
  { code: "00123", description: "Battiscopa in PVC espanso 12x70x2400mm", brand: null, category: null, pricePerM2: null, active: false },
  { code: "10150E1", description: "Pavimento SPC Smart Core, collezione SVR5", brand: "SmartFloors", category: "SPC", pricePerM2: 1234.56, active: true },
  { code: "MAZZ", description: "Mazzetta colori", brand: null, category: "Accessori", pricePerM2: 12, active: true },
];

async function headers(data: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.worksheets[0].getRow(1).eachCell((cell) => out.push(cell.text));
  return out;
}

describe("export contatti in Excel (formato dell'import)", () => {
  it("scrive le intestazioni del file Airtable di BGP, nell'ordine", async () => {
    const data = await buildContactsWorkbook(CONTACTS);
    expect(await headers(data)).toEqual([
      "Name",
      "Email",
      "Default address",
      "Agent name",
      "Agent email (cc)",
      "Language",
      "Country",
      "Phone",
    ]);
    expect(CONTACT_EXPORT_COLUMNS.map((c) => c.header)).toEqual(await headers(data));
  });

  it("reimportato con il lettore e il parser dell'import restituisce gli stessi valori", async () => {
    const data = await buildContactsWorkbook(CONTACTS);
    const rows = await readTabularFile("contatti.xlsx", data);
    expect(rows).toHaveLength(CONTACTS.length);
    // email e lingua come le scrive BGP
    expect(rows[0].Email).toBe("info@corvino.example;fatture.fornitori@corvino.example;");
    expect(rows.map((r) => r.Language)).toEqual(["Italiano", "Deutsch", "Français", "Italiano", "English"]);

    const { agents, customers } = parseContactRows(rows);
    expect(customers.skipped).toEqual([]);
    expect(customers.rows).toHaveLength(CONTACTS.length);
    customers.rows.forEach((parsed, i) => {
      const src = CONTACTS[i];
      expect(parsed.name).toBe(src.name);
      expect(parsed.email).toBe(src.email);
      expect(parsed.defaultAddress).toBe(src.defaultAddress);
      expect(parsed.language).toBe(src.language);
      expect(parsed.phone).toBe(src.phone);
      expect(parsed.agentKey).toBe(src.agentName ? agentKey(src.agentName, src.agentEmail) : null);
      if (src.country) {
        expect(parsed.country).toBe(src.country);
        expect(parsed.countryDerived).toBe(false);
      } else {
        // cella vuota: l'import ricava il paese dall'indirizzo e non sovrascrive quello salvato
        expect(parsed.countryDerived).toBe(true);
      }
    });
    // un solo agente per i due clienti di Mike Bergamini
    expect(agents.map((a) => [a.name, a.email])).toEqual([
      ["LOMBARDI S.N.C. DI P. E F. LOMBARDI", "info@lombardiagenzie.example"],
      ["Mike Bergamini", "m.bergamini@posta.example"],
    ]);
  });

  it("formatta il foglio: intestazione in grassetto e bloccata, filtri, celle di testo", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildContactsWorkbook(CONTACTS)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    // telefono come testo: lo zero iniziale resta
    expect(ws.getCell("H2").value).toBe("0354567890");
    expect(ws.getCell("H2").numFmt).toBe("@");
  });

  it("un elenco vuoto produce solo l'intestazione", async () => {
    const data = await buildContactsWorkbook([]);
    expect(await headers(data)).toHaveLength(8);
    expect(await readTabularFile("contatti.xlsx", data)).toEqual([]);
  });
});

describe("export prodotti in Excel (formato dell'import)", () => {
  it("scrive le colonne del listino più marchio, categoria, prezzo e attivo", async () => {
    const data = await buildProductsWorkbook(PRODUCTS);
    expect(await headers(data)).toEqual(["Codice_articolo", "Descrizione_articolo_estesa", "Marchio", "Categoria", "Prezzo_m2", "Attivo"]);
    expect(PRODUCT_EXPORT_COLUMNS.map((c) => c.header)).toEqual(await headers(data));
  });

  it("reimportato restituisce codice, descrizione, marchio, categoria, prezzo e attivo invariati", async () => {
    const data = await buildProductsWorkbook(PRODUCTS, { brands: ["SmartFloors", "Gaia Parquet"], categories: ["Legno"] });
    const parsed = parseProductRows(await readTabularFile("prodotti.xlsx", data));
    expect(parsed.skipped).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toEqual(
      PRODUCTS.map((p) => ({
        code: p.code,
        description: p.description,
        brand: p.brand,
        category: p.category,
        ...(p.pricePerM2 === null ? {} : { pricePerM2: p.pricePerM2 }),
        active: p.active,
      })),
    );
  });

  it("tiene i codici come testo e propone marchio e categoria senza bloccare altri valori", async () => {
    const wb = new ExcelJS.Workbook();
    const data = await buildProductsWorkbook(PRODUCTS, {
      brands: ["SmartFloors", "Gaia Parquet", "AFAP", "Valore, con virgola"],
      categories: ["Legno", "SPC"],
    });
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A3").value).toBe("00123");
    expect(ws.getCell("A3").numFmt).toBe("@");
    expect(ws.getCell("E2").value).toBe(45.5);
    expect(ws.getCell("E3").value).toBeNull();
    // la regola dell'intervallo C2:C5 viene riletta cella per cella
    const brand = ws.getCell("C5").dataValidation;
    expect(brand).toMatchObject({ type: "list", formulae: ['"SmartFloors,Gaia Parquet,AFAP"'] });
    expect(brand.showErrorMessage).toBeFalsy();
    expect(ws.getCell("D2").dataValidation).toMatchObject({ type: "list", formulae: ['"Legno,SPC"'] });
    expect(ws.getCell("C6").dataValidation).toBeUndefined();
  });
});

describe("testo delle celle", () => {
  it("protegge le sequenze _xHHHH_ letterali", () => {
    expect(xlsxText("manu_x001F__galli@posta.example")).toBe("manu_x005F_x001F__galli@posta.example");
    expect(xlsxText("SNC_x_y")).toBe("SNC_x_y");
    expect(xlsxText("")).toBeNull();
  });

  it("rilette con exceljs, le sequenze letterali restano invariate anche se consecutive", async () => {
    const values = ["manu_x001F__x001F__galli@posta.example", "A_x0041_x0042_B", "già protetto _x005F_x001F_", "_x000D_"];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    values.forEach((v) => ws.addRow([xlsxText(v)]));
    const back = new ExcelJS.Workbook();
    await back.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(values.map((_, i) => back.worksheets[0].getCell(i + 1, 1).text)).toEqual(values);
  });
});

describe("indirizzi email nel formato di BGP", () => {
  it("separa con «;» e termina con «;» come il file Airtable", () => {
    expect(bgpEmailList("a@x.it; b@y.it")).toBe("a@x.it;b@y.it;");
    expect(bgpEmailList("a@x.it")).toBe("a@x.it;");
    expect(bgpEmailList("")).toBeNull();
    expect(bgpEmailList(null)).toBeNull();
  });
});

describe("indizi dalla descrizione dei prodotti", () => {
  it("riconosce il tipo di prodotto dall'inizio della descrizione", () => {
    const cases: [string, string][] = [
      ["Pavimento in legno 2 strati in essenza Doussié, collezione NAIF 15", "Pavimento in legno"],
      ["0 Pavimento in legno supportato 2 strati retro multistrato", "Pavimento in legno"],
      ["LISTONCINO ROVERE \"A\" 14*75*350/400MM", "Pavimento in legno"],
      ["Doussié massello, scelta AB, 15x90x900/1100mm", "Pavimento in legno"],
      ["Pavimento SPC Smart Core RIGID CORE plancia unica, collezione SVR4", "Pavimento SPC"],
      ["Pavimento vinilico plancia unica, collezione Brussels", "Pavimento vinilico"],
      ["Pavimento melaminico AC4 plancia unica, collezione Bolero", "Pavimento melaminico"],
      ["STK Battiscopa imp.to Rovere verniciato 13x25mm", "Battiscopa"],
      ["Battiscopa in PVC espanso in abb. a pavimento vinilico", "Battiscopa"],
      ["Soglia di dilatazione in alluminio", "Soglia"],
      ["Kit soglia di compensazione alluminio", "Soglia"],
      ["Decking WPC alveolare BIANCO 25x150x2200mm", "Decking"],
      ["QUADROTTE IPE' PER ESTERNO 750x750mm", "Decking"],
      ["Mazzetta colori pavimenti in legno Essence 10150", "Mazzetta"],
      ["Pannelli campione collezione Scirocco 10120", "Pannello campione"],
      ["Espositore Campionatura collezione Essence 10150", "Espositore"],
      ["Profilo terminale NEBO in WPC WENGE", "Profilo"],
      ["ANGOLARE GRADINO BRONZO + SUPPORTO 7mm", "Angolare"],
      ["VEDI BSSV04! Battiscopa in PVC espanso", "Battiscopa"],
      ["Lavorazione in m2", "Altro"],
      ["", "Altro"],
    ];
    for (const [description, type] of cases) expect(productTypeFromDescription(description), description).toBe(type);
  });

  it("estrae la collezione in maiuscolo, fermandosi alla virgola o al dato successivo", () => {
    expect(collectionFromDescription("Pavimento in legno …, collezione NAIF 15, scelta AB")).toBe("NAIF 15");
    expect(collectionFromDescription("Pannelli campione collezione Essence 10150")).toBe("ESSENCE 10150");
    expect(collectionFromDescription('Pavimento …, collezione MATERIA scelta ABC -UNI "t", misura 14x190')).toBe("MATERIA");
    expect(collectionFromDescription("Pavimento …, collezione SVR5EVO.")).toBe("SVR5EVO");
    expect(collectionFromDescription("Battiscopa in PVC espanso")).toBeNull();
    expect(collectionFromDescription(null)).toBeNull();
  });
});
