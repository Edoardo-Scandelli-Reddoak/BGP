/** Nome del cookie di sessione (letto anche da src/proxy.ts per il controllo ottimistico). */
export const SESSION_COOKIE = "bgp_session";
export const SESSION_TTL_DAYS = 14;
/** Rinnovo automatico quando mancano meno di questi giorni alla scadenza. */
export const SESSION_RENEW_DAYS = 7;

/** Attributi del cookie di sessione: uguali alla creazione (login) e al rinnovo (src/proxy.ts). */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}
