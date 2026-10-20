/** Nome del cookie di sessione (letto anche da src/proxy.ts per il controllo ottimistico). */
export const SESSION_COOKIE = "bgp_session";
export const SESSION_TTL_DAYS = 14;
/** Rinnovo automatico quando mancano meno di questi giorni alla scadenza. */
export const SESSION_RENEW_DAYS = 7;
