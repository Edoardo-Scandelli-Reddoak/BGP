import { describe, expect, it } from "vitest";
import type { EmailKind, Language } from "@/db/schema";
import { phoneNoticeText } from "@/lib/email/notifications";
import {
  DEFAULT_TEMPLATES,
  EMAIL_KIND_DESCRIPTIONS,
  EMAIL_KIND_LABELS,
  PLACEHOLDERS,
  renderSubject,
  renderTemplate,
  renderTemplateText,
  TEMPLATE_LANGUAGES,
  textToHtml,
  unknownPlaceholders,
  type TemplateVars,
} from "@/lib/email/templates";

type AutoKind = Exclude<EmailKind, "TEST" | "EXPORT_CRM">;

const FULL_VARS: TemplateVars = {
  codice_richiesta: "CAMP-00042",
  data_richiesta: "15/10/2026",
  cliente: "CORVINO SRL",
  email_cliente: "info@corvino.example",
  agente: "LOMBARDI S.N.C. DI P. E F. LOMBARDI",
  prodotti: "- 2 × Mezze doghe — Rovere naturale (10120D001)\n- 1 × Mazzetta — Noce (10120N002)",
  destinatario: "ORBIS FURNITURE SRL",
  alla_ca: "Sig. Rossi",
  destinazione: "VIA F. MERCANTI, 46/R, 16143 GENOVA (GE)",
  preavviso: "Sì, tel. 328 3556565",
  note: "Consegnare al mattino",
  bolla_richiesta: "Sì",
  colli: "2",
  peso_kg: "3,50",
  mq_totali: "0,58",
  corriere: "GLS",
  data_ritiro: "21/10/2026",
  tracking: "1Z999AA10123456784",
  link_tracking: "https://track.example.test/?n=1Z999AA10123456784",
  data_spedizione: "22/10/2026",
  numero_ddt: "13807",
  link_richiesta: "http://localhost:3000/richieste/42",
  firma: "Ufficio Commerciale\nBGP Group S.r.l.",
};

function allTemplates(): { kind: AutoKind; lang: Language; subject: string; body: string }[] {
  return (Object.keys(DEFAULT_TEMPLATES) as AutoKind[]).flatMap((kind) =>
    (Object.entries(DEFAULT_TEMPLATES[kind]) as [Language, { subject: string; body: string }][]).map(([lang, tpl]) => ({
      kind,
      lang,
      ...tpl,
    })),
  );
}

