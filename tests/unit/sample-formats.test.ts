import { describe, expect, it } from "vitest";
import type { Language } from "@/db/schema";
import {
  isSampleFormat,
  looksLikeCompany,
  SAMPLE_FORMAT_LABELS,
  SAMPLE_FORMATS,
  sampleFormatMissing,
  sampleFormatText,
  suggestSampleFormat,
} from "@/lib/sample-formats";

const LANGUAGES: Language[] = ["it", "en", "fr", "de"];

describe("SAMPLE_FORMATS e etichette", () => {
  it("coprono l'elenco di BGP: doghe intere, mezze doghe, mazzette, pannelli, espositori completi o solo culle, altro", () => {
    expect([...SAMPLE_FORMATS]).toEqual([
      "DOGHE_INTERE",
      "MEZZE_DOGHE",
      "MAZZETTA",
      "PANNELLO",
      "ESPOSITORE_COMPLETO",
      "ESPOSITORE_CULLE",
      "ALTRO",
    ]);
    expect(Object.keys(SAMPLE_FORMAT_LABELS).sort()).toEqual([...SAMPLE_FORMATS].sort());
  });

  it.each(LANGUAGES)("%s: un'etichetta non vuota e diversa per ogni formato", (lang) => {
    const labels = SAMPLE_FORMATS.map((f) => sampleFormatText(f, null, lang));
    for (const [i, label] of labels.entries()) expect(label.trim(), SAMPLE_FORMATS[i]).not.toBe("");
    expect(new Set(labels).size).toBe(SAMPLE_FORMATS.length);
  });

  it("in italiano usa SAMPLE_FORMAT_LABELS (lingua predefinita)", () => {
    for (const f of SAMPLE_FORMATS) {
      expect(sampleFormatText(f)).toBe(SAMPLE_FORMAT_LABELS[f]);
      expect(sampleFormatText(f, null, "it")).toBe(SAMPLE_FORMAT_LABELS[f]);
    }
    expect(SAMPLE_FORMAT_LABELS.MEZZE_DOGHE).toBe("Mezze doghe");
    expect(SAMPLE_FORMAT_LABELS.ESPOSITORE_CULLE).toBe("Espositore: solo culle");
  });

  it("le lingue estere sono tradotte (email ai clienti esteri)", () => {
    expect(sampleFormatText("MEZZE_DOGHE", null, "en")).toBe("Half-length planks");
    expect(sampleFormatText("DOGHE_INTERE", null, "en")).toBe("Full-length planks");
    expect(sampleFormatText("MAZZETTA", null, "fr")).toBe("Nuancier");
    expect(sampleFormatText("ESPOSITORE_CULLE", null, "fr")).toBe("Présentoir : supports seuls");
    expect(sampleFormatText("PANNELLO", null, "de")).toBe("Musterpaneel");
    for (const lang of ["en", "fr", "de"] as const) {
      for (const f of SAMPLE_FORMATS) {
        expect(sampleFormatText(f, null, lang), `${lang}/${f}`).not.toBe(SAMPLE_FORMAT_LABELS[f]);
      }
    }
  });

  it("isSampleFormat accetta solo i valori dell'elenco", () => {
    for (const f of SAMPLE_FORMATS) expect(isSampleFormat(f)).toBe(true);
    for (const v of ["", "mazzetta", "Mazzetta", "DOGHE", null, undefined, 1]) expect(isSampleFormat(v), String(v)).toBe(false);
  });
});

describe("sampleFormatText", () => {
  it("«Altro» con la descrizione dopo i due punti", () => {
    expect(sampleFormatText("ALTRO", "listello tagliato a 30 cm")).toBe("Altro: listello tagliato a 30 cm");
    expect(sampleFormatText("ALTRO", "plank cut to 30 cm", "en")).toBe("Other: plank cut to 30 cm");
    expect(sampleFormatText("ALTRO", "30 cm", "de")).toBe("Sonstiges: 30 cm");
  });

  it("negli altri formati la nota va tra parentesi, ripulita dagli spazi", () => {
    expect(sampleFormatText("PANNELLO", "  2 colori  ")).toBe("Pannello (2 colori)");
    expect(sampleFormatText("ESPOSITORE_COMPLETO", "con 12 culle", "it")).toBe("Espositore completo (con 12 culle)");
  });

  it("nota vuota o di soli spazi: solo l'etichetta", () => {
    expect(sampleFormatText("MAZZETTA", "")).toBe("Mazzetta");
    expect(sampleFormatText("MAZZETTA", "   ")).toBe("Mazzetta");
    expect(sampleFormatText("ALTRO", null)).toBe("Altro");
  });

  it("formato non indicato o sconosciuto: la nota se c'è, altrimenti stringa vuota", () => {
    expect(sampleFormatText(null)).toBe("");
    expect(sampleFormatText(undefined, undefined, "en")).toBe("");
    expect(sampleFormatText(null, "   ")).toBe("");
    expect(sampleFormatText("XYZ", " mezza doga e mazzetta ")).toBe("mezza doga e mazzetta");
  });
});

