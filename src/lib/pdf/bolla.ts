import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { isAbroad } from "@/lib/config/bolla";
import { formatDate, formatDateTime, formatNumber, requestCode, todayIso } from "@/lib/format";
import type { RequestDetail } from "@/lib/requests/queries";
import { sampleFormatText } from "@/lib/sample-formats";
import type { AppSettings } from "@/lib/settings";
import { clampLines, makeSanitizer, wrapText, type Sanitizer } from "./text";

/**
 * Bolla di consegna (documento di trasporto) in PDF, A4, sul modello del DDT di BGP:
 * intestazione aziendale, numero e data, causale, cessionario (il contatto) e luogo di
 * destinazione (destinatario, «alla c.a.», indirizzo di consegna), tabella articoli con il
 * formato del campione (anche su più pagine, con intestazione ripetuta), preavviso telefonico,
 * note, riquadro colli/aspetto/porto/peso/data/vettore e spazi per le firme.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const PAD = 6;
const BODY_SIZE = 9;
const LINE_H = 11.5;
const NOTE_SIZE = 8;
const NOTE_LINE_H = 10;

/** Colonne della tabella articoli: Descrizione | U.M. | Quantità | m². */
const COL_W = { um: 44, qty: 62, m2: 62 };
const COL_DESC_W = CONTENT_W - COL_W.um - COL_W.qty - COL_W.m2;
const COL_X = {
  desc: MARGIN,
  um: MARGIN + COL_DESC_W,
  qty: MARGIN + COL_DESC_W + COL_W.um,
  m2: MARGIN + COL_DESC_W + COL_W.um + COL_W.qty,
};
const TABLE_HEADER_H = 18;

/** Riquadro finale: dati del trasporto, vettore, firme. */
const FOOTER_ROWS = { transport: 30, carrier: 34, signatures: 50 };
const FOOTER_H = FOOTER_ROWS.transport + FOOTER_ROWS.carrier + FOOTER_ROWS.signatures;
const FOOTER_TOP = PAGE_H - MARGIN - FOOTER_H;
/** Limite inferiore delle righe sulle pagine intermedie (lascia spazio a "Segue"). */
const BODY_LIMIT = PAGE_H - MARGIN - 16;

const C = {
  ink: rgb(0.09, 0.11, 0.15),
  muted: rgb(0.4, 0.44, 0.5),
  brand: rgb(0x1d / 255, 0x38 / 255, 0x71 / 255),
  border: rgb(0.45, 0.48, 0.53),
  rule: rgb(0.84, 0.86, 0.89),
  fill: rgb(0.93, 0.945, 0.965),
};

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

const NOTICE_SIZE = 10;
const NOTICE_LINE_H = 13;

/** Confronto di indirizzi senza maiuscole, punteggiatura e a capo. */
function addressKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Paese da stampare nel luogo di destinazione, se non è già scritto nell'indirizzo: il paese di
 * consegna della richiesta se è estero; altrimenti quello del contatto, ma solo se la consegna è al
 * suo indirizzo in anagrafica (sulle richieste precedenti il paese di consegna è stato copiato dal
 * contatto: meglio nessun paese che uno sbagliato).
 */
function destinationCountry(detail: RequestDetail): string | null {
  const address = detail.destinationAddress.trim();
  if (!address) return null;
  const notInAddress = (c: string | null | undefined) =>
    c?.trim() && !addressKey(address).includes(addressKey(c)) ? c.trim().toUpperCase() : null;
  if (isAbroad(detail.destinationCountry)) return notInAddress(detail.destinationCountry);
  const home = detail.contact.defaultAddress?.trim();
  return home && addressKey(home) === addressKey(address) ? notInAddress(detail.contact.country) : null;
}

/**
 * Numero stampato sulla bolla: quello assegnato con «Genera bolla», altrimenti il numero del DDT
 * del gestionale, altrimenti il codice della richiesta. Il PDF non assegna mai un numero da sé.
 */
export function bollaDocNumber(detail: Pick<RequestDetail, "id" | "bollaNumber" | "ddtNumber">): string {
  return detail.bollaNumber?.trim() || detail.ddtNumber?.trim() || requestCode(detail.id);
}

type TextOpts = { size?: number; font?: PDFFont; color?: RGB };

