import type { PDFFont } from "pdf-lib";

/**
 * I font standard di pdf-lib usano la codifica WinAnsi: un carattere non codificabile fa
 * fallire drawText. Qui normalizziamo ogni stringa prima di disegnarla.
 */

/** Sostituzioni per caratteri frequenti nei dati (anagrafiche importate, note copiate da email). */
const REPLACEMENT_GROUPS: [string, number[]][] = [
  ["'", [0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x00b4]],
  ['"', [0x201c, 0x201d, 0x201e, 0x201f, 0x2033]],
  ["-", [0x2010, 0x2011, 0x2012, 0x2212, 0x2043]],
  [" ", [0x00a0, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000]],
  ["", [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]],
  ["<=", [0x2264]],
  [">=", [0x2265]],
  ["~", [0x2248]],
  ["!=", [0x2260]],
  ["N.", [0x2116]],
  ["->", [0x2192]],
  ["<-", [0x2190]],
  ["v", [0x2713, 0x2714]],
  ["L", [0x0141]],
  ["l", [0x0142]],
  ["D", [0x0110]],
  ["d", [0x0111]],
  ["i", [0x0131]],
];
const REPLACEMENTS = new Map<string, string>(
  REPLACEMENT_GROUPS.flatMap(([to, codePoints]) => codePoints.map((cp): [string, string] => [String.fromCodePoint(cp), to])),
);

export type Sanitizer = (input: string | null | undefined) => string;

/** Crea una funzione che rende la stringa sicura per il font indicato (una riga, senza a capo). */
export function makeSanitizer(font: PDFFont): Sanitizer {
  const supported = new Set(font.getCharacterSet());
  const cache = new Map<string, string>();

  function convertChar(ch: string): string {
    const cached = cache.get(ch);
    if (cached !== undefined) return cached;
    let out: string;
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 9) out = " ";
    else if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) out = "";
    else if (REPLACEMENTS.has(ch)) out = REPLACEMENTS.get(ch) ?? "";
    else if (supported.has(cp)) out = ch;
    else {
      // Lettere accentate fuori da WinAnsi (es. ő, ş, ć): tolgo il diacritico.
      const base = ch.normalize("NFD").replace(/\p{M}+/gu, "");
      out = base && base !== ch && [...base].every((c) => supported.has(c.codePointAt(0) ?? 0)) ? base : "?";
    }
    cache.set(ch, out);
    return out;
  }

  return (input) => {
    if (!input) return "";
    let out = "";
    for (const ch of input.normalize("NFC")) {
      const cp = ch.codePointAt(0) ?? 0;
      out += cp < 128 && cp >= 32 && cp !== 127 && supported.has(cp) ? ch : convertChar(ch);
    }
    return out;
  };
}

/**
 * Divide il testo in righe che stanno in `maxWidth` punti. Rispetta gli a capo del testo,
 * spezza le parole troppo lunghe (codici, URL) carattere per carattere.
 */
export function wrapText(
  text: string | null | undefined,
  font: PDFFont,
  size: number,
  maxWidth: number,
  sanitize: Sanitizer,
): string[] {
  if (!text) return [];
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  const lines: string[] = [];
  for (const rawParagraph of text.split(/\r\n|\r|\n|\u2028|\u2029/)) {
    const paragraph = sanitize(rawParagraph).replace(/ {2,}/g, " ").trim();
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (width(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (width(word) <= maxWidth) {
        current = word;
        continue;
      }
      // Parola più larga della colonna: la spezzo.
      let chunk = "";
      for (const ch of word) {
        if (width(chunk + ch) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
    }
    if (current) lines.push(current);
  }
  // Niente righe vuote all'inizio o in fondo.
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** Limita il numero di righe, chiudendo l'ultima con "…" se il testo è stato tagliato. */
export function clampLines(lines: string[], max: number, font: PDFFont, size: number, maxWidth: number): string[] {
  if (lines.length <= max) return lines;
  const out = lines.slice(0, max);
  let last = out[max - 1];
  while (last && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) last = last.slice(0, -1);
  out[max - 1] = `${last.trimEnd()}…`;
  return out;
}
