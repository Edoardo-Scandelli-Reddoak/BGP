import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  firstParam,
  isIsoDate,
  isIsoMonth,
  monthEnd,
  monthsBetween,
  presetRange,
  recentMonths,
  resolvePeriod,
} from "./period";

const TODAY = "2026-10-20";

describe("date e mesi", () => {
  it("valida date e mesi ISO", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("20-10-2026")).toBe(false);
    expect(isIsoMonth("2026-10")).toBe(true);
    expect(isIsoMonth("2026-13")).toBe(false);
    expect(isIsoMonth("garbage")).toBe(false);
  });

  it("aritmetica su giorni e mesi", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(recentMonths("2026-01", 3)).toEqual(["2026-01", "2025-12", "2025-11"]);
  });

  it("firstParam", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam("  ")).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("periodo del cruscotto", () => {
  it("predefinito: ultimi 12 mesi di calendario", () => {
    expect(resolvePeriod({}, TODAY)).toEqual({ da: "2025-11-01", a: TODAY, preset: "12m" });
  });

  it("riconosce i periodi predefiniti", () => {
    expect(resolvePeriod(presetRange("30g", TODAY), TODAY).preset).toBe("30g");
    expect(resolvePeriod({ da: "2026-01-01", a: TODAY }, TODAY).preset).toBe("anno");
  });

  it("scambia le date invertite e ignora quelle non valide", () => {
    expect(resolvePeriod({ da: "2026-10-01", a: "2026-09-01" }, TODAY)).toEqual({
      da: "2026-09-01",
      a: "2026-10-01",
      preset: null,
    });
    expect(resolvePeriod({ da: "x", a: "y" }, TODAY).preset).toBe("12m");
    expect(resolvePeriod({ da: "2026-06-01" }, TODAY)).toEqual({ da: "2026-06-01", a: TODAY, preset: null });
  });
});