type PageInfo = {
  page: PDFPage;
  /** Coordinate "dall'alto" dell'inizio della tabella su questa pagina. */
  tableTop: number;
  /** Baseline della scritta "Pag. x / y". */
  pageLabelBaseline: number;
};

class BollaWriter {
  readonly pages: PageInfo[] = [];
  page!: PDFPage;
  /** Cursore verticale, misurato dall'alto della pagina. */
  y = 0;

  constructor(
    readonly pdf: PDFDocument,
    readonly fonts: Fonts,
    readonly clean: Sanitizer,
    readonly detail: RequestDetail,
    readonly settings: AppSettings,
    readonly docNumber: string,
    /** Data di emissione: per la bolla generata è quella di generazione, fissa su ogni copia. */
    readonly docDate: string,
    /** Data del trasporto (spedizione o ritiro), vuota finché non è nota. */
    readonly transportDate: string,
  ) {}

  /* --- primitive (coordinate dall'alto) --- */

  text(page: PDFPage, value: string, x: number, baseline: number, opts: TextOpts = {}) {
    const str = this.clean(value);
    if (!str) return;
    page.drawText(str, {
      x,
      y: PAGE_H - baseline,
      size: opts.size ?? BODY_SIZE,
      font: opts.font ?? this.fonts.regular,
      color: opts.color ?? C.ink,
    });
  }

  textRight(page: PDFPage, value: string, xRight: number, baseline: number, opts: TextOpts = {}) {
    const str = this.clean(value);
    const font = opts.font ?? this.fonts.regular;
    const w = font.widthOfTextAtSize(str, opts.size ?? BODY_SIZE);
    this.text(page, str, xRight - w, baseline, opts);
  }

  textCenter(page: PDFPage, value: string, xCenter: number, baseline: number, opts: TextOpts = {}) {
    const str = this.clean(value);
    const font = opts.font ?? this.fonts.regular;
    const w = font.widthOfTextAtSize(str, opts.size ?? BODY_SIZE);
    this.text(page, str, xCenter - w / 2, baseline, opts);
  }

  /** Testo su una riga dentro `maxWidth`: riduce il corpo e, se non basta, tronca con "…". */
  fitText(page: PDFPage, value: string, x: number, baseline: number, maxWidth: number, opts: TextOpts = {}) {
    const font = opts.font ?? this.fonts.regular;
    let size = opts.size ?? BODY_SIZE;
    let str = this.clean(value);
    while (size > 6.5 && font.widthOfTextAtSize(str, size) > maxWidth) size -= 0.5;
    if (font.widthOfTextAtSize(str, size) > maxWidth) {
      while (str && font.widthOfTextAtSize(`${str}…`, size) > maxWidth) str = str.slice(0, -1);
      str = `${str.trimEnd()}…`;
    }
    this.text(page, str, x, baseline, { ...opts, size });
  }

  rect(page: PDFPage, x: number, top: number, w: number, h: number, opts: { fill?: RGB; border?: RGB; width?: number }) {
    page.drawRectangle({
      x,
      y: PAGE_H - top - h,
      width: w,
      height: h,
      color: opts.fill,
      borderColor: opts.border,
      borderWidth: opts.border ? (opts.width ?? 0.75) : 0,
    });
  }

  hline(page: PDFPage, x1: number, x2: number, top: number, color: RGB = C.border, thickness = 0.75) {
    page.drawLine({ start: { x: x1, y: PAGE_H - top }, end: { x: x2, y: PAGE_H - top }, thickness, color });
  }

  vline(page: PDFPage, x: number, top: number, bottom: number, color: RGB = C.border, thickness = 0.75) {
    page.drawLine({ start: { x, y: PAGE_H - top }, end: { x, y: PAGE_H - bottom }, thickness, color });
  }

  wrap(value: string | null | undefined, font: PDFFont, size: number, width: number): string[] {
    return wrapText(value, font, size, width, this.clean);
  }

  /* --- blocchi --- */

