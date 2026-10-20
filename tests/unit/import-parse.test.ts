import { describe, expect, it } from "vitest";
import {
  agentKey,
  cleanAddress,
  countryFromAddress,
  customerKey,
  normalizeEmails,
  normalizeLanguage,
  parseContactRows,
  parseCsv,
  parseProductRows,
  type RawRow,
} from "@/lib/import/parse";

/** Riga con le intestazioni dell'export Airtable di BGP (Lista_clienti_Airtable.xlsx). */
function airtable(
  name: string,
  email: string,
  address: string,
  agentName: string,
  agentEmail: string,
  language: string | null,
): RawRow {
  return {
    Name: name,
    Email: email,
    "Default address": address,
    "Agent name": agentName,
    "Agent email (cc)": agentEmail,
    Language: language,
  };
}

// Righe copiate (con i loro difetti) dal file reale dei contatti.
const ROWS: RawRow[] = [
  airtable(
    "BRAVIA HOME PRO SNC di Ferri Giorgio & C.",
    "info@braviacasa.example;",
    "LOCALITA' PIE DI FONTANELLE SNC, 19015 LEVANTO (SP)",
    "LOMBARDI  S.N.C. DI P. E F. LOMBARDI",
    "info@lombardiagenzie.example",
    "Italiano",
  ),
  airtable(
    "CORVINO SRL",
    "info@corvino.example;fatture.fornitori@corvino.example;",
    "VIA F. MERCANTI, 46/R, 16143 GENOVA (GE)",
    "LOMBARDI  S.N.C. DI P. E F. LOMBARDI",
    "info@lombardiagenzie.example",
    "Italiano",
  ),
  airtable(
    "KMB HANDELS GMBH",
    "office@fliesenhaus.example",
    "HANDELSSTRASSE 1/HALLE/E.E.24 91, 2100 KORNEUBURG ()",
    "VERDI ANDREA",
    "m.verdi@posta.example",
    "Deutsch",
  ),
  airtable(
    "ATLAS NOVEN TRADING INTERNATIONAL",
    "atlas.trading@posta.example",
    "VDN NORD EN FACE ST. MARCEL, 12710 DAKAR ()",
    "MARIO SERENI",
    "l.sereni@posta.example;msereni@posta.example",
    "English",
  ),
  airtable(
    "UNION DECORS SAS",
    "contact@union-decors.example",
    "AVENUE DE LAVANDES 287 CS 19001, 34965 MONTPELLIER CEDEX 2 ()",
    "H.A PRESTIGE SASU",
    "hprestige@posta.example",
    "Français",
  ),
  airtable(
    "ARREDO NOVA SRL",
    "direzione@arredonova.example;amministrazione@arredonova.example;info@arredonova.example;",
    "VIA SANT AMBROGIO, 5/A, 24020 PARRE (BG)",
    "",
    "",
    "Italiano",
  ),
  airtable(
    "LA PINETA di Gallo Paolo & C. SAS",
    "",
    "VIA GELSI DEL MOLINO 77, 17023 CERIALE (SV)",
    "LOMBARDI  S.N.C. DI P. E F. LOMBARDI",
    "info@lombardiagenzie.example",
    null,
  ),
  airtable("K.L.M. LTD", "office@klm-ltd.example", "", "MARIO SERENI", "l.sereni@posta.example;", "English"),
  airtable("DI GALLINI STEFANO", "", "VIA CASTAGNETO 32, 54035 FOSDINOVO (MS)", "", "", "Italiano"),
  // Duplicato (stesso nome e indirizzo, grafia diversa) → scartato.
  airtable("Di Gallini  Stefano", "stefano@example.it", "via Castagneto 32 54035 Fosdinovo (MS)", "", "", "Italiano"),
  // Stesso nome, indirizzo diverso → è un altro punto vendita, si tiene.
  airtable("DI GALLINI STEFANO", "", "VIA ROMA 1, 54035 FOSDINOVO (MS)", "", "", "Italiano"),
  // Nome mancante ma riga non vuota → scartata con motivo.
  airtable("", "orfano@example.it", "VIA X 1, 24020 GROMO (BG)", "", "", "Italiano"),
  // Riga completamente vuota → ignorata senza segnalazioni.
  airtable("", "", "", "", "", null),
];

