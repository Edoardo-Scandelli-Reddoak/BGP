import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/layout/brand";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/roles";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Accesso" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect(ROLE_HOME[user.role]);
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark inverted />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl sm:p-8">
          <h1 className="text-lg font-semibold text-slate-900">Accedi al gestionale</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">Richieste e spedizioni dei campioni BGP.</p>
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>
        <p className="mt-6 text-center text-sm text-brand-100">
          Sei un agente o un cliente?{" "}
          <Link href="/richiedi-campioni" className="font-semibold text-white underline underline-offset-4">
            Richiedi i campioni qui
          </Link>
        </p>
      </div>
    </main>
  );
}
