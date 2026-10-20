/** Esito standard delle server action, usato con useActionState nei form. */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const NOT_AUTHORIZED: ActionResult<never> = {
  ok: false,
  error: "Non hai i permessi per questa operazione o la sessione è scaduta.",
};

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Converte gli errori di zod in { campo: messaggio } (primo errore per campo). */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