describe("sampleFormatMissing", () => {
  it("manca se non indicato o non valido", () => {
    expect(sampleFormatMissing(null)).toBe(true);
    expect(sampleFormatMissing(undefined)).toBe(true);
    expect(sampleFormatMissing("")).toBe(true);
    expect(sampleFormatMissing("XYZ", "nota")).toBe(true);
  });

  it("«Altro» senza descrizione manca ancora", () => {
    expect(sampleFormatMissing("ALTRO")).toBe(true);
    expect(sampleFormatMissing("ALTRO", null)).toBe(true);
    expect(sampleFormatMissing("ALTRO", "   ")).toBe(true);
    expect(sampleFormatMissing("ALTRO", "listello 30 cm")).toBe(false);
  });

  it("gli altri formati non richiedono la nota", () => {
    for (const f of SAMPLE_FORMATS.filter((x) => x !== "ALTRO")) {
      expect(sampleFormatMissing(f), f).toBe(false);
      expect(sampleFormatMissing(f, ""), f).toBe(false);
    }
  });
});

describe("suggestSampleFormat", () => {
  it("dal codice: MAZZ… → mazzetta, PAN… → pannello (anche in minuscolo)", () => {
    expect(suggestSampleFormat("MAZZ10120", "")).toBe("MAZZETTA");
    expect(suggestSampleFormat("mazz-gaia", "")).toBe("MAZZETTA");
    expect(suggestSampleFormat("PANPL002", "Rovere naturale")).toBe("PANNELLO");
  });

  it("dalla descrizione: mazzetta…, pannell…, espositor…", () => {
    expect(suggestSampleFormat("SVR01", "Mazzetta colori Gaia Parquet")).toBe("MAZZETTA");
    expect(suggestSampleFormat("X1", "Pannelli campione 30x40")).toBe("PANNELLO");
    expect(suggestSampleFormat("ESP01", "Espositore da banco SmartFloors")).toBe("ESPOSITORE_COMPLETO");
  });

  it("il codice ha la precedenza sulla descrizione", () => {
    expect(suggestSampleFormat("MAZZ01", "Pannello")).toBe("MAZZETTA");
  });

  it("per le doghe non propone nulla: intere o mezze lo decide chi inserisce la richiesta", () => {
    expect(suggestSampleFormat("10150E1", "Rovere naturale spazzolato 14x190")).toBeNull();
    expect(suggestSampleFormat("PL002ABCM", "Plancia rovere")).toBeNull();
    expect(suggestSampleFormat("", "")).toBeNull();
  });
});

describe("looksLikeCompany (promemoria «alla c.a.»)", () => {
  it.each(["ORBIS FURNITURE SRL", "LEGNOARTE SRL", "DRVOTEK DOO", "GC STEINHAUS GMBH"])("ditta: %s", (name) => {
    expect(looksLikeCompany(name)).toBe(true);
  });

  it.each([
    "CORVINO S.r.l.",
    "Parquet Rossi S.p.A.",
    "LOMBARDI S.N.C. DI P. E F. LOMBARDI",
    "Bianchi Sas",
    "PARKETT AG",
    "BOSCO LTD",
    "Studio Arch. Bianchi",
    "D.O.O. DRVOTEK",
  ])("altre forme societarie: %s", (name) => {
    expect(looksLikeCompany(name)).toBe(true);
  });

  it.each(["NERI ANDREA", "ROSSI MARIO", "SARA ROSSI", "AGOSTINI LUCA", "Ceramiche Sassuolo", "Mario Sasso"])(
    "persona (o nome senza forma societaria): %s",
    (name) => {
      expect(looksLikeCompany(name)).toBe(false);
    },
  );

  it("vuoto o assente", () => {
    expect(looksLikeCompany("")).toBe(false);
    expect(looksLikeCompany(null)).toBe(false);
    expect(looksLikeCompany(undefined)).toBe(false);
  });
});
