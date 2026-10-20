"use client";

import { useRef, useState } from "react";
import { createUserAction, resetPasswordAction, updateUserAction } from "@/app/(app)/impostazioni/actions";
import type { Role } from "@/db/schema";
import { ActionMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/roles";
import { PendingButton, useFormAction } from "./form-kit";

const DEFAULT_ROLE: Role = "BACKOFFICE";

/** Password casuale leggibile (senza caratteri ambigui come 0/O, 1/l). */
function randomPassword(length = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function RoleSelect({
  id,
  defaultValue,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  defaultValue: Role;
  disabled?: boolean;
  invalid?: boolean;
  onChange?: (role: Role) => void;
}) {
  return (
    <Select
      id={id}
      name={disabled ? undefined : "role"}
      defaultValue={defaultValue}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange?.(e.target.value as Role)}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </Select>
  );
}

/** `minPasswordLength` arriva dal server (MIN_PASSWORD_LENGTH): password.ts usa bcrypt e non va nel bundle client. */
export function CreateUserForm({ minPasswordLength }: { minPasswordLength: number }) {
  const { state, pending, formRef, onSubmit, fieldError } = useFormAction(createUserAction, { resetOnSuccess: true });
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onReset={() => {
        setRole(DEFAULT_ROLE);
        setShowPassword(false);
      }}
      className="space-y-4"
    >
      <ActionMessage state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome e cognome" htmlFor="new-name" required error={fieldError("name")}>
          <Input id="new-name" name="name" required maxLength={120} autoComplete="off" aria-invalid={!!fieldError("name") || undefined} />
        </Field>
        <Field label="Email" htmlFor="new-email" required error={fieldError("email")} hint="Serve per accedere. Non può essere già usata.">
          <Input
            id="new-email"
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="off"
            aria-invalid={!!fieldError("email") || undefined}
          />
        </Field>
        <Field label="Ruolo" htmlFor="new-role" required error={fieldError("role")} hint={ROLE_DESCRIPTIONS[role]}>
          <RoleSelect id="new-role" defaultValue={DEFAULT_ROLE} invalid={!!fieldError("role")} onChange={setRole} />
        </Field>
        <Field
          label="Password iniziale"
          htmlFor="new-password"
          required
          error={fieldError("password")}
          hint={`Almeno ${minPasswordLength} caratteri. Comunicala all'utente in modo riservato.`}
        >
          <div className="flex gap-2">
            <Input
              ref={passwordRef}
              id="new-password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={minPasswordLength}
              autoComplete="new-password"
              aria-invalid={!!fieldError("password") || undefined}
              className="font-mono"
            />
            <Button
              variant="secondary"
              onClick={() => {
                if (passwordRef.current) passwordRef.current.value = randomPassword();
                setShowPassword(true);
              }}
            >
              Genera
            </Button>
          </div>
        </Field>
      </div>
      <div className="flex justify-end">
        <PendingButton pending={pending} pendingText="Creazione…">
          Crea utente
        </PendingButton>
      </div>
    </form>
  );
}

export type EditableUser = { id: number; name: string; email: string; role: Role; active: boolean };

