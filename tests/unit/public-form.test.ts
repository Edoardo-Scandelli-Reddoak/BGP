import { describe, expect, it } from "vitest";
import { publicRequestInput, type PublicRequestInput } from "@/lib/requests/public";
import { SAMPLE_FORMATS } from "@/lib/sample-formats";

/**
 * Regole del modulo pubblico /richiedi-campioni (src/lib/requests/public.ts): i dati che BGP chiede per
 * prendere in carico una richiesta. «Alla c.a.» obbligatorio salvo destinatario privato, preavviso
 * telefonico Sì/No obbligatorio (con un numero vero se Sì), formato del campione su ogni riga.
 */

function payload(overrides: Partial<Record<keyof PublicRequestInput, unknown>> = {}): Record<string, unknown> {
  return {
    requesterType: "CLIENTE",
    requesterName: "Mario Rossi",
    requesterEmail: "Mario.Rossi@Example.com",
    recipientName: "Rossi Arredamenti Srl",
    recipientIsPrivate: false,
    attentionOf: "Sig. Bianchi",
    address: "Via Roma 1, 24023 Clusone (BG)",
    country: "Italia",
    language: "it",
    phoneNotice: true,
    phoneNoticeNumber: "035 123456",
    items: [{ productId: 1, quantity: 2, sampleFormat: "MAZZETTA" }],
    consent: true,
    ...overrides,
  };
}

/** Errori per campo (percorso → messaggi). */
function errors(value: unknown): Record<string, string[]> {
  const res = publicRequestInput.safeParse(value);
  if (res.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of res.error.issues) (out[issue.path.join(".")] ??= []).push(issue.message);
  return out;
}

describe("modulo pubblico: dati completi", () => {
  it("richiesta completa: valida (email del richiedente in minuscolo)", () => {
    const res = publicRequestInput.safeParse(payload());
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      requesterEmail: "mario.rossi@example.com",
      attentionOf: "Sig. Bianchi",
      recipientIsPrivate: false,
      phoneNotice: true,
      phoneNoticeNumber: "035 123456",
      items: [{ productId: 1, quantity: 2, sampleFormat: "MAZZETTA", formatNote: null }],
    });
  });
});

describe("modulo pubblico: «alla c.a.» obbligatorio salvo destinatario privato", () => {
  it("ditta senza persona di riferimento: errore sul campo «alla c.a.»", () => {
    for (const attentionOf of [undefined, null, "", "   "]) {
      const e = errors(payload({ attentionOf }));
      expect(Object.keys(e), String(attentionOf)).toEqual(["attentionOf"]);
      expect(e.attentionOf[0]).toMatch(/privato/);
    }
  });

  it("spunta «privato» non indicata: vale «ditta» (serve la persona)", () => {
    const { recipientIsPrivate: _omit, ...rest } = payload({ attentionOf: null });
    void _omit;
    expect(Object.keys(errors(rest))).toEqual(["attentionOf"]);
  });

  it("destinatario privato: «alla c.a.» non serve", () => {
    expect(errors(payload({ recipientIsPrivate: true, attentionOf: null }))).toEqual({});
    expect(errors(payload({ recipientIsPrivate: true, attentionOf: "Sig. Bianchi" }))).toEqual({});
  });
});

