import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type Role } from "@/db/schema";
import { can, ROLE_HOME, type Permission } from "@/lib/roles";
import { SESSION_COOKIE, SESSION_RENEW_DAYS, SESSION_TTL_DAYS, sessionCookieOptions } from "./constants";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Crea la sessione e imposta il cookie. Da chiamare in una server action. */
export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** Chiude la sessione corrente (logout). */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  store.delete(SESSION_COOKIE);
}

/** Invalida tutte le sessioni di un utente (disattivazione, reset password). */
export async function destroyUserSessions(userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Utente della richiesta corrente, o null. Memorizzato per la durata del render (React cache),
 * quindi layout, pagina e componenti possono chiamarlo senza ripetere la query.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hashToken(token);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(users.active, true)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Rinnovo "scorrevole" della scadenza lato DB (il cookie lo rinnova src/proxy.ts a ogni pagina).
  if (row.expiresAt.getTime() - Date.now() < SESSION_RENEW_DAYS * DAY_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS) })
      .where(eq(sessions.id, id));
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role };
});

/**
 * Per pagine e layout: utente obbligatorio, opzionalmente con un permesso.
 * Senza sessione → /login; senza permesso → pagina iniziale del ruolo.
 */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect(ROLE_HOME[user.role]);
  return user;
}

/** Per server action e route handler: non reindirizza, restituisce null se non autorizzato. */
export async function getAuthorizedUser(permission?: Permission): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (permission && !can(user.role, permission)) return null;
  return user;
}
