import type { EmailKind, Language } from "@/db/schema";

/**
 * Template delle email automatiche (blueprint BGP, sezione 5) + conferma di spedizione
 * modellata sull'email che l'ufficio commerciale invia oggi ("INVIO CAMPIONATURA cli. …").
 *
 * Sintassi: segnaposto {nome}. Regola delle righe: se una riga contiene almeno un segnaposto
 * vuoto, l'intera riga viene omessa (es. "Note: {note}" sparisce quando non ci sono note).
 */

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  AVVISO_MAGAZZINO: "Avviso al magazzino",
  CONFERMA_SPEDIZIONE: "Conferma di spedizione al cliente",
  AVVISO_BOLLA: "Avviso bolla di consegna alla logistica",
  TEST: "Email di prova",
};

export const EMAIL_KIND_DESCRIPTIONS: Record<EmailKind, string> = {
  AVVISO_MAGAZZINO:
    "Parte quando il back office invia la richiesta al magazzino (stato «In preparazione»). Destinatari: indirizzi del magazzino nelle impostazioni.",
  CONFERMA_SPEDIZIONE:
    "Parte quando la richiesta è «Spedita» e la logistica ha inserito tracking e data di spedizione. Al contatto, con l'agente in copia, nella lingua del contatto.",
  AVVISO_BOLLA:
    "Parte quando una richiesta con «bolla di consegna richiesta» diventa «Pronta per il ritiro», o quando la bolla viene richiesta su una richiesta già pronta. Destinatari: indirizzi della logistica nelle impostazioni.",
  TEST: "Email di prova inviata dalle impostazioni.",
};

/** Le email interne sono solo in italiano; la conferma al cliente in tutte le lingue. */
export const TEMPLATE_LANGUAGES: Record<Exclude<EmailKind, "TEST">, Language[]> = {
  AVVISO_MAGAZZINO: ["it"],
  AVVISO_BOLLA: ["it"],
  CONFERMA_SPEDIZIONE: ["it", "en", "fr", "de"],
};

export type TemplateVars = {
  codice_richiesta: string;
  data_richiesta: string;
  cliente: string;
  email_cliente: string;
  agente: string;
  prodotti: string;
  destinatario: string;
  alla_ca: string;
  destinazione: string;
  preavviso: string;
  note: string;
  bolla_richiesta: string;
  colli: string;
  peso_kg: string;
  mq_totali: string;
  corriere: string;
  data_ritiro: string;
  tracking: string;
  link_tracking: string;
  data_spedizione: string;
  numero_ddt: string;
  link_richiesta: string;
  firma: string;
};

export const PLACEHOLDERS: { key: keyof TemplateVars; label: string }[] = [
  { key: "codice_richiesta", label: "Codice richiesta (es. CAMP-00042)" },
  { key: "data_richiesta", label: "Data di ricezione della richiesta" },
  { key: "cliente", label: "Nome del contatto (cliente o agente)" },
  { key: "email_cliente", label: "Email del contatto" },
  { key: "agente", label: "Agente di riferimento" },
  { key: "prodotti", label: "Elenco prodotti con quantità e formato (una riga per prodotto)" },
  { key: "destinatario", label: "Destinatario (ragione sociale o cognome e nome)" },
  { key: "alla_ca", label: "Alla cortese attenzione di (persona presso la ditta)" },
  { key: "destinazione", label: "Indirizzo di consegna" },
  { key: "preavviso", label: "Preavviso telefonico (es. «Sì, tel. 328 3556565» oppure «No»)" },
  { key: "note", label: "Note della richiesta" },
  { key: "bolla_richiesta", label: "Bolla di consegna richiesta (Sì/No)" },
  { key: "colli", label: "Numero colli" },
  { key: "peso_kg", label: "Peso totale in kg" },
  { key: "mq_totali", label: "m² totali della spedizione" },
  { key: "corriere", label: "Corriere" },
  { key: "data_ritiro", label: "Data di ritiro" },
  { key: "tracking", label: "Numero di tracking / spedizione" },
  { key: "link_tracking", label: "Link per seguire la spedizione (dal corriere)" },
  { key: "data_spedizione", label: "Data di spedizione" },
  { key: "numero_ddt", label: "Numero DDT / bolla" },
  { key: "link_richiesta", label: "Link alla richiesta nel gestionale (solo email interne)" },
  { key: "firma", label: "Firma (dalle impostazioni)" },
];

