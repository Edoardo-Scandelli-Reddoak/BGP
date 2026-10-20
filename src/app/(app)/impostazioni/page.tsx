import type { Metadata } from "next";
import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { CreateUserForm } from "@/components/impostazioni/user-forms";
import { Badge } from "@/components/ui/badge";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/roles";

export const metadata: Metadata = { title: "Utenti — Impostazioni" };

export default async function UsersSettingsPage() {
  const me = await requireUser("settings.manage");
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(desc(users.active), asc(users.name));
  const activeCount = rows.filter((u) => u.active).length;

  return (
    <>
      <Card>
        <CardHeader
          title="Utenti"
          description={`${activeCount} attiv${activeCount === 1 ? "o" : "i"} su ${rows.length}. Ogni persona ha il suo accesso e vede solo le viste del proprio ruolo.`}
          actions={
            <a href="#nuovo-utente" className={buttonClasses("primary", "sm")}>
              Nuovo utente
            </a>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="Nessun utente" description="Crea il primo utente con il modulo qui sotto." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>Email</TH>
                <TH>Ruolo</TH>
                <TH>Stato</TH>
                <TH>Ultimo accesso</TH>
                <TH>
                  <span className="sr-only">Azioni</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((u) => (
                <TR key={u.id} className={u.active ? undefined : "text-slate-500"}>
                  <TD className="font-medium">
                    <Link href={`/impostazioni/utenti/${u.id}`} className="text-slate-900 hover:text-brand-700 hover:underline">
                      {u.name}
                    </Link>
                    {u.id === me.id ? (
                      <Badge tone="blue" className="ml-2">
                        Tu
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="whitespace-nowrap">{u.email}</TD>
                  <TD>
                    <Badge tone={u.role === "ADMIN" ? "violet" : "slate"}>{ROLE_LABELS[u.role]}</Badge>
                  </TD>
                  <TD>{u.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="slate">Disattivato</Badge>}</TD>
                  <TD className="whitespace-nowrap">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-slate-400">Mai</span>}
                  </TD>
                  <TD className="text-right">
                    <LinkButton href={`/impostazioni/utenti/${u.id}`} size="sm">
                      Modifica
                    </LinkButton>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card id="nuovo-utente" className="scroll-mt-20 lg:col-span-2">
          <CardHeader title="Nuovo utente" description="L'utente accede con email e password; può cambiarla chiedendo a un amministratore." />
          <CardBody>
            <CreateUserForm minPasswordLength={MIN_PASSWORD_LENGTH} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ruoli" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              {ROLES.map((r) => (
                <div key={r}>
                  <dt className="font-medium text-slate-900">{ROLE_LABELS[r]}</dt>
                  <dd className="text-slate-600">{ROLE_DESCRIPTIONS[r]}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