  /** Intestazione aziendale, uguale su ogni pagina. */
  drawCompanyHeader(page: PDFPage): number {
    const { settings } = this;
    let y = MARGIN;
    this.fitText(page, settings.companyName, MARGIN, y + 12, CONTENT_W * 0.66, {
      size: 14,
      font: this.fonts.bold,
      color: C.brand,
    });
    y += 18;
    const infoWidth = CONTENT_W * 0.7;
    for (const line of [settings.companyAddress, settings.companyTaxInfo, settings.companyContacts]) {
      for (const l of clampLines(this.wrap(line, this.fonts.regular, 8, infoWidth), 2, this.fonts.regular, 8, infoWidth)) {
        this.text(page, l, MARGIN, y + 8, { size: 8, color: C.muted });
        y += 10;
      }
    }
    // A destra il riferimento della richiesta, utile per abbinare bolla e collo.
    const right = MARGIN + CONTENT_W;
    this.textRight(page, "Rif. richiesta", right, MARGIN + 8, { size: 7.5, color: C.muted });
    this.textRight(page, requestCode(this.detail.id), right, MARGIN + 22, { size: 12, font: this.fonts.bold });
    y = Math.max(y, MARGIN + 28) + 6;
    this.hline(page, MARGIN, right, y, C.brand, 1.2);
    return y + 10;
  }

  /** Titolo, numero e data del documento, causale; registra la posizione di "Pag. x / y". */
  drawTitle(page: PDFPage, top: number): { bottom: number; pageLabelBaseline: number } {
    const right = MARGIN + CONTENT_W;
    this.text(page, "Bolla di consegna", MARGIN, top + 14, { size: 15, font: this.fonts.bold });
    const numberLabel = `N° ${this.docNumber}   del ${this.docDate}`;
    this.textRight(page, numberLabel, right, top + 14, { size: 11, font: this.fonts.bold });

    const causaleLabel = "Causale del trasporto";
    this.text(page, causaleLabel, MARGIN, top + 30, { size: 8, color: C.muted });
    const labelW = this.fonts.regular.widthOfTextAtSize(causaleLabel, 8) + 8;
    this.fitText(page, this.settings.bollaCausale, MARGIN + labelW, top + 30, CONTENT_W - labelW - 70, {
      size: 9,
      font: this.fonts.bold,
    });
    return { bottom: top + 40, pageLabelBaseline: top + 30 };
  }

  /**
   * Riquadri "Cessionario" (il contatto, con il suo indirizzo in anagrafica) e "Luogo di
   * destinazione" (destinatario, «alla c.a.», indirizzo di consegna, preavviso), solo prima pagina.
   */
  drawAddressBoxes(page: PDFPage, top: number): number {
    const { detail } = this;
    const { contact } = detail;
    const gap = 10;
    const boxW = (CONTENT_W - gap) / 2;
    const textW = boxW - 2 * PAD;
    type Line = { text: string; bold?: boolean };

    const toLines = (value: string | null | undefined, bold = false): Line[] =>
      this.wrap(value, bold ? this.fonts.bold : this.fonts.regular, BODY_SIZE, textW).map((t) => ({ text: t, bold }));

    const left: Line[] = [...toLines(contact.name, true)];
    if (contact.company?.trim() && contact.company.trim().toLowerCase() !== contact.name.trim().toLowerCase()) {
      left.push(...toLines(contact.company));
    }
    left.push(...toLines(contact.defaultAddress));
    if (contact.country?.trim()) left.push(...toLines(contact.country.toUpperCase()));
    if (contact.phone?.trim()) left.push(...toLines(`Tel. ${contact.phone}`));

    // Luogo di destinazione: in testa destinatario e «alla c.a.», in fondo paese e telefono del
    // preavviso; se le righe sono troppe si accorcia l'indirizzo, non i dati per il corriere.
    const maxLines = 9;
    const head: Line[] = [...toLines(detail.recipientName?.trim() || contact.name, true)];
    if (detail.attentionOf?.trim()) head.push(...toLines(`Alla c.a.: ${detail.attentionOf.trim()}`));
    const tail: Line[] = [];
    const country = destinationCountry(detail);
    if (country) tail.push(...toLines(country));
    const noticeNumber = detail.phoneNoticeNumber?.trim();
    if (detail.phoneNotice && noticeNumber) tail.push(...toLines(`Tel. ${noticeNumber} (preavviso)`, true));
    const address = toLines(detail.destinationAddress);
    const room = Math.max(1, maxLines - head.length - tail.length);
    const right: Line[] = [...head, ...address.slice(0, room), ...tail];
    if (address.length > room) {
      const last = right[head.length + room - 1];
      last.text = clampLines([last.text, ""], 1, this.fonts.regular, BODY_SIZE, textW)[0];
    }

    const leftLines = left.slice(0, maxLines);
    const h = Math.max(84, 32 + Math.max(leftLines.length, right.length) * LINE_H + 6);

    const draw = (x: number, title: string, lines: Line[]) => {
      this.rect(page, x, top, boxW, h, { border: C.border });
      this.text(page, title, x + PAD, top + 11, { size: 8, font: this.fonts.bold, color: C.brand });
      this.text(page, "Spett.le", x + PAD, top + 21, { size: 7.5, font: this.fonts.italic, color: C.muted });
      lines.forEach((l, i) => {
        this.text(page, l.text, x + PAD, top + 33 + i * LINE_H, {
          font: l.bold ? this.fonts.bold : this.fonts.regular,
        });
      });
    };
    draw(MARGIN, "Cessionario", leftLines);
    draw(MARGIN + boxW + gap, "Luogo di destinazione", right);
    return top + h + 10;
  }