describe("renderTemplateText", () => {
  it("sostituisce i segnaposto", () => {
    expect(renderTemplateText("Richiesta {codice_richiesta} per {cliente}", FULL_VARS)).toBe(
      "Richiesta CAMP-00042 per CORVINO SRL",
    );
  });

  it("omette l'intera riga se un segnaposto è vuoto o mancante", () => {
    const tpl = "Cliente: {cliente}\nNote: {note}\nDDT: {numero_ddt}\nFine";
    expect(renderTemplateText(tpl, { cliente: "X", note: "", numero_ddt: undefined })).toBe("Cliente: X\nFine");
  });

  it("considera vuoto un valore di soli spazi", () => {
    expect(renderTemplateText("A\nNote: {note}\nB", { note: "   " })).toBe("A\nB");
  });

  it("omette la riga anche se solo uno dei segnaposto è vuoto", () => {
    expect(renderTemplateText("Colli: {colli} — Peso: {peso_kg} kg\nOK", { colli: "2", peso_kg: "" })).toBe("OK");
  });

  it("mantiene le righe senza segnaposto, comprese quelle vuote singole", () => {
    expect(renderTemplateText("Gentile Cliente,\n\nsaluti", {})).toBe("Gentile Cliente,\n\nsaluti");
  });

  it("lascia invariati i segnaposto sconosciuti e non omette la riga", () => {
    expect(renderTemplateText("Ciao {nome_sbagliato}, {cliente}", { cliente: "Rossi" })).toBe(
      "Ciao {nome_sbagliato}, Rossi",
    );
  });

  it("non lascia mai tre a capo consecutivi dopo l'omissione di righe", () => {
    const tpl = "Inizio\n\nNote: {note}\n\nDDT: {numero_ddt}\n\nFine";
    const out = renderTemplateText(tpl, {});
    expect(out).toBe("Inizio\n\nFine");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("normalizza CRLF e rimuove spazi iniziali/finali", () => {
    expect(renderTemplateText("\r\nRiga 1\r\nRiga 2\r\n\r\n", {})).toBe("Riga 1\nRiga 2");
  });

  it("i valori con più righe (elenco prodotti) vengono inseriti così come sono", () => {
    expect(renderTemplateText("Prodotti:\n{prodotti}", FULL_VARS)).toBe(`Prodotti:\n${FULL_VARS.prodotti}`);
  });

  it("i valori non vengono interpretati come pattern di sostituzione né come segnaposto", () => {
    expect(renderTemplateText("{cliente}", { cliente: "A $& $1 B" })).toBe("A $& $1 B");
    expect(renderTemplateText("{cliente} {note}", { cliente: "{note}", note: "X" })).toBe("{note} X");
  });
});

describe("renderSubject", () => {
  it("sostituisce i segnaposto e non omette nulla", () => {
    expect(renderSubject("INVIO CAMPIONATURA cli. {cliente}", FULL_VARS)).toBe("INVIO CAMPIONATURA cli. CORVINO SRL");
  });

  it("toglie il trattino finale quando l'ultimo segnaposto è vuoto", () => {
    expect(renderSubject("Bolla di consegna richiesta — {codice_richiesta} — {cliente}", { codice_richiesta: "CAMP-00042" })).toBe(
      "Bolla di consegna richiesta — CAMP-00042",
    );
  });

  it("comprime gli spazi multipli", () => {
    expect(renderSubject("A  {note}  B", {})).toBe("A B");
  });

  it("lascia invariati i segnaposto sconosciuti", () => {
    expect(renderSubject("Oggetto {boh}", {})).toBe("Oggetto {boh}");
  });

  it("renderTemplate combina oggetto e corpo", () => {
    const out = renderTemplate({ subject: "S {codice_richiesta}", body: "B {cliente}\nN: {note}" }, { codice_richiesta: "C1", cliente: "X" });
    expect(out).toEqual({ subject: "S C1", body: "B X" });
  });
});

describe("unknownPlaceholders", () => {
  it("restituisce i segnaposto non riconosciuti senza duplicati", () => {
    expect(unknownPlaceholders("{cliente} {clinte} {clinte} {tracking_url}")).toEqual(["clinte", "tracking_url"]);
  });

  it("vuoto per un testo con soli segnaposto validi", () => {
    expect(unknownPlaceholders("{cliente} {tracking} testo { non_segnaposto }")).toEqual([]);
  });

  it("ogni segnaposto documentato è riconosciuto", () => {
    for (const { key } of PLACEHOLDERS) expect(unknownPlaceholders(`{${key}}`), key).toEqual([]);
  });

  it("PLACEHOLDERS documenta esattamente tutte le variabili dei template", () => {
    expect(PLACEHOLDERS.map((p) => p.key).sort()).toEqual(Object.keys(FULL_VARS).sort());
  });

  it("riconosce i segnaposto dei dati richiesti da BGP (destinatario, alla c.a., preavviso)", () => {
    expect(unknownPlaceholders("{destinatario} {alla_ca} {preavviso} {destinazione}")).toEqual([]);
    for (const key of ["destinatario", "alla_ca", "preavviso"]) {
      expect(PLACEHOLDERS.find((p) => p.key === key)?.label, key).toBeTruthy();
    }
  });
});

describe("dati di presa in carico nelle email (destinatario, alla c.a., formato, preavviso)", () => {
  const warehouse = DEFAULT_TEMPLATES.AVVISO_MAGAZZINO.it!;
  const bolla = DEFAULT_TEMPLATES.AVVISO_BOLLA.it!;

  it.each([
    ["AVVISO_MAGAZZINO", warehouse],
    ["AVVISO_BOLLA", bolla],
  ] as const)("%s contiene destinatario, alla c.a., indirizzo, preavviso e prodotti", (_kind, tpl) => {
    for (const key of ["destinatario", "alla_ca", "destinazione", "preavviso", "prodotti"]) {
      expect(tpl.body, key).toContain(`{${key}}`);
    }
  });

  it("avviso magazzino completo: ogni dato sulla sua riga", () => {
    const body = renderTemplate(warehouse, FULL_VARS).body;
    expect(body).toContain("Destinatario: ORBIS FURNITURE SRL\nAlla c.a.: Sig. Rossi\nIndirizzo: VIA F. MERCANTI, 46/R, 16143 GENOVA (GE)");
    expect(body).toContain("Preavviso telefonico: Sì, tel. 328 3556565");
    expect(body).toContain("Prodotti (quantità × formato):\n- 2 × Mezze doghe — Rovere naturale (10120D001)\n- 1 × Mazzetta — Noce");
  });

  it("senza «alla c.a.» e con preavviso non indicato le righe spariscono", () => {
    const body = renderTemplate(warehouse, { ...FULL_VARS, alla_ca: "", preavviso: "" }).body;
    expect(body).not.toContain("Alla c.a.");
    expect(body).not.toContain("Preavviso telefonico");
    expect(body).toContain("Destinatario: ORBIS FURNITURE SRL\nIndirizzo: ");
  });

  it("preavviso «No» resta visibile (il magazzino sa che è stato chiesto)", () => {
    const body = renderTemplate(bolla, { ...FULL_VARS, preavviso: "No" }).body;
    expect(body).toContain("Preavviso telefonico: No");
  });

  it("phoneNoticeText: sì con numero, no, non indicato — nella lingua del destinatario", () => {
    expect(phoneNoticeText(true, " 328 3556565 ")).toBe("Sì, tel. 328 3556565");
    expect(phoneNoticeText(true, null)).toBe("Sì, tel.");
    expect(phoneNoticeText(false, "328 3556565")).toBe("No");
    expect(phoneNoticeText(null, "328 3556565")).toBe("");
    expect(phoneNoticeText(true, "+44 20 7946 0000", "en")).toBe("Yes, phone +44 20 7946 0000");
    expect(phoneNoticeText(false, null, "fr")).toBe("Non");
    expect(phoneNoticeText(true, "0049 89 123", "de")).toBe("Ja, Tel. 0049 89 123");
  });
});

describe("textToHtml", () => {
  it("fa l'escape dell'HTML", () => {
    const html = textToHtml(`<script>alert("x")</script> & 'ok'`);
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; 'ok'");
    expect(html).not.toContain("<script>");
  });

  it("paragrafi per le righe vuote, <br> per gli a capo", () => {
    const html = textToHtml("Riga 1\nRiga 2\n\nParagrafo 2");
    expect(html).toContain(">Riga 1<br>Riga 2</p>");
    expect(html).toContain(">Paragrafo 2</p>");
    expect(html.match(/<p /g)).toHaveLength(2);
  });

  it("rende cliccabili i link", () => {
    const html = textToHtml("Segui la spedizione: https://www.ups.com/track?loc=it_IT&tracknum=1Z9 grazie");
    expect(html).toContain(
      '<a href="https://www.ups.com/track?loc=it_IT&amp;tracknum=1Z9" style="color:#1e3a8a">https://www.ups.com/track?loc=it_IT&amp;tracknum=1Z9</a> grazie',
    );
  });

  it("un link con virgolette non può uscire dall'attributo href", () => {
    const html = textToHtml('https://x.test/"onmouseover="alert(1)');
    const href = html.match(/href="([^"]*)"/)?.[1];
    expect(href).toBe("https://x.test/&quot;onmouseover=&quot;alert(1)");
    expect(html).not.toContain('" onmouseover');
  });

  it("aggiunge l'immagine della firma solo con il cid", () => {
    expect(textToHtml("Saluti", "firma-bgp")).toContain('<img src="cid:firma-bgp"');
    expect(textToHtml("Saluti")).not.toContain("<img");
  });

  it("produce un documento HTML completo", () => {
    const html = textToHtml("Ciao");
    expect(html.startsWith("<!doctype html><html><body")).toBe(true);
    expect(html.endsWith("</body></html>")).toBe(true);
  });
});

describe("DEFAULT_TEMPLATES", () => {
  it("TEMPLATE_LANGUAGES coincide con le lingue dei template predefiniti", () => {
    expect(Object.keys(TEMPLATE_LANGUAGES).sort()).toEqual(Object.keys(DEFAULT_TEMPLATES).sort());
    for (const kind of Object.keys(DEFAULT_TEMPLATES) as AutoKind[]) {
      expect(Object.keys(DEFAULT_TEMPLATES[kind]).sort(), kind).toEqual([...TEMPLATE_LANGUAGES[kind]].sort());
      expect(TEMPLATE_LANGUAGES[kind], kind).toContain("it");
    }
  });

  it("la conferma al cliente esiste in tutte le lingue dei contatti", () => {
    expect([...TEMPLATE_LANGUAGES.CONFERMA_SPEDIZIONE].sort()).toEqual(["de", "en", "fr", "it"]);
  });

  it("ogni tipo di email ha etichetta e descrizione", () => {
    for (const kind of ["AVVISO_MAGAZZINO", "CONFERMA_SPEDIZIONE", "AVVISO_BOLLA", "TEST"] as EmailKind[]) {
      expect(EMAIL_KIND_LABELS[kind]).toBeTruthy();
      expect(EMAIL_KIND_DESCRIPTIONS[kind]).toBeTruthy();
    }
  });

  it.each(allTemplates())("$kind/$lang usa solo segnaposto validi", ({ subject, body }) => {
    expect(unknownPlaceholders(subject)).toEqual([]);
    expect(unknownPlaceholders(body)).toEqual([]);
  });

  it.each(allTemplates())("$kind/$lang con tutti i dati non lascia segnaposto né righe vuote multiple", (tpl) => {
    const out = renderTemplate(tpl, FULL_VARS);
    expect(out.subject).not.toMatch(/[{}]/);
    expect(out.body).not.toMatch(/[{}]/);
    expect(out.body).not.toMatch(/\n{3,}/);
    expect(out.subject).not.toContain("\n");
  });

  it.each(allTemplates().filter((t) => t.kind === "CONFERMA_SPEDIZIONE"))(
    "conferma $lang: tracking, data, corriere e firma; nessun link interno",
    ({ subject, body }) => {
      for (const key of ["tracking", "data_spedizione", "corriere", "firma", "prodotti"]) {
        expect(body, key).toContain(`{${key}}`);
      }
      expect(subject).toContain("{cliente}");
      // Il link al gestionale è solo per le email interne.
      expect(body).not.toContain("{link_richiesta}");
      expect(subject).not.toContain("{link_richiesta}");
    },
  );

  it.each(allTemplates().filter((t) => t.kind !== "CONFERMA_SPEDIZIONE"))(
    "avviso interno $kind: contiene codice richiesta e link al gestionale",
    ({ subject, body }) => {
      expect(subject).toContain("{codice_richiesta}");
      expect(body).toContain("{link_richiesta}");
    },
  );

  it("conferma senza DDT e senza link di tracking: le righe relative spariscono", () => {
    const vars = { ...FULL_VARS, numero_ddt: "", link_tracking: "" };
    const it_ = renderTemplate(DEFAULT_TEMPLATES.CONFERMA_SPEDIZIONE.it!, vars).body;
    expect(it_).not.toContain("Rif. DDT");
    expect(it_).not.toContain("Può seguire la spedizione");
    expect(it_).toContain("Numero di spedizione: 1Z999AA10123456784");
    const en = renderTemplate(DEFAULT_TEMPLATES.CONFERMA_SPEDIZIONE.en!, vars).body;
    expect(en).not.toContain("Delivery note");
    expect(en).toContain("Tracking number: 1Z999AA10123456784");
  });

  it("avviso magazzino senza note: la riga Note sparisce", () => {
    const out = renderTemplate(DEFAULT_TEMPLATES.AVVISO_MAGAZZINO.it!, { ...FULL_VARS, note: "" });
    expect(out.subject).toBe("Nuovo campionario da preparare — CAMP-00042");
    expect(out.body).not.toContain("Note:");
    expect(out.body).toContain("Bolla di consegna richiesta: Sì");
  });
});