describe("parseContactRows — clienti", () => {
  const { customers } = parseContactRows(ROWS);
  const byName = (name: string, address?: string) =>
    customers.rows.find((c) => c.name === name && (address === undefined || c.defaultAddress === address));

  it("importa le righe valide e scarta duplicati e righe senza nome", () => {
    expect(customers.rows).toHaveLength(10);
    expect(customers.skipped).toEqual([
      { row: 11, reason: "Duplicato di un contatto già presente nel file (Di Gallini Stefano)" },
      { row: 13, reason: "Nome mancante" },
    ]);
  });

  it("email multiple con ';' finale → lista normalizzata", () => {
    expect(byName("BRAVIA HOME PRO SNC di Ferri Giorgio & C.")?.email).toBe("info@braviacasa.example");
    expect(byName("CORVINO SRL")?.email).toBe("info@corvino.example; fatture.fornitori@corvino.example");
    expect(byName("ARREDO NOVA SRL")?.email).toBe(
      "direzione@arredonova.example; amministrazione@arredonova.example; info@arredonova.example",
    );
    expect(byName("LA PINETA di Gallo Paolo & C. SAS")?.email).toBeNull();
  });

  it("indirizzo italiano con sigla di provincia → paese Italia", () => {
    const c = byName("CORVINO SRL");
    expect(c?.defaultAddress).toBe("VIA F. MERCANTI, 46/R, 16143 GENOVA (GE)");
    expect(c?.country).toBe("Italia");
  });

  it("indirizzo estero «… ()» → '()' tolto e paese non indicato", () => {
    const c = byName("KMB HANDELS GMBH");
    expect(c?.defaultAddress).toBe("HANDELSSTRASSE 1/HALLE/E.E.24 91, 2100 KORNEUBURG");
    expect(c?.country).toBeNull();
    expect(byName("ATLAS NOVEN TRADING INTERNATIONAL")?.defaultAddress).toBe("VDN NORD EN FACE ST. MARCEL, 12710 DAKAR");
  });

  it("indirizzo mancante → null", () => {
    const c = byName("K.L.M. LTD");
    expect(c?.defaultAddress).toBeNull();
    expect(c?.country).toBeNull();
  });

  it("lingua: Italiano/English/Français/Deutsch; mancante → null (decide l'import, da verificare)", () => {
    expect(byName("CORVINO SRL")?.language).toBe("it");
    expect(byName("ATLAS NOVEN TRADING INTERNATIONAL")?.language).toBe("en");
    expect(byName("UNION DECORS SAS")?.language).toBe("fr");
    expect(byName("KMB HANDELS GMBH")?.language).toBe("de");
    expect(byName("LA PINETA di Gallo Paolo & C. SAS")).toMatchObject({ language: null, languageRaw: "" });
  });

  it("numero di riga del file e paese ricavato dall'indirizzo", () => {
    expect(byName("CORVINO SRL")).toMatchObject({ row: 3, country: "Italia", countryDerived: true });
    expect(byName("K.L.M. LTD")).toMatchObject({ row: 9, country: null, countryDerived: true });
  });

  it("cliente senza agente = cliente direzionale (agentKey null)", () => {
    expect(byName("ARREDO NOVA SRL")?.agentKey).toBeNull();
    expect(byName("DI GALLINI STEFANO", "VIA ROMA 1, 54035 FOSDINOVO (MS)")?.agentKey).toBeNull();
  });

  it("stesso nome con indirizzo diverso: due contatti distinti", () => {
    expect(customers.rows.filter((c) => c.name === "DI GALLINI STEFANO")).toHaveLength(2);
  });
});

