"use server";

import { redirect } from "next/navigation";
import { checkLogin, LOGIN_LOCKED_MESSAGE } from "@/lib/auth/login-guard";
import { createSession, destroySession } from "@/lib/auth/session";
import { getClientIp } from "@/lib/request-ip";
import { ROLE_HOME } from "@/lib/roles";
import { safeLoginNext } from "./safe-next";

export type LoginState = { error?: string; email?: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Inserisci email e password.", email };

  // Limiti per account (in Postgres) e per IP affidabile; stesso esito per email registrate e non.
  const result = await checkLogin(email, password, await getClientIp());
  if (result.status === "locked") return { error: LOGIN_LOCKED_MESSAGE, email };
  if (result.status === "invalid") return { error: "Email o password non corretti.", email };

  await createSession(result.user.id);
  redirect(safeLoginNext(formData.get("next")) ?? ROLE_HOME[result.user.role]);
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
