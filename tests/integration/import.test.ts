import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { contacts, products } from "@/db/schema";
import type { RawRow } from "@/lib/import/parse";
import { cleanupTestData, dbTestsSkipReason, MARK_PREFIX } from "./fixtures";

/**
 * Import di contatti e prodotti (src/lib/import/import-db.ts) sul database locale:
 * lingua mancante, paese ricavato dall'indirizzo, marchio e categoria facoltativi.
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
});
