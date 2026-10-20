import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { EditUserForm, ResetPasswordForm } from "@/components/impostazioni/user-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { parseDbId } from "@/lib/validation";

export const metadata: Metadata = { title: "Modifica utente — Impostazioni" };

export default async function EditUserPage({ params }: PageProps<"/impostazioni/utenti/[id]">) {
  const me = await requireUser("settings.manage");
  const { id } = await params;
  const userId = parseDbId(id);
  if (userId === null) notFound();

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) notFound();

  const [open] = await db
    .select({ n: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  const isSelf = user.id === me.id;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/impostazioni" className="text-sm font-medium text-brand-700 hover:underline">
            ← Tutti gli utenti
          </Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
            {user.name}
            <Badge tone={user.role === "ADMIN" ? "violet" : "slate"}>{ROLE_LABELS[user.role]}</Badge>
            {user.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="slate">Disattivato</Badge>}
            {isSelf ? <Badge tone="blue">Tu</Badge> : null}
          </h2>
        </div>
      </div>

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <DetailItem label="Email">{user.email}</DetailItem>
            <DetailItem label="Creato il">{formatDateTime(user.createdAt)}</DetailItem>
            <DetailItem label="Ultimo accesso">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Mai"}</DetailItem>
            <DetailItem label="Sessioni aperte">{String(open.n)}</DetailItem>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Dati e ruolo" />
        <CardBody>
          <EditUserForm
            user={{ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active }}
            isSelf={isSelf}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Reimposta password"
          description="Le password sono salvate cifrate: non è possibile vedere quella attuale, solo sostituirla."
        />
        <CardBody>
          <ResetPasswordForm userId={user.id} isSelf={isSelf} minPasswordLength={MIN_PASSWORD_LENGTH} />
        </CardBody>
      </Card>
    </>
  );
}
