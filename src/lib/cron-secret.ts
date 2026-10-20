import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Segreto per chiamare le attività programmate (/api/cron/*): CRON_SECRET, altrimenti derivato da
 * DATABASE_URL (stabile e non noto all'esterno). Senza dipendenze dal database: lo usa anche
 * src/instrumentation.ts.
 */
export function cronSecret(): string | null {
  const configured = process.env.CRON_SECRET?.trim();
  if (configured) return configured;
  const dbUrl = process.env.DATABASE_URL?.trim();
  return dbUrl ? createHash("sha256").update(`bgp-cron:${dbUrl}`).digest("hex") : null;
}

/** Confronto a tempo costante dell'intestazione "Authorization: Bearer <segreto>". */
export function isValidCronAuthorization(header: string | null): boolean {
  const secret = cronSecret();
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
