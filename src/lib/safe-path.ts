/**
 * Percorso interno sicuro per i redirect (?next=, ?ritorno=): solo "/qualcosa" della stessa app.
 * Rifiuta "//host", "/\host", spazi e caratteri di controllo che i browser trasformano in URL esterni.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return null;
  if (s.length > 300 || /[\s\\\u0000-\u001f\u007f]/.test(s)) return null;
  try {
    const base = "http://interno.invalid";
    return new URL(s, base).origin === base ? s : null;
  } catch {
    return null;
  }
}
