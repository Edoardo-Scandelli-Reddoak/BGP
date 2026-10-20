import { asc, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { products } from "@/db/schema";
import { dbTestsSkipReason, MARK_PREFIX } from "./fixtures";

/**
 * Marchio e categoria dei prodotti (src/lib/products/labels-db.ts) sul database locale: assegnazione in
 * blocco con i filtri dell'elenco (anche «senza marchio»), solo dove manca o sostituendo, grafia allineata
 * ai valori esistenti, rinomina, unione e rimozione di un valore.
 * Codici e valori contengono un suffisso unico: il database è condiviso con lo sviluppo e con altri test.
 */

const SKIP_REASON = dbTestsSkipReason();
const SFX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const RUN = `${MARK_PREFIX}LBL-${SFX}`;

type LabelsDb = typeof import("@/lib/products/labels-db");
type Queries = typeof import("@/app/(app)/anagrafiche/_lib/queries");

let db: DB;
let lab: LabelsDb;
let queries: Queries;

type Seed = { brand?: string | null; category?: string | null; active?: boolean };

/** Crea i prodotti del test (codici RUN-01, RUN-02…) dopo aver eliminato quelli del test precedente. */
async function seed(rows: Seed[]) {
  await db.delete(products).where(like(products.code, `${RUN}%`));
  await db.insert(products).values(
    rows.map((r, i) => ({
      code: `${RUN}-${String(i + 1).padStart(2, "0")}`,
      description: `Prodotto di prova ${i + 1}`,
      brand: r.brand ?? null,
      category: r.category ?? null,
      active: r.active ?? true,
    })),
  );
}

/** [marchio, categoria] dei prodotti del test, in ordine di codice. */
async function labels() {
  const rows = await db
    .select({ brand: products.brand, category: products.category })
    .from(products)
    .where(like(products.code, `${RUN}%`))
    .orderBy(asc(products.code));
  return rows.map((r) => [r.brand, r.category]);
}

/** Filtri dell'elenco prodotti ristretti ai prodotti del test (la ricerca trova il codice). */
function where(extra: Record<string, string> = {}) {
  return queries.productWhere(queries.parseProductFilters({ q: RUN, ...extra }));
}

describe.skipIf(SKIP_REASON !== null)("marchio e categoria dei prodotti (integrazione con il database)", () => {
  const A = `Alfa ${SFX}`;
  const B = `Beta ${SFX}`;
  const L = `Legno ${SFX}`;
  const S = `Spc ${SFX}`;

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    lab = await import("@/lib/products/labels-db");
    queries = await import("@/app/(app)/anagrafiche/_lib/queries");
  });

  beforeEach(async () => {
    if (db) await db.delete(products).where(like(products.code, `${RUN}%`));
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.delete(products).where(like(products.code, `${RUN}%`));
    } finally {
      await db.$client.end({ timeout: 5 });
    }
  });

  it("solo dove manca: marchio e categoria si compilano campo per campo", async () => {
    await seed([{}, { brand: A }, { category: L }, { brand: A, category: L }]);
    const res = await lab.assignProductLabels(where(), { brand: B, category: S, overwrite: false });
    expect(res).toEqual({ updated: 3, brand: B, category: S });
    expect(await labels()).toEqual([
      [B, S],
      [A, S],
      [B, L],
      [A, L],
    ]);
  });

  it("sostituisci: cambia anche i valori presenti e conta solo i prodotti modificati", async () => {
    await seed([{}, { brand: A, category: L }, { brand: B, category: L }]);
    const res = await lab.assignProductLabels(where(), { brand: B, overwrite: true });
    expect(res.updated).toBe(2);
    expect(await labels()).toEqual([
      [B, null],
      [B, L],
      [B, L],
    ]);
    // di nuovo con gli stessi valori: nessun prodotto cambia
    expect((await lab.assignProductLabels(where(), { brand: B, overwrite: true })).updated).toBe(0);
  });

  it("filtri dell'elenco: «senza marchio», «senza categoria» e stato", async () => {
    await seed([{}, { brand: A }, { brand: " " }, { category: L, active: false }, { brand: A, category: L }]);

    const senzaMarchio = await lab.assignProductLabels(where({ marchio: "-" }), { category: S, overwrite: true });
    expect(senzaMarchio.updated).toBe(3); // vuoto, solo spazi e il disattivato senza marchio
    expect(await labels()).toEqual([
      [null, S],
      [A, null],
      [" ", S],
      [null, S],
      [A, L],
    ]);

    const senzaCategoria = await lab.assignProductLabels(where({ categoria: "-" }), { brand: B, overwrite: true });
    expect(senzaCategoria.updated).toBe(1);

    const attiviConMarchio = { attivi: "1", marchio: B };
    expect((await lab.assignProductLabels(where(attiviConMarchio), { category: L, overwrite: false })).updated).toBe(1);
    // ripetuto: il prodotto ha ormai una categoria e «solo dove manca» non la tocca
    expect((await lab.assignProductLabels(where(attiviConMarchio), { category: S, overwrite: false })).updated).toBe(0);

    const disattivati = await lab.assignProductLabels(where({ attivi: "0", marchio: "-" }), { brand: A, overwrite: false });
    expect(disattivati.updated).toBe(1);
    expect(await labels()).toEqual([
      [null, S],
      [B, L],
      [" ", S],
      [A, S],
      [A, L],
    ]);
  });

  it("la grafia si allinea ai valori già in uso (maiuscole, spazi, accenti)", async () => {
    const existing = `Gaia Parquèt ${SFX}`;
    await seed([{ brand: existing }, {}]);
    const typed = `  gaia   PARQUET ${SFX.toUpperCase()} `;
    const res = await lab.assignProductLabels(where(), { brand: typed, overwrite: false });
    expect(res).toMatchObject({ updated: 1, brand: existing });
    expect((await labels()).map(([brand]) => brand)).toEqual([existing, existing]);

    // valore nuovo: solo spazi ripuliti
    expect(await lab.canonicalProductLabel("category", `  Nuova   categoria ${SFX} `)).toBe(`Nuova categoria ${SFX}`);
    expect(await lab.canonicalProductLabel("category", "   ")).toBeNull();
  });

  it("modifica di un prodotto: il suo valore attuale non vincola la grafia", async () => {
    const lower = `delta ${SFX}`;
    await seed([{ brand: lower }]);
    const [p] = await db.select({ id: products.id }).from(products).where(like(products.code, `${RUN}%`));
    expect(await lab.canonicalProductLabel("brand", `Delta ${SFX}`)).toBe(lower);
    expect(await lab.canonicalProductLabel("brand", `Delta ${SFX}`, { excludeProductId: p.id })).toBe(`Delta ${SFX}`);
  });

  it("valori in uso con il numero di prodotti attivi e totali", async () => {
    await seed([{ brand: A }, { brand: A, active: false }, { brand: B }]);
    const usage = await lab.productLabelUsage("brand");
    const mine = usage.values.filter((v) => v.value.endsWith(SFX));
    expect(mine).toEqual([
      { value: A, total: 2, active: 1 },
      { value: B, total: 1, active: 1 },
    ]);
    expect(await lab.distinctLabels("brand")).toEqual(expect.arrayContaining([A, B]));
  });

  it("rinomina: nome nuovo, correzione della grafia, nome vuoto o invariato, valore inesistente", async () => {
    await seed([{ category: L }, { category: L }, { category: S }]);
    expect(await lab.renameProductLabel("category", L, `Legno massello ${SFX}`)).toEqual({
      status: "ok",
      updated: 2,
      value: `Legno massello ${SFX}`,
      merged: false,
      replaced: [L],
    });
    expect(await lab.renameProductLabel("category", S, `SPC ${SFX}`)).toMatchObject({
      status: "ok",
      updated: 1,
      merged: false,
    });
    expect(await labels()).toEqual([
      [null, `Legno massello ${SFX}`],
      [null, `Legno massello ${SFX}`],
      [null, `SPC ${SFX}`],
    ]);
    expect(await lab.renameProductLabel("category", `SPC ${SFX}`, `  SPC   ${SFX}`)).toEqual({ status: "unchanged" });
    expect(await lab.renameProductLabel("category", `SPC ${SFX}`, "  ")).toEqual({ status: "empty" });
    expect(await lab.renameProductLabel("category", L, `Altro ${SFX}`)).toEqual({ status: "not-found" });
  });

  it("unione: il nuovo nome corrisponde a un valore esistente, vince la variante più usata", async () => {
    const BETA = `BETA ${SFX}`;
    await seed([{ brand: A }, { brand: A }, { brand: B }, { brand: B }, { brand: BETA }, { brand: L }]);
    const res = await lab.renameProductLabel("brand", A, `beta ${SFX}`);
    expect(res).toEqual({ status: "ok", updated: 3, value: B, merged: true, replaced: [A, BETA] });
    expect((await labels()).map(([brand]) => brand)).toEqual([B, B, B, B, B, L]);
  });

  it("unione: «Rinomina» con il nome attuale unisce le altre varianti a quel valore", async () => {
    const BETA = `BETA ${SFX}`;
    await seed([{ brand: B }, { brand: B }, { brand: BETA }]);
    // BETA è il meno usato ma è il nome scritto: vince lui
    const res = await lab.renameProductLabel("brand", BETA, BETA);
    expect(res).toEqual({ status: "ok", updated: 2, value: BETA, merged: true, replaced: [B] });
    expect((await labels()).map(([brand]) => brand)).toEqual([BETA, BETA, BETA]);
    // ora è l'unica variante: stesso nome = invariato
    expect(await lab.renameProductLabel("brand", BETA, BETA)).toEqual({ status: "unchanged" });
  });

  it("ricerca prodotti (selettore): le parole valgono anche per marchio e categoria", async () => {
    const { searchProducts } = await import("@/lib/search");
    await seed([{ brand: `Gaia ${SFX}`, category: L }, { brand: B }, {}]);
    const found = await searchProducts(`${RUN} gaia legno`);
    expect(found).toEqual([
      expect.objectContaining({ code: `${RUN}-01`, brand: `Gaia ${SFX}`, category: L, active: true }),
    ]);
    const all = await searchProducts(RUN);
    expect(all.map((p) => [p.brand, p.category])).toEqual([
      [`Gaia ${SFX}`, L],
      [B, null],
      [null, null],
    ]);
  });

  it("togli dai prodotti: il campo torna vuoto solo per quel valore", async () => {
    await seed([{ brand: A, category: L }, { brand: B, category: L }, { brand: A, category: S }]);
    expect(await lab.clearProductLabel("category", L)).toBe(2);
    expect(await labels()).toEqual([
      [A, null],
      [B, null],
      [A, S],
    ]);
    expect(await lab.clearProductLabel("category", L)).toBe(0);
  });
});
