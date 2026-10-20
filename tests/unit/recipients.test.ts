import { describe, expect, it } from "vitest";
import { formatEmailList, invalidEmails, isValidEmail, parseEmailList } from "@/lib/email/recipients";

describe("isValidEmail", () => {
  it.each(["info@bgpgroup.it", "m.verdi@posta.example", "nome.cognome+campioni@studio-arch.co.uk", "  info@corvino.example  "])(
    "valido: %s",
    (email) => expect(isValidEmail(email)).toBe(true),
  );

  it.each(["", "pippo", "a@b", "@bgpgroup.it", "info@", "info @bgpgroup.it", "a@b.it;c@d.it", "<a@b.it>", "www.rossi ceramiche.com"])(
    "non valido: %j",
    (email) => expect(isValidEmail(email)).toBe(false),
  );
});

describe("parseEmailList", () => {
  it("lista BGP separata da ';' con ';' finale", () => {
    expect(parseEmailList("info@corvino.example;fatture.fornitori@corvino.example;")).toEqual([
      "info@corvino.example",
      "fatture.fornitori@corvino.example",
    ]);
  });

  it("virgole, spazi e a capo come separatori", () => {
    expect(parseEmailList("a@x.it, b@y.it  c@z.it\nd@w.it; e@v.it")).toEqual(["a@x.it", "b@y.it", "c@z.it", "d@w.it", "e@v.it"]);
  });

  it("spazi iniziali e finali (celle del file Airtable)", () => {
    expect(parseEmailList(" info@angolobergamo.example; ")).toEqual(["info@angolobergamo.example"]);
  });

  it("toglie il prefisso mailto: (anche maiuscolo)", () => {
    expect(parseEmailList("mailto:info@bgpgroup.it; MAILTO:ufficio@bgpgroup.it")).toEqual([
      "info@bgpgroup.it",
      "ufficio@bgpgroup.it",
    ]);
  });

  it("elimina i duplicati senza distinguere maiuscole, mantenendo la prima grafia", () => {
    expect(parseEmailList("Info@BGPgroup.it; info@bgpgroup.it;INFO@BGPGROUP.IT; altro@bgpgroup.it")).toEqual([
      "Info@BGPgroup.it",
      "altro@bgpgroup.it",
    ]);
  });

  it("scarta le voci non valide", () => {
    expect(parseEmailList("NO MAIL  - NO COMPUTER")).toEqual([]);
    expect(parseEmailList("www.rossi ceramiche.com")).toEqual([]);
    expect(parseEmailList("Ufficio Acquisti ; acquisti@ditta.it")).toEqual(["acquisti@ditta.it"]);
  });

  it("valori vuoti", () => {
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList("")).toEqual([]);
    expect(parseEmailList(" ; ; ")).toEqual([]);
  });

  it("accetta anche un array (impostazioni salvate come lista)", () => {
    expect(parseEmailList(["magazzino@bgpgroup.it", " MAGAZZINO@bgpgroup.it ", "non valida"])).toEqual(["magazzino@bgpgroup.it"]);
  });

  it("indirizzi con etichetta o tra parentesi del file contatti BGP: tiene solo l'indirizzo", () => {
    // Celle reali di Lista_clienti_Airtable.xlsx: oggi l'etichetta resta attaccata all'indirizzo
    // (es. "DDT:verificadocumenti@ondagroup.example"), che non è un indirizzo valido.
    expect(parseEmailList("Per ordini:ordine@ondagroup.example;Per DDT:verificadocumenti@ondagroup.example;r.conti@ondagroup.example;")).toEqual([
      "ordine@ondagroup.example",
      "verificadocumenti@ondagroup.example",
      "r.conti@ondagroup.example",
    ]);
    expect(parseEmailList("paolo@novaceramiche.example;Per DDT:amministrazione@novaceramiche.example>")).toEqual([
      "paolo@novaceramiche.example",
      "amministrazione@novaceramiche.example",
    ]);
    expect(parseEmailList("VEDI FILIALE DI COMPETENZA - Filiale Cento:showroom.ce@ceramichecento.example;")).toEqual([
      "showroom.ce@ceramichecento.example",
    ]);
    expect(parseEmailList("'galli.ugo (galli.ugo@posta.example)'")).toEqual(["galli.ugo@posta.example"]);
    expect(parseEmailList("rbianchi8@posta.example.;")).toEqual(["rbianchi8@posta.example"]);
  });
});

describe("invalidEmails e formatEmailList", () => {
  it("invalidEmails segnala le voci non valide nell'ordine in cui compaiono", () => {
    expect(invalidEmails("a@x.it; pippo, b@; c@y.it")).toEqual(["pippo", "b@"]);
    expect(invalidEmails("a@x.it; b@y.it;")).toEqual([]);
    expect(invalidEmails(null)).toEqual([]);
  });

  it("formatEmailList unisce con '; '", () => {
    expect(formatEmailList(["a@x.it", "b@y.it"])).toBe("a@x.it; b@y.it");
    expect(formatEmailList([])).toBe("");
  });

  it("parse → format è stabile (forma normalizzata salvata nel DB)", () => {
    const normalized = formatEmailList(parseEmailList("info@corvino.example;fatture.fornitori@corvino.example;"));
    expect(normalized).toBe("info@corvino.example; fatture.fornitori@corvino.example");
    expect(formatEmailList(parseEmailList(normalized))).toBe(normalized);
  });
});