  drawTableHeader(page: PDFPage, top: number): number {
    this.rect(page, MARGIN, top, CONTENT_W, TABLE_HEADER_H, { fill: C.fill });
    const baseline = top + 12;
    const opts = { size: 8, font: this.fonts.bold };
    this.text(page, "Descrizione", COL_X.desc + PAD, baseline, opts);
    this.textCenter(page, "U.M.", COL_X.um + COL_W.um / 2, baseline, opts);
    this.textRight(page, "Quantità", COL_X.qty + COL_W.qty - PAD, baseline, opts);
    this.textRight(page, "m²", COL_X.m2 + COL_W.m2 - PAD, baseline, opts);
    this.hline(page, MARGIN, MARGIN + CONTENT_W, top + TABLE_HEADER_H);
    return top + TABLE_HEADER_H + 4;
  }

  /** Nuova pagina: intestazione, titolo, (destinatari sulla prima) e intestazione tabella. */
  newPage() {
    const first = this.pages.length === 0;
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    let y = this.drawCompanyHeader(this.page);
    const title = this.drawTitle(this.page, y);
    y = title.bottom + 6;
    if (first) y = this.drawAddressBoxes(this.page, y);
    const tableTop = y;
    this.y = this.drawTableHeader(this.page, tableTop);
    this.pages.push({ page: this.page, tableTop, pageLabelBaseline: title.pageLabelBaseline });
  }

  /** Va a pagina nuova se il blocco di altezza `h` non sta nella pagina corrente. */
  ensureSpace(h: number) {
    if (this.y + h > BODY_LIMIT) this.newPage();
  }

  drawItems() {
    const { detail } = this;
    const descW = COL_DESC_W - 2 * PAD;
    // Lo stesso prodotto può comparire in due formati: i m² misurati vanno sulla prima riga.
    const m2Shown = new Set<number>();
    for (const item of detail.items) {
      const product = item.product;
      const name = product.description?.trim() ? `${product.description.trim()} (${product.code})` : product.code;
      const format = sampleFormatText(item.sampleFormat, item.formatNote);
      const label = format ? `${format} — ${name}` : name;
      const descLines = clampLines(this.wrap(label, this.fonts.regular, BODY_SIZE, descW), 10, this.fonts.regular, BODY_SIZE, descW);
      const noteLines = item.notes?.trim()
        ? clampLines(this.wrap(`Nota: ${item.notes.trim()}`, this.fonts.italic, NOTE_SIZE, descW), 4, this.fonts.italic, NOTE_SIZE, descW)
        : [];
      const h = descLines.length * LINE_H + noteLines.length * NOTE_LINE_H + 6;
      this.ensureSpace(h);

      const page = this.page;
      const first = this.y + 9;
      descLines.forEach((l, i) => this.text(page, l, COL_X.desc + PAD, first + i * LINE_H));
      noteLines.forEach((l, i) =>
        this.text(page, l, COL_X.desc + PAD, first + descLines.length * LINE_H + i * NOTE_LINE_H - 1, {
          size: NOTE_SIZE,
          font: this.fonts.italic,
          color: C.muted,
        }),
      );
      this.textCenter(page, "CAD", COL_X.um + COL_W.um / 2, first);
      this.textRight(page, formatNumber(item.quantity, 0), COL_X.qty + COL_W.qty - PAD, first);
      const m2 = m2Shown.has(item.productId) ? undefined : detail.m2ByProduct.get(item.productId);
      m2Shown.add(item.productId);
      if (m2 && m2 > 0) this.textRight(page, formatNumber(m2, 2), COL_X.m2 + COL_W.m2 - PAD, first);
      this.y += h;
      this.hline(page, MARGIN, MARGIN + CONTENT_W, this.y - 2, C.rule, 0.4);
    }

    // Riga dei totali (pezzi richiesti e m² misurati).
    if (detail.items.length > 1 || detail.totalM2 > 0) {
      this.ensureSpace(LINE_H + 8);
      const page = this.page;
      const baseline = this.y + 10;
      const bold = { font: this.fonts.bold };
      this.textRight(page, "Totale", COL_X.um - PAD, baseline, bold);
      const totalQty = detail.items.reduce((sum, i) => sum + i.quantity, 0);
      this.textRight(page, formatNumber(totalQty, 0), COL_X.qty + COL_W.qty - PAD, baseline, bold);
      if (detail.totalM2 > 0) this.textRight(page, formatNumber(detail.totalM2, 2), COL_X.m2 + COL_W.m2 - PAD, baseline, bold);
      this.y += LINE_H + 8;
    }
  }