describe("parseContactRows — agenti", () => {
  const { agents, customers } = parseContactRows(ROWS);
  const agent = (key: string) => agents.find((a) => a.key === key);

  it("un agente per email, anche se compare su più righe", () => {
    expect(agents.map((a) => a.key).sort()).toEqual([
      "email:hprestige@posta.example",
      "email:info@lombardiagenzie.example",
      "email:l.sereni@posta.example",
      "email:m.verdi@posta.example",
    ]);
  });

  it("nome dell'agente con spazi doppi normalizzato", () => {
    expect(agent("email:info@lombardiagenzie.example")).toEqual({
      key: "email:info@lombardiagenzie.example",
      name: "LOMBARDI S.N.C. DI P. E F. LOMBARDI",
      email: "info@lombardiagenzie.example",
      row: 2,
    });
  });

  it("agente con più email: chiave dalla prima, tutte le email salvate", () => {
    expect(agent("email:l.sereni@posta.example")?.email).toBe("l.sereni@posta.example; msereni@posta.example");
    // "K.L.M. LTD" ha solo la prima email dell'agente: stessa chiave, stesso agente.
    expect(customers.rows.find((c) => c.name === "K.L.M. LTD")?.agentKey).toBe("email:l.sereni@posta.example");
  });

  it("i clienti puntano alla chiave del proprio agente", () => {
    const keys = new Set(agents.map((a) => a.key));
    for (const c of customers.rows) {
      if (c.agentKey) expect(keys.has(c.agentKey), c.name).toBe(true);
    }
    expect(customers.rows.find((c) => c.name === "CORVINO SRL")?.agentKey).toBe("email:info@lombardiagenzie.example");
  });

  it("agente senza email: chiave dal nome normalizzato", () => {
    expect(agentKey("Rossi  Mario", null)).toBe("name:ROSSI MARIO");
    expect(agentKey("Rossi Mario", "M.Rossi@Example.it; altro@example.it")).toBe("email:m.rossi@example.it");
  });
});

describe("parseContactRows — intestazioni alternative", () => {
  it("riconosce intestazioni italiane e paese esplicito", () => {
    const { agents, customers } = parseContactRows([
      {
        Nome: "Studio Bianchi",
        "E-mail": "studio@bianchi.ch",
        Indirizzo: "Via Centrale 31, 6928 Manno ()",
        Agente: "Alpicem Sagl",
        "Email agente": "info@alpicem.example;",
        Lingua: " tedesco ",
        Telefono: "+41 91 000 00 00",
        Paese: "Svizzera",
      },
    ]);
    expect(customers.rows[0]).toMatchObject({
      name: "Studio Bianchi",
      email: "studio@bianchi.ch",
      defaultAddress: "Via Centrale 31, 6928 Manno",
      country: "Svizzera",
      countryDerived: false,
      language: "de",
      phone: "+41 91 000 00 00",
      agentKey: "email:info@alpicem.example",
    });
    expect(agents).toEqual([{ key: "email:info@alpicem.example", name: "Alpicem Sagl", email: "info@alpicem.example", row: 2 }]);
  });

  it("lingua non riconosciuta → null con il valore originale", () => {
    const { customers } = parseContactRows([{ Name: "Ditta ES", Language: "Español" }]);
    expect(customers.rows[0]).toMatchObject({ language: null, languageRaw: "Español" });
  });

  it("valori di cella exceljs con { text }", () => {
    const { customers } = parseContactRows([{ Name: { text: "Ditta Link" }, Email: { text: "info@ditta.it" } }]);
    expect(customers.rows[0]).toMatchObject({ name: "Ditta Link", email: "info@ditta.it" });
  });
});

