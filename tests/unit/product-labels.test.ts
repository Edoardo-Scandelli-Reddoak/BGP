import { describe, expect, it } from "vitest";
import {
  canonicalLabel,
  canonicalWithIndex,
  cleanLabel,
  compareLabels,
  labelIndex,
  labelKey,
  labelsByUsage,
  renameTarget,
} from "@/lib/products/labels";

describe("marchio e categoria dei prodotti", () => {
  it("ripulisce gli spazi e tratta il vuoto come assente", () => {
    expect(cleanLabel("  Gaia   Parquet ")).toBe("Gaia Parquet");
    expect(cleanLabel("   ")).toBeNull();
    expect(cleanLabel(null)).toBeNull();
  });

  it("confronta senza maiuscole, spazi e accenti", () => {
    expect(labelKey(" Rivestimento ")).toBe(labelKey("RIVESTIMENTO"));
    expect(labelKey("Doussié")).toBe(labelKey("doussie"));
  });

  it("usa il valore già in anagrafica se scritto diversamente", () => {
    expect(canonicalLabel("gaia  parquet", ["SmartFloors", "Gaia Parquet"])).toBe("Gaia Parquet");
    expect(canonicalLabel("Nuovo Marchio", ["SmartFloors"])).toBe("Nuovo Marchio");
    expect(canonicalLabel("", ["SmartFloors"])).toBeNull();
  });

  it("l'indice raccoglie anche i valori nuovi dello stesso file", () => {
    const index = labelIndex(["SPC", null]);
    expect(canonicalWithIndex("spc", index)).toBe("SPC");
    expect(canonicalWithIndex("Legno", index)).toBe("Legno");
    expect(canonicalWithIndex("LEGNO", index)).toBe("Legno");
  });

  it("ordina senza maiuscole e accenti, con le varianti vicine", () => {
    expect(["legno", "SPC", "Accessori", "Legno", "Élite"].sort(compareLabels)).toEqual([
      "Accessori",
      "Élite",
      "Legno",
      "legno",
      "SPC",
    ]);
  });

  it("priorità per l'unione: prima il valore più usato", () => {
    expect(
      labelsByUsage([
        { value: "Beta", total: 1 },
        { value: "BETA", total: 5 },
        { value: "Alfa", total: 1 },
      ]),
    ).toEqual(["BETA", "Alfa", "Beta"]);
  });

  describe("rinomina di un valore", () => {
    const existing = ["Gaia Parquet", "GAIA PARQUET", "SmartFloors", "smartfloor"];

    it("nome nuovo: semplice rinomina", () => {
      expect(renameTarget("smartfloor", "Smart Floor", existing)).toEqual({
        value: "Smart Floor",
        merged: false,
        sources: ["smartfloor"],
      });
    });

    it("correzione della grafia dello stesso valore: niente unione", () => {
      expect(renameTarget("smartfloor", "  SmartFloor ", existing)).toEqual({
        value: "SmartFloor",
        merged: false,
        sources: ["smartfloor"],
      });
    });

    it("nome già esistente scritto diversamente: unione nella grafia esistente", () => {
      expect(renameTarget("SmartFloors", "Gaia parquet", existing)).toEqual({
        value: "Gaia Parquet",
        merged: true,
        sources: ["SmartFloors", "GAIA PARQUET"],
      });
    });

    it("se il nome scritto coincide con una variante si tiene quella e si uniscono le altre", () => {
      expect(renameTarget("SmartFloors", "GAIA PARQUET", existing)).toEqual({
        value: "GAIA PARQUET",
        merged: true,
        sources: ["SmartFloors", "Gaia Parquet"],
      });
    });

    it("nome uguale a quello attuale con altre varianti: si uniscono a questo valore", () => {
      expect(renameTarget("Gaia Parquet", " Gaia  Parquet", existing)).toEqual({
        value: "Gaia Parquet",
        merged: true,
        sources: ["GAIA PARQUET"],
      });
      // anche se il valore rinominato non è il più usato
      expect(renameTarget("GAIA PARQUET", "GAIA PARQUET", existing)).toEqual({
        value: "GAIA PARQUET",
        merged: true,
        sources: ["Gaia Parquet"],
      });
    });

    it("grafia nuova di un valore con varianti: unione nella variante più usata, anche quella rinominata", () => {
      expect(renameTarget("Gaia Parquet", "gaia parquet", existing)).toEqual({
        value: "Gaia Parquet",
        merged: true,
        sources: ["GAIA PARQUET"],
      });
      expect(renameTarget("GAIA PARQUET", "gaia parquet", existing)).toEqual({
        value: "Gaia Parquet",
        merged: true,
        sources: ["GAIA PARQUET"],
      });
    });

    it("uguale al valore attuale o vuoto", () => {
      expect(renameTarget("SmartFloors", " SmartFloors ", existing)).toEqual({
        value: "SmartFloors",
        merged: false,
        sources: ["SmartFloors"],
      });
      expect(renameTarget("SmartFloors", "   ", existing)).toBeNull();
    });
  });
});
