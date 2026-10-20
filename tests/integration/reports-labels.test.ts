import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { carriers, contacts, pieces, products, requestItems, sampleRequests, users, type RequestStatus } from "@/db/schema";
import { CRM_COLUMNS_BY_GROUP, DEFAULT_CRM_EXPORT_CONFIG, type CrmExportConfig, type CrmGroupBy, type CrmRow } from "@/lib/config/crm-export";
import { NONE_VALUE, type HistoryFilters } from "@/lib/reports/history-filters";
import { createFixtures, dbTestsSkipReason, MARK_PREFIX, type Fixtures } from "./fixtures";

/**
 * Marchio e categoria dei prodotti nei report: cruscotto direzione (per marchio / per categoria),
 * filtri dello storico, report m² del mese ed export CRM raggruppato per marchio o categoria.
 *
 * Il database è quello di sviluppo, condiviso con altri test e con `next dev`: marchi e categorie hanno
 * nomi unici per esecuzione e le richieste sono in un mese «storico» usato solo qui (aprile 2003),
 * così le righe «Non indicato» del periodo contengono solo i dati di questo file.
 */

const SKIP_REASON = dbTestsSkipReason();
if (SKIP_REASON) console.warn(`Test di integrazione saltati: ${SKIP_REASON}`);

type Dashboard = typeof import("@/lib/reports/dashboard");
type History = typeof import("@/lib/reports/history");
type M2 = typeof import("@/lib/reports/m2");
type ProductLabels = typeof import("@/lib/reports/product-labels");
type CrmRun = typeof import("@/lib/crm-export/run");