describe("helper di normalizzazione", () => {
  it("normalizeLanguage", () => {
    expect(normalizeLanguage("Italiano")).toBe("it");
    expect(normalizeLanguage("English")).toBe("en");
    expect(normalizeLanguage("Français")).toBe("fr");
    expect(normalizeLanguage("francais")).toBe("fr");
    expect(normalizeLanguage("Deutsch")).toBe("de");
    expect(normalizeLanguage(" EN ")).toBe("en");
    expect(normalizeLanguage("Español")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(42)).toBeNull();
  });

  it("cleanAddress", () => {
    expect(cleanAddress("RUA 5 DE MAIO 502, 4700-260 FROSSOS - BRAGA ()")).toBe("RUA 5 DE MAIO 502, 4700-260 FROSSOS - BRAGA");
    expect(cleanAddress("VIA ROMA 1,, 24023  CLUSONE (BG)")).toBe("VIA ROMA 1, 24023 CLUSONE (BG)");
    expect(cleanAddress("  ")).toBeNull();
    expect(cleanAddress(null)).toBeNull();
  });

  it("countryFromAddress: Italia solo con sigla di provincia italiana e CAP a 5 cifre", () => {
    expect(countryFromAddress("VIA ROSSINI 33, 17028 SPOTORNO (SV)")).toBe("Italia");
    expect(countryFromAddress("VIA ROSSINI 33, 17028 SPOTORNO (SV)  ")).toBe("Italia");
    // (CH) è anche Chieti: con CAP a 5 cifre resta Italia
    expect(countryFromAddress("VIA TRONTO 108, 66020 SAN GIOVANNI TEATINO (CH)")).toBe("Italia");
    // CAP segnaposto 00000 con sigla di provincia: resta Italia
    expect(countryFromAddress("VIA DEL CASALE DI ROCCANOVA 108, 00000 ROMA (RM)")).toBe("Italia");
    expect(countryFromAddress("QUAI JEAN - CHARLES LEROY 32, 98000 MONACO ()")).toBeNull();
    expect(countryFromAddress("14 AVENUE DE VERDUN, 06230 SAINT JEAN CAP FERRAT")).toBeNull();
    expect(countryFromAddress(null)).toBeNull();
  });

  it("countryFromAddress: sigle estere del file BGP", () => {
    // (EE) = Escursionisti Esteri: mai Italia, anche con CAP a 5 cifre
    expect(countryFromAddress("BAGDAT CAD 120, 34744 ISTANBUL (EE)")).toBeNull();
    expect(countryFromAddress("Suite 210, ground floor, Harbour Building,, 00000 Belize city (EE)")).toBeNull();
    expect(countryFromAddress("DRAZICE GORNJI 17 22B, 51218 DRAZICE (HR)")).toBe("Croazia");
    expect(countryFromAddress("ISTARSKA 32, 09010 PULA (HR)")).toBe("Croazia");
    expect(countryFromAddress("VIA 5 FEBBRAIO 77, 47899 SERRAVALLE (SM)")).toBe("San Marino");
    expect(countryFromAddress("SEESTRASSE 17, 2558 AEGERTEN (CH)")).toBe("Svizzera");
    expect(countryFromAddress("VIA VELA 12, 6830 CHIASSO (TI)")).toBe("Svizzera");
    expect(countryFromAddress("BLUMENSTRASSE 22, 8330 PAEFFIKON (ZH) ()")).toBe("Svizzera");
    // sigla di una provincia italiana ma CAP non italiano (Slovenia, Bosnia)
    expect(countryFromAddress("PODGORJE 43 A, 6273 MAREZIGE (SI)")).toBeNull();
    expect(countryFromAddress("POLJE BB, 8500 GORNJE POLJE (MO)")).toBeNull();
    // sigla che non è una provincia italiana
    expect(countryFromAddress("AN DER LINDE 7, 60388 FRANCOFORTE (DE)")).toBeNull();
  });

  it("countryFromAddress: provincia vuota «()» → Italia solo con via italiana, CAP a 5 cifre e lingua italiana", () => {
    expect(countryFromAddress("VIA DEI MILLE, 12, 80121 NAPOLI ()")).toBe("Italia");
    expect(countryFromAddress("VIA DEI MILLE, 12, 80121 NAPOLI ()", "it")).toBe("Italia");
    expect(countryFromAddress("VIA RIPENDA 214, 52220 LABIN ()", "en")).toBeNull();
    expect(countryFromAddress("VIA CENTRALE 36, 6928 MANNO ()")).toBeNull();
  });

  it("normalizeEmails", () => {
    expect(normalizeEmails("a@x.it;b@y.it;")).toBe("a@x.it; b@y.it");
    expect(normalizeEmails("NO MAIL  - NO COMPUTER")).toBeNull();
    expect(normalizeEmails(undefined)).toBeNull();
  });

  it("customerKey ignora maiuscole, punteggiatura e spazi", () => {
    expect(customerKey("Di Gallini  Stefano", "via Castagneto 32 54035 Fosdinovo (MS)")).toBe(
      customerKey("DI GALLINI STEFANO", "VIA CASTAGNETO 32, 54035 FOSDINOVO (MS)"),
    );
    expect(customerKey("A", null)).not.toBe(customerKey("A", "VIA ROMA 1"));
  });
});