  /**
   * Preavviso telefonico in grassetto nel corpo, come sul DDT di BGP («PREAVVISO TASSATIVO 1GG
   * PRIMA TEL. …»): il corriere deve chiamare il destinatario prima della consegna.
   */
  drawPhoneNotice() {
    if (this.detail.phoneNotice !== true) return;
    const number = this.detail.phoneNoticeNumber?.trim() || "________________";
    const width = COL_DESC_W - 2 * PAD;
    const lines = this.wrap(`PREAVVISO TELEFONICO TASSATIVO 1 GG PRIMA — TEL. ${number}`, this.fonts.bold, NOTICE_SIZE, width);
    this.y += 8;
    this.ensureSpace(lines.length * NOTICE_LINE_H + 4);
    for (const line of lines) {
      this.text(this.page, line, COL_X.desc + PAD, this.y + 10, { size: NOTICE_SIZE, font: this.fonts.bold });
      this.y += NOTICE_LINE_H;
    }
    this.y += 2;
  }

  /** Note della richiesta (istruzioni di consegna), nella colonna descrizione come sul DDT di BGP. */
  drawNotes() {
    const notes = this.detail.notes?.trim();
    if (!notes) return;
    const width = COL_DESC_W - 2 * PAD;
    const lines = this.wrap(notes, this.fonts.regular, BODY_SIZE, width);
    this.y += 6;
    this.ensureSpace(12 + LINE_H);
    this.text(this.page, "Note", COL_X.desc + PAD, this.y + 9, { size: 8, font: this.fonts.bold, color: C.brand });
    this.y += 12;
    for (const line of lines) {
      this.ensureSpace(LINE_H);
      if (line) this.text(this.page, line, COL_X.desc + PAD, this.y + 9);
      this.y += LINE_H;
    }
  }

