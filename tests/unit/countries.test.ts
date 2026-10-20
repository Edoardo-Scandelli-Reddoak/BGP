import { describe, expect, it } from "vitest";
import {
  COUNTRIES,
  COUNTRY_NAMES,
  countryKey,
  isItaly,
  ITALY,
  normalizeCountry,
  recognizeCountry,
} from "@/lib/countries";

describe("elenco dei paesi", () => {
  it("nessuna variante (nome, sigla, alias) indica due paesi diversi", () => {
    const owner = new Map<string, string>();
    const conflicts: string[] = [];
    for (const c of COUNTRIES) {
      for (const v of [c.name, c.iso2, c.iso3, ...c.aliases]) {
        const key = countryKey(v);
        expect(key, `${c.name}: «${v}»`).not.toBe("");
        const prev = owner.get(key);
        if (prev && prev !== c.name) conflicts.push(`«${v}»: ${prev} / ${c.name}`);
        owner.set(key, c.name);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("sigle ISO: 2 e 3 lettere maiuscole, senza doppioni", () => {
    const iso2 = COUNTRIES.map((c) => c.iso2);
    const iso3 = COUNTRIES.map((c) => c.iso3);
    for (const c of COUNTRIES) {
      expect(c.iso2, c.name).toMatch(/^[A-Z]{2}$/);
      expect(c.iso3, c.name).toMatch(/^[A-Z]{3}$/);
    }
    expect(new Set(iso2).size).toBe(iso2.length);
    expect(new Set(iso3).size).toBe(iso3.length);
  });

  it("suggerimenti: tutti i nomi canonici una volta sola, Italia e paesi frequenti in testa", () => {
    expect(COUNTRY_NAMES[0]).toBe(ITALY);
    expect(COUNTRY_NAMES.slice(1, 4)).toEqual(["Svizzera", "Francia", "Germania"]);
    expect(new Set(COUNTRY_NAMES).size).toBe(COUNTRY_NAMES.length);
    expect([...COUNTRY_NAMES].sort()).toEqual(COUNTRIES.map((c) => c.name).sort());
    // dopo i frequenti: ordine alfabetico italiano
    const rest = COUNTRY_NAMES.slice(COUNTRY_NAMES.indexOf("Regno Unito") + 1);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, "it")));
    expect(rest[0]).toBe("Albania");
  });

  it("paesi richiesti: UE, EFTA, Regno Unito, Balcani, microstati e mercati principali", () => {
    for (const name of [
      "Austria", "Belgio", "Bulgaria", "Cipro", "Croazia", "Danimarca", "Estonia", "Finlandia", "Francia", "Germania",
      "Grecia", "Irlanda", "Italia", "Lettonia", "Lituania", "Lussemburgo", "Malta", "Paesi Bassi", "Polonia",
      "Portogallo", "Repubblica Ceca", "Romania", "Slovacchia", "Slovenia", "Spagna", "Svezia", "Ungheria",
      "Islanda", "Liechtenstein", "Norvegia", "Svizzera", "Regno Unito",
      "Albania", "Bosnia ed Erzegovina", "Kosovo", "Macedonia del Nord", "Montenegro", "Serbia",
      "San Marino", "Città del Vaticano", "Principato di Monaco", "Andorra",
      "Stati Uniti", "Canada", "Messico", "Brasile", "Argentina", "Australia", "Cina", "Giappone", "Corea del Sud",
      "India", "Emirati Arabi Uniti", "Arabia Saudita", "Qatar", "Israele", "Turchia", "Russia", "Ucraina", "Egitto",
      "Marocco", "Tunisia", "Sudafrica", "Singapore", "Hong Kong",
    ]) {
      expect(COUNTRY_NAMES, name).toContain(name);
    }
  });
});

describe("recognizeCountry", () => {
  const cases: [string, string][] = [
    // sigle ISO a 2 e 3 lettere (anche quelle che negli indirizzi sono sigle di provincia)
    ["IT", "Italia"],
    ["ita", "Italia"],
    ["CH", "Svizzera"],
    ["CHE", "Svizzera"],
    ["SM", "San Marino"],
    ["FR", "Francia"],
    ["DEU", "Germania"],
    ["hr", "Croazia"],
    ["GB", "Regno Unito"],
    ["MC", "Principato di Monaco"],
    // nomi in italiano, inglese, francese, tedesco, spagnolo e nella lingua locale
    ["ITALIA", "Italia"],
    [" italy ", "Italia"],
    ["Italien", "Italia"],
    ["Hrvatska", "Croazia"],
    ["Slovenija", "Slovenia"],
    ["SLO", "Slovenia"],
    ["Schweiz", "Svizzera"],
    ["Suisse", "Svizzera"],
    ["SVIZZERA", "Svizzera"],
    ["Österreich", "Austria"],
    ["Oesterreich", "Austria"],
    ["Deutschland", "Germania"],
    ["Allemagne", "Germania"],
    ["España", "Spagna"],
    ["espana", "Spagna"],
    ["Nederland", "Paesi Bassi"],
    ["Holland", "Paesi Bassi"],
    ["Olanda", "Paesi Bassi"],
    ["The Netherlands", "Paesi Bassi"],
    ["België", "Belgio"],
    ["Belgique", "Belgio"],
    ["Polska", "Polonia"],
    ["Česko", "Repubblica Ceca"],
    ["Czechia", "Repubblica Ceca"],
    ["Czech Republic", "Repubblica Ceca"],
    ["Magyarország", "Ungheria"],
    ["România", "Romania"],
    ["Ελλάδα", "Grecia"],
    ["Србија", "Serbia"],
    ["Türkiye", "Turchia"],
    ["Großbritannien", "Regno Unito"],
    ["Grossbritannien", "Regno Unito"],
    // forme comuni
    ["UK", "Regno Unito"],
    ["U.K.", "Regno Unito"],
    ["Gran Bretagna", "Regno Unito"],
    ["Inghilterra", "Regno Unito"],
    ["England", "Regno Unito"],
    ["USA", "Stati Uniti"],
    ["U.S.A.", "Stati Uniti"],
    ["Stati Uniti d'America", "Stati Uniti"],
    ["stati uniti d america", "Stati Uniti"],
    ["United States of America", "Stati Uniti"],
    ["EAU", "Emirati Arabi Uniti"],
    ["UAE", "Emirati Arabi Uniti"],
    ["Emirati Arabi", "Emirati Arabi Uniti"],
    ["Repubblica di San Marino", "San Marino"],
    ["RSM", "San Marino"],
    ["Rep. San Marino", "San Marino"],
    ["Monaco", "Principato di Monaco"],
    ["Vaticano", "Città del Vaticano"],
    ["citta del vaticano", "Città del Vaticano"],
    ["Bosnia & Herzegovina", "Bosnia ed Erzegovina"],
    ["Bosnia-Erzegovina", "Bosnia ed Erzegovina"],
    ["North Macedonia", "Macedonia del Nord"],
    ["Corea", "Corea del Sud"],
    ["Perù", "Perù"],
    ["peru", "Perù"],
    // spazi, punteggiatura e a capo
    ["  Regno   Unito ", "Regno Unito"],
    ["Paesi\nBassi", "Paesi Bassi"],
    ["Italia.", "Italia"],
    // indicazione tra parentesi
    ["Svizzera (TI)", "Svizzera"],
    ["Italia (BG)", "Italia"],
  ];

  it.each(cases)("«%s» → %s", (raw, expected) => {
    expect(recognizeCountry(raw)).toBe(expected);
  });

  it("valori vuoti o non riconosciuti → null", () => {
    for (const v of [null, undefined, "", "   ", "Frnce", "Atlantide", "Svizzera Italiana", "(TI)", "BG Bergamo"]) {
      expect(recognizeCountry(v), String(v)).toBeNull();
    }
  });

  it("i nomi canonici riconoscono sé stessi", () => {
    for (const name of COUNTRY_NAMES) expect(recognizeCountry(name), name).toBe(name);
  });
});

describe("normalizeCountry", () => {
  it("paese riconosciuto → nome canonico in italiano", () => {
    expect(normalizeCountry("france")).toBe("Francia");
    expect(normalizeCountry(" CH ")).toBe("Svizzera");
    expect(normalizeCountry("Hrvatska")).toBe("Croazia");
  });

  it("non riconosciuto → il testo com'è (spazi normalizzati)", () => {
    expect(normalizeCountry("  Frnce ")).toBe("Frnce");
    expect(normalizeCountry("Isole   Fær Øer")).toBe("Isole Fær Øer");
  });

  it("vuoto → null", () => {
    for (const v of [null, undefined, "", "  \n "]) expect(normalizeCountry(v), String(v)).toBeNull();
  });

  it("senza lettere né cifre («-», «?», «/») → null, come vuoto («-» è il filtro «Paese non indicato»)", () => {
    for (const v of ["-", " — ", "?", "/", "..."]) expect(normalizeCountry(v), v).toBeNull();
  });
});

describe("isItaly", () => {
  it("Italia in tutte le forme riconosciute", () => {
    for (const v of ["Italia", "ITALIA", " italy ", "IT", "ita", "Italie", "Italien", "Repubblica Italiana", "Italia (BG)"]) {
      expect(isItaly(v), v).toBe(true);
    }
  });

  it("altri paesi, valori non riconosciuti e vuoti: no", () => {
    for (const v of ["San Marino", "SM", "Città del Vaticano", "Svizzera", "Frnce", "", null, undefined]) {
      expect(isItaly(v), String(v)).toBe(false);
    }
  });
});
