import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { contacts, products } from "@/db/schema";
import type { RawRow } from "@/lib/import/parse";
import { cleanupTestData, dbTestsSkipReason, MARK_PREFIX } from "./fixtures";

/**
 * Import di contatti e prodotti (src/lib/import/import-db.ts) sul database locale:
 * lingua mancante, paese ricavato dall'indirizzo o dalla colonna Paese (nome italiano),
 * marchio e categoria facoltativi e allineati ai valori già in anagrafica.
 */

const SKIP_REASON = dbTestsSkipReason();
const RUN = `${MARK_PREFIX}IMP-${Date.now().toString(36)}`;

type ImportDb = typeof import("@/lib/import/import-db");

let db: DB;
let imp: ImportDb;

function row(name: string, address: string, language: string | null, extra: Record<string, string> = {}): RawRow {
  return {
    Name: `${RUN} ${name}`,
    Email: "",
    "Default address": address,
    "Agent name": `${RUN} Agente Svizzera`,
    "Agent email (cc)": "",
    Language: language,
    ...extra,
  };
}

async function contactByName(name: string) {
  const [c] = await db.select().from(contacts).where(eq(contacts.name, `${RUN} ${name}`));
  return c;
}

describe.skipIf(SKIP_REASON !== null)("import anagrafiche (integrazione con il database)", () => {
  beforeAll(async () => {
    ({ db } = await import("@/db"));
    imp = await import("@/lib/import/import-db");
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await cleanupTestData(db, RUN);
    } finally {
      await db.$client.end({ timeout: 5 });
    }
  });

  it("lingua mancante: nuovo contatto in italiano «da verificare» con avviso; agente senza lingua da verificare", async () => {
    const summary = await imp.importContacts([
      row("Ticino", "VIA VELA 12, 6830 CHIASSO (TI)", null),
      row("Berna", "LINDENSTRASSE 22, 3014 BERN ()", "Español"),
      row("Croazia", "MORSKA 5, 21000 SPLIT (HR)", "English", { "Agent name": "" }),
    ]);
    expect(summary).toMatchObject({ created: 3, updated: 0, agentsCreated: 1 });
    expect(summary.warnings.map((w) => w.row)).toEqual([2, 2, 3]);
    expect(summary.warnings.map((w) => w.reason)).toEqual([
      expect.stringMatching(/Agente .*: nessun cliente con la lingua indicata, impostato italiano/),
      expect.stringMatching(/Ticino: lingua mancante, impostato italiano — da verificare/),
      expect.stringMatching(/Berna: lingua «Español» non riconosciuta, impostato italiano/),
    ]);

    expect(await contactByName("Ticino")).toMatchObject({ language: "it", needsReview: true, country: "Svizzera" });
    expect(await contactByName("Berna")).toMatchObject({ language: "it", needsReview: true, country: null });
    expect(await contactByName("Croazia")).toMatchObject({ language: "en", needsReview: false, country: "Croazia" });
    expect(await contactByName("Agente Svizzera")).toMatchObject({ type: "AGENTE", language: "it", needsReview: true });
    // un solo avviso per i clienti rimasti senza paese (Berna), non uno per riga
    expect(summary.notes).toEqual([expect.stringMatching(/^1 cliente del file è senza paese: .*filtro Paese «Non indicato»/)]);
  });

  it("re-import: lingua vuota e paese ricavato non sovrascrivono le correzioni; la colonna Paese sì", async () => {
    const ticino = await contactByName("Ticino");
    await db.update(contacts).set({ language: "de", country: "Svizzera (TI)" }).where(eq(contacts.id, ticino.id));
    const croazia = await contactByName("Croazia");
    await db.update(contacts).set({ country: "Hrvatska" }).where(eq(contacts.id, croazia.id));

    const summary = await imp.importContacts([
      row("Ticino", "VIA VELA 12, 6830 CHIASSO (TI)", ""),
      row("Croazia", "MORSKA 5, 21000 SPLIT (HR)", "English", { "Agent name": "", Country: "Croazia" }),
    ]);
    expect(summary.created).toBe(0);
    // lingua vuota su un contatto esistente: si tiene quella in anagrafica, senza avvisi ripetuti
    expect(summary.warnings).toEqual([]);
    expect(await contactByName("Ticino")).toMatchObject({ language: "de", country: "Svizzera (TI)" });
    expect(await contactByName("Croazia")).toMatchObject({ country: "Croazia" });
    expect(summary.notes).toEqual([]);
  });

  it("colonna Paese: salvata col nome italiano; non riconosciuta → com'è con avviso; vuota → non cancella", async () => {
    let summary = await imp.importContacts([
      row("Parigi", "12 RUE DE LA PAIX, 75002 PARIS ()", "Français", { Country: "france" }),
      row("Lubiana", "IZANSKA CESTA 297, 1000 LJUBLJANA ()", "English", { Country: "SI" }),
      row("Refuso", "MORSKA 7, 21000 SPLIT ()", "English", { Country: "Croazzia" }),
      row("Senza paese", "AVENUE 1, 1000 BRUXELLES ()", "Français", { Country: "" }),
    ]);
    expect(summary).toMatchObject({ created: 4 });
    expect(summary.warnings).toEqual([
      { row: 4, reason: `${RUN} Refuso: paese «Croazzia» non riconosciuto, salvato com'è — controlla` },
    ]);
    expect(summary.notes).toEqual([expect.stringMatching(/^1 cliente del file è senza paese/)]);
    expect(await contactByName("Parigi")).toMatchObject({ country: "Francia", needsReview: false });
    expect(await contactByName("Lubiana")).toMatchObject({ country: "Slovenia" });
    expect(await contactByName("Refuso")).toMatchObject({ country: "Croazzia", needsReview: false });
    expect(await contactByName("Senza paese")).toMatchObject({ country: null });

    // re-import: la colonna corregge il refuso, le celle vuote non cancellano, «Belgique» completa il mancante
    summary = await imp.importContacts([
      row("Parigi", "12 RUE DE LA PAIX, 75002 PARIS ()", "Français", { Country: "" }),
      row("Refuso", "MORSKA 7, 21000 SPLIT ()", "English", { Country: "HR" }),
      row("Senza paese", "AVENUE 1, 1000 BRUXELLES ()", "Français", { Country: "Belgique" }),
    ]);
    expect(summary).toMatchObject({ created: 0, updated: 2, unchanged: 1, warnings: [], notes: [] });
    expect(await contactByName("Parigi")).toMatchObject({ country: "Francia" });
    expect(await contactByName("Refuso")).toMatchObject({ country: "Croazia" });
    expect(await contactByName("Senza paese")).toMatchObject({ country: "Belgio" });
  });

  it("prodotti: Marchio e Categoria facoltativi, le celle vuote non cancellano", async () => {
    const code = `${RUN}-P1`;
    let summary = await imp.importProducts([{ Codice_articolo: code, Descrizione_articolo_estesa: "Rovere", Marchio: "Gaia Parquet" }]);
    expect(summary).toMatchObject({ created: 1, warnings: [] });
    const [p] = await db.select().from(products).where(eq(products.code, code));
    expect(p).toMatchObject({ brand: "Gaia Parquet", category: null });

    summary = await imp.importProducts([{ Codice_articolo: code, Descrizione_articolo_estesa: "Rovere", Marchio: "", Categoria: "Prefinito" }]);
    expect(summary).toMatchObject({ created: 0, updated: 1 });
    summary = await imp.importProducts([{ Codice_articolo: code, Descrizione_articolo_estesa: "", Marchio: "" }]);
    expect(summary).toMatchObject({ updated: 0, unchanged: 1 });
    const [after] = await db.select().from(products).where(like(products.code, `${RUN}%`));
    expect(after).toMatchObject({ description: "Rovere", brand: "Gaia Parquet", category: "Prefinito" });
  });

  it("prodotti: Marchio e Categoria allineati ai valori già presenti (maiuscole, spazi, accenti) e coerenti nel file", async () => {
    // valori unici per questa esecuzione: il database è condiviso con altri test
    const brand = `${RUN} Marchio Città`;
    const category = `${RUN} Categoria`;
    await imp.importProducts([{ Codice_articolo: `${RUN}-B1`, Descrizione_articolo_estesa: "Rovere", Marchio: brand }]);

    const summary = await imp.importProducts([
      // stesso marchio scritto diversamente: diventa quello in anagrafica
      { Codice_articolo: `${RUN}-B2`, Descrizione_articolo_estesa: "Noce", Marchio: `  ${brand.toLowerCase()}`.replace("città", "CITTA") },
      // categoria nuova: le righe successive del file prendono la grafia della prima
      { Codice_articolo: `${RUN}-B3`, Descrizione_articolo_estesa: "Olmo", Categoria: category },
      { Codice_articolo: `${RUN}-B4`, Descrizione_articolo_estesa: "Faggio", Categoria: ` ${category.toUpperCase()}  ` },
      // prodotto esistente con lo stesso marchio in altra grafia: invariato
      { Codice_articolo: `${RUN}-B1`, Descrizione_articolo_estesa: "Rovere", Marchio: brand.toUpperCase().replace(" ", "   ") },
    ]);
    expect(summary).toMatchObject({ created: 3, updated: 0, unchanged: 1 });
    const rows = await db.select().from(products).where(like(products.code, `${RUN}-B%`));
    const byCode = new Map(rows.map((p) => [p.code, p]));
    expect(byCode.get(`${RUN}-B1`)).toMatchObject({ brand });
    expect(byCode.get(`${RUN}-B2`)).toMatchObject({ brand });
    expect(byCode.get(`${RUN}-B3`)).toMatchObject({ category });
    expect(byCode.get(`${RUN}-B4`)).toMatchObject({ category });
  });

  it("prodotti: con due grafie dello stesso marchio già in anagrafica vince la più usata", async () => {
    const used = `${RUN} Marchio Uso`;
    await db.insert(products).values([
      { code: `${RUN}-U1`, description: "Rovere", brand: used.toUpperCase() },
      { code: `${RUN}-U2`, description: "Noce", brand: used },
      { code: `${RUN}-U3`, description: "Olmo", brand: used },
    ]);
    await imp.importProducts([{ Codice_articolo: `${RUN}-U4`, Descrizione_articolo_estesa: "Faggio", Marchio: used.toLowerCase() }]);
    const [created] = await db.select().from(products).where(eq(products.code, `${RUN}-U4`));
    expect(created).toMatchObject({ brand: used });
  });

  it("prodotti: colonna Attivo rispettata (file esportato e reimportato); senza colonna i prodotti vengono attivati", async () => {
    const code = (n: number) => `${RUN}-A${n}`;
    await db.insert(products).values([
      { code: code(1), description: "Rovere", active: false },
      { code: code(2), description: "Noce", active: true },
      { code: code(3), description: "Olmo", active: false },
    ]);
    const summary = await imp.importProducts([
      { Codice_articolo: code(1), Descrizione_articolo_estesa: "Rovere", Marchio: "", Attivo: "No" },
      { Codice_articolo: code(2), Descrizione_articolo_estesa: "Noce", Attivo: "No" },
      { Codice_articolo: code(4), Descrizione_articolo_estesa: "Faggio", Attivo: "No" },
    ]);
    expect(summary).toMatchObject({ created: 1, updated: 1, unchanged: 1, warnings: [] });
    await imp.importProducts([{ Codice_articolo: code(3), Descrizione_articolo_estesa: "Olmo" }]);
    const rows = await db.select().from(products).where(like(products.code, `${RUN}-A%`));
    const active = Object.fromEntries(rows.map((r) => [r.code, r.active]));
    expect(active).toEqual({ [code(1)]: false, [code(2)]: false, [code(3)]: true, [code(4)]: false });
  });
});
