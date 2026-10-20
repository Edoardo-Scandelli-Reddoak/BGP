"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/roles";

export type LoginState = { error?: string; email?: string } | null;

// Limite tentativi in memoria (singola istanza): 8 errori in 15 minuti per email+IP.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function isLocked(key: string): boolean {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return a.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

function safeNext(next: FormDataEntryValue | null): string | null {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/login") ? s : null;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Inserisci email e password.", email };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${email}|${ip}`;
  if (isLocked(key)) return { error: "Troppi tentativi. Riprova tra 15 minuti.", email };

  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  const valid = user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!valid) {
    recordFailure(key);
    return { error: "Email o password non corretti.", email };
  }
  attempts.delete(key);
  await createSession(user.id);
  redirect(safeNext(formData.get("next")) ?? ROLE_HOME[user.role]);
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