describe("modulo pubblico: preavviso telefonico", () => {
  it("Sì/No va scelto: nessun valore predefinito", () => {
    for (const phoneNotice of [undefined, null, "true", "si"]) {
      const e = errors(payload({ phoneNotice, phoneNoticeNumber: null }));
      expect(Object.keys(e), String(phoneNotice)).toEqual(["phoneNotice"]);
      expect(e.phoneNotice[0]).toBe("Indica se serve il preavviso telefonico prima della consegna");
    }
  });

  it("«No»: il numero non serve", () => {
    expect(errors(payload({ phoneNotice: false, phoneNoticeNumber: null }))).toEqual({});
    expect(errors(payload({ phoneNotice: false, phoneNoticeNumber: "" }))).toEqual({});
  });

  it("«Sì» senza numero: errore sul numero", () => {
    for (const phoneNoticeNumber of [undefined, null, "", "   "]) {
      const e = errors(payload({ phoneNoticeNumber }));
      expect(Object.keys(e), String(phoneNoticeNumber)).toEqual(["phoneNoticeNumber"]);
      expect(e.phoneNoticeNumber[0]).toMatch(/numero di telefono per il preavviso/);
    }
  });

  it("«Sì» con un numero senza cifre o troppo corto: rifiutato", () => {
    for (const phoneNoticeNumber of ["abc", "-----", "(+) / .", "12345", "+39 123", "tel. 035 123456"]) {
      const e = errors(payload({ phoneNoticeNumber }));
      expect(Object.keys(e), phoneNoticeNumber).toEqual(["phoneNoticeNumber"]);
      expect(e.phoneNoticeNumber[0], phoneNoticeNumber).toMatch(/Numero di telefono non valido/);
    }
  });

  it("«Sì» con un numero vero, nelle forme usate di solito: valido", () => {
    for (const phoneNoticeNumber of ["035 123456", "+39 328 355 6565", "(035) 12.34.56", "328/3556565", "0346-25200"]) {
      expect(errors(payload({ phoneNoticeNumber })), phoneNoticeNumber).toEqual({});
    }
  });
});

describe("modulo pubblico: formato del campione su ogni riga", () => {
  it("riga senza formato o con un formato sconosciuto: errore sulla riga", () => {
    for (const sampleFormat of [undefined, null, "", "SCATOLA"]) {
      const e = errors(payload({ items: [{ productId: 1, quantity: 1, sampleFormat }] }));
      expect(e, String(sampleFormat)).toEqual({ "items.0.sampleFormat": ["Scegli il formato del campione"] });
    }
  });

  it("errore sulla riga giusta quando manca su una sola delle righe", () => {
    const items = [
      { productId: 1, quantity: 1, sampleFormat: "MAZZETTA" },
      { productId: 2, quantity: 1 },
      { productId: 3, quantity: 1, sampleFormat: "PANNELLO" },
    ];
    expect(Object.keys(errors(payload({ items })))).toEqual(["items.1.sampleFormat"]);
  });

  it("«Altro» richiede la descrizione del formato", () => {
    expect(errors(payload({ items: [{ productId: 1, quantity: 1, sampleFormat: "ALTRO", formatNote: "  " }] }))).toEqual({
      "items.0.formatNote": ["Descrivi il formato richiesto"],
    });
    expect(errors(payload({ items: [{ productId: 1, quantity: 1, sampleFormat: "ALTRO", formatNote: "listello 30 cm" }] }))).toEqual({});
  });

  it("tutti i formati previsti sono accettati", () => {
    const items = SAMPLE_FORMATS.map((sampleFormat, i) => ({
      productId: i + 1,
      quantity: 1,
      sampleFormat,
      formatNote: sampleFormat === "ALTRO" ? "a misura" : null,
    }));
    expect(errors(payload({ items }))).toEqual({});
  });

  it("almeno un prodotto, quantità entro i limiti", () => {
    expect(errors(payload({ items: [] }))).toEqual({ items: ["Aggiungi almeno un prodotto"] });
    expect(Object.keys(errors(payload({ items: [{ productId: 1, quantity: 21, sampleFormat: "MAZZETTA" }] })))).toEqual([
      "items.0.quantity",
    ]);
  });
});

describe("modulo pubblico: tutti gli errori in un solo invio", () => {
  it("con altri campi errati si vedono comunque «alla c.a.», numero del preavviso e formato", () => {
    const e = errors(
      payload({
        requesterEmail: "non-una-email",
        attentionOf: null,
        phoneNoticeNumber: null,
        items: [{ productId: 1, quantity: 1, sampleFormat: "" }],
        consent: false,
      }),
    );
    expect(Object.keys(e).sort()).toEqual(
      ["attentionOf", "consent", "items.0.sampleFormat", "phoneNoticeNumber", "requesterEmail"].sort(),
    );
  });
});
