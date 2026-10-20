import "server-only";
import { headers } from "next/headers";

/**
 * IP del client per i limiti di frequenza (login, modulo pubblico).
 *
 * Con TRUST_PROXY=true (produzione dietro reverse proxy, che serve comunque per HTTPS) si usa
 * x-real-ip impostato dal proxy, o l'ultimo indirizzo di x-forwarded-for (quello aggiunto dal
 * proxy, non falsificabile dal client).
 * Senza proxy fidato si usa il primo indirizzo di x-forwarded-for, che Next.js compila con l'IP
 * della connessione solo se l'header manca: limita i client normali ma un client malevolo può
 * falsificarlo. Per questo login e modulo pubblico hanno anche limiti non basati sull'IP.
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  if (process.env.TRUST_PROXY !== "true") {
    return h.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || null;
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return forwarded?.length ? forwarded[forwarded.length - 1].slice(0, 64) : null;
}