export type TemplateContent = { subject: string; body: string };

export const DEFAULT_TEMPLATES: Record<
  Exclude<EmailKind, "TEST">,
  Partial<Record<Language, TemplateContent>>
> = {
  AVVISO_MAGAZZINO: {
    it: {
      subject: "Nuovo campionario da preparare — {codice_richiesta}",
      body: [
        "È arrivata una nuova richiesta campioni.",
        "",
        "Richiesta: {codice_richiesta}",
        "Cliente: {cliente}",
        "Prodotti (quantità × formato):",
        "{prodotti}",
        "Destinatario: {destinatario}",
        "Alla c.a.: {alla_ca}",
        "Indirizzo: {destinazione}",
        "Preavviso telefonico: {preavviso}",
        "Bolla di consegna richiesta: {bolla_richiesta}",
        "Note: {note}",
        "",
        "Apri la richiesta per registrare colli, peso e misure dei pezzi, poi segnala come pronta per il ritiro:",
        "{link_richiesta}",
      ].join("\n"),
    },
  },
  AVVISO_BOLLA: {
    it: {
      subject: "Bolla di consegna richiesta — {codice_richiesta} — {cliente}",
      body: [
        "La spedizione seguente richiede la preparazione di una bolla di consegna prima del ritiro.",
        "",
        "Richiesta: {codice_richiesta}",
        "Cliente: {cliente}",
        "Destinatario: {destinatario}",
        "Alla c.a.: {alla_ca}",
        "Indirizzo: {destinazione}",
        "Preavviso telefonico: {preavviso}",
        "Prodotti:",
        "{prodotti}",
        "N° colli: {colli} — Peso: {peso_kg} kg",
        "m² totali: {mq_totali}",
        "",
        "Apri la richiesta per tutti i dettagli e per generare la bolla:",
        "{link_richiesta}",
      ].join("\n"),
    },
  },
  CONFERMA_SPEDIZIONE: {
    it: {
      subject: "INVIO CAMPIONATURA cli. {cliente}",
      body: [
        "Gentile Cliente,",
        "",
        "la presente per informarLa che in data {data_spedizione} è stata spedita la campionatura richiesta.",
        "",
        "Corriere: {corriere}",
        "Numero di spedizione: {tracking}",
        "Può seguire la spedizione al link: {link_tracking}",
        "Rif. DDT N° {numero_ddt}",
        "",
        "Prodotti inviati:",
        "{prodotti}",
        "N° colli: {colli} — Peso: {peso_kg} kg",
        "",
        "Restando a disposizione, porgiamo cordiali saluti.",
        "",
        "{firma}",
      ].join("\n"),
    },
    en: {
      subject: "Samples shipped — {cliente}",
      body: [
        "Dear Customer,",
        "",
        "we are pleased to inform you that the samples you requested were shipped on {data_spedizione}.",
        "",
        "Courier: {corriere}",
        "Tracking number: {tracking}",
        "Track your shipment: {link_tracking}",
        "Delivery note (DDT) no. {numero_ddt}",
        "",
        "Products shipped:",
        "{prodotti}",
        "Packages: {colli} — Weight: {peso_kg} kg",
        "",
        "Please do not hesitate to contact us for any further information.",
        "",
        "Kind regards,",
        "{firma}",
      ].join("\n"),
    },
    fr: {
      subject: "Envoi d'échantillons — {cliente}",
      body: [
        "Cher client,",
        "",
        "nous avons le plaisir de vous informer que les échantillons demandés ont été expédiés le {data_spedizione}.",
        "",
        "Transporteur : {corriere}",
        "Numéro de suivi : {tracking}",
        "Suivi en ligne : {link_tracking}",
        "Bon de livraison (DDT) n° {numero_ddt}",
        "",
        "Produits expédiés :",
        "{prodotti}",
        "Colis : {colli} — Poids : {peso_kg} kg",
        "",
        "Nous restons à votre disposition pour toute information complémentaire.",
        "",
        "Cordialement,",
        "{firma}",
      ].join("\n"),
    },
    de: {
      subject: "Versand der Muster — {cliente}",
      body: [
        "Sehr geehrte Damen und Herren,",
        "",
        "wir freuen uns, Ihnen mitzuteilen, dass die angeforderten Muster am {data_spedizione} versandt wurden.",
        "",
        "Spediteur: {corriere}",
        "Sendungsnummer: {tracking}",
        "Sendungsverfolgung: {link_tracking}",
        "Lieferschein (DDT) Nr. {numero_ddt}",
        "",
        "Versandte Produkte:",
        "{prodotti}",
        "Packstücke: {colli} — Gewicht: {peso_kg} kg",
        "",
        "Für weitere Informationen stehen wir Ihnen gerne zur Verfügung.",
        "",
        "Mit freundlichen Grüßen",
        "{firma}",
      ].join("\n"),
    },
  },
};

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

