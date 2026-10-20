import "server-only";
import { getAuthorizedUser, getCurrentUser, type SessionUser } from "@/lib/auth/session";
import type { Permission } from "@/lib/roles";

/** Per i route handler di export: utente autorizzato, oppure la risposta 401 (non autenticato) / 403 (senza permesso). */
export async function authorizeRoute(
  permission: Permission,
): Promise<{ user: SessionUser; response?: never } | { user?: never; response: Response }> {
  const user = await getAuthorizedUser(permission);
  if (user) return { user };
  const current = await getCurrentUser();
  return current
    ? { response: Response.json({ error: "Non hai i permessi per questo export." }, { status: 403 }) }
    : { response: Response.json({ error: "Non autenticato" }, { status: 401 }) };
}
