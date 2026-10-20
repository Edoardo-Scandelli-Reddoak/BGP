import { describe, expect, it } from "vitest";
import { hasActiveFilters, historyFiltersToParams, NONE_VALUE, parseHistoryFilters, toQueryString } from "./history-filters";

describe("filtri dello storico: marchio e categoria", () => {
  it("valori, «Non indicato» (nessuno) e spazi esterni tolti", () => {
    expect(parseHistoryFilters({ marchio: " Gaia Parquet ", categoria: "Legno" })).toEqual({
      marchio: "Gaia Parquet",
      categoria: "Legno",
    });
    expect(parseHistoryFilters({ marchio: NONE_VALUE, categoria: NONE_VALUE })).toEqual({
      marchio: NONE_VALUE,
      categoria: NONE_VALUE,
    });
    expect(parseHistoryFilters({ marchio: "", categoria: "   " })).toEqual({});
    expect(parseHistoryFilters({ categoria: ["SPC", "Legno"] })).toEqual({ categoria: "SPC" });
    expect(parseHistoryFilters({ categoria: "x".repeat(150) }).categoria).toHaveLength(100);
  });

  it("stessi parametri per pagina, paginazione e link dell'export CSV", () => {
    const filters = parseHistoryFilters(
      new URLSearchParams({ da: "2026-01-01", marchio: "Gaia Parquet", categoria: NONE_VALUE, paese: "Italia" }),
    );
    const qs = toQueryString(historyFiltersToParams(filters));
    expect(qs).toBe("?da=2026-01-01&paese=Italia&marchio=Gaia+Parquet&categoria=nessuno");
    expect(parseHistoryFilters(new URLSearchParams(qs.slice(1)))).toEqual(filters);
    expect(hasActiveFilters({ categoria: "Legno" })).toBe(true);
  });
});