describe("parseProductRows", () => {
  it("legge codice e descrizione estesa, comprimendo gli spazi", () => {
    const { rows, skipped } = parseProductRows([
      {
        Codice_articolo: " 10120D001 ",
        Descrizione_articolo_estesa: "Pavimento in legno 2 strati  in essenza Doussié, finitura vernice UV NEUTRO ,  misura 10/4x120x600/1500mm",
      },
      { Codice_articolo: "10120D001ITA", Descrizione_articolo_estesa: "0 Doussie 2 strati verniciato liscio AB 10x120 mm M/F, spigolo vivo" },
    ]);
    expect(skipped).toEqual([]);
    expect(rows).toEqual([
      {
        code: "10120D001",
        description: "Pavimento in legno 2 strati in essenza Doussié, finitura vernice UV NEUTRO , misura 10/4x120x600/1500mm",
        brand: null,
        category: null,
      },
      {
        code: "10120D001ITA",
        description: "0 Doussie 2 strati verniciato liscio AB 10x120 mm M/F, spigolo vivo",
        brand: null,
        category: null,
      },
    ]);
  });

  it("codice mancante: scartato se la riga ha una descrizione, ignorato se vuota", () => {
    const { rows, skipped } = parseProductRows([
      { Codice_articolo: "", Descrizione_articolo_estesa: "Prodotto senza codice" },
      { Codice_articolo: "", Descrizione_articolo_estesa: "" },
      { Codice_articolo: "X1", Descrizione_articolo_estesa: "" },
    ]);
    expect(rows).toEqual([{ code: "X1", description: "", brand: null, category: null }]);
    expect(skipped).toEqual([{ row: 2, reason: "Codice articolo mancante" }]);
  });

  it("codici numerici e intestazioni alternative", () => {
    const { rows } = parseProductRows([{ Codice: 12345, Descrizione: "Rovere" }, { SKU: "AB-1", Description: "Noce" }]);
    expect(rows).toEqual([
      { code: "12345", description: "Rovere", brand: null, category: null },
      { code: "AB-1", description: "Noce", brand: null, category: null },
    ]);
  });

  it("colonne facoltative Marchio e Categoria (vuote → null)", () => {
    const { rows } = parseProductRows([
      { Codice_articolo: "10150E1", Descrizione_articolo_estesa: "Rovere Essence", Marchio: " Gaia  Parquet ", Categoria: "Prefinito" },
      { Codice: "AB-1", Descrizione: "Noce", Brand: "", Category: "" },
    ]);
    expect(rows).toEqual([
      { code: "10150E1", description: "Rovere Essence", brand: "Gaia Parquet", category: "Prefinito" },
      { code: "AB-1", description: "Noce", brand: null, category: null },
    ]);
  });

  it("codice duplicato (senza distinzione maiuscole): la riga segnalata come scartata non viene importata", () => {
    const { rows, skipped } = parseProductRows([
      { Codice_articolo: "10120D001", Descrizione_articolo_estesa: "Prima descrizione" },
      { Codice_articolo: "10120d001", Descrizione_articolo_estesa: "Seconda descrizione" },
    ]);
    expect(skipped).toEqual([{ row: 3, reason: "Codice duplicato 10120d001" }]);
    expect(rows).toEqual([{ code: "10120D001", description: "Prima descrizione", brand: null, category: null }]);
  });
});

