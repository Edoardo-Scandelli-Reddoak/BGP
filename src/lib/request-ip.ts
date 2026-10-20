import "server-only";
import { headers } from "next/headers";

/**
 * IP del client per i limiti di frequenza (login, modulo pubblico).
 *
 * Next.js scrive x-forwarded-for solo se manca, quindi senza un reverse proxy fidato quel valore
 * lo decide il client. In produzione l'app va dietro a un proxy (serve comunque per HTTPS) con
 * TRUST_PROXY=true: allora si usa x-real-ip impostato dal proxy, o l'ultimo indirizzo di
 * x-forwarded-for (quello aggiunto dal proxy, non falsificabile dal client).
 * Senza TRUST_PROXY restituisce null: i chiamanti devono avere anche limiti non basati sull'IP.
 */
export async function getClientIp(): Promise<string | null> {
  if (process.env.TRUST_PROXY !== "true") return null;
  const h = await headers();
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return forwarded?.length ? forwarded[forwarded.length - 1].slice(0, 64) : null;
}