function isEmptyValue(v: string | undefined): boolean {
  return v === undefined || v.trim() === "";
}

/**
 * Sostituisce i segnaposto. Una riga che contiene un segnaposto vuoto viene rimossa;
 * i segnaposto sconosciuti restano invariati (così un errore di battitura si vede nell'anteprima).
 */
export function renderTemplateText(template: string, vars: Partial<TemplateVars>): string {
  const lines = template.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const keys = [...line.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
    const known = keys.filter((k) => k in emptyVars);
    if (known.some((k) => isEmptyValue(vars[k as keyof TemplateVars]))) continue;
    out.push(
      line.replace(PLACEHOLDER_RE, (match, key: string) =>
        key in emptyVars ? (vars[key as keyof TemplateVars] ?? "") : match,
      ),
    );
  }
  // Niente righe vuote multiple consecutive (possono restare dopo l'omissione di righe).
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** L'oggetto è una sola riga: i segnaposto vuoti vengono sostituiti con stringa vuota. */
export function renderSubject(template: string, vars: Partial<TemplateVars>): string {
  return template
    .replace(PLACEHOLDER_RE, (match, key: string) =>
      key in emptyVars ? (vars[key as keyof TemplateVars] ?? "") : match,
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+—\s*$/, "")
    .trim();
}

export function renderTemplate(tpl: TemplateContent, vars: Partial<TemplateVars>): TemplateContent {
  return { subject: renderSubject(tpl.subject, vars), body: renderTemplateText(tpl.body, vars) };
}

/** Segnaposto presenti nel testo ma non riconosciuti (per avvisi nell'editor dei template). */
export function unknownPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).filter((k) => !(k in emptyVars)))];
}

const emptyVars: Record<keyof TemplateVars, ""> = {
  codice_richiesta: "",
  data_richiesta: "",
  cliente: "",
  email_cliente: "",
  agente: "",
  prodotti: "",
  destinatario: "",
  alla_ca: "",
  destinazione: "",
  preavviso: "",
  note: "",
  bolla_richiesta: "",
  colli: "",
  peso_kg: "",
  mq_totali: "",
  corriere: "",
  data_ritiro: "",
  tracking: "",
  link_tracking: "",
  data_spedizione: "",
  numero_ddt: "",
  link_richiesta: "",
  firma: "",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Versione HTML semplice del testo: paragrafi, a capo e link cliccabili. */
export function textToHtml(text: string, signatureImageCid?: string): string {
  const linked = escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:#1e3a8a">${url}</a>`,
  );
  const paragraphs = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0">${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const image = signatureImageCid
    ? `<p style="margin:8px 0 0 0"><img src="cid:${signatureImageCid}" alt="BGP Group" width="320" style="max-width:100%;height:auto"></p>`
    : "";
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${paragraphs}${image}</body></html>`;
}