  /** Riquadro con colli, aspetto, porto, peso, data, vettore e firme (ultima pagina). */
  drawFooter(page: PDFPage) {
    const { detail, settings } = this;
    let top = FOOTER_TOP;
    const right = MARGIN + CONTENT_W;
    const label = (x: number, t: number, value: string) =>
      this.text(page, value, x + PAD, t + 9, { size: 7, font: this.fonts.bold, color: C.muted });

    // Riga 1: dati del trasporto.
    const cells: [string, string, number][] = [
      ["N. colli", detail.packagesCount ? String(detail.packagesCount) : "", 64],
      ["Aspetto dei beni", settings.bollaAspetto, 110],
      ["Porto", settings.bollaPorto, 150],
      ["Peso lordo (kg)", detail.weightKg ? formatNumber(detail.weightKg, 2) : "", 90],
      ["Data del trasporto", this.transportDate, CONTENT_W - 64 - 110 - 150 - 90],
    ];
    let x = MARGIN;
    for (const [title, value, w] of cells) {
      this.rect(page, x, top, w, FOOTER_ROWS.transport, { border: C.border });
      label(x, top, title);
      this.fitText(page, value, x + PAD, top + 23, w - 2 * PAD, { size: 9.5, font: this.fonts.bold });
      x += w;
    }
    top += FOOTER_ROWS.transport;

    // Riga 2: vettore e numero di tracking.
    const carrierW = CONTENT_W * 0.62;
    this.rect(page, MARGIN, top, carrierW, FOOTER_ROWS.carrier, { border: C.border });
    label(MARGIN, top, "Vettore");
    this.fitText(page, detail.carrier?.name ?? "", MARGIN + PAD, top + 24, carrierW - 2 * PAD, {
      size: 9.5,
      font: this.fonts.bold,
    });
    this.rect(page, MARGIN + carrierW, top, CONTENT_W - carrierW, FOOTER_ROWS.carrier, { border: C.border });
    label(MARGIN + carrierW, top, "N. spedizione / tracking");
    this.fitText(page, detail.trackingNumber?.trim() ?? "", MARGIN + carrierW + PAD, top + 24, CONTENT_W - carrierW - 2 * PAD, {
      size: 9.5,
    });
    top += FOOTER_ROWS.carrier;

    // Riga 3: firme.
    const sigW = CONTENT_W / 3;
    ["Firma vettore", "Firma mittente", "Firma destinatario"].forEach((title, i) => {
      const sx = MARGIN + i * sigW;
      this.rect(page, sx, top, i === 2 ? right - sx : sigW, FOOTER_ROWS.signatures, { border: C.border });
      this.text(page, title, sx + PAD, top + 10, { size: 7.5, font: this.fonts.italic, color: C.muted });
    });
  }

  /** Cornice della tabella e colonne su ogni pagina, "Segue" sulle intermedie, numeri di pagina. */
  finish() {
    const total = this.pages.length;
    const generated = `Generata da Campionature BGP il ${formatDateTime(new Date())}`;
    this.pages.forEach((info, i) => {
      const last = i === total - 1;
      const bottom = last ? FOOTER_TOP - 8 : PAGE_H - MARGIN;
      const { page, tableTop } = info;
      this.rect(page, MARGIN, tableTop, CONTENT_W, bottom - tableTop, { border: C.border });
      for (const x of [COL_X.um, COL_X.qty, COL_X.m2]) this.vline(page, x, tableTop, bottom);
      if (!last) {
        this.textRight(page, "Segue a pagina successiva", COL_X.um - PAD, bottom - 5, {
          size: 7.5,
          font: this.fonts.italic,
          color: C.muted,
        });
      }
      this.textRight(page, `Pag. ${i + 1} / ${total}`, MARGIN + CONTENT_W, info.pageLabelBaseline, { size: 8.5 });
      this.text(page, generated, MARGIN, PAGE_H - 22, { size: 6.5, color: C.muted });
    });
  }
}

export async function generateBollaPdf(detail: RequestDetail, settings: AppSettings): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const clean = makeSanitizer(fonts.regular);
  const code = requestCode(detail.id);
  const docNumber = bollaDocNumber(detail);
  const transportDate = formatDate(detail.shipmentDate || detail.pickupDate);
  const docDate = detail.bollaGeneratedAt
    ? formatDate(detail.bollaGeneratedAt)
    : transportDate || formatDate(todayIso());

  pdf.setTitle(`Bolla di consegna ${docNumber} - ${code}`);
  pdf.setAuthor(settings.companyName);
  pdf.setSubject(`Bolla di consegna campionatura ${code}`);
  pdf.setCreator("Campionature BGP");
  pdf.setProducer("Campionature BGP");
  pdf.setLanguage("it-IT");
  pdf.setCreationDate(new Date());

  const writer = new BollaWriter(pdf, fonts, clean, detail, settings, clean(docNumber), docDate, transportDate);
  writer.newPage();
  writer.drawItems();
  writer.drawPhoneNotice();
  writer.drawNotes();
  // Il riquadro finale va sull'ultima pagina: se non c'è spazio, se ne aggiunge una.
  if (writer.y + 4 > FOOTER_TOP - 8) writer.newPage();
  writer.drawFooter(writer.page);
  writer.finish();

  return pdf.save();
}
