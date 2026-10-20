"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<LoginState, FormData>(login, null);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.email} autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Accesso in corso…">
        Accedi
      </SubmitButton>
    </form>
  );
}
