import { describe, expect, it } from "vitest";
import { csvDecimal, csvEscape, csvRow, toCsv } from "./csv";

describe("csvEscape", () => {
  it("lascia invariato il testo semplice", () => {
    expect(csvEscape("PL002ABCM")).toBe("PL002ABCM");
    expect(csvEscape("Rovere, spazzolato")).toBe("Rovere, spazzolato");
  });

  it("mette tra virgolette i campi con ; virgolette o a capo", () => {
    expect(csvEscape("a;b")).toBe('"a;b"');
    expect(csvEscape('scelta UNI "t"')).toBe('"scelta UNI ""t"""');
    expect(csvEscape("riga 1\nriga 2")).toBe('"riga 1\nriga 2"');
    expect(csvEscape("riga 1\r\nriga 2")).toBe('"riga 1\r\nriga 2"');
  });

  it("valori vuoti e numeri", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape(12)).toBe("12");
    expect(csvEscape(0.5)).toBe("0,5");
    expect(csvEscape(Number.NaN)).toBe("");
  });

  it("neutralizza le formule (CSV injection) ma non i numeri negativi", () => {
    expect(csvEscape("=SOMMA(A1:A2)")).toBe("'=SOMMA(A1:A2)");
    expect(csvEscape("@cmd")).toBe("'@cmd");
    expect(csvEscape("+39 035")).toBe("'+39 035");
    expect(csvEscape("-12,5")).toBe("-12,5");
    expect(csvEscape('=HYPERLINK("x";"y")')).toBe('"\'=HYPERLINK(""x"";""y"")"');
  });
});

describe("csvDecimal", () => {
  it("usa la virgola decimale senza separatore delle migliaia", () => {
    expect(csvDecimal(1234.5)).toBe("1234,50");
    expect(csvDecimal(0.8832)).toBe("0,88");
    expect(csvDecimal(1.005, 1)).toBe("1,0");
    expect(csvDecimal(null)).toBe("");
  });
});

describe("toCsv", () => {
  it("BOM, separatore ; e righe CRLF", () => {
    const out = toCsv(["Codice", "m2"], [["A;1", "1,50"], ["B", null]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe('﻿Codice;m2\r\n"A;1";1,50\r\nB;\r\n');
    expect(csvRow(["x", 2, null])).toBe("x;2;");
  });
});
