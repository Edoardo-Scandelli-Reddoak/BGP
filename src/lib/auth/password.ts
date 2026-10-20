import bcrypt from "bcryptjs";

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Hash (costo 12) di una stringa casuale scartata: confronto "a vuoto" quando l'utente non esiste. */
const DUMMY_HASH = "$2b$12$Sqy3mo3O06ARwrfm.lPrneIKHUB/0fAYtoxoqa6nCbeJp4IvpLX22";

/**
 * Esegue sempre un confronto bcrypt, anche senza hash (utente inesistente): i tempi di risposta
 * del login non rivelano quali email sono registrate.
 */
export async function verifyPasswordConstantTime(password: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}

/** Restituisce un messaggio di errore oppure null se la password è accettabile. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
  }
  return null;
}
