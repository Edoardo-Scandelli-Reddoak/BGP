import { describe, expect, it } from "vitest";
import {
  currentMonthIso,
  dateFromIso,
  formatDate,
  formatDateTime,
  formatEuro,
  formatKg,
  formatM2,
  formatMonth,
  formatNumber,
  parseDecimal,
  parseRequestCode,
  pieceAreaM2,
  requestCode,
  todayIso,
} from "@/lib/format";

/** Intl usa spazi speciali (U+00A0, U+202F) prima di € e nei separatori: li normalizziamo. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("requestCode / parseRequestCode", () => {
  it("formatta l'id come CAMP-00042", () => {
    expect(requestCode(42)).toBe("CAMP-00042");
    expect(requestCode(1)).toBe("CAMP-00001");
    expect(requestCode(123456)).toBe("CAMP-123456");
  });

  it.each([
    ["CAMP-00042", 42],
    ["camp-00042", 42],
    ["camp42", 42],
    ["CAMP42", 42],
    ["#42", 42],
    ["42", 42],
    ["00042", 42],
    ["  CAMP-00042  ", 42],
    ["CAMP-123456", 123456],
  ])("%j → %i", (input, expected) => {
    expect(parseRequestCode(input)).toBe(expected);
  });

  it.each(["", "CAMP-", "CAMP 42", "abc", "42a", "CAMP-42-1", "-42", "4.2", "1234567890"])("%j → null", (input) => {
    expect(parseRequestCode(input)).toBeNull();
  });

  it("andata e ritorno", () => {
    for (const id of [1, 42, 99999, 100000]) expect(parseRequestCode(requestCode(id))).toBe(id);
  });
});

describe("parseDecimal", () => {
  it.each([
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["1.234,5", 1234.5],
    ["1.234.567,25", 1234567.25],
    ["  3,75 ", 3.75],
    ["1 234,5", 1234.5],
    ["0", 0],
    ["7", 7],
  ])("%j → %d", (input, expected) => {
    expect(parseDecimal(input)).toBe(expected);
  });

  it("vuoto → null", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
  });

  it("testo non numerico → NaN", () => {
    expect(parseDecimal("abc")).toBeNaN();
    expect(parseDecimal("12,5 kg")).toBeNaN();
    expect(parseDecimal("12,5,3")).toBeNaN();
  });
});

describe("pieceAreaM2 (formula del blueprint: L × W × Q / 10.000)", () => {
  it("60 × 20 × 1 = 0,12 m²", () => {
    expect(pieceAreaM2(60, 20, 1)).toBe(0.12);
    expect(pieceAreaM2(60, 20)).toBe(0.12);
  });

  it("122 × 19 × 2 = 0,4636 m²", () => {
    expect(pieceAreaM2(122, 19, 2)).toBe(0.4636);
  });

  it("arrotonda a 4 decimali come la colonna generata del database", () => {
    expect(pieceAreaM2(12.3, 4.5, 1)).toBe(0.0055); // 0.005535
    expect(pieceAreaM2(0.1, 0.2, 3)).toBe(0); // 0.000006
    expect(pieceAreaM2(190, 1500 / 10, 4)).toBe(11.4);
  });
});

describe("formatDate", () => {
  it("'YYYY-MM-DD' non slitta di un giorno, in qualunque fuso del server", () => {
    expect(formatDate("2026-10-20")).toBe("20/10/2026");
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
    expect(formatDate("2026-03-29")).toBe("29/03/2026"); // passaggio all'ora legale
  });

  it("Date: giorno di calendario nel fuso di Roma", () => {
    // 23:30 UTC del 20 ottobre = 01:30 del 21 ottobre a Roma (ora legale).
    expect(formatDate(new Date("2026-10-20T23:30:00Z"))).toBe("21/10/2026");
    expect(formatDate(new Date("2026-10-20T10:00:00Z"))).toBe("20/10/2026");
  });

  it("formato per lingua del contatto", () => {
    expect(formatDate("2026-10-20", "en")).toBe("20/10/2026");
    expect(formatDate("2026-10-20", "fr")).toBe("20/10/2026");
    expect(formatDate("2026-10-20", "de")).toBe("20.10.2026");
  });

  it("valori mancanti o non validi → stringa vuota", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate(new Date("non valida"))).toBe("");
  });

  it("dateFromIso → mezzanotte UTC", () => {
    expect(dateFromIso("2026-10-20").toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(dateFromIso("2026-10-20T15:00:00Z").toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("formatDateTime nel fuso di Roma", () => {
    const out = formatDateTime(new Date("2026-10-20T10:30:00Z"));
    expect(out).toContain("20/10/2026");
    expect(out).toContain("12:30");
    expect(formatDateTime(null)).toBe("");
  });
});

describe("numeri in formato italiano", () => {
  it("formatM2", () => {
    expect(formatM2(0.12)).toBe("0,12 m²");
    expect(formatM2(0.4636)).toBe("0,46 m²");
    expect(plain(formatM2(12345.678))).toBe("12.345,68 m²");
    expect(formatM2(null)).toBe("0,00 m²");
    expect(formatM2(undefined)).toBe("0,00 m²");
  });

  it("formatEuro", () => {
    expect(plain(formatEuro(12.5))).toBe("12,50 €");
    expect(plain(formatEuro(12345.5))).toBe("12.345,50 €");
    expect(plain(formatEuro(0))).toBe("0,00 €");
    expect(formatEuro(null)).toBe("");
  });

  it("formatKg e formatNumber", () => {
    expect(formatKg(3.5)).toBe("3,50 kg");
    expect(formatKg(null)).toBe("");
    expect(formatNumber(2.345, 1)).toBe("2,3");
    expect(formatNumber(NaN)).toBe("");
    expect(formatNumber(null)).toBe("");
    expect(plain(formatNumber(12345.5, 2, "en"))).toBe("12,345.50");
    expect(plain(formatNumber(12345.5, 2, "de"))).toBe("12.345,50");
  });
});

describe("mesi", () => {
  it("formatMonth", () => {
    expect(formatMonth("2026-10")).toBe("ottobre 2026");
    expect(formatMonth("2026-01")).toBe("gennaio 2026");
    expect(formatMonth("2025-12")).toBe("dicembre 2025");
  });

  it("todayIso e currentMonthIso", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(currentMonthIso()).toBe(todayIso().slice(0, 7));
  });
});
