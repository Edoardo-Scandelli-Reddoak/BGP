"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

const TABS: { href: string; label: string; match: (path: string) => boolean }[] = [
  {
    href: "/impostazioni",
    label: "Utenti",
    match: (p) => p === "/impostazioni" || p.startsWith("/impostazioni/utenti"),
  },
  { href: "/impostazioni/email", label: "Email e notifiche", match: (p) => p.startsWith("/impostazioni/email") },
  { href: "/impostazioni/template", label: "Template email", match: (p) => p.startsWith("/impostazioni/template") },
  { href: "/impostazioni/corrieri", label: "Corrieri", match: (p) => p.startsWith("/impostazioni/corrieri") },
  { href: "/impostazioni/azienda", label: "Bolla e azienda", match: (p) => p.startsWith("/impostazioni/azienda") },
  {
    href: "/impostazioni/registro-email",
    label: "Registro email",
    match: (p) => p.startsWith("/impostazioni/registro-email"),
  },
  {
    href: "/impostazioni/modulo-pubblico",
    label: "Modulo pubblico",
    match: (p) => p.startsWith("/impostazioni/modulo-pubblico"),
  },
];

/** Sotto-navigazione delle impostazioni: su telefono scorre orizzontalmente. */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sezioni delle impostazioni" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-slate-200">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-brand-700 text-brand-800"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