const RUN = `lbl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const MONTH = "2003-04";
const RANGE = { da: "2003-04-01", a: "2003-04-30" };

const BRAND_1 = `Gaia ${RUN}`;
const BRAND_2 = `Smart ${RUN}`;
const CATEGORY_1 = `Legno ${RUN}`;

let db: DB;
let dashboard: Dashboard;
let history: History;
let m2: M2;
let labels: ProductLabels;
let crm: CrmRun;
let fx: Fixtures;

/** Richieste di prova, per nome (vedi beforeAll). */
const req: Record<"r1" | "r2" | "r3" | "r4" | "r5", number> = { r1: 0, r2: 0, r3: 0, r4: 0, r5: 0 };

type PieceSpec = { productId: number; lengthCm: number; widthCm: number; quantity?: number };

/** Richiesta inserita direttamente (stato e date di comodo): qui conta solo come la contano i report. */
async function insertRequest(spec: {
  received: string;
  status: RequestStatus;
  shipmentDate?: string;
  pickupDate?: string;
  items: number[];
  pieces?: PieceSpec[];
}): Promise<number> {
  const [row] = await db
    .insert(sampleRequests)
    .values({
      contactId: fx.contacts.clienteIt.id,
      status: spec.status,
      receivedAt: new Date(`${spec.received}T10:00:00Z`),
      recipientName: `${fx.mark} Destinatario`,
      destinationAddress: "Via S. Vincenzo de Paoli 8, 24023 Clusone (BG)",
      carrierId: fx.carrier.id,
      shipmentDate: spec.shipmentDate ?? null,
      pickupDate: spec.pickupDate ?? null,
    })
    .returning({ id: sampleRequests.id });
  await db.insert(requestItems).values(spec.items.map((productId) => ({ requestId: row.id, productId })));
  if (spec.pieces?.length) await db.insert(pieces).values(spec.pieces.map((p) => ({ requestId: row.id, ...p })));
  return row.id;
}

/**
 * Elimina solo i dati di questa esecuzione: cleanupTestData() toglie anche gli utenti di prova di
 * altri file di test, che potrebbero essere in esecuzione nello stesso momento.
 */
async function cleanupRun(): Promise<void> {
  const mark = `${MARK_PREFIX}${RUN}`;
  const contactIds = (await db.select({ id: contacts.id }).from(contacts).where(like(contacts.name, `${mark}%`))).map((r) => r.id);
  if (contactIds.length) {
    // righe, pezzi e storico seguono a cascata
    await db.delete(sampleRequests).where(inArray(sampleRequests.contactId, contactIds));
    await db.delete(contacts).where(inArray(contacts.id, contactIds));
  }
  await db.delete(products).where(like(products.code, `${mark}%`));
  await db.delete(carriers).where(like(carriers.name, `${mark}%`));
  await db.delete(users).where(like(users.email, `vitest-${RUN}-%`));
}

const sortIds = (ids: number[]) => [...ids].sort((x, y) => x - y);

describe.skipIf(SKIP_REASON !== null)("marchio e categoria nei report (integrazione con il database)", () => {
  beforeAll(async () => {
    ({ db } = await import("@/db"));
    dashboard = await import("@/lib/reports/dashboard");
    history = await import("@/lib/reports/history");
    m2 = await import("@/lib/reports/m2");
    labels = await import("@/lib/reports/product-labels");
    crm = await import("@/lib/crm-export/run");
    fx = await createFixtures(db, RUN);

    const { a, b, notRequested: c } = fx.products;
    // A: marchio scritto con spazi in più (dato importato prima della pulizia) → vale «BRAND_1»
    await db.update(products).set({ brand: `  ${BRAND_1} `, category: CATEGORY_1 }).where(eq(products.id, a.id));
    // B: senza categoria
    await db.update(products).set({ brand: BRAND_2, category: null }).where(eq(products.id, b.id));
    // C: marchio vuoto (solo spazi) = non indicato
    await db.update(products).set({ brand: "   ", category: CATEGORY_1 }).where(eq(products.id, c.id));

    // R1: ricevuta e spedita in aprile, A + C            → A 1 m² (2 pezzi), C 0,01 m²
    req.r1 = await insertRequest({
      received: "2003-04-02",
      status: "SPEDITA",
      shipmentDate: "2003-04-05",
      pickupDate: "2003-04-05",
      items: [a.id, c.id],
      pieces: [
        { productId: a.id, lengthCm: 100, widthCm: 50, quantity: 2 },
        { productId: c.id, lengthCm: 10, widthCm: 10 },
      ],
    });
    // R2: completata, senza data di spedizione: conta la data di ritiro (aprile), A + B → A 0,25 m², B 0,12 m²
    req.r2 = await insertRequest({
      received: "2003-04-03",
      status: "COMPLETATA",
      pickupDate: "2003-04-10",
      items: [a.id, b.id],
      pieces: [
        { productId: a.id, lengthCm: 50, widthCm: 50 },
        { productId: b.id, lengthCm: 60, widthCm: 20 },
      ],
    });
    // R3: ricevuta in aprile, non ancora spedita, B
    req.r3 = await insertRequest({ received: "2003-04-04", status: "IN_PREPARAZIONE", items: [b.id] });
    // R4: ricevuta a marzo, spedita in aprile, B → B 1 m²
    req.r4 = await insertRequest({
      received: "2003-03-28",
      status: "SPEDITA",
      shipmentDate: "2003-04-02",
      pickupDate: "2003-04-01",
      items: [b.id],
      pieces: [{ productId: b.id, lengthCm: 100, widthCm: 100 }],
    });
    // R5: ricevuta in aprile, spedita a maggio, A → A 0,04 m² (non in aprile)
    req.r5 = await insertRequest({
      received: "2003-04-20",
      status: "SPEDITA",
      shipmentDate: "2003-05-03",
      pickupDate: "2003-05-03",
      items: [a.id],
      pieces: [{ productId: a.id, lengthCm: 20, widthCm: 20 }],
    });
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await cleanupRun();
    } finally {
      await db.$client.end({ timeout: 5 });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Cruscotto direzione                                                 */
  /* ------------------------------------------------------------------ */

  describe("cruscotto: per marchio e per categoria", () => {
    it("per marchio: richieste ricevute, prodotti, pezzi e m² spediti nel periodo; vuoto o spazi → non indicato", async () => {
      const { rows, total } = await dashboard.getByBrand(RANGE, null);
      const labelsInOrder = rows.map((r) => r.label);
      expect(rows.filter((r) => r.label === BRAND_1 || r.label === BRAND_2)).toEqual([
        // R1, R2, R5 ricevute in aprile con A; pezzi e m² di R1 e R2 (R5 è spedita a maggio)
        { label: BRAND_1, requests: 3, products: 1, pieces: 3, m2: 1.25 },
        // R2, R3 ricevute in aprile con B (R4 è di marzo); m² di R2 e R4
        { label: BRAND_2, requests: 2, products: 1, pieces: 2, m2: 1.12 },
      ]);
      // aprile 2003 è usato solo da questo file: «Non indicato» è il prodotto C
      expect(rows.find((r) => r.label === null)).toEqual({ label: null, requests: 1, products: 1, pieces: 1, m2: 0.01 });
      expect(labelsInOrder.indexOf(BRAND_1)).toBeLessThan(labelsInOrder.indexOf(BRAND_2));
      expect(labelsInOrder.indexOf(BRAND_2)).toBeLessThan(labelsInOrder.indexOf(null));
      expect(total).toBe(rows.length);

      const top = await dashboard.getByBrand(RANGE, 1);
      expect(top.rows).toHaveLength(1);
      expect(top.total).toBe(total);
    });

    it("per categoria: una richiesta con due prodotti della stessa categoria conta una volta", async () => {
      const { rows } = await dashboard.getByCategory(RANGE, null);
      // R1 contiene A e C (entrambi CATEGORY_1) ma conta una sola richiesta
      expect(rows.find((r) => r.label === CATEGORY_1)).toEqual({ label: CATEGORY_1, requests: 3, products: 2, pieces: 4, m2: 1.26 });
      expect(rows.find((r) => r.label === null)).toEqual({ label: null, requests: 2, products: 1, pieces: 2, m2: 1.12 });
    });

    it("stesse regole del dettaglio per prodotto", async () => {
      const { rows } = await dashboard.getByProduct(RANGE, null);
      const byId = (id: number) => rows.find((r) => r.productId === id);
      expect(byId(fx.products.a.id)).toMatchObject({ requests: 3, pieces: 3, m2: 1.25 });
      expect(byId(fx.products.b.id)).toMatchObject({ requests: 2, pieces: 2, m2: 1.12 });
      expect(byId(fx.products.notRequested.id)).toMatchObject({ requests: 1, pieces: 1, m2: 0.01 });
    });

    it("periodo senza richieste dei prodotti: nessuna riga", async () => {
      const { rows } = await dashboard.getByBrand({ da: "2003-06-01", a: "2003-06-30" }, null);
      expect(rows.filter((r) => r.label === BRAND_1 || r.label === BRAND_2)).toEqual([]);
    });

    it("conteggio dei prodotti con marchio e categoria in anagrafica", async () => {
      const coverage = await labels.getProductLabelCoverage();
      // A e B hanno un marchio (C solo spazi), A e C una categoria; altri prodotti possono averli
      expect(coverage.brand).toBeGreaterThanOrEqual(2);
      expect(coverage.category).toBeGreaterThanOrEqual(2);
      expect(coverage.products).toBeGreaterThanOrEqual(coverage.brand);
      expect(coverage.products).toBeGreaterThanOrEqual(coverage.category);
    });
  });

  /* ------------------------------------------------------------------ */
  /* Storico                                                             */
  /* ------------------------------------------------------------------ */

  describe("storico: filtri «Marchio» e «Categoria»", () => {
    const ids = async (f: HistoryFilters) => sortIds((await history.getHistoryForExport(f)).map((r) => r.id));

    it("marchio e categoria: richieste con almeno un prodotto con quel valore (spazi esterni ignorati)", async () => {
      const { r1, r2, r3, r4, r5 } = req;
      expect(await ids({ marchio: BRAND_1 })).toEqual(sortIds([r1, r2, r5]));
      expect(await ids({ marchio: BRAND_2 })).toEqual(sortIds([r2, r3, r4]));
      expect(await ids({ categoria: CATEGORY_1 })).toEqual(sortIds([r1, r2, r5]));
      expect(await ids({ marchio: BRAND_1, categoria: CATEGORY_1, da: "2003-04-03", a: "2003-04-30" })).toEqual(sortIds([r2, r5]));
      expect(await ids({ marchio: `${BRAND_1} non esiste` })).toEqual([]);
    });

    it("«Non indicato»: richieste con almeno un prodotto senza marchio / senza categoria", async () => {
      const { r1, r2, r3, r4 } = req;
      expect(await ids({ marchio: NONE_VALUE, contatto: fx.mark })).toEqual([r1]);
      expect(await ids({ categoria: NONE_VALUE, contatto: fx.mark })).toEqual(sortIds([r2, r3, r4]));
      // R2 contiene A (BRAND_1) e B (senza categoria)
      expect(await ids({ marchio: BRAND_1, categoria: NONE_VALUE })).toEqual([r2]);
    });

    it("pagina e conteggio coerenti con l'export", async () => {
      const page = await history.getHistoryPage({ categoria: CATEGORY_1 }, 1);
      expect(page.total).toBe(3);
      expect(sortIds(page.rows.map((r) => r.id))).toEqual(sortIds([req.r1, req.r2, req.r5]));
      const none = await history.getHistoryPage({ categoria: NONE_VALUE, contatto: fx.mark, da: "2003-04-01", a: "2003-04-30" }, 1);
      expect(none.total).toBe(2);
    });

    it("valori delle tendine: marchi e categorie dell'anagrafica, «Non indicato» disponibile", async () => {
      const options = await history.getHistoryFilterOptions();
      expect(options.brands).toEqual(expect.arrayContaining([BRAND_1, BRAND_2]));
      expect(options.brands).not.toContain(`  ${BRAND_1} `);
      expect(options.categories).toContain(CATEGORY_1);
      expect(options.brands.every((b) => b.trim() === b && b !== "")).toBe(true);
      expect(options.hasMissingBrand).toBe(true);
      expect(options.hasMissingCategory).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /* Report m² del mese                                                  */
  /* ------------------------------------------------------------------ */

  describe("report m²: categoria accanto al marchio e riepilogo", () => {
    it("righe per prodotto con marchio e categoria; riepilogo per marchio e per categoria", async () => {
      const report = await m2.getMonthlyM2Report(MONTH);
      const { a, b, notRequested: c } = fx.products;
      const row = (id: number) => report.rows.find((r) => r.productId === id);
      expect(row(a.id)).toMatchObject({ brand: BRAND_1, category: CATEGORY_1, requests: 2, pieces: 3, m2: 1.25 });
      expect(row(b.id)).toMatchObject({ brand: BRAND_2, category: null, requests: 2, pieces: 2, m2: 1.12 });
      expect(row(c.id)).toMatchObject({ brand: null, category: CATEGORY_1, requests: 1, pieces: 1, m2: 0.01 });

      expect(report.byBrand.filter((r) => r.label === BRAND_1 || r.label === BRAND_2)).toEqual([
        { label: BRAND_1, requests: 2, pieces: 3, m2: 1.25, products: 1 },
        { label: BRAND_2, requests: 2, pieces: 2, m2: 1.12, products: 1 },
      ]);
      expect(report.byBrand.find((r) => r.label === null)).toEqual({ label: null, requests: 1, pieces: 1, m2: 0.01, products: 1 });
      expect(report.byBrand.at(-1)?.label).toBeNull();
      expect(report.byCategory).toEqual([
        { label: CATEGORY_1, requests: 2, pieces: 4, m2: 1.26, products: 2 },
        { label: null, requests: 2, pieces: 2, m2: 1.12, products: 1 },
      ]);
      // i riepiloghi tornano con i totali del mese
      const sum = (rows: { m2: number; pieces: number }[]) => ({
        m2: Math.round(rows.reduce((s, r) => s + r.m2, 0) * 1e4) / 1e4,
        pieces: rows.reduce((s, r) => s + r.pieces, 0),
      });
      const totals = { m2: Math.round(report.totals.m2 * 1e4) / 1e4, pieces: report.totals.pieces };
      expect(sum(report.byBrand)).toEqual(totals);
      expect(sum(report.byCategory)).toEqual(totals);
    });
  });

  /* ------------------------------------------------------------------ */
  /* Export CRM                                                          */
  /* ------------------------------------------------------------------ */

  describe("export CRM per marchio e per categoria", () => {
    const configFor = (groupBy: CrmGroupBy, patch: Partial<CrmExportConfig> = {}): CrmExportConfig => ({
      ...DEFAULT_CRM_EXPORT_CONFIG,
      groupBy,
      columns: CRM_COLUMNS_BY_GROUP[groupBy],
      ...patch,
    });
    const pick = (rows: CrmRow[], column: "marchio" | "categoria", values: string[]) =>
      rows.filter((r) => values.includes(String(r[column])));

    it("per marchio: richieste distinte, pezzi e m² del mese; prodotti senza marchio in «Non indicato»", async () => {
      const rows = await crm.getCrmExportRows(MONTH, configFor("MARCHIO"));
      expect(pick(rows, "marchio", [BRAND_1, BRAND_2, "Non indicato"])).toEqual([
        { mese: MONTH, marchio: BRAND_1, richieste: 2, pezzi: 3, m2: 1.25 },
        { mese: MONTH, marchio: BRAND_2, richieste: 2, pezzi: 2, m2: 1.12 },
        { mese: MONTH, marchio: "Non indicato", richieste: 1, pezzi: 1, m2: 0.01 },
      ]);
    });

    it("per categoria: la richiesta con due prodotti della stessa categoria conta una volta", async () => {
      const rows = await crm.getCrmExportRows(MONTH, configFor("CATEGORIA"));
      expect(pick(rows, "categoria", [CATEGORY_1, "Non indicato"])).toEqual([
        { mese: MONTH, categoria: CATEGORY_1, richieste: 2, pezzi: 4, m2: 1.26 },
        { mese: MONTH, categoria: "Non indicato", richieste: 2, pezzi: 2, m2: 1.12 },
      ]);
    });

    it("per prodotto: marchio e categoria senza spazi esterni, vuoti se non indicati", async () => {
      const rows = await crm.getCrmExportRows(MONTH, DEFAULT_CRM_EXPORT_CONFIG);
      const { a, b, notRequested: c } = fx.products;
      const byCode = (code: string) => rows.find((r) => r.codice === code);
      expect(byCode(a.code)).toMatchObject({ marchio: BRAND_1, categoria: CATEGORY_1 });
      expect(byCode(b.code)).toMatchObject({ marchio: BRAND_2, categoria: null });
      expect(byCode(c.code)).toMatchObject({ marchio: null, categoria: CATEGORY_1 });
    });

    it("file CSV ed Excel con i nuovi raggruppamenti", async () => {
      const csv = await crm.buildCrmExportFile(MONTH, configFor("MARCHIO"));
      const lines = csv.data.toString("utf8").replace(/^﻿/, "").split("\r\n");
      expect(lines[0]).toBe("Mese;Marchio;Richieste;Pezzi;m2");
      expect(lines).toContain(`"=""${MONTH}""";${BRAND_1};2;3;1,25`);
      expect(lines).toContain(`"=""${MONTH}""";Non indicato;1;1;0,01`);

      const xlsx = await crm.buildCrmExportFile(MONTH, configFor("CATEGORIA", { format: "XLSX", columns: ["categoria", "m2"] }));
      expect(xlsx.fileName).toBe(`m2-campioni-${MONTH}.xlsx`);
      expect(xlsx.rows).toBe((await crm.getCrmExportRows(MONTH, configFor("CATEGORIA"))).length);
    });
  });
});
