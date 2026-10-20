const EMAIL_RE = /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * "a@b.it;c@d.it; " oppure "a@b.it, c@d.it" → ["a@b.it", "c@d.it"].
 * Il file contatti di BGP separa più indirizzi con ";" e spesso termina con ";".
 * Indirizzi non validi e duplicati (senza distinzione maiuscole) vengono scartati.
 */
export function parseEmailList(value: string | null | undefined | string[]): string[] {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : value.split(/[;,\s]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const email = raw.trim().replace(/^mailto:/i, "");
    if (!email || !isValidEmail(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** Indirizzi presenti nel testo ma non validi, per segnalarli nei form. */
export function invalidEmails(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s && !isValidEmail(s));
}

/** Normalizza per il salvataggio: "a@b.it; c@d.it" */
export function formatEmailList(list: string[]): string {
  return list.join("; ");
}
