import bcrypt from "bcryptjs";

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Restituisce un messaggio di errore oppure null se la password è accettabile. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
  }
  return null;
}