describe("parseCsv", () => {
  it("separatore ';' (Excel italiano)", () => {
    expect(parseCsv("Name;Email;Language\nCORVINO SRL;info@corvino.example;Italiano\n")).toEqual([
      { Name: "CORVINO SRL", Email: "info@corvino.example", Language: "Italiano" },
    ]);
  });

  it("separatore ','", () => {
    expect(parseCsv("Codice_articolo,Descrizione_articolo_estesa\nX1,Rovere\n")).toEqual([
      { Codice_articolo: "X1", Descrizione_articolo_estesa: "Rovere" },
    ]);
  });

  it("campi tra virgolette con separatori, a capo e virgolette raddoppiate", () => {
    const csv = [
      "Codice;Descrizione;Note",
      '"X1";"Rovere; spazzolato";"Riga 1',
      'Riga 2"',
      'X2;"Noce ""Canaletto""";""',
    ].join("\n");
    expect(parseCsv(csv)).toEqual([
      { Codice: "X1", Descrizione: "Rovere; spazzolato", Note: "Riga 1\nRiga 2" },
      { Codice: "X2", Descrizione: 'Noce "Canaletto"', Note: "" },
    ]);
  });

  it("virgole dentro le virgolette con separatore ','", () => {
    expect(parseCsv('Name,Default address\n"ROSSI SRL","VIA ROMA 1, 24023 CLUSONE (BG)"')).toEqual([
      { Name: "ROSSI SRL", "Default address": "VIA ROMA 1, 24023 CLUSONE (BG)" },
    ]);
  });

  it("BOM iniziale, CRLF, righe vuote e intestazioni con spazi", () => {
    const csv = "﻿ Name ;Email\r\nA;a@x.it\r\n\r\n;\r\nB;b@y.it\r\n";
    expect(parseCsv(csv)).toEqual([
      { Name: "A", Email: "a@x.it" },
      { Name: "B", Email: "b@y.it" },
    ]);
  });

  it("campi finali mancanti → stringa vuota; ultima riga senza a capo", () => {
    expect(parseCsv("A;B;C\n1;2\n3;4;5")).toEqual([
      { A: "1", B: "2", C: "" },
      { A: "3", B: "4", C: "5" },
    ]);
  });

  it("testo vuoto o solo intestazione → nessuna riga", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("﻿")).toEqual([]);
    expect(parseCsv("Name;Email\n")).toEqual([]);
  });

  it("CSV → parseContactRows", () => {
    const csv = "﻿Name;Email;Default address;Agent name;Agent email (cc);Language\n" +
      'LEGNOARTE SRL;legnoarte@posta.example;;"LOMBARDI  S.N.C. DI P. E F. LOMBARDI";info@lombardiagenzie.example;Italiano\n';
    const { agents, customers } = parseContactRows(parseCsv(csv));
    expect(customers.rows).toHaveLength(1);
    expect(customers.rows[0]).toMatchObject({ name: "LEGNOARTE SRL", email: "legnoarte@posta.example", defaultAddress: null });
    expect(agents[0].name).toBe("LOMBARDI S.N.C. DI P. E F. LOMBARDI");
  });
});
