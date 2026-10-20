import { safeReturnPath } from "@/lib/safe-path";

/** Destinazione dopo l'accesso (?next=): solo percorsi interni sicuri, mai di nuovo /login. */
export function safeLoginNext(value: unknown): string | null {
  const path = safeReturnPath(value);
  return path && !path.startsWith("/login") ? path : null;
}