export function EditUserForm({ user, isSelf }: { user: EditableUser; isSelf: boolean }) {
  const { state, pending, onSubmit, fieldError } = useFormAction(updateUserAction.bind(null, user.id));
  // Dopo il salvataggio i campi si rigenerano con i valori aggiornati dal server.
  const version = `${user.name}|${user.email}|${user.role}|${user.active}`;
  const [role, setRole] = useState<Role>(user.role);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ActionMessage state={state} />
      <div key={version} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome e cognome" htmlFor="edit-name" required error={fieldError("name")}>
          <Input
            id="edit-name"
            name="name"
            required
            maxLength={120}
            defaultValue={user.name}
            aria-invalid={!!fieldError("name") || undefined}
          />
        </Field>
        <Field label="Email" htmlFor="edit-email" required error={fieldError("email")}>
          <Input
            id="edit-email"
            name="email"
            type="email"
            required
            maxLength={200}
            defaultValue={user.email}
            aria-invalid={!!fieldError("email") || undefined}
          />
        </Field>
        <Field
          label="Ruolo"
          htmlFor="edit-role"
          required
          error={fieldError("role")}
          hint={isSelf ? "Non puoi cambiare il tuo ruolo." : ROLE_DESCRIPTIONS[role]}
        >
          <RoleSelect
            id="edit-role"
            defaultValue={user.role}
            disabled={isSelf}
            invalid={!!fieldError("role")}
            onChange={setRole}
          />
          {isSelf ? <input type="hidden" name="role" value={user.role} /> : null}
        </Field>
        <div className="space-y-1.5 sm:pt-7">
          {isSelf ? (
            <>
              <input type="hidden" name="active" value="on" />
              <Checkbox label="Utente attivo" checked disabled readOnly hint="Non puoi disattivare il tuo utente." />
            </>
          ) : (
            <Checkbox
              name="active"
              label="Utente attivo"
              defaultChecked={user.active}
              hint="Un utente disattivato non può accedere; lo storico delle sue attività resta."
            />
          )}
          {fieldError("active") ? (
            <p className="text-sm text-red-600" role="alert">
              {fieldError("active")}
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Se cambi il ruolo o disattivi l&apos;utente, le sue sessioni vengono chiuse e dovrà accedere di nuovo.
      </p>
      <div className="flex justify-end">
        <PendingButton pending={pending} pendingText="Salvataggio…">
          Salva modifiche
        </PendingButton>
      </div>
    </form>
  );
}

export function ResetPasswordForm({
  userId,
  isSelf,
  minPasswordLength,
}: {
  userId: number;
  isSelf: boolean;
  minPasswordLength: number;
}) {
  const { state, pending, formRef, onSubmit, fieldError } = useFormAction(resetPasswordAction.bind(null, userId), {
    resetOnSuccess: true,
  });
  const [visible, setVisible] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  return (
    <form ref={formRef} onSubmit={onSubmit} onReset={() => setVisible(false)} className="space-y-4">
      <ActionMessage state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Nuova password"
          htmlFor="reset-password"
          required
          error={fieldError("password")}
          hint={`Almeno ${minPasswordLength} caratteri.`}
        >
          <Input
            ref={passwordRef}
            id="reset-password"
            name="password"
            type={visible ? "text" : "password"}
            required
            minLength={minPasswordLength}
            autoComplete="new-password"
            className="font-mono"
            aria-invalid={!!fieldError("password") || undefined}
          />
        </Field>
        <Field label="Ripeti la password" htmlFor="reset-confirm" required error={fieldError("confirm")}>
          <Input
            ref={confirmRef}
            id="reset-confirm"
            name="confirm"
            type={visible ? "text" : "password"}
            required
            autoComplete="new-password"
            className="font-mono"
            aria-invalid={!!fieldError("confirm") || undefined}
          />
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        {isSelf
          ? "Stai cambiando la tua password: verrai disconnesso e dovrai accedere di nuovo."
          : "L'utente verrà disconnesso da tutti i dispositivi. Comunicagli la nuova password in modo riservato."}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            const pwd = randomPassword();
            if (passwordRef.current) passwordRef.current.value = pwd;
            if (confirmRef.current) confirmRef.current.value = pwd;
            setVisible(true);
          }}
        >
          Genera password
        </Button>
        <Button variant="ghost" onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? "Nascondi" : "Mostra"}
        </Button>
        <PendingButton
          pending={pending}
          pendingText="Aggiornamento…"
          confirmMessage={isSelf ? "Cambiare la tua password? Verrai disconnesso." : undefined}
        >
          Reimposta password
        </PendingButton>
      </div>
    </form>
  );
}
